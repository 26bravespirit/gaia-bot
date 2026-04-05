import type { PipelineContext, PipelineStage } from './types.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { TimeEngine } from '../engine/time-engine.js';
import type { PersonaConfig } from '../config/schemas.js';

export class S2ContextAssembler implements PipelineStage {
  name = 'S2:ContextAssembler';

  constructor(
    private memory: MemoryManager,
    private timeEngine: TimeEngine,
    private getConfig: () => PersonaConfig,
  ) {}

  private biographyKeywordPatterns = [
    /小时候|童年|以前|之前|过去|记得/,
    /爸|妈|家人|家里|家庭/,
    /冲浪|摄影|拍照|相机|胶片/,
    /深圳|香港|港大|心理学/,
    /初中|高中|大学|小学/,
  ];

  private extractKeywords(text: string): string[] {
    const keywords: string[] = [];
    for (const pattern of this.biographyKeywordPatterns) {
      const match = text.match(pattern);
      if (match) keywords.push(match[0]);
    }
    return keywords;
  }

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply) return ctx;

    const config = this.getConfig();
    ctx.config = config;

    // Load user profile
    ctx.userProfile = this.memory.getUserProfile(ctx.rawSenderId);

    // Resolve sender alias
    ctx.resolvedSenderName = this.memory.resolveAlias(ctx.rawSenderName) || ctx.rawSenderName;

    // Get time state
    ctx.timeState = this.timeEngine.getState();

    // Check sleep mode
    if (ctx.timeState.isSleepMode && !ctx.mentionedBot) {
      const sleepResp = this.timeEngine.getSleepResponse();
      if (sleepResp) {
        ctx.generatedResponse = sleepResp;
        ctx.finalResponse = sleepResp;
        ctx.selectedModel = 'sleep_mode';
        // Skip S3+S4, go directly to S5
        return ctx;
      }
    }

    // Load conversation history (exclude current message — it's added separately by prompt-builder)
    const allHistory = this.memory.getRecentHistory(ctx.rawSenderId, 21);
    // Drop the last entry if it matches the current message (already added to memory before pipeline)
    if (allHistory.length > 0) {
      const last = allHistory[allHistory.length - 1];
      if (last.role === 'user' && last.content === ctx.rawText) {
        allHistory.pop();
      }
    }
    ctx.history = allHistory;

    // v0.2.0: Retrieve biography context (user-visible facts only)
    if (config.biography?.anchors?.length) {
      const keywords = this.extractKeywords(ctx.rawText);
      ctx.biographyContext = this.memory.getBiographyContext(keywords.length > 0 ? keywords : undefined);
    }

    return ctx;
  }
}
