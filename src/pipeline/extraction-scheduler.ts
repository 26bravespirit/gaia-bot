import type { MemoryManager } from '../memory/memory-manager.js';
import { callLLM } from '../llm/llm-client.js';
import { logger } from '../utils/logger.js';

/**
 * ExtractionScheduler — shared coordinator for S4.5 and S4.6
 *
 * Both extractors push to this scheduler. It batches and serializes
 * LLM calls so S4.5 and S4.6 NEVER compete for API concurrency.
 *
 * Flush cycle:
 *   1. Wait for BATCH_SIZE items OR BATCH_INTERVAL timeout
 *   2. Process biography batch (from bot responses)
 *   3. Then process LTM batch (from user messages) — sequential, not parallel
 *   4. Clear buffers
 */

const BATCH_SIZE = 5;
const BATCH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// ── Biography extraction prompt ──

const BIO_BATCH_PROMPT = `你是一个传记事实提取器。以下是对话中bot的多条回复。
提取关于bot自身经历、背景、生活事件的传记事实。
只提取个人经历，不提取观点或一般性知识。

输出JSON数组：
[{"period":"时期(童年/初中/高中/大学/过去/现在)","age_approx":大约年龄或null,"fact":"事实内容","importance":0.3-0.9}]

没有传记事实返回 []
只返回JSON。`;

// ── LTM extraction prompt ──

const LTM_BATCH_PROMPT = `你是一个记忆提取器。以下是用户在最近几条消息中说的内容。
请提取所有值得长期记住的信息。

提取类别：
- emotional_event: 情感事件（开心/难过/生气的事）
- promise: 承诺或约定（"下次一起去""我会..."）
- shared_experience: 共同经历（"我们上次..."）
- factual_detail: 个人事实（偏好、习惯、工作、家庭、口味、观点）

规则：
- 提取"用户"说的信息，不是bot说的
- 合并重复信息（如多次提到同一偏好，只记一条）
- 隐式偏好也要提取（如"蓝山咖啡" → 用户喜欢蓝山咖啡）
- 不提取日常寒暄（你好/哈哈/嗯嗯）

输出JSON数组：
[{"type":"类别","content":"记忆内容（简短概括）","keywords":["关键词1","关键词2"],"importance":0.3-0.9}]

没有值得记忆的内容返回 []`;

// ── AI identity filter ──

const AI_LEAK_PATTERN = /聊天框|无法访问|本地文件|系统配置|AI|人工智能|语言模型|机器人|程序|代码|服务器|API|token|prompt/;

// ── Buffer types ──

interface BioEntry {
  botResponse: string;
  chatId: string;
  timestamp: number;
  forbiddenFabrications: string[];
}

interface LtmEntry {
  userId: string;
  text: string;
  timestamp: number;
}

export class ExtractionScheduler {
  private bioBuffer: BioEntry[] = [];
  private ltmBuffer: LtmEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private flushPromise: Promise<void> | null = null;
  private messageCount = 0;

  constructor(private memory: MemoryManager) {}

  /** Called by S4.5 — push bot response for biography extraction */
  pushBio(entry: BioEntry): void {
    this.bioBuffer.push(entry);
    this.messageCount++;
    this.checkFlush();
  }

  /** Called by S4.6 — push user message for LTM extraction */
  pushLtm(entry: LtmEntry): void {
    this.ltmBuffer.push(entry);
    this.messageCount++;
    this.checkFlush();
  }

  private checkFlush(): void {
    if (this.messageCount >= BATCH_SIZE) {
      this.scheduleFlush(0); // immediate
    } else if (!this.flushTimer) {
      this.scheduleFlush(BATCH_INTERVAL_MS); // delayed
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(err => {
        logger.warn(`ExtractionScheduler: flush failed: ${err}`);
      });
    }, delayMs);
  }

  private flush(): Promise<void> {
    if (this.flushing) return this.flushPromise ?? Promise.resolve();
    this.flushing = true;
    this.messageCount = 0;

    this.flushPromise = this.doFlush().finally(() => {
      this.flushing = false;
      this.flushPromise = null;
    });

    return this.flushPromise;
  }

  private async doFlush(): Promise<void> {
    // Take snapshots and clear buffers
    const bioBatch = this.bioBuffer.splice(0);
    const ltmBatch = this.ltmBuffer.splice(0);

    const totalItems = bioBatch.length + ltmBatch.length;
    if (totalItems === 0) return;

    logger.info(`ExtractionScheduler: flushing ${bioBatch.length} bio + ${ltmBatch.length} ltm entries`);

    // Step 1: Process biography batch (sequential — no parallel LLM calls)
    if (bioBatch.length > 0) {
      await this.flushBio(bioBatch);
    }

    // Step 2: Process LTM batch (after bio completes)
    if (ltmBatch.length > 0) {
      await this.flushLtm(ltmBatch);
    }
  }

  private async flushBio(batch: BioEntry[]): Promise<void> {
    const responses = batch.map((e, i) => `${i + 1}. ${e.botResponse}`).join('\n');
    const forbiddenAll = [...new Set(batch.flatMap(e => e.forbiddenFabrications))];

    try {
      const result = await callLLM([
        { role: 'system', content: BIO_BATCH_PROMPT },
        { role: 'user', content: `Bot的回复：\n${responses}` },
      ]);

      if (!result?.text) return;
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const facts = JSON.parse(jsonMatch[0]) as Array<{
        period: string; age_approx?: number | null; fact: string; importance: number;
      }>;

      let added = 0;
      for (const f of facts) {
        if (!f.fact || f.fact.length < 5 || f.fact.length > 100) continue;
        if (forbiddenAll.some(fb => f.fact.includes(fb))) continue;
        if (AI_LEAK_PATTERN.test(f.fact)) continue;

        const factId = this.memory.biography.addFact({
          userId: '_self',
          period: this.normalizePeriod(f.period),
          ageApprox: f.age_approx ?? undefined,
          factContent: f.fact,
          sourceType: 'generated',
          sourceConversationId: batch[0].chatId,
          sourceMessageTimestamp: batch[0].timestamp,
          importance: Math.max(0.3, Math.min(0.9, f.importance || 0.4)),
          confidence: 0.7,
          isActive: true,
          userVisible: true,
        });

        if (factId !== null) {
          added++;
          logger.info(`S4.5: batch stored [${f.period}] "${f.fact}"`);
        }
      }

      logger.info(`S4.5: batch complete — ${added} new facts from ${batch.length} responses`);
    } catch (err) {
      logger.warn(`S4.5: batch LLM error: ${err}`);
    }
  }

  private async flushLtm(batch: LtmEntry[]): Promise<void> {
    const userId = batch[0].userId;
    const messages = batch.map((e, i) => `${i + 1}. ${e.text}`).join('\n');

    try {
      const result = await callLLM([
        { role: 'system', content: LTM_BATCH_PROMPT },
        { role: 'user', content: `用户最近的消息：\n${messages}` },
      ]);

      if (!result?.text) return;
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const items = JSON.parse(jsonMatch[0]) as Array<{
        type: string; content: string; keywords: string[]; importance: number;
      }>;

      const validTypes = ['emotional_event', 'promise', 'shared_experience', 'factual_detail'];
      let added = 0;

      for (const item of items) {
        if (!validTypes.includes(item.type)) continue;
        if (!item.content || item.content.length < 3) continue;

        // Deduplicate
        const existing = this.memory.longTerm.searchByKeywords(
          userId, item.keywords?.slice(0, 2) || [item.content.slice(0, 4)], 3
        );
        if (existing.some(m => m.content === item.content)) continue;

        this.memory.longTerm.addMemory(userId, {
          userId,
          type: item.type as 'emotional_event' | 'promise' | 'shared_experience' | 'factual_detail',
          content: item.content,
          keywords: item.keywords || [],
          importance: Math.max(0.3, Math.min(0.9, item.importance || 0.5)),
          isForgettable: item.importance < 0.5,
        });
        added++;
        logger.info(`S4.6: batch stored [${item.type}] "${item.content}"`);
      }

      logger.info(`S4.6: batch complete — ${added} new memories from ${batch.length} messages`);
    } catch (err) {
      logger.warn(`S4.6: batch LLM error: ${err}`);
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    // Wait for in-flight flush to complete before draining remaining buffer
    if (this.flushPromise) {
      await this.flushPromise;
    }
    if (this.bioBuffer.length > 0 || this.ltmBuffer.length > 0) {
      await this.flush();
    }
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
    return map[period] || '现在';
  }
}
