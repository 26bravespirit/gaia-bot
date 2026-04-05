import type { PipelineContext, PipelineStage } from './types.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { ExtractionScheduler } from './extraction-scheduler.js';
import { logger } from '../utils/logger.js';

/**
 * S4.5 Biographical Fact Extractor — Batch Mode
 *
 * Regex runs synchronously for immediate catches.
 * LLM extraction delegated to shared ExtractionScheduler
 * (coordinated with S4.6 to avoid API concurrency).
 */

// Regex markers for biographical fact detection (immediate layer)
const BIOGRAPHY_MARKERS = [
  /我(小时候|以前|之前|那时候|记得).{5,50}/g,
  /(在|去过|住过|到过)\s*[\u4e00-\u9fa5]{2,8}(的时候|那会儿)/g,
  /(\d{1,2}岁|小学|初中|高中|大学)(的时候|那年|那会)/g,
  /(爸|妈|爷爷|奶奶|外公|外婆|家人|家里).{3,30}/g,
  /我(学|开始学|迷上|喜欢上).{3,20}/g,
];

const AI_LEAK_PATTERN = /聊天框|无法访问|本地文件|系统配置|AI|人工智能|语言模型|机器人|程序|代码|服务器|API|token|prompt/;

export class S45BiographicalExtractor implements PipelineStage {
  name = 'S4.5:BiographicalExtractor';

  constructor(
    private memory: MemoryManager,
    private scheduler: ExtractionScheduler,
  ) {}

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply || !ctx.generatedResponse || ctx.isDegraded) return ctx;
    if (ctx.config.biography?.writeback?.enabled === false) return ctx;

    // Layer 1: Synchronous regex extraction — immediate, zero API cost
    this.regexExtract(ctx);

    // Layer 2: Push to shared scheduler for batch LLM extraction
    this.scheduler.pushBio({
      botResponse: ctx.generatedResponse,
      chatId: ctx.rawChatId,
      timestamp: ctx.rawTimestamp,
      forbiddenFabrications: ctx.config.biography?.forbidden_fabrications || [],
    });

    return ctx;
  }

  private regexExtract(ctx: PipelineContext): void {
    const response = ctx.generatedResponse;
    const forbidden = ctx.config.biography?.forbidden_fabrications || [];
    const extracted: string[] = [];

    for (const pattern of BIOGRAPHY_MARKERS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(response)) !== null) {
        const text = match[0].trim();
        if (text.length >= 5 && text.length <= 100) extracted.push(text);
      }
    }

    for (const factText of [...new Set(extracted)]) {
      if (forbidden.some(f => factText.includes(f))) continue;
      if (AI_LEAK_PATTERN.test(factText)) continue;

      const factId = this.memory.biography.addFact({
        userId: '_self',
        period: this.inferPeriod(factText),
        factContent: factText,
        sourceType: 'generated',
        sourceConversationId: ctx.rawChatId,
        sourceMessageTimestamp: ctx.rawTimestamp,
        importance: 0.4,
        confidence: 0.5,
        isActive: true,
        userVisible: true,
      });

      if (factId !== null) {
        logger.info(`S4.5: regex extracted "${factText}"`);
      }
    }
  }

  private inferPeriod(text: string): string {
    if (/小时候|童年|小学/.test(text)) return '童年';
    if (/初中/.test(text)) return '初中';
    if (/高中|高三/.test(text)) return '高中';
    if (/大学|大一|大二/.test(text)) return '大学';
    if (/以前|之前/.test(text)) return '过去';
    return '现在';
  }
}
