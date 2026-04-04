import type { PipelineContext, PipelineStage } from './types.js';
import type { PersonaConfig } from '../config/schemas.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../engine/event-bus.js';

export class PipelineRunner {
  private stages: PipelineStage[] = [];

  addStage(stage: PipelineStage): void {
    this.stages.push(stage);
  }

  async run(input: {
    messageId: string;
    chatId: string;
    senderId: string;
    senderName: string;
    text: string;
    timestamp: number;
  }): Promise<PipelineContext> {
    const ctx: PipelineContext = {
      rawMessageId: input.messageId,
      rawChatId: input.chatId,
      rawSenderId: input.senderId,
      rawSenderName: input.senderName,
      rawText: input.text,
      rawTimestamp: input.timestamp,
      mentionedBot: false,
      config: {} as PersonaConfig,
      userProfile: null,
      history: [],
      timeState: {
        isActiveHours: true,
        isSleepMode: false,
        currentHour: new Date().getHours(),
        energyLevel: 0.8,
        replyDelayMs: 1000,
        sessionMessageCount: 0,
      },
      resolvedSenderName: input.senderName,
      generatedResponse: '',
      selectedModel: '',
      shouldReply: true,
      finalResponse: '',
      deliveryStatus: 'pending',
    };

    for (const stage of this.stages) {
      try {
        await stage.execute(ctx);
        if (!ctx.shouldReply && stage.name !== 'S6:OutboundScheduler') {
          logger.debug(`Pipeline skipped after ${stage.name}: ${ctx.skipReason}`);
          break;
        }
      } catch (err) {
        logger.error(`Pipeline error in ${stage.name}`, { error: String(err) });
        eventBus.publish('error', { stage: stage.name, error: String(err) });
        ctx.shouldReply = false;
        ctx.skipReason = `stage_error:${stage.name}`;
        break;
      }
    }

    return ctx;
  }
}
