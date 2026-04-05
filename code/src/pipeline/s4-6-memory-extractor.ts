import type { PipelineContext, PipelineStage } from './types.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { ExtractionScheduler } from './extraction-scheduler.js';
import { logger } from '../utils/logger.js';

/**
 * S4.6 Long-term Memory Extractor — Batch Mode
 *
 * Regex runs synchronously for immediate catches.
 * LLM extraction delegated to shared ExtractionScheduler
 * (coordinated with S4.5 to avoid API concurrency).
 */

// Regex fallback patterns — run synchronously on every message
const REGEX_PATTERNS: Array<{ pattern: RegExp; type: string; importance: number }> = [
  { pattern: /我(?:最)?(?:喜欢|爱|偏好|迷|钟爱)(.{2,20})/, type: 'factual_detail', importance: 0.7 },
  { pattern: /我(?:在|是)(.{2,15})(?:工作|上班|上学|读书|实习)/, type: 'factual_detail', importance: 0.7 },
  { pattern: /我(?:养了|有一?(?:只|条|个))(.{2,10})/, type: 'factual_detail', importance: 0.6 },
  { pattern: /我(?:老家|家乡|家在|来自|住在)(.{2,10})/, type: 'factual_detail', importance: 0.6 },
  { pattern: /(?:下次|以后|改天)(?:一起|我们)(.{2,15})/, type: 'promise', importance: 0.7 },
  { pattern: /我(?:今天|昨天|刚才|最近)(.{3,20})(?:很开心|很高兴|超爽|太好了)/, type: 'emotional_event', importance: 0.7 },
  { pattern: /我(?:今天|昨天|最近)(.{3,20})(?:难过|伤心|崩溃|生气|烦死)/, type: 'emotional_event', importance: 0.8 },
  { pattern: /我(?:不喜欢|讨厌|受不了|不爱)(.{2,15})/, type: 'factual_detail', importance: 0.6 },
  { pattern: /我(?:觉得|认为)(.{2,10})(?:最好|最棒|最差|最烂)/, type: 'factual_detail', importance: 0.5 },
];

export class S46MemoryExtractor implements PipelineStage {
  name = 'S4.6:MemoryExtractor';

  constructor(
    private memory: MemoryManager,
    private scheduler: ExtractionScheduler,
  ) {}

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply || !ctx.rawText || ctx.isDegraded) return ctx;
    if (ctx.rawText.length < 3) return ctx;

    // Layer 1: Synchronous regex — immediate, zero API cost
    this.regexExtract(ctx);

    // Layer 2: Push to shared scheduler for batch LLM extraction
    this.scheduler.pushLtm({
      userId: ctx.rawSenderId,
      text: ctx.rawText,
      timestamp: ctx.rawTimestamp,
    });

    return ctx;
  }

  private regexExtract(ctx: PipelineContext): void {
    for (const { pattern, type, importance } of REGEX_PATTERNS) {
      const match = ctx.rawText.match(pattern);
      if (match) {
        const content = match[0].trim();
        const existing = this.memory.longTerm.searchByKeywords(ctx.rawSenderId, [content.slice(0, 6)], 3);
        if (existing.some(m => m.content.includes(content.slice(0, 6)) || content.includes(m.content.slice(0, 6)))) {
          continue;
        }
        const keywords = content.replace(/[我的是在了过有很最不]/g, '').match(/[\u4e00-\u9fa5a-zA-Z]{2,}/g) || [];
        this.memory.longTerm.addMemory(ctx.rawSenderId, {
          userId: ctx.rawSenderId,
          type: type as 'emotional_event' | 'promise' | 'shared_experience' | 'factual_detail',
          content,
          keywords: keywords.slice(0, 5),
          importance,
          isForgettable: importance < 0.5,
        });
        logger.info(`S4.6: regex extracted [${type}] "${content}"`);
      }
    }
  }
}
