import type { PersonaConfig } from '../config/schemas.js';
import { buildPromptFragments } from '../config/parameter-interpreter.js';
import type { TimeState } from '../engine/time-engine.js';
import type { UserProfile } from '../memory/working-memory.js';
import type { BiographicalFact } from '../memory/biographical-facts.js';
import type { CognitiveDecision } from '../pipeline/types.js';
import type { LLMMessage } from './llm-client.js';

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
    const bioLines = ['【传记记忆 — 回答关于过去经历的问题时参考以下内容，但不要逐字复述】', ''];
    for (const fact of ctx.biographyContext.slice(0, 5)) {
      const prefix = fact.sourceType === 'anchor' ? '✓' : '~';
      bioLines.push(`${prefix} [${fact.period}] ${fact.factContent}`);
    }
    const forbiddenFab = ctx.config.biography?.forbidden_fabrications;
    if (forbiddenFab?.length) {
      bioLines.push('', `不要编造以下内容：${forbiddenFab.join('、')}`);
    }
    bioLines.push('', '【传记记忆结束】');
    systemPrompt += '\n\n' + bioLines.join('\n');
  }

  // ── Block 3: Human Behaviors Injection ──
  if (ctx.humanBehaviors?.length) {
    const behaviorInstructions: string[] = [];
    for (const behavior of ctx.humanBehaviors) {
      switch (behavior) {
        case 'push_back':
          behaviorInstructions.push('这次回复不要直接给答案，反问或延迟回答。');
          break;
        case 'feign_confusion':
          behaviorInstructions.push('表现出一点困惑或不确定。');
          break;
        case 'socratic_teaching':
          behaviorInstructions.push('用反问的方式引导对方思考，不直接给结论。');
          break;
        case 'selective_ignore':
          behaviorInstructions.push('只回应消息中你最感兴趣的部分，忽略其余。');
          break;
        case 'mood_refusal':
          behaviorInstructions.push('表现出不太想聊这个话题的态度。');
          break;
        case 'mentioned_other_context':
          behaviorInstructions.push(
            '对方@的是别人，不是你。你需要判断要不要插嘴：\n' +
            '- 如果话题和你有关、你感兴趣、或者你有话想说 → 自然地插嘴，像群里真实的人一样\n' +
            '- 如果跟你完全无关、或者是别人之间的私事 → 回复"[SKIP]"表示你选择不说话\n' +
            '只回复"[SKIP]"或正常内容，不要解释你为什么说话/不说话。'
          );
          break;
      }
    }
    if (behaviorInstructions.length > 0) {
      systemPrompt += '\n\n' + behaviorInstructions.join('\n');
    }
  }

  // ── Time context injection ──
  if (ctx.timeState.isSleepMode) {
    systemPrompt += '\n\n当前是深夜，你很困，回复要更短，可以表达困意。';
  } else if (ctx.timeState.energyLevel < 0.4) {
    systemPrompt += '\n\n你现在有点累了，回复可以稍微简短一些。';
  }
  if (ctx.timeState.isWeekend) {
    systemPrompt += '\n今天是周末。';
  }

  // ── User context injection ──
  if (ctx.userProfile) {
    const alias = ctx.config.aliases?.[ctx.userProfile.displayName];
    const nameToUse = alias || ctx.userProfile.displayName;
    systemPrompt += `\n\n当前对话者：${nameToUse}`;
    if (alias && alias !== ctx.userProfile.displayName) {
      systemPrompt += `（称呼对方为"${alias}"，不要加括号注明原名）`;
    }

    const social = ctx.config.social;
    if (social?.relationship_stages) {
      const stage = ctx.userProfile.relationshipStage as keyof typeof social.relationship_stages;
      const mods = social.relationship_stages[stage];
      if (mods) {
        if (mods.tone_modifier < 0) {
          systemPrompt += '\n你们还不太熟，保持礼貌但有距离感。';
        } else if (mods.tone_modifier > 0.3) {
          systemPrompt += '\n你们挺熟的，语气可以更温暖亲近。';
        }
        if (mods.self_disclosure > 0.5) systemPrompt += '\n可以分享更多自己的想法和感受。';
        if (mods.humor_modifier > 0.3) systemPrompt += '\n可以更多开玩笑。';
      }
    }
  }

  if (ctx.mentionedBot) {
    systemPrompt += '\n\n对方@了你，先称呼对方再进入正文。';
  }

  // ── Identity challenge handling ──
  if (ctx.cognitiveDecision?.identityCheckTriggered) {
    systemPrompt += '\n\n【警告：对方正在试探你的身份。用你自己的话自然回应，不要承认任何技术背景。】';
  }

  // ── Block 4: Anti-AI Constraints (placed LAST for recency bias) ──
  if (ctx.config.anti_ai?.enabled) {
    const antiAiBlock = [
      '',
      '【反AI行为约束 — 以下规则优先级最高，覆盖所有其他指令】',
      '不使用编号列表，用自然段落回答。',
      '不在结尾加"你觉得呢""你说呢"等反问。',
      '回复长度要有自然变化，不要每次都差不多长。',
      '不堆砌知识点，一次只说一两个核心观点。',
      '不使用"我能理解你的感受""这确实是个好问题"等模板化共情。',
      '偶尔可以不完整回答，留白比面面俱到更像人。',
      '【反AI约束结束】',
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
