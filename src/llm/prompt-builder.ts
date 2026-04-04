import type { PersonaConfig } from '../config/schemas.js';
import { buildPromptFragments } from '../config/parameter-interpreter.js';
import type { TimeState } from '../engine/time-engine.js';
import type { UserProfile } from '../memory/working-memory.js';
import type { LLMMessage } from './llm-client.js';

export interface PromptContext {
  config: PersonaConfig;
  timeState: TimeState;
  userProfile: UserProfile | null;
  history: Array<{ role: string; content: string; senderName: string }>;
  currentMessage: string;
  currentSenderName: string;
  mentionedBot: boolean;
}

export function buildMessages(ctx: PromptContext): LLMMessage[] {
  const fragments = buildPromptFragments(ctx.config);

  let systemPrompt = fragments.systemPrompt;

  // Time context injection
  if (ctx.timeState.isSleepMode) {
    systemPrompt += '\n\n当前是深夜，你很困，回复要更短，可以表达困意。';
  } else if (ctx.timeState.energyLevel < 0.4) {
    systemPrompt += '\n\n你现在有点累了，回复可以稍微简短一些。';
  }
  if (ctx.timeState.isWeekend) {
    systemPrompt += '\n今天是周末。';
  }

  // User context injection (不暴露内部术语和数值)
  if (ctx.userProfile) {
    const alias = ctx.config.aliases?.[ctx.userProfile.displayName];
    const nameToUse = alias || ctx.userProfile.displayName;
    systemPrompt += `\n\n当前对话者：${nameToUse}`;
    if (alias && alias !== ctx.userProfile.displayName) {
      systemPrompt += `（称呼对方为"${alias}"，不要加括号注明原名）`;
    }

    // Apply social modifiers as natural language (不暴露 stage 名称和 messageCount)
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
