import type { PipelineContext, PipelineStage } from './types.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { callLLM } from '../llm/llm-client.js';
import { logger } from '../utils/logger.js';

/**
 * S4.5 Biographical Fact Extractor
 * Async, fire-and-forget: extracts biographical facts from bot replies.
 * Primary: LLM JSON extraction with 3s timeout.
 * Fallback: regex-based extraction.
 */

// Regex markers for biographical fact detection (fallback)
const BIOGRAPHY_MARKERS = [
  /我(小时候|以前|之前|那时候|记得).{5,50}/g,
  /(在|去过|住过|到过)\s*[\u4e00-\u9fa5]{2,8}(的时候|那会儿)/g,
  /(\d{1,2}岁|小学|初中|高中|大学)(的时候|那年|那会)/g,
  /(爸|妈|爷爷|奶奶|外公|外婆|家人|家里).{3,30}/g,
  /我(学|开始学|迷上|喜欢上).{3,20}/g,
];

const LLM_EXTRACTION_TIMEOUT_MS = 3000;

const EXTRACTION_SYSTEM_PROMPT = `你是一个传记事实提取器。从下面的对话回复中提取关于说话者自身经历的传记事实。
只提取关于说话者个人经历、背景、生活事件的事实，不提取观点或一般性知识。

输出JSON数组，每个元素：
{"period":"时期(童年/初中/高中/大学/过去/现在)","age_approx":大约年龄或null,"fact":"事实内容","importance":0.3-0.9}

如果没有传记事实，返回空数组 []
只返回JSON，不要其他文字。`;

interface ExtractedFact {
  period: string;
  age_approx?: number | null;
  fact: string;
  importance: number;
}

function matchesForbidden(text: string, forbiddenList: string[]): boolean {
  return forbiddenList.some(f => text.includes(f));
}

export class S45BiographicalExtractor implements PipelineStage {
  name = 'S4.5:BiographicalExtractor';

  constructor(private memory: MemoryManager) {}

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply || !ctx.generatedResponse || ctx.isDegraded) return ctx;

    // Respect writeback config
    if (ctx.config.biography?.writeback?.enabled === false) return ctx;

    // Fire-and-forget: extract in background, don't block pipeline
    ctx.biographyExtractionPending = true;
    this.extractAsync(ctx).catch(err => {
      logger.error('S4.5: async extraction failed', { error: String(err) });
    });

    return ctx;
  }

  private async extractAsync(ctx: PipelineContext): Promise<void> {
    const response = ctx.generatedResponse;
    const config = ctx.config;
    const forbiddenFabrications = config.biography?.forbidden_fabrications || [];

    // Try LLM extraction first, fallback to regex on timeout/error
    let extractedFacts: Array<{ period: string; ageApprox?: number; factContent: string; importance: number }> = [];

    try {
      extractedFacts = await this.extractViaLLM(response);
      logger.debug(`S4.5: LLM extracted ${extractedFacts.length} facts`);
    } catch (err) {
      logger.debug(`S4.5: LLM extraction failed (${err}), falling back to regex`);
      extractedFacts = this.extractViaRegex(response);
    }

    if (extractedFacts.length === 0) return;

    let addedCount = 0;

    for (const fact of extractedFacts) {
      // Check forbidden fabrications
      if (matchesForbidden(fact.factContent, forbiddenFabrications)) {
        logger.debug(`S4.5: blocked forbidden fabrication: ${fact.factContent}`);
        continue;
      }

      const factId = this.memory.biography.addFact({
        userId: '_self',
        period: fact.period,
        ageApprox: fact.ageApprox,
        factContent: fact.factContent,
        sourceType: 'generated',
        sourceConversationId: ctx.rawChatId,
        sourceMessageTimestamp: ctx.rawTimestamp,
        importance: fact.importance,
        confidence: 0.7,
        isActive: true,
        userVisible: true,
      });

      if (factId !== null) {
        addedCount++;
      }
    }

    if (addedCount > 0) {
      logger.info(`S4.5: extracted ${addedCount} biographical facts`);
    }
  }

  /**
   * Primary: LLM-based JSON structured extraction with 3s timeout.
   */
  private async extractViaLLM(response: string): Promise<Array<{ period: string; ageApprox?: number; factContent: string; importance: number }>> {
    const messages = [
      { role: 'system' as const, content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user' as const, content: response },
    ];

    // Race LLM call against 3s timeout
    const result = await Promise.race([
      callLLM(messages),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('S4.5 LLM timeout (3s)')), LLM_EXTRACTION_TIMEOUT_MS)
      ),
    ]);

    // Parse JSON response
    const text = result.text.trim();
    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as ExtractedFact[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(f => f.fact && f.period && f.fact.length >= 5 && f.fact.length <= 100)
      .map(f => ({
        period: this.normalizePeriod(f.period),
        ageApprox: f.age_approx ?? undefined,
        factContent: f.fact,
        importance: Math.max(0.3, Math.min(0.9, f.importance || 0.4)),
      }));
  }

  /**
   * Fallback: regex-based extraction when LLM times out or fails.
   */
  private extractViaRegex(response: string): Array<{ period: string; ageApprox?: number; factContent: string; importance: number }> {
    const extracted: string[] = [];

    for (const pattern of BIOGRAPHY_MARKERS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(response)) !== null) {
        const factText = match[0].trim();
        if (factText.length >= 5 && factText.length <= 100) {
          extracted.push(factText);
        }
      }
    }

    const unique = [...new Set(extracted)];
    return unique.map(factText => ({
      period: this.inferPeriod(factText),
      factContent: factText,
      importance: 0.4,
    }));
  }

  private inferPeriod(text: string): string {
    if (/小时候|童年|小学/.test(text)) return '童年';
    if (/初中/.test(text)) return '初中';
    if (/高中|高三/.test(text)) return '高中';
    if (/大学|大一|大二/.test(text)) return '大学';
    if (/以前|之前/.test(text)) return '过去';
    return '现在';
  }

  private normalizePeriod(period: string): string {
    const map: Record<string, string> = {
      '童年': '童年', '小学': '童年', '幼年': '童年',
      '初中': '初中', '中学': '初中',
      '高中': '高中', '高三': '高中',
      '大学': '大学', '大一': '大学', '大二': '大学',
      '过去': '过去', '以前': '过去',
      '现在': '现在', '目前': '现在', '当前': '现在',
    };
    return map[period] || this.inferPeriod(period);
  }
}
