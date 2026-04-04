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

    // Apply response delay for more natural feel
    const delay = ctx.timeState?.replyDelayMs ?? 1000;
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, 3000)));

    // Send via Lark
    const msgId = this.lark.sendText(ctx.rawChatId, ctx.finalResponse);

    if (msgId) {
      ctx.deliveryMessageId = msgId;
      ctx.deliveryStatus = 'sent';

      // Record bot response in memory (use the user's ID so it pairs with their messages in conversation_log)
      this.memory.addMessage({
        id: msgId,
        role: 'assistant',
        content: ctx.finalResponse,
        senderName: ctx.config.meta.name,
        senderId: ctx.rawSenderId,
        timestamp: Date.now(),
        chatId: ctx.rawChatId,
      });

      eventBus.publish('response_sent', {
        messageId: msgId,
        chatId: ctx.rawChatId,
        userId: ctx.rawSenderId,
        model: ctx.selectedModel,
        responseLength: ctx.finalResponse.length,
      });

      logger.info(`S6: sent (len=${ctx.finalResponse.length}, model=${ctx.selectedModel})`);
    } else {
      ctx.deliveryStatus = 'failed';
      logger.error('S6: delivery failed');
    }

    return ctx;
  }
}
