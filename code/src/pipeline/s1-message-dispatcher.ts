import type { PipelineContext, PipelineStage } from './types.js';
import { logger } from '../utils/logger.js';

export class S1MessageDispatcher implements PipelineStage {
  name = 'S1:MessageDispatcher';

  private botOpenId: string;
  private mentionPatterns: string[];

  constructor() {
    this.botOpenId = process.env.BOT_OPEN_ID?.trim() || '';
    this.mentionPatterns = (process.env.BOT_MENTION_PATTERNS || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    // Filter: only handle text messages from users
    if (!ctx.rawText) {
      ctx.shouldReply = false;
      ctx.skipReason = 'empty_text';
      return ctx;
    }

    // Check bot self-message
    if (this.botOpenId && ctx.rawSenderId === this.botOpenId) {
      ctx.shouldReply = false;
      ctx.skipReason = 'self_message';
      return ctx;
    }

    // Detect @mention using structured mentions from lark payload
    ctx.mentionedBot = this.isMentionedBot(ctx);

    // Detect if user @mentioned someone else (not the bot)
    const hasMentions = ctx.rawMentions.length > 0;
    ctx.mentionedOther = hasMentions && !ctx.mentionedBot;

    // Clean @mention markers from text (handles multi-word like "@Lark CLI")
    for (const pattern of this.mentionPatterns) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      ctx.rawText = ctx.rawText.replace(new RegExp(escaped, 'gi'), '').trim();
    }
    ctx.rawText = ctx.rawText.replace(/@\S+\s*/g, '').trim();

    if (!ctx.rawText) {
      ctx.shouldReply = false;
      ctx.skipReason = 'empty_after_mention_strip';
      return ctx;
    }

    ctx.shouldReply = true;
    logger.info(`S1: [${ctx.rawSenderName}] ${ctx.rawText.slice(0, 50)}`);
    return ctx;
  }

  private isMentionedBot(ctx: PipelineContext): boolean {
    // Check structured mentions from lark payload
    if (ctx.rawMentions.length > 0 && this.botOpenId) {
      for (const m of ctx.rawMentions) {
        const id = (m.id as Record<string, unknown>)?.open_id || m.open_id;
        if (id === this.botOpenId) return true;
      }
    }

    // Fallback: check text patterns
    const lower = ctx.rawText.toLowerCase();
    return this.mentionPatterns.some(p => lower.includes(p));
  }
}
