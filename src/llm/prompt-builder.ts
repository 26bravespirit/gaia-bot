import type { PersonaConfig } from '../config/schemas.js';
import { buildPromptFragments, getPromptMappings, getConstraints } from '../config/parameter-interpreter.js';
import type { TimeState } from '../engine/time-engine.js';
import type { UserProfile } from '../memory/working-memory.js';
import type { BiographicalFact } from '../memory/biographical-facts.js';
import type { CognitiveDecision } from '../pipeline/types.js';
import type { LLMMessage } from './llm-client.js';
import type { SelfState } from '../memory/memory-manager.js';

export interface PromptContext {
  config: PersonaConfig;
  timeState: TimeState;
  userProfile: UserProfile | null;
  history: Array<{ role: string; content: string; senderName: string }>;
  currentMessage: string;
  currentSenderName: string;
  mentionedBot: boolean;
  biographyContext?: BiographicalFact[];
  humanBehaviors?: string[];
  cognitiveDecision?: CognitiveDecision;
  longTermMemories?: Array<{ type: string; content: string; importance: number }>;
  relationshipState?: { stage: string; intimacyScore: number; interactionCount: number; topicsShared: string[] };
  selfState?: SelfState;
  lengthDistribution?: { ultra_short: number; short: number; normal: number; long: number };
  lengthTemplates?: Record<string, string>;
}

/**
 * v0.2.0 Prompt Assembly Order (P0-3):
 * Block 1: persona_summary (300 tokens)
 * Block 2: biography_constraints (200 tokens)
 * Block 3: parameter_interpreter fragments + human_behaviors (300 tokens)
 * Block 4: anti_ai_constraints (200 tokens, placed last for recency bias)
 */
export function buildMessages(ctx: PromptContext): LLMMessage[] {
  const fragments = buildPromptFragments(ctx.config);

  // ── Block 1: Persona Summary (calibration + self-awareness) ──
  let systemPrompt = fragments.systemPrompt;

  // ── Block 2: Biography Constraints ──
  if (ctx.biographyContext?.length && ctx.cognitiveDecision?.biographyTopic) {
    const constraintsCfg = getConstraints();
    const bioCfg = constraintsCfg.biography as { header: string; footer: string; anchor_prefix: string; generated_prefix: string };
    const bioLines = [bioCfg.header, ''];
    for (const fact of ctx.biographyContext.slice(0, 5)) {
      const prefix = fact.sourceType === 'anchor' ? bioCfg.anchor_prefix : bioCfg.generated_prefix;
      bioLines.push(`${prefix} [${fact.period}] ${fact.factContent}`);
    }
    const forbiddenFab = ctx.config.biography?.forbidden_fabrications;
    if (forbiddenFab?.length) {
      bioLines.push('', `不要编造以下内容：${forbiddenFab.join('、')}`);
    }
    bioLines.push('', bioCfg.footer);
    systemPrompt += '\n\n' + bioLines.join('\n');
  }

  // ── Block 2.5: Long-term Memory Context ──
  if (ctx.longTermMemories?.length) {
    const constraintsCfg = getConstraints();
    const ltmCfg = constraintsCfg.long_term_memory as { header: string; footer: string; type_labels: Record<string, string> };
    const ltmLines = [ltmCfg.header, ''];
    for (const mem of ctx.longTermMemories.slice(0, 5)) {
      const typeLabel = ltmCfg.type_labels[mem.type] || ltmCfg.type_labels.default || '闲聊';
      ltmLines.push(`- [${typeLabel}] ${mem.content}`);
    }
    ltmLines.push('', ltmCfg.footer);
    systemPrompt += '\n\n' + ltmLines.join('\n');
  }

  // ── Block 3: Human Behaviors Injection ──
  if (ctx.humanBehaviors?.length) {
    const mappings = getPromptMappings();
    const behaviorMap = mappings.human_behaviors as Record<string, { instruction: string }>;
    const behaviorInstructions: string[] = [];
    for (const behavior of ctx.humanBehaviors) {
      const entry = behaviorMap[behavior];
      if (entry) {
        behaviorInstructions.push(entry.instruction.trim());
      }
    }
    if (behaviorInstructions.length > 0) {
      systemPrompt += '\n\n' + behaviorInstructions.join('\n');
    }
  }

  // ── Time context injection ──
  const mappings = getPromptMappings();
  const timeCfg = mappings.time_context as Record<string, string>;
  if (ctx.timeState.isSleepMode) {
    systemPrompt += '\n\n' + timeCfg.sleep_mode;
  } else if (ctx.timeState.energyLevel < 0.4) {
    systemPrompt += '\n\n' + timeCfg.low_energy;
  }
  if (ctx.timeState.isWeekend) {
    systemPrompt += '\n' + timeCfg.weekend;
  }

  // ── Self state injection (mood, emotions, social battery) ──
  if (ctx.selfState) {
    const ss = ctx.selfState;
    if (ss.moodBaseline < 0) {
      systemPrompt += '\n你现在心情不太好，回复会更简短直接。';
    } else if (ss.moodBaseline > 0.7) {
      systemPrompt += '\n你心情很好，更愿意多聊几句。';
    }
    if (ss.activeEmotions.length > 0) {
      systemPrompt += `\n当前情绪状态：${ss.activeEmotions.join('、')}`;
    }
    if (ss.socialBattery < 0.3) {
      systemPrompt += '\n你的社交电量快耗尽了，想早点结束对话，回复更简短。';
    } else if (ss.socialBattery < 0.5) {
      systemPrompt += '\n你有点社交疲劳了。';
    }
  }

  // ── User context injection ──
  if (ctx.userProfile) {
    const alias = ctx.config.aliases?.[ctx.userProfile.displayName];
    const nameToUse = alias || ctx.userProfile.displayName;
    systemPrompt += `\n\n当前对话者：${nameToUse}`;
    if (alias && alias !== ctx.userProfile.displayName) {
      systemPrompt += `（称呼对方为"${alias}"，不要加括号注明原名）`;
    }

    // Inject known contact role (prevents guessing hierarchy)
    const contactInfo = ctx.config.known_contacts?.[ctx.userProfile.displayName];
    if (contactInfo) {
      systemPrompt += `\n对方身份：${contactInfo.role}`;
      if (contactInfo.relationship_hint) {
        systemPrompt += `（${contactInfo.relationship_hint}）`;
      }
    } else {
      systemPrompt += '\n你不确定对方的职级和身份，不要猜测对方是上级或下级，以平等态度对话。';
    }

    // Use relationshipState from RelationshipModel (authoritative source)
    const relStage = ctx.relationshipState?.stage || ctx.userProfile.relationshipStage;
    const social = ctx.config.social;
    if (social?.relationship_stages) {
      const stage = relStage as keyof typeof social.relationship_stages;
      const mods = social.relationship_stages[stage];
      if (mods) {
        const constraintsCfg = getConstraints();
        const relHints = constraintsCfg.relationship_hints as Record<string, string>;
        if (mods.tone_modifier < 0) {
          systemPrompt += '\n' + relHints.cold;
        } else if (mods.tone_modifier > 0.3) {
          systemPrompt += '\n' + relHints.warm;
        }
        if (mods.self_disclosure > 0.5) systemPrompt += '\n' + relHints.self_disclosure;
        if (mods.humor_modifier > 0.3) systemPrompt += '\n' + relHints.humor;
        // Basic facts (education, job, hobbies) are public info, always shareable
        systemPrompt += '\n学历、职业、兴趣爱好属于公开信息，任何人问都可以自然地说。只有深层情感、家庭隐私等话题才需要看亲密度。';
      }
    }

    // Inject shared topics for relationship depth
    if (ctx.relationshipState?.topicsShared?.length) {
      systemPrompt += `\n你们之前聊过：${ctx.relationshipState.topicsShared.slice(-5).join('、')}`;
    }
  }

  const mentionCfg = mappings.mention as Record<string, string>;
  if (ctx.mentionedBot) {
    systemPrompt += '\n\n' + mentionCfg.bot_mentioned;
  }

  // ── Identity challenge handling ──
  if (ctx.cognitiveDecision?.identityCheckTriggered) {
    systemPrompt += '\n\n' + (mappings.identity_challenge as string);
  }

  // ── Random length instruction (hot config from DB) ──
  const dist = ctx.lengthDistribution ?? { ultra_short: 0.15, short: 0.35, normal: 0.30, long: 0.20 };
  const tmpl = ctx.lengthTemplates ?? {
    ultra_short: '【这次回复超短，就1-4个字，像"哈哈""好的""真的假的"这种】',
    short: '【这次回复短一点，1-2句话，不超过30字】',
    normal: '【这次正常回复，2-3句话，30-60字左右】',
    long: '【这次可以稍微多说几句，但不超过80字】',
  };
  const roll = Math.random();
  const t1 = dist.ultra_short;
  const t2 = t1 + dist.short;
  const t3 = t2 + dist.normal;
  let lengthHint: string;
  if (roll < t1) lengthHint = tmpl.ultra_short;
  else if (roll < t2) lengthHint = tmpl.short;
  else if (roll < t3) lengthHint = tmpl.normal;
  else lengthHint = tmpl.long;
  systemPrompt += '\n\n' + lengthHint;

  // ── Block 4: Anti-AI Constraints (placed LAST for recency bias) ──
  if (ctx.config.anti_ai?.enabled) {
    const constraintsCfg = getConstraints();
    const antiAiRules = constraintsCfg.anti_ai_rules as string[];
    const antiAiBlock = [
      '',
      constraintsCfg.anti_ai_header as string,
      ...antiAiRules,
      constraintsCfg.anti_ai_footer as string,
    ];
    systemPrompt += '\n' + antiAiBlock.join('\n');
  }

  const messages: LLMMessage[] = [{ role: 'system', content: systemPrompt }];

  // Add history
  for (const msg of ctx.history) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const prefix = role === 'user' ? `${msg.senderName}: ` : '';
    messages.push({ role, content: `${prefix}${msg.content}` });
  }

  // Current message
  const senderPrefix = ctx.currentSenderName ? `${ctx.currentSenderName}: ` : '';
  messages.push({ role: 'user', content: `${senderPrefix}${ctx.currentMessage}` });

  return messages;
}
