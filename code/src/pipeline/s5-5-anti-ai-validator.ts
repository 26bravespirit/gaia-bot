import type { PipelineContext, PipelineStage, AiFingerprint, AntiAiVerdict } from './types.js';
import { logger } from '../utils/logger.js';

const PASS_THRESHOLD = 30;
const BLOCK_THRESHOLD = 60;

// Dimension weights for weighted average
const WEIGHTS: Record<keyof AiFingerprint, number> = {
  sentenceRegularity: 0.12,
  lexicalDiversity: 0.10,
  lengthRegularity: 0.10,
  connectorFrequency: 0.15,
  empathyTemplateScore: 0.15,
  knowledgeDumpIndex: 0.13,
  completenessScore: 0.10,
  emotionalAuthenticity: 0.15,
};

// Fallback templates when BLOCK triggers
const BLOCK_FALLBACKS = [
  '嗯...这个我一下子说不好',
  '哈哈你问得好突然',
  '等等让我想想',
  '我觉得这个事情吧...算了不说了',
];

/**
 * S5.5 Anti-AI Validator
 * 8-dimension AI fingerprint scoring.
 * PASS (<30) / WARN (30-60) / BLOCK (≥60)
 */
export class S55AntiAiValidator implements PipelineStage {
  name = 'S5.5:AntiAiValidator';

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply || !ctx.finalResponse || ctx.isDegraded) return ctx;

    const antiAi = ctx.config.anti_ai;
    if (!antiAi?.enabled) return ctx;

    const text = ctx.finalResponse;
    const fingerprint = this.analyze(text);
    const score = this.weightedScore(fingerprint);
    const verdict = this.getVerdict(score);

    ctx.antiAiFingerprint = fingerprint;
    ctx.antiAiScore = Math.round(score * 10) / 10;
    ctx.antiAiVerdict = verdict;

    if (verdict === 'BLOCK') {
      logger.warn(`S5.5: BLOCK (score=${score.toFixed(1)}), falling back to template`);
      ctx.finalResponse = BLOCK_FALLBACKS[Math.floor(Math.random() * BLOCK_FALLBACKS.length)];
    } else if (verdict === 'WARN') {
      logger.info(`S5.5: WARN (score=${score.toFixed(1)})`);
    }

    return ctx;
  }

  private analyze(text: string): AiFingerprint {
    return {
      sentenceRegularity: this.scoreSentenceRegularity(text),
      lexicalDiversity: this.scoreLexicalDiversity(text),
      lengthRegularity: this.scoreLengthRegularity(text),
      connectorFrequency: this.scoreConnectorFrequency(text),
      empathyTemplateScore: this.scoreEmpathyTemplate(text),
      knowledgeDumpIndex: this.scoreKnowledgeDump(text),
      completenessScore: this.scoreCompleteness(text),
      emotionalAuthenticity: this.scoreEmotionalAuthenticity(text),
    };
  }

  private weightedScore(fp: AiFingerprint): number {
    let total = 0;
    for (const [key, weight] of Object.entries(WEIGHTS)) {
      total += fp[key as keyof AiFingerprint] * weight;
    }
    return total;
  }

  private getVerdict(score: number): AntiAiVerdict {
    if (score >= BLOCK_THRESHOLD) return 'BLOCK';
    if (score >= PASS_THRESHOLD) return 'WARN';
    return 'PASS';
  }

  // ── Dimension Scorers (0-100) ──

  private scoreSentenceRegularity(text: string): number {
    const sentences = text.split(/[。！？!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length < 2) return 0;
    const lengths = sentences.map(s => s.length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
    const cv = Math.sqrt(variance) / (avg || 1); // coefficient of variation
    // Low CV = high regularity = more AI-like
    return Math.max(0, Math.min(100, (1 - cv) * 80));
  }

  private scoreLexicalDiversity(text: string): number {
    const chars = text.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '');
    if (chars.length < 10) return 0;
    const unique = new Set(chars);
    const ratio = unique.size / chars.length;
    // Low diversity = more AI-like (repetitive)
    return Math.max(0, Math.min(100, (1 - ratio) * 100));
  }

  private scoreLengthRegularity(text: string): number {
    const len = text.length;
    // Suspiciously round lengths
    if (len % 100 === 0) return 70;
    if (len % 50 === 0) return 50;
    if (len % 10 === 0) return 30;
    return 5;
  }

  private scoreConnectorFrequency(text: string): number {
    const connectors = [
      '首先', '其次', '然后', '接着', '最后',
      '另外', '此外', '而且', '不过', '但是',
      '因此', '所以', '总之', '综上', '总的来说',
      '一方面', '另一方面', '与此同时',
    ];
    let count = 0;
    for (const c of connectors) {
      const matches = text.match(new RegExp(c, 'g'));
      if (matches) count += matches.length;
    }
    const sentences = text.split(/[。！？!?]+/).filter(s => s.trim().length > 0);
    const ratio = sentences.length > 0 ? count / sentences.length : 0;
    return Math.max(0, Math.min(100, ratio * 100));
  }

  private scoreEmpathyTemplate(text: string): number {
    const templates = [
      /我(能|可以)?理解/,
      /这(确实|的确)是/,
      /感谢你的(分享|信任|坦诚)/,
      /你的(感受|心情|想法)(是|很)(正常|可以理解|合理)的/,
      /我(听到|感受到)你的/,
    ];
    let count = 0;
    for (const p of templates) {
      if (p.test(text)) count++;
    }
    return Math.min(100, count * 35);
  }

  private scoreKnowledgeDump(text: string): number {
    // Detect information overload patterns
    const indicators = [
      /\d+[\.、）)]\s*/g, // numbered points
      /首先.*其次.*最后/s,
      /第一.*第二/s,
    ];
    let score = 0;
    for (const p of indicators) {
      p.lastIndex = 0;
      const matches = text.match(p);
      if (matches) score += 25;
    }
    // Long text with many facts
    const factDensity = (text.match(/[，,]/g) || []).length / (text.length / 20);
    if (factDensity > 1.5) score += 20;
    return Math.min(100, score);
  }

  private scoreCompleteness(text: string): number {
    // Over-complete responses are AI-like
    const sentences = text.split(/[。！？!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 5) return Math.min(100, (sentences.length - 5) * 15);
    return 0;
  }

  private scoreEmotionalAuthenticity(text: string): number {
    // Check for overly balanced or templated emotional expressions
    const positiveEmotions = (text.match(/开心|高兴|棒|好的|不错|太好了/g) || []).length;
    const negativeEmotions = (text.match(/难过|伤心|遗憾|抱歉|不好意思/g) || []).length;

    // Perfect emotional balance = suspicious
    if (positiveEmotions > 0 && negativeEmotions > 0 && Math.abs(positiveEmotions - negativeEmotions) <= 1) {
      return 60;
    }

    // Excessive hedging
    const hedges = (text.match(/可能|也许|或许|大概/g) || []).length;
    if (hedges > 3) return 50;

    return 10;
  }
}
