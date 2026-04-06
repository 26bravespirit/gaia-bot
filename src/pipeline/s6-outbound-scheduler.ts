import type { PipelineContext, PipelineStage } from './types.js';
import type { LarkClient } from '../lark/lark-client.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { eventBus } from '../engine/event-bus.js';
import { logger } from '../utils/logger.js';

export class S6OutboundScheduler implements PipelineStage {
  name = 'S6:OutboundScheduler';

  constructor(
    private lark: LarkClient,
    private memory: MemoryManager,
  ) {}

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply || !ctx.finalResponse) {
      ctx.deliveryStatus = 'failed';
      return ctx;
    }

    // Re-check channel enabled right before delivery (may have been toggled during pipeline)
    const channelEnabled = this.memory.getRuntimeConfig('channel_feishu_enabled');
    if (channelEnabled === 'false') {
      ctx.deliveryStatus = 'failed';
      ctx.skipReason = 'channel_disabled_during_pipeline';
      logger.info('S6: channel disabled during pipeline, dropping response');
      return ctx;
    }

    // Split multi-paragraph response into separate messages (like a real person)
    const segments = this.splitIntoMessages(ctx.finalResponse);

    // Apply initial response delay
    const delay = ctx.timeState?.replyDelayMs ?? 1000;
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, 3000)));

    // Send each segment as a separate message
    const sentIds: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      if (i > 0) {
        // Typing delay between messages: 500-1500ms based on segment length
        const typingDelay = Math.min(500 + segments[i].length * 15, 1500);
        await new Promise(resolve => setTimeout(resolve, typingDelay));
      }

      const msgId = this.lark.sendText(ctx.rawChatId, segments[i]);
      if (msgId) sentIds.push(msgId);
    }

    if (sentIds.length > 0) {
      ctx.deliveryMessageId = sentIds[0];
      ctx.deliveryStatus = 'sent';

      // Record full response in memory as one entry
      this.memory.addMessage({
        id: sentIds[0],
        role: 'assistant',
        content: ctx.finalResponse,
        senderName: ctx.config.meta.name,
        senderId: ctx.rawSenderId,
        timestamp: Date.now(),
        chatId: ctx.rawChatId,
      });

      eventBus.publish('response_sent', {
        messageId: sentIds[0],
        chatId: ctx.rawChatId,
        userId: ctx.rawSenderId,
        model: ctx.selectedModel,
        responseLength: ctx.finalResponse.length,
      });

      logger.info(`S6: sent ${segments.length} msg(s) (len=${ctx.finalResponse.length}, model=${ctx.selectedModel})`);
    } else {
      ctx.deliveryStatus = 'failed';
      logger.error('S6: delivery failed');
    }

    return ctx;
  }

  /**
   * Split response into separate messages at paragraph breaks.
   * Real people send multiple short messages, not one long block.
   */
  private splitIntoMessages(text: string): string[] {
    // Split on double newlines (paragraph breaks)
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);

    // If only 1 paragraph or very short, send as-is
    if (paragraphs.length <= 1) return [text.trim()];

    // Merge very short consecutive paragraphs (< 15 chars) into one message
    const merged: string[] = [];
    let buffer = '';
    for (const p of paragraphs) {
      if (buffer && p.length < 15 && buffer.length < 60) {
        buffer += '\n' + p;
      } else {
        if (buffer) merged.push(buffer);
        buffer = p;
      }
    }
    if (buffer) merged.push(buffer);

    return merged;
  }
}
