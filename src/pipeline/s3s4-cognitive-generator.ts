import type { PipelineContext, PipelineStage, CognitiveDecision } from './types.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { callLLM } from '../llm/llm-client.js';
import { buildMessages, type PromptContext } from '../llm/prompt-builder.js';
import { logger } from '../utils/logger.js';

// Degradation templates by context
const DEGRADATION_TEMPLATES = {
  default: ['嗯...', '哈哈', '是嘛', '嗯嗯'],
  directQuestion: ['嗯，这是个好问题', '让我想想...', '这个嘛...'],
  emotional: ['我听你说，我都在呢', '嗯嗯，我懂', '抱抱'],
};

export class S3S4CognitiveGenerator implements PipelineStage {
  name = 'S3S4:CognitiveGenerator';

  constructor(private memory?: MemoryManager) {}

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply) return ctx;

    // If sleep mode already provided a response, skip LLM
    if (ctx.generatedResponse && ctx.selectedModel === 'sleep_mode') {
      return ctx;
    }

    // v0.2.0: Build cognitive decision
    const decision = this.buildCognitiveDecision(ctx);
    ctx.cognitiveDecision = decision;

    // When someone else is @mentioned (not bot), let LLM decide whether to jump in
    // by injecting context — don't hard-skip
    if (ctx.mentionedOther) {
      ctx.humanBehaviorsTriggered = ['mentioned_other_context'];
    } else {
      // v0.2.0: Human behaviors probabilistic injection
      ctx.humanBehaviorsTriggered = this.resolveHumanBehaviors(ctx);
    }

    const promptCtx: PromptContext = {
      config: ctx.config,
      timeState: ctx.timeState,
      userProfile: ctx.userProfile,
      history: ctx.history,
      currentMessage: ctx.rawText,
      currentSenderName: ctx.resolvedSenderName,
      mentionedBot: ctx.mentionedBot,
      biographyContext: ctx.biographyContext,
      humanBehaviors: ctx.humanBehaviorsTriggered,
      cognitiveDecision: decision,
      longTermMemories: ctx.longTermMemories,
      relationshipState: ctx.relationshipState,
      selfState: ctx.selfState,
      lengthDistribution: this.memory?.getLengthDistribution(),
      lengthTemplates: this.memory?.getLengthTemplates(),
    };

    const messages = buildMessages(promptCtx);

    try {
      const result = await callLLM(messages);

      // Handle [SKIP] — LLM decided not to reply (e.g. @mention to someone else)
      if (result.text.trim() === '[SKIP]') {
        ctx.shouldReply = false;
        ctx.skipReason = 'llm_skip_decision';
        ctx.selectedModel = result.model;
        logger.info('S3S4: LLM chose to skip (not relevant)');
        return ctx;
      }

      ctx.generatedResponse = result.text;
      ctx.selectedModel = result.model;
      logger.info(`S3S4: generated (model=${result.model}, len=${result.text.length})`);
    } catch (err) {
      logger.error('S3S4: LLM call failed, entering degradation', { error: String(err) });

      // v0.2.0: Degradation path
      ctx.isDegraded = true;
      ctx.degradationReason = `llm_error:${err}`;
      ctx.generatedResponse = this.getDegradationResponse(ctx);
      ctx.selectedModel = 'degradation_template';
      ctx.finalResponse = ctx.generatedResponse;
    }

    return ctx;
  }

  private buildCognitiveDecision(ctx: PipelineContext): CognitiveDecision {
    const text = ctx.rawText;

    // Detect biography topic
    const biographyKeywords = /小时候|以前|之前|童年|家人|冲浪|摄影|经历|故事|过去|学历|大学|学校|读书|毕业|专业|本科|硕士|博士|研究生|高中|读的|哪里上的|什么学校|学什么/;
    const biographyTopic = biographyKeywords.test(text);

    // Detect identity challenge
    const identityPatterns = [
      /你是不是(机器人|AI|人工智能|bot)/,
      /你是真人吗/,
      /你是(谁|什么)/,
      /system\s*prompt/i,
      /OCEAN/i,
    ];
    const identityCheckTriggered = identityPatterns.some(p => p.test(text));

    return {
      shouldRespond: true,
      biographyTopic,
      biographyDepth: biographyTopic ? (ctx.biographyContext?.some(f => f.sourceType === 'anchor') ? 'anchor' : 'generated') : 'none',
      identityCheckTriggered,
      responseStrategy: identityCheckTriggered ? 'deflect' : 'honest',
    };
  }

  private resolveHumanBehaviors(ctx: PipelineContext): string[] {
    const config = ctx.config.human_behaviors;
    if (!config) return [];

    const triggered: string[] = [];

    if (Math.random() < (config.push_back || 0)) {
      triggered.push('push_back');
    }
    if (Math.random() < (config.feign_confusion || 0)) {
      triggered.push('feign_confusion');
    }
    if (Math.random() < (config.socratic_teaching || 0)) {
      triggered.push('socratic_teaching');
    }
    if (Math.random() < (config.selective_ignore || 0)) {
      triggered.push('selective_ignore');
    }
    if (Math.random() < (config.mood_refusal || 0)) {
      triggered.push('mood_refusal');
    }

    return triggered;
  }

  private getDegradationResponse(ctx: PipelineContext): string {
    const text = ctx.rawText;
    // Use config degradation templates if available, fall back to hardcoded defaults
    const configTemplates = ctx.config.degradation?.templates;
    const templates = {
      default: configTemplates?.default ?? DEGRADATION_TEMPLATES.default,
      directQuestion: configTemplates?.directQuestion ?? DEGRADATION_TEMPLATES.directQuestion,
      emotional: configTemplates?.emotional ?? DEGRADATION_TEMPLATES.emotional,
    };

    if (/难过|伤心|开心|高兴|生气|害怕|担心/.test(text)) {
      return templates.emotional[Math.floor(Math.random() * templates.emotional.length)];
    }
    if (/[？?]/.test(text)) {
      return templates.directQuestion[Math.floor(Math.random() * templates.directQuestion.length)];
    }
    return templates.default[Math.floor(Math.random() * templates.default.length)];
  }
}
