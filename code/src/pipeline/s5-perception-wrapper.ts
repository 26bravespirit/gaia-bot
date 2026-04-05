import type { PipelineContext, PipelineStage, S5StepsExecuted } from './types.js';
import type { IdentityGuardian } from '../engine/identity-guardian.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { PersonaConfig } from '../config/schemas.js';
import { logger } from '../utils/logger.js';

/**
 * S5 Perception Wrapper — v0.2.0 Four-Step Sub-Pipeline
 *
 * Step 1: Anti-AI Rules R01-R06
 * Step 2: Memory Blur
 * Step 3: Imperfection injection (catchphrases, typos, filler words)
 * Step 4: Message splitting
 */
export class S5PerceptionWrapper implements PipelineStage {
  name = 'S5:PerceptionWrapper';

  constructor(
    private guardian: IdentityGuardian,
    private memory?: MemoryManager,
  ) {}

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply || !ctx.generatedResponse) return ctx;

    let response = ctx.generatedResponse;
    const config = ctx.config;
    const steps: S5StepsExecuted = {};

    // Degradation path: only run Step 3 + Step 4
    if (ctx.isDegraded) {
      response = this.step3Imperfection(response, config, steps);
      response = trimAiTail(response);
      ctx.finalResponse = response;
      ctx.s5StepsExecuted = steps;
      return ctx;
    }

    // ── Step 1: Anti-AI Rules R01-R06 ──
    const antiAiResult = this.step1AntiAiRules(response, ctx, steps);
    response = antiAiResult;

    // ── Step 2: Memory Blur ──
    response = this.step2MemoryBlur(response, config, steps);

    // ── Step 3: Imperfection Injection ──
    response = this.step3Imperfection(response, config, steps);

    // ── Trim AI tail patterns ──
    response = trimAiTail(response);

    // ── Identity guardian check ──
    const guardResult = this.guardian.checkOutput(response);
    if (!guardResult.passed) {
      logger.warn(`S5: identity violation: ${guardResult.violation}`);
      ctx.identityViolation = guardResult.violation;
      response = guardResult.correctedResponse || response;
    }

    // ── Step 4: Mention prefix ──
    if (ctx.mentionedBot && ctx.resolvedSenderName) {
      if (!response.startsWith(ctx.resolvedSenderName)) {
        response = `${ctx.resolvedSenderName}，${response}`;
      }
    }

    ctx.finalResponse = response;
    ctx.s5StepsExecuted = steps;
    return ctx;
  }

  // ── Step 1: Anti-AI Rules R01-R06 ──
  private step1AntiAiRules(text: string, ctx: PipelineContext, steps: S5StepsExecuted): string {
    const applied: string[] = [];
    const removed: string[] = [];
    let result = text;

    // R01: Enumeration Killer — convert numbered lists to natural text
    // Exemption: if user asked ≥2 questions, skip R01
    const userQuestionCount = (ctx.rawText.match(/[？?]/g) || []).length;
    if (userQuestionCount < 2) {
      const listPattern = /(?:^|\n)\s*(?:\d+[\.、）)]\s*|[-·•]\s*)/gm;
      if (listPattern.test(result)) {
        result = result.replace(/(?:^|\n)\s*(?:\d+[\.、）)]\s*|[-·•]\s*)/gm, (match, offset) => {
          if (offset === 0) return '';
          return '，';
        }).replace(/^，/, '').replace(/，+/g, '，');
        applied.push('R01');
        removed.push('numbered_list');
      }
    }

    // R02: Tail Question Remover — catch ALL trailing guiding questions
    const tailQuestionPatterns = [
      /[，,\s]*(你(觉得|说|看|认为)?呢[？?]?)$/,
      /[，,\s]*(对吧[？?]?)$/,
      /[，,\s]*(你(有|想|要|会|能|敢|愿意).*[吗嘛么][？?]?)$/,
      /[，,\s]*(想(试试|聊聊|了解|知道|看看).*[吗嘛么？?]?)$/,
      /[，,\s]*(要不要.*[？?]?)$/,
      /[，,\s]*(有兴趣[吗嘛么]?[？?]?)$/,
      /[，,\s]*(好奇[吗嘛么]?[？?]?)$/,
      /[，,\s]*(怎么样[？?]?)$/,
      /[，,\s]*(如何[？?]?)$/,
      /[，,\s]*(感兴趣[吗嘛么]?[？?]?)$/,
    ];
    for (const p of tailQuestionPatterns) {
      if (p.test(result)) {
        const before = result;
        result = result.replace(p, '');
        if (result !== before) {
          applied.push('R02');
          removed.push('tail_question');
          break;
        }
      }
    }

    // R03: Hedge Opener Remover
    const hedgePatterns = [
      /^(我觉得|我认为|在我看来|据我所知)[，,\s]*/,
      /^(其实|说实话|坦白说)[，,\s]*/,
    ];
    for (const p of hedgePatterns) {
      if (p.test(result) && Math.random() < 0.5) {
        result = result.replace(p, '');
        applied.push('R03');
        removed.push('hedge_opener');
        break;
      }
    }

    // R04: Length Safety Net — only truncate extreme outliers
    // Normal length control is done probabilistically in prompt-builder
    const targetLen = ctx.config.language.base_style.avg_message_length;
    if (result.length > targetLen * 3) {
      const originalText = result;
      // Truncate at a natural break point
      const sentences = result.split(/(?<=[。！？!?\n])/);
      let truncated = '';
      for (const s of sentences) {
        if (truncated.length + s.length > targetLen * 2) break;
        truncated += s;
      }
      if (truncated.length > 10) {
        result = truncated;
        applied.push('R04');
        removed.push('over_length');

        // P1-3: Truncation feedback — mark biography facts in truncated portion as user_visible=false
        if (this.memory) {
          const truncatedPortion = originalText.slice(truncated.length);
          this.markTruncatedFactsInvisible(truncatedPortion);
        }
      }
    }

    // R05: Knowledge Dump Compressor
    const knowledgeDumpIndicators = [
      /首先.*其次.*最后/s,
      /第一.*第二.*第三/s,
      /一方面.*另一方面/s,
    ];
    for (const p of knowledgeDumpIndicators) {
      if (p.test(result)) {
        // Keep only the first point
        const sentences = result.split(/(?<=[。！？!?])/);
        if (sentences.length > 3) {
          result = sentences.slice(0, 2).join('');
          applied.push('R05');
          removed.push('knowledge_dump');
        }
        break;
      }
    }

    // R06: Empathy Template Variation
    const empathyTemplates = [
      { pattern: /我(能|可以)理解你的(感受|心情)/, replacement: '嗯我懂' },
      { pattern: /这(确实|的确)是一个(很好|不错)的(问题|想法)/, replacement: '嗯' },
      { pattern: /感谢你的(分享|信任)/, replacement: '' },
    ];
    for (const { pattern, replacement } of empathyTemplates) {
      if (pattern.test(result)) {
        result = result.replace(pattern, replacement).replace(/^[，,\s]+/, '');
        applied.push('R06');
        removed.push('empathy_template');
        break;
      }
    }

    steps.antiAiRules = { applied, removed };
    return result;
  }

  // ── Step 2: Memory Blur ──
  private step2MemoryBlur(text: string, config: PersonaConfig, steps: S5StepsExecuted): string {
    const blurConfig = config.memory_blur;
    if (!blurConfig?.enabled) {
      steps.memoryBlur = { triggered: false, patterns: [] };
      return text;
    }

    const patterns: string[] = [];

    // Detect blur triggers
    const hasTrigger = blurConfig.blur_triggers.some(trigger => {
      switch (trigger) {
        case 'specific_date':
          return /\d{4}年|\d{1,2}月\d{1,2}[日号]|上周|去年|前天/.test(text);
        case 'exact_sequence':
          return /第一次.*第二次|先.*然后.*接着/.test(text);
        case 'low_importance_detail':
          return text.length > 80 && /具体来说|详细地说/.test(text);
        default:
          return false;
      }
    });

    if (hasTrigger && Math.random() < blurConfig.blur_rate) {
      // Apply blur: prefix a blur expression
      const blurExpr = blurConfig.blur_expressions[
        Math.floor(Math.random() * blurConfig.blur_expressions.length)
      ];
      if (blurExpr) {
        text = blurExpr + text;
        patterns.push('date_blur');
      }
    }

    steps.memoryBlur = { triggered: patterns.length > 0, patterns };
    return text;
  }

  // ── Step 3: Imperfection Injection ──
  private step3Imperfection(text: string, config: PersonaConfig, steps: S5StepsExecuted): string {
    const vocab = config.language.vocabulary;
    const imperf = config.language.imperfection;
    let addedTypos = false;
    let addedFillers = false;
    let addedCatchphrases = false;

    // Catchphrase injection
    if (vocab?.catchphrases?.length && Math.random() < (vocab.catchphrase_frequency || 0.2)) {
      const phrase = vocab.catchphrases[Math.floor(Math.random() * vocab.catchphrases.length)];
      // Insert at a random sentence boundary
      const sentences = text.split(/(?<=[。！？!?，,])/);
      if (sentences.length > 1) {
        const pos = Math.floor(Math.random() * (sentences.length - 1)) + 1;
        sentences.splice(pos, 0, phrase);
        text = sentences.join('');
        addedCatchphrases = true;
      }
    }

    // Filler word injection
    if (imperf?.filler_words?.length && Math.random() < 0.15) {
      const filler = imperf.filler_words[Math.floor(Math.random() * imperf.filler_words.length)];
      // Insert at start of a random sentence
      const sentences = text.split(/(?<=[。！？!?])/);
      if (sentences.length > 1) {
        const pos = Math.floor(Math.random() * (sentences.length - 1)) + 1;
        sentences[pos] = filler + sentences[pos];
        text = sentences.join('');
        addedFillers = true;
      }
    }

    // Typo injection (very subtle)
    if (imperf && imperf.typo_rate > 0 && Math.random() < imperf.typo_rate) {
      // Simple: occasional character swap in one word
      const chars = [...text];
      if (chars.length > 10) {
        const pos = Math.floor(Math.random() * (chars.length - 2)) + 1;
        // Only swap adjacent Chinese chars
        if (/[\u4e00-\u9fa5]/.test(chars[pos]) && /[\u4e00-\u9fa5]/.test(chars[pos + 1])) {
          [chars[pos], chars[pos + 1]] = [chars[pos + 1], chars[pos]];
          text = chars.join('');
          addedTypos = true;

          // Correction behavior
          if (imperf.correction_behavior === 'sometimes' && Math.random() < 0.3) {
            text += `\n*${chars[pos + 1]}${chars[pos]}`;
          }
        }
      }
    }

    // Incomplete thought injection
    if (imperf && imperf.incomplete_thought_rate > 0 && Math.random() < imperf.incomplete_thought_rate * 0.3) {
      const sentences = text.split(/(?<=[。！？!?])/);
      if (sentences.length > 2) {
        // Truncate last sentence
        const last = sentences[sentences.length - 1];
        if (last.length > 5) {
          sentences[sentences.length - 1] = last.slice(0, Math.floor(last.length * 0.6)) + '...';
          text = sentences.join('');
        }
      }
    }

    steps.imperfection = { addedTypos, addedFillers, addedCatchphrases };
    return text;
  }

  /**
   * P1-3: Mark recently generated biography facts that appear in
   * the truncated portion as user_visible=false.
   */
  private markTruncatedFactsInvisible(truncatedText: string): void {
    if (!this.memory || !truncatedText) return;

    try {
      const recentFacts = this.memory.biography.getAllActiveFacts()
        .filter(f => f.sourceType === 'generated' && f.userVisible);

      for (const fact of recentFacts) {
        if (truncatedText.includes(fact.factContent) || fact.factContent.includes(truncatedText.slice(0, 20))) {
          this.memory.biography.markInvisible(fact.id!);
          logger.debug(`S5 R04: marked fact #${fact.id} as invisible (truncated)`);
        }
      }
    } catch (err) {
      logger.debug(`S5 R04: truncation feedback failed: ${err}`);
    }
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
