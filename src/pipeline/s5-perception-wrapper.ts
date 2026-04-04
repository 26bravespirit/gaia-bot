import type { PipelineContext, PipelineStage } from './types.js';
import type { IdentityGuardian } from '../engine/identity-guardian.js';
import { logger } from '../utils/logger.js';

export class S5PerceptionWrapper implements PipelineStage {
  name = 'S5:PerceptionWrapper';

  constructor(private guardian: IdentityGuardian) {}

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply || !ctx.generatedResponse) return ctx;

    let response = ctx.generatedResponse;

    // Trim AI tail patterns (reused from GGBot)
    response = trimAiTail(response);

    // Identity guardian check on output
    const guardResult = this.guardian.checkOutput(response);
    if (!guardResult.passed) {
      logger.warn(`S5: identity violation: ${guardResult.violation}`);
      ctx.identityViolation = guardResult.violation;
      response = guardResult.correctedResponse || response;
    }

    // Add sender prefix if @mentioned
    if (ctx.mentionedBot && ctx.resolvedSenderName) {
      if (!response.startsWith(ctx.resolvedSenderName)) {
        response = `${ctx.resolvedSenderName}，${response}`;
      }
    }

    ctx.finalResponse = response;
    return ctx;
  }
}

function trimAiTail(text: string): string {
  const sentences = text.split(/(?<=[。！？!?])\s*/);
  const tailPatterns = [
    /^(如果你(?:愿意|想|需要)|如果需要|如有需要|需要的话)/,
    /^(下一步|接下来)/,
    /^(我可以|我也可以|我还能|我能继续|需要我|要不要我|是否要我)/,
    /^(你也可以|也可以继续)/,
  ];
  while (sentences.length > 1) {
    const last = sentences[sentences.length - 1].trim().replace(/^[，,；;\s]+/, '');
    if (tailPatterns.some(p => p.test(last))) {
      sentences.pop();
    } else {
      break;
    }
  }
  return sentences.join('').trim() || text.trim();
}
