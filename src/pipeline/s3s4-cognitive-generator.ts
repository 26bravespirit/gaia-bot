import type { PipelineContext, PipelineStage } from './types.js';
import { callLLM } from '../llm/llm-client.js';
import { buildMessages, type PromptContext } from '../llm/prompt-builder.js';
import { logger } from '../utils/logger.js';

export class S3S4CognitiveGenerator implements PipelineStage {
  name = 'S3S4:CognitiveGenerator';

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply) return ctx;

    // If sleep mode already provided a response, skip LLM
    if (ctx.generatedResponse && ctx.selectedModel === 'sleep_mode') {
      return ctx;
    }

    const promptCtx: PromptContext = {
      config: ctx.config,
      timeState: ctx.timeState,
      userProfile: ctx.userProfile,
      history: ctx.history,
      currentMessage: ctx.rawText,
      currentSenderName: ctx.resolvedSenderName,
      mentionedBot: ctx.mentionedBot,
    };

    const messages = buildMessages(promptCtx);

    try {
      const result = await callLLM(messages);
      ctx.generatedResponse = result.text;
      ctx.selectedModel = result.model;
      logger.info(`S3S4: generated (model=${result.model}, len=${result.text.length})`);
    } catch (err) {
      logger.error('S3S4: LLM call failed', { error: String(err) });
      ctx.shouldReply = false;
      ctx.skipReason = `llm_error:${err}`;
    }

    return ctx;
  }
}
