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
    const allHistory = this.memory.getRecentHistory(ctx.rawSenderId, (config.memory_config?.immediate_window ?? 20) + 1);
    // Drop the last entry if it matches the current message (already added to memory before pipeline)
    if (allHistory.length > 0) {
      const last = allHistory[allHistory.length - 1];
      if (last.role === 'user' && last.content === ctx.rawText) {
        allHistory.pop();
      }
    }
    ctx.history = allHistory;

    return ctx;
  }
}
