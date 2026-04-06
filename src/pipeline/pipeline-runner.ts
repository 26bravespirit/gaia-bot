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
    messageType?: string;
    timestamp: number;
    mentions?: Array<Record<string, unknown>>;
  }): Promise<PipelineContext> {
    const ctx: PipelineContext = {
      rawMessageId: input.messageId,
      rawChatId: input.chatId,
      rawSenderId: input.senderId,
      rawSenderName: input.senderName,
      rawText: input.text,
      rawMessageType: input.messageType || 'text',
      rawTimestamp: input.timestamp,
      rawMentions: input.mentions || [],
      mentionedBot: false,
      mentionedOther: false,
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
        isWeekend: [0, 6].includes(new Date().getDay()),
        moodBaseline: 0.5,
      },
      resolvedSenderName: input.senderName,
      generatedResponse: '',
      selectedModel: '',
      shouldReply: true,
      finalResponse: '',
      deliveryStatus: 'pending',
    };

    const startTime = Date.now();

    for (const stage of this.stages) {
      // v0.2.0: Skip S4.5 and S5.5 on degradation path
      if (ctx.isDegraded) {
        if (stage.name === 'S4.5:BiographicalExtractor' || stage.name === 'S5.5:AntiAiValidator') {
          logger.debug(`Pipeline degradation: skipping ${stage.name}`);
          continue;
        }
      }

      try {
        const stageStart = Date.now();
        await stage.execute(ctx);
        const stageMs = Date.now() - stageStart;

        if (stageMs > 5000) {
          logger.warn(`Pipeline slow stage: ${stage.name} took ${stageMs}ms`);
        }

        if (!ctx.shouldReply && stage.name !== 'S6:OutboundScheduler') {
          logger.debug(`Pipeline skipped after ${stage.name}: ${ctx.skipReason}`);
          break;
        }
      } catch (err) {
        logger.error(`Pipeline error in ${stage.name}`, { error: String(err) });
        eventBus.publish('error', { stage: stage.name, error: String(err) });

        // v0.2.0: If error in S3S4, enter degradation instead of failing
        if (stage.name.startsWith('S3S4')) {
          ctx.isDegraded = true;
          ctx.degradationReason = `stage_error:${stage.name}`;
          ctx.generatedResponse = '嗯...';
          ctx.finalResponse = ctx.generatedResponse;
          ctx.selectedModel = 'degradation_template';
          logger.warn('Pipeline entering degradation path');
          continue;
        }

        ctx.shouldReply = false;
        ctx.skipReason = `stage_error:${stage.name}`;
        break;
      }
    }

    const totalMs = Date.now() - startTime;
    logger.debug(`Pipeline total: ${totalMs}ms, degraded=${!!ctx.isDegraded}, verdict=${ctx.antiAiVerdict || 'N/A'}`);

    return ctx;
  }
}
