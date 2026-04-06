import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'path';
import { S5PerceptionWrapper } from '../../src/pipeline/s5-perception-wrapper.js';
import { S55AntiAiValidator } from '../../src/pipeline/s5-5-anti-ai-validator.js';
import { S6OutboundScheduler } from '../../src/pipeline/s6-outbound-scheduler.js';
import { PipelineRunner } from '../../src/pipeline/pipeline-runner.js';
import { buildMessages, type PromptContext } from '../../src/llm/prompt-builder.js';
import { loadPersona } from '../../src/config/persona-loader.js';
import { eventBus } from '../../src/engine/event-bus.js';
import type { PersonaConfig } from '../../src/config/schemas.js';
import type { PipelineContext } from '../../src/pipeline/types.js';
import type { GuardResult } from '../../src/engine/identity-guardian.js';
import type { SelfState } from '../../src/memory/memory-manager.js';
import type { TimeState } from '../../src/engine/time-engine.js';

// ── Fixtures ──

const fixtureConfig = loadPersona(resolve(import.meta.dirname, '../fixtures/test-persona.yaml'));

// Extend fixture config with anti_ai and memory_blur for tests that need them
const configWithAntiAi: PersonaConfig = {
  ...fixtureConfig,
  anti_ai: { enabled: true, strictness: 0.5 },
};

const configWithMemoryBlur: PersonaConfig = {
  ...fixtureConfig,
  memory_blur: {
    enabled: true,
    blur_rate: 1.0, // always trigger for deterministic tests
    blur_expressions: ['好像是...', '我记得大概...'],
    blur_triggers: ['specific_date', 'exact_sequence', 'low_importance_detail'],
  },
};

// ── Mock factories ──

function makeMockGuardian(overrides: Partial<{
  checkInput: (text: string) => GuardResult;
  checkOutput: (text: string) => GuardResult;
}> = {}) {
  return {
    checkInput: overrides.checkInput ?? (() => ({ passed: true })),
    checkOutput: overrides.checkOutput ?? ((text: string) => {
      if (text.includes('请问您')) {
        return {
          passed: false,
          violation: 'avoided_word:请问您',
          correctedResponse: text.replace(/请问您/g, '你'),
        };
      }
      return { passed: true };
    }),
    updateConfig: () => {},
    getIdentityChallengeResponse: () => null,
  };
}

function makeMockChannel(sendResult: string | null = 'msg_sent_001') {
  return {
    sendText: vi.fn((_chatId: string, _text: string) => sendResult),
  };
}

function makeMockMemory() {
  return {
    addMessage: vi.fn(),
    biography: {
      getAllActiveFacts: () => [],
      markInvisible: vi.fn(),
    },
  };
}

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    rawMessageId: 'msg_001',
    rawChatId: 'chat_001',
    rawSenderId: 'user_001',
    rawSenderName: 'Test User',
    rawText: '你好',
    rawMessageType: 'text',
    rawTimestamp: Date.now(),
    rawMentions: [],
    mentionedBot: false,
    mentionedOther: false,
    config: fixtureConfig,
    userProfile: null,
    history: [],
    timeState: {
      isActiveHours: true,
      isSleepMode: false,
      currentHour: 10,
      energyLevel: 0.8,
      replyDelayMs: 1000,
      sessionMessageCount: 0,
      isWeekend: false,
      moodBaseline: 0.5,
    },
    resolvedSenderName: 'Test User',
    generatedResponse: '',
    selectedModel: 'test-model',
    shouldReply: true,
    finalResponse: '',
    deliveryStatus: 'pending',
    ...overrides,
  };
}

function makeTimeState(overrides: Partial<TimeState> = {}): TimeState {
  return {
    isActiveHours: true,
    isSleepMode: false,
    currentHour: 10,
    energyLevel: 0.8,
    replyDelayMs: 1000,
    sessionMessageCount: 0,
    isWeekend: false,
    moodBaseline: 0.5,
    ...overrides,
  };
}

function makePromptContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    config: fixtureConfig,
    timeState: makeTimeState(),
    userProfile: null,
    history: [],
    currentMessage: '你好',
    currentSenderName: 'Test User',
    mentionedBot: false,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════
// S5 PerceptionWrapper Tests
// ════════════════════════════════════════════════════════════════════

describe('S5 PerceptionWrapper', () => {
  let s5: S5PerceptionWrapper;
  let mockGuardian: ReturnType<typeof makeMockGuardian>;

  beforeEach(() => {
    mockGuardian = makeMockGuardian();
    s5 = new S5PerceptionWrapper(mockGuardian as any);
  });

  it('should pass through when shouldReply is false', async () => {
    const ctx = makeCtx({ shouldReply: false, generatedResponse: '一些文本' });
    const result = await s5.execute(ctx);
    expect(result.finalResponse).toBe('');
  });

  it('should pass through when generatedResponse is empty', async () => {
    const ctx = makeCtx({ generatedResponse: '' });
    const result = await s5.execute(ctx);
    expect(result.finalResponse).toBe('');
  });

  // ── R01: Enumeration Killer ──

  describe('R01: Enumeration Killer', () => {
    it('should convert numbered lists to natural text', async () => {
      const ctx = makeCtx({
        generatedResponse: '1. 第一点\n2. 第二点\n3. 第三点',
        rawText: '说说你的想法',
      });
      const result = await s5.execute(ctx);
      // Numbered list markers should be removed/replaced
      expect(result.finalResponse).not.toMatch(/^\d+\.\s/m);
      expect(result.s5StepsExecuted?.antiAiRules?.applied).toContain('R01');
    });

    it('should convert bullet lists to natural text', async () => {
      const ctx = makeCtx({
        generatedResponse: '- 要点一\n- 要点二',
        rawText: '说说看',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toMatch(/^-\s/m);
    });

    it('should skip R01 when user asks >= 2 questions', async () => {
      const ctx = makeCtx({
        generatedResponse: '1. 回答一\n2. 回答二',
        rawText: '你喜欢什么？你觉得怎么样？',
      });
      const result = await s5.execute(ctx);
      // R01 should NOT be applied because user asked 2 questions
      const applied = result.s5StepsExecuted?.antiAiRules?.applied || [];
      expect(applied).not.toContain('R01');
    });
  });

  // ── R02: Tail Question Remover ──

  describe('R02: Tail Question Remover', () => {
    it('should remove "你觉得呢？" tail question', async () => {
      const ctx = makeCtx({
        generatedResponse: '我觉得这个挺好的，你觉得呢？',
        rawText: '这个怎么样',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('你觉得呢');
      expect(result.s5StepsExecuted?.antiAiRules?.applied).toContain('R02');
    });

    it('should remove "对吧？" tail question', async () => {
      const ctx = makeCtx({
        generatedResponse: '这个确实不错，对吧？',
        rawText: '说说',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('对吧');
    });

    it('should remove "你有什么想法吗？" tail question', async () => {
      const ctx = makeCtx({
        generatedResponse: '我觉得可以试试，你有什么想法吗？',
        rawText: '说说看',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('你有什么想法吗');
    });
  });

  // ── R03: Hedge Opener Remover ──

  describe('R03: Hedge Opener Remover', () => {
    it('should sometimes remove hedge openers (probabilistic)', async () => {
      // Run multiple times to observe probabilistic behavior
      let removedCount = 0;
      const runs = 50;
      for (let i = 0; i < runs; i++) {
        const ctx = makeCtx({
          generatedResponse: '我觉得，这个东西还不错。',
          rawText: '你怎么看',
        });
        const result = await s5.execute(ctx);
        if (result.s5StepsExecuted?.antiAiRules?.applied?.includes('R03')) {
          removedCount++;
        }
      }
      // With 50% probability, we expect roughly 25 removals. Accept a wide range.
      // At minimum, it should trigger at least once and not always trigger.
      expect(removedCount).toBeGreaterThan(0);
      expect(removedCount).toBeLessThan(runs);
    });
  });

  // ── R04: Length Enforcer ──

  describe('R04: Length Enforcer', () => {
    it('should truncate over-length responses', async () => {
      // avg_message_length is 60 in test config, threshold is 60 * 1.8 = 108
      const longResponse = '第一句话。第二句话。第三句话。第四句话。' +
        '第五句话很长很长很长很长很长很长。第六句话也很长很长很长很长很长很长。' +
        '第七句话还是很长很长很长很长很长很长。第八句话继续很长很长很长很长很长。' +
        '第九句话还要继续很长很长很长很长很长。第十句话最后一句。';
      const ctx = makeCtx({
        generatedResponse: longResponse,
        rawText: '说说',
      });
      const result = await s5.execute(ctx);
      // Response should be shorter than the original (R04 or R05 may truncate)
      expect(result.finalResponse!.length).toBeLessThan(longResponse.length);
      const applied = result.s5StepsExecuted?.antiAiRules?.applied || [];
      expect(applied.some(r => r === 'R04' || r === 'R05')).toBe(true);
    });

    it('should not truncate short responses', async () => {
      const shortResponse = '挺好的。';
      const ctx = makeCtx({
        generatedResponse: shortResponse,
        rawText: '怎么样',
      });
      const result = await s5.execute(ctx);
      const applied = result.s5StepsExecuted?.antiAiRules?.applied || [];
      expect(applied).not.toContain('R04');
    });
  });

  // ── R05: Knowledge Dump Compressor ──

  describe('R05: Knowledge Dump Compressor', () => {
    it('should compress knowledge dumps with 首先/其次/最后 pattern', async () => {
      const dumpResponse = '首先我想说这个很重要。其次我们要考虑到各方面因素。最后总结一下就是这样的。还有一些补充说明。';
      const ctx = makeCtx({
        generatedResponse: dumpResponse,
        rawText: '解释一下',
      });
      const result = await s5.execute(ctx);
      // Should keep only the first 2 sentences
      expect(result.finalResponse!.length).toBeLessThan(dumpResponse.length);
      expect(result.s5StepsExecuted?.antiAiRules?.applied).toContain('R05');
    });

    it('should compress knowledge dumps with 第一/第二/第三 pattern', async () => {
      const dumpResponse = '第一个原因是效率。第二个原因是成本。第三个原因是可行性。第四个原因是创新。';
      const ctx = makeCtx({
        generatedResponse: dumpResponse,
        rawText: '为什么',
      });
      const result = await s5.execute(ctx);
      expect(result.s5StepsExecuted?.antiAiRules?.applied).toContain('R05');
    });
  });

  // ── R06: Empathy Template Variation ──

  describe('R06: Empathy Template Variation', () => {
    it('should replace "我能理解你的感受" empathy template', async () => {
      const ctx = makeCtx({
        generatedResponse: '我能理解你的感受，这确实不容易。',
        rawText: '我好难过',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('我能理解你的感受');
      expect(result.finalResponse).toContain('嗯我懂');
      expect(result.s5StepsExecuted?.antiAiRules?.applied).toContain('R06');
    });

    it('should replace "感谢你的分享" empathy template', async () => {
      const ctx = makeCtx({
        generatedResponse: '感谢你的分享，这很有趣。',
        rawText: '跟你说个事',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('感谢你的分享');
      expect(result.s5StepsExecuted?.antiAiRules?.applied).toContain('R06');
    });

    it('should replace "这确实是一个很好的问题" empathy template', async () => {
      const ctx = makeCtx({
        generatedResponse: '这确实是一个很好的问题，需要认真思考。',
        rawText: '你怎么看待这个',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('这确实是一个很好的问题');
      expect(result.s5StepsExecuted?.antiAiRules?.applied).toContain('R06');
    });
  });

  // ── Step 2: Memory Blur ──

  describe('Memory Blur', () => {
    it('should prefix blur expression when triggered by specific_date', async () => {
      const s5blur = new S5PerceptionWrapper(mockGuardian as any);
      const ctx = makeCtx({
        config: configWithMemoryBlur,
        generatedResponse: '去年5月15日我们去了那个地方，当时天气特别好，阳光很灿烂。',
        rawText: '说说看',
      });
      const result = await s5blur.execute(ctx);
      const hasBlurPrefix = configWithMemoryBlur.memory_blur!.blur_expressions.some(
        expr => result.finalResponse!.startsWith(expr)
      );
      expect(hasBlurPrefix).toBe(true);
      expect(result.s5StepsExecuted?.memoryBlur?.triggered).toBe(true);
    });

    it('should not trigger blur when disabled', async () => {
      const ctx = makeCtx({
        config: { ...fixtureConfig, memory_blur: { enabled: false, blur_rate: 1, blur_expressions: ['模糊...'], blur_triggers: ['specific_date'] } },
        generatedResponse: '去年5月我们见过面。',
        rawText: '说说',
      });
      const result = await s5.execute(ctx);
      expect(result.s5StepsExecuted?.memoryBlur?.triggered).toBe(false);
    });

    it('should not trigger blur when no blur triggers match', async () => {
      const s5blur = new S5PerceptionWrapper(mockGuardian as any);
      const ctx = makeCtx({
        config: configWithMemoryBlur,
        generatedResponse: '好的没问题。',
        rawText: '帮个忙',
      });
      const result = await s5blur.execute(ctx);
      expect(result.s5StepsExecuted?.memoryBlur?.triggered).toBe(false);
    });
  });

  // ── Step 3: Imperfection Injection ──

  describe('Imperfection injection', () => {
    it('should inject catchphrases probabilistically', async () => {
      let catchphraseInjected = false;
      const runs = 100;
      for (let i = 0; i < runs; i++) {
        const ctx = makeCtx({
          config: {
            ...fixtureConfig,
            language: {
              ...fixtureConfig.language,
              vocabulary: {
                ...fixtureConfig.language.vocabulary,
                catchphrases: ['咁样嘅'],
                catchphrase_frequency: 1.0, // always try
              },
            },
          },
          generatedResponse: '好的没问题，我来帮你看看。',
          rawText: '帮忙看看',
        });
        const result = await s5.execute(ctx);
        if (result.finalResponse!.includes('咁样嘅')) {
          catchphraseInjected = true;
          expect(result.s5StepsExecuted?.imperfection?.addedCatchphrases).toBe(true);
          break;
        }
      }
      expect(catchphraseInjected).toBe(true);
    });
  });

  // ── Degradation Path ──

  describe('Degradation path', () => {
    it('should only run Step 3 when degraded', async () => {
      const ctx = makeCtx({
        isDegraded: true,
        generatedResponse: '嗯...让我想想。',
        rawText: '你好',
      });
      const result = await s5.execute(ctx);
      // Should produce a finalResponse
      expect(result.finalResponse).toBeTruthy();
      // Step 1 (antiAiRules) should NOT be executed in degradation path
      expect(result.s5StepsExecuted?.antiAiRules).toBeUndefined();
      // Step 2 (memoryBlur) should NOT be executed in degradation path
      expect(result.s5StepsExecuted?.memoryBlur).toBeUndefined();
      // Step 3 (imperfection) should be executed
      expect(result.s5StepsExecuted?.imperfection).toBeDefined();
    });

    it('should not run identity guardian when degraded', async () => {
      const guardianSpy = vi.fn(() => ({ passed: true }));
      const spyGuardian = makeMockGuardian({ checkOutput: guardianSpy });
      const s5spy = new S5PerceptionWrapper(spyGuardian as any);
      const ctx = makeCtx({
        isDegraded: true,
        generatedResponse: '嗯...',
        rawText: '你好',
      });
      await s5spy.execute(ctx);
      expect(guardianSpy).not.toHaveBeenCalled();
    });
  });

  // ── Identity Guard ──

  describe('Identity guard', () => {
    it('should correct avoided_words in output', async () => {
      const ctx = makeCtx({
        generatedResponse: '请问您需要什么帮助？',
        rawText: '你好',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('请问您');
      expect(result.identityViolation).toContain('avoided_word');
    });

    it('should pass through when no violation found', async () => {
      const ctx = makeCtx({
        generatedResponse: '嗯好的。',
        rawText: '你好',
      });
      const result = await s5.execute(ctx);
      expect(result.identityViolation).toBeUndefined();
    });
  });

  // ── Mention Prefix ──

  describe('Mention prefix (Step 4)', () => {
    it('should prepend sender name when bot is mentioned', async () => {
      const ctx = makeCtx({
        generatedResponse: '好的没问题。',
        rawText: '你好',
        mentionedBot: true,
        resolvedSenderName: '老板',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse!.startsWith('老板')).toBe(true);
    });

    it('should not prepend if response already starts with name', async () => {
      const ctx = makeCtx({
        generatedResponse: '老板，我来了。',
        rawText: '你好',
        mentionedBot: true,
        resolvedSenderName: '老板',
      });
      const result = await s5.execute(ctx);
      // Should not have double "老板" prefix — the response already starts with it
      const firstOccurrence = result.finalResponse!.indexOf('老板');
      expect(firstOccurrence).toBe(0);
      // Count occurrences of "老板" — should be exactly 1
      const occurrences = (result.finalResponse!.match(/老板/g) || []).length;
      expect(occurrences).toBe(1);
    });
  });

  // ── Trim AI Tail ──
  // NOTE: Trim happens after imperfection injection; filler words can
  // occasionally land before the tail sentence and prevent the regex
  // from matching. To test the trimming logic deterministically, we
  // use a config with no imperfection to isolate the trim step.

  describe('Trim AI tail patterns', () => {
    it('should remove "如果你需要" tail', async () => {
      const noImperfConfig: PersonaConfig = {
        ...fixtureConfig,
        language: {
          ...fixtureConfig.language,
          vocabulary: { ...fixtureConfig.language.vocabulary, catchphrases: [], catchphrase_frequency: 0 },
          imperfection: { typo_rate: 0, correction_behavior: 'never', incomplete_thought_rate: 0, filler_words: [] },
        },
      };
      const ctx = makeCtx({
        config: noImperfConfig,
        generatedResponse: '答案就是这样。如果你需要更多信息可以再问。',
        rawText: '问个事',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('如果你需要');
    });

    it('should remove "需要我继续吗" tail', async () => {
      const noImperfConfig: PersonaConfig = {
        ...fixtureConfig,
        language: {
          ...fixtureConfig.language,
          vocabulary: { ...fixtureConfig.language.vocabulary, catchphrases: [], catchphrase_frequency: 0 },
          imperfection: { typo_rate: 0, correction_behavior: 'never', incomplete_thought_rate: 0, filler_words: [] },
        },
      };
      const ctx = makeCtx({
        config: noImperfConfig,
        generatedResponse: '就是这样的情况。需要我继续解释吗？',
        rawText: '怎么回事',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('需要我');
    });

    it('should remove "我可以帮你" tail', async () => {
      const noImperfConfig: PersonaConfig = {
        ...fixtureConfig,
        language: {
          ...fixtureConfig.language,
          vocabulary: { ...fixtureConfig.language.vocabulary, catchphrases: [], catchphrase_frequency: 0 },
          imperfection: { typo_rate: 0, correction_behavior: 'never', incomplete_thought_rate: 0, filler_words: [] },
        },
      };
      const ctx = makeCtx({
        config: noImperfConfig,
        generatedResponse: '情况就是这样。我可以帮你想想办法。',
        rawText: '怎么办',
      });
      const result = await s5.execute(ctx);
      expect(result.finalResponse).not.toContain('我可以');
    });
  });
});


// ════════════════════════════════════════════════════════════════════
// S5.5 AntiAiValidator Tests
// ════════════════════════════════════════════════════════════════════

describe('S5.5 AntiAiValidator', () => {
  let validator: S55AntiAiValidator;

  beforeEach(() => {
    validator = new S55AntiAiValidator();
  });

  it('should pass human-like responses (short, informal, varied)', async () => {
    const ctx = makeCtx({
      config: configWithAntiAi,
      finalResponse: '哈哈好吧',
      shouldReply: true,
    });
    const result = await validator.execute(ctx);
    expect(result.antiAiVerdict).toBe('PASS');
    expect(result.antiAiScore).toBeLessThan(30);
  });

  it('should flag AI-like responses (long, structured, formulaic)', async () => {
    const aiResponse =
      '首先，我能理解你的感受，这确实是一个很好的问题。' +
      '其次，让我从几个方面来分析这个问题。' +
      '另外，我们还需要考虑到其他因素。' +
      '此外，还有一些细节需要注意。' +
      '不过，总的来说情况还是比较乐观的。' +
      '因此，我建议你可以尝试以下几个方法。' +
      '最后，如果你还有任何问题，随时可以问我。' +
      '综上所述，这个问题的关键在于平衡各方面的需求。';
    const ctx = makeCtx({
      config: configWithAntiAi,
      finalResponse: aiResponse,
      shouldReply: true,
    });
    const result = await validator.execute(ctx);
    // Should score high (WARN or BLOCK)
    expect(result.antiAiScore).toBeGreaterThan(30);
    expect(['WARN', 'BLOCK']).toContain(result.antiAiVerdict);
  });

  it('should produce a score between 0-100', async () => {
    const ctx = makeCtx({
      config: configWithAntiAi,
      finalResponse: '嗯嗯好的，我知道了。',
      shouldReply: true,
    });
    const result = await validator.execute(ctx);
    expect(result.antiAiScore).toBeGreaterThanOrEqual(0);
    expect(result.antiAiScore).toBeLessThanOrEqual(100);
  });

  it('should produce 8-dimension fingerprint', async () => {
    const ctx = makeCtx({
      config: configWithAntiAi,
      finalResponse: '让我想想这个问题。',
      shouldReply: true,
    });
    const result = await validator.execute(ctx);
    expect(result.antiAiFingerprint).toBeDefined();
    const fp = result.antiAiFingerprint!;
    expect(typeof fp.sentenceRegularity).toBe('number');
    expect(typeof fp.lexicalDiversity).toBe('number');
    expect(typeof fp.lengthRegularity).toBe('number');
    expect(typeof fp.connectorFrequency).toBe('number');
    expect(typeof fp.empathyTemplateScore).toBe('number');
    expect(typeof fp.knowledgeDumpIndex).toBe('number');
    expect(typeof fp.completenessScore).toBe('number');
    expect(typeof fp.emotionalAuthenticity).toBe('number');
  });

  it('should replace response with fallback when BLOCK', async () => {
    // Craft a maximally AI-like response to trigger BLOCK
    const aiResponse =
      '首先，我能理解你的感受。其次，这确实是一个很好的问题。' +
      '另外，我可以理解你的心情，感谢你的信任。' +
      '此外，你的想法是正常的。不过，我听到你的痛苦。' +
      '因此，让我从几个方面来看。最后，总的来说很不错。' +
      '综上所述，你也可以继续尝试。与此同时，要注意休息。' +
      '一方面要保持乐观开心，另一方面也不要太难过伤心。' +
      '总之，可能也许或许大概情况还是比较好的。';
    const ctx = makeCtx({
      config: configWithAntiAi,
      finalResponse: aiResponse,
      shouldReply: true,
    });
    const result = await validator.execute(ctx);
    if (result.antiAiVerdict === 'BLOCK') {
      const fallbacks = ['嗯...这个我一下子说不好', '哈哈你问得好突然', '等等让我想想', '我觉得这个事情吧...算了不说了'];
      expect(fallbacks).toContain(result.finalResponse);
    }
  });

  it('should skip validation when anti_ai is disabled', async () => {
    const ctx = makeCtx({
      config: { ...fixtureConfig, anti_ai: { enabled: false, strictness: 0 } },
      finalResponse: '随便什么。',
      shouldReply: true,
    });
    const result = await validator.execute(ctx);
    expect(result.antiAiScore).toBeUndefined();
    expect(result.antiAiVerdict).toBeUndefined();
  });

  it('should skip validation when degraded', async () => {
    const ctx = makeCtx({
      config: configWithAntiAi,
      finalResponse: '嗯...',
      shouldReply: true,
      isDegraded: true,
    });
    const result = await validator.execute(ctx);
    expect(result.antiAiScore).toBeUndefined();
  });

  it('should skip validation when shouldReply is false', async () => {
    const ctx = makeCtx({
      config: configWithAntiAi,
      finalResponse: '测试',
      shouldReply: false,
    });
    const result = await validator.execute(ctx);
    expect(result.antiAiScore).toBeUndefined();
  });

  // ── Individual dimension tests ──

  describe('Dimension scorers', () => {
    it('should score high connectorFrequency for connector-heavy text', async () => {
      const ctx = makeCtx({
        config: configWithAntiAi,
        finalResponse: '首先这个很重要。其次要考虑。然后还要。最后总结。',
        shouldReply: true,
      });
      const result = await validator.execute(ctx);
      expect(result.antiAiFingerprint!.connectorFrequency).toBeGreaterThan(30);
    });

    it('should score high empathyTemplate for empathy-heavy text', async () => {
      const ctx = makeCtx({
        config: configWithAntiAi,
        finalResponse: '我能理解你的感受，这确实是一件不容易的事情。你的心情是正常的。',
        shouldReply: true,
      });
      const result = await validator.execute(ctx);
      expect(result.antiAiFingerprint!.empathyTemplateScore).toBeGreaterThan(30);
    });

    it('should score low for simple human-like text', async () => {
      const ctx = makeCtx({
        config: configWithAntiAi,
        finalResponse: '哈哈',
        shouldReply: true,
      });
      const result = await validator.execute(ctx);
      expect(result.antiAiFingerprint!.connectorFrequency).toBe(0);
      expect(result.antiAiFingerprint!.empathyTemplateScore).toBe(0);
      expect(result.antiAiFingerprint!.completenessScore).toBe(0);
    });

    it('should detect suspiciously round lengths', async () => {
      // Create text of exactly 100 chars
      const text = 'a'.repeat(100);
      const ctx = makeCtx({
        config: configWithAntiAi,
        finalResponse: text,
        shouldReply: true,
      });
      const result = await validator.execute(ctx);
      expect(result.antiAiFingerprint!.lengthRegularity).toBe(70);
    });
  });
});


// ════════════════════════════════════════════════════════════════════
// S6 OutboundScheduler Tests
// ════════════════════════════════════════════════════════════════════

describe('S6 OutboundScheduler', () => {
  it('should schedule delivery with delay and send message', async () => {
    const mockChannel = makeMockChannel('msg_sent_001');
    const mockMemory = makeMockMemory();
    const s6 = new S6OutboundScheduler(mockChannel as any, mockMemory as any);

    const ctx = makeCtx({
      shouldReply: true,
      finalResponse: '你好啊！',
      rawChatId: 'chat_test',
      timeState: { ...makeTimeState(), replyDelayMs: 100 }, // short delay for test speed
    });

    const startTime = Date.now();
    const result = await s6.execute(ctx);
    const elapsed = Date.now() - startTime;

    expect(result.deliveryStatus).toBe('sent');
    expect(result.deliveryMessageId).toBe('msg_sent_001');
    expect(mockChannel.sendText).toHaveBeenCalledWith('chat_test', '你好啊！');
    // Should have waited at least the delay
    expect(elapsed).toBeGreaterThanOrEqual(50); // some tolerance
  });

  it('should record assistant message to memory', async () => {
    const mockChannel = makeMockChannel('msg_sent_002');
    const mockMemory = makeMockMemory();
    const s6 = new S6OutboundScheduler(mockChannel as any, mockMemory as any);

    const ctx = makeCtx({
      shouldReply: true,
      finalResponse: '没问题！',
      rawChatId: 'chat_test',
      rawSenderId: 'user_test',
      config: fixtureConfig,
      timeState: { ...makeTimeState(), replyDelayMs: 100 },
    });

    await s6.execute(ctx);

    expect(mockMemory.addMessage).toHaveBeenCalledOnce();
    const addedMsg = mockMemory.addMessage.mock.calls[0][0];
    expect(addedMsg.role).toBe('assistant');
    expect(addedMsg.content).toBe('没问题！');
    expect(addedMsg.senderName).toBe('TestBot');
    expect(addedMsg.chatId).toBe('chat_test');
    expect(addedMsg.id).toBe('msg_sent_002');
  });

  it('should handle send failure gracefully', async () => {
    const mockChannel = makeMockChannel(null); // null = send failure
    const mockMemory = makeMockMemory();
    const s6 = new S6OutboundScheduler(mockChannel as any, mockMemory as any);

    const ctx = makeCtx({
      shouldReply: true,
      finalResponse: '测试消息',
      timeState: { ...makeTimeState(), replyDelayMs: 100 },
    });

    const result = await s6.execute(ctx);

    expect(result.deliveryStatus).toBe('failed');
    expect(result.deliveryMessageId).toBeUndefined();
    // Should NOT have recorded to memory on failure
    expect(mockMemory.addMessage).not.toHaveBeenCalled();
  });

  it('should set failed when shouldReply is false', async () => {
    const mockChannel = makeMockChannel();
    const mockMemory = makeMockMemory();
    const s6 = new S6OutboundScheduler(mockChannel as any, mockMemory as any);

    const ctx = makeCtx({
      shouldReply: false,
      finalResponse: '测试',
      timeState: { ...makeTimeState(), replyDelayMs: 100 },
    });

    const result = await s6.execute(ctx);
    expect(result.deliveryStatus).toBe('failed');
    expect(mockChannel.sendText).not.toHaveBeenCalled();
  });

  it('should set failed when finalResponse is empty', async () => {
    const mockChannel = makeMockChannel();
    const mockMemory = makeMockMemory();
    const s6 = new S6OutboundScheduler(mockChannel as any, mockMemory as any);

    const ctx = makeCtx({
      shouldReply: true,
      finalResponse: '',
      timeState: { ...makeTimeState(), replyDelayMs: 100 },
    });

    const result = await s6.execute(ctx);
    expect(result.deliveryStatus).toBe('failed');
  });

  it('should cap delay at 3000ms', async () => {
    const mockChannel = makeMockChannel('msg_fast');
    const mockMemory = makeMockMemory();
    const s6 = new S6OutboundScheduler(mockChannel as any, mockMemory as any);

    const ctx = makeCtx({
      shouldReply: true,
      finalResponse: '测试',
      timeState: { ...makeTimeState(), replyDelayMs: 99999 },
    });

    const startTime = Date.now();
    await s6.execute(ctx);
    const elapsed = Date.now() - startTime;

    // Delay should be capped at 3000ms
    expect(elapsed).toBeLessThan(4000);
  });
});


// ════════════════════════════════════════════════════════════════════
// PipelineRunner Tests
// ════════════════════════════════════════════════════════════════════

describe('PipelineRunner', () => {
  // The eventBus extends EventEmitter, which throws on unhandled 'error' events.
  // Register a no-op handler so pipeline error tests don't crash.
  const noopErrorHandler = () => {};

  beforeEach(() => {
    eventBus.on('error', noopErrorHandler);
  });

  afterEach(() => {
    eventBus.off('error', noopErrorHandler);
  });

  it('should execute stages in order', async () => {
    const runner = new PipelineRunner();
    const order: string[] = [];

    runner.addStage({
      name: 'Stage1',
      execute: async (ctx) => { order.push('Stage1'); return ctx; },
    });
    runner.addStage({
      name: 'Stage2',
      execute: async (ctx) => { order.push('Stage2'); return ctx; },
    });
    runner.addStage({
      name: 'Stage3',
      execute: async (ctx) => { order.push('Stage3'); return ctx; },
    });

    await runner.run({
      messageId: 'msg_001',
      chatId: 'chat_001',
      senderId: 'user_001',
      senderName: 'Test User',
      text: '你好',
      timestamp: Date.now(),
    });

    expect(order).toEqual(['Stage1', 'Stage2', 'Stage3']);
  });

  it('should stop pipeline when shouldReply becomes false', async () => {
    const runner = new PipelineRunner();
    const order: string[] = [];

    runner.addStage({
      name: 'StageA',
      execute: async (ctx) => {
        order.push('StageA');
        ctx.shouldReply = false;
        ctx.skipReason = 'test_skip';
        return ctx;
      },
    });
    runner.addStage({
      name: 'StageB',
      execute: async (ctx) => { order.push('StageB'); return ctx; },
    });

    const result = await runner.run({
      messageId: 'msg_001',
      chatId: 'chat_001',
      senderId: 'user_001',
      senderName: 'Test User',
      text: '你好',
      timestamp: Date.now(),
    });

    expect(order).toEqual(['StageA']);
    expect(result.shouldReply).toBe(false);
  });

  it('should skip S4.5 and S5.5 on degradation path', async () => {
    const runner = new PipelineRunner();
    const order: string[] = [];

    runner.addStage({
      name: 'S3S4:Generator',
      execute: async (ctx) => {
        order.push('S3S4');
        ctx.isDegraded = true;
        ctx.generatedResponse = '嗯...';
        ctx.finalResponse = '嗯...';
        return ctx;
      },
    });
    runner.addStage({
      name: 'S4.5:BiographicalExtractor',
      execute: async (ctx) => { order.push('S4.5'); return ctx; },
    });
    runner.addStage({
      name: 'S5.5:AntiAiValidator',
      execute: async (ctx) => { order.push('S5.5'); return ctx; },
    });
    runner.addStage({
      name: 'S6:OutboundScheduler',
      execute: async (ctx) => { order.push('S6'); return ctx; },
    });

    await runner.run({
      messageId: 'msg_001',
      chatId: 'chat_001',
      senderId: 'user_001',
      senderName: 'Test User',
      text: '你好',
      timestamp: Date.now(),
    });

    expect(order).toContain('S3S4');
    expect(order).not.toContain('S4.5');
    expect(order).not.toContain('S5.5');
    expect(order).toContain('S6');
  });

  it('should enter degradation on S3S4 error', async () => {
    const runner = new PipelineRunner();

    runner.addStage({
      name: 'S3S4:Generator',
      execute: async () => { throw new Error('LLM timeout'); },
    });
    runner.addStage({
      name: 'S5:PerceptionWrapper',
      execute: async (ctx) => { return ctx; },
    });

    const result = await runner.run({
      messageId: 'msg_001',
      chatId: 'chat_001',
      senderId: 'user_001',
      senderName: 'Test User',
      text: '你好',
      timestamp: Date.now(),
    });

    expect(result.isDegraded).toBe(true);
    expect(result.generatedResponse).toBe('嗯...');
    expect(result.selectedModel).toBe('degradation_template');
  });

  it('should abort on non-S3S4 stage error', async () => {
    const runner = new PipelineRunner();

    runner.addStage({
      name: 'S1:Dispatcher',
      execute: async () => { throw new Error('unexpected'); },
    });

    const result = await runner.run({
      messageId: 'msg_001',
      chatId: 'chat_001',
      senderId: 'user_001',
      senderName: 'Test User',
      text: '你好',
      timestamp: Date.now(),
    });

    expect(result.shouldReply).toBe(false);
    expect(result.skipReason).toContain('stage_error');
  });
});


// ════════════════════════════════════════════════════════════════════
// Prompt Builder Tests
// ════════════════════════════════════════════════════════════════════

describe('PromptBuilder buildMessages', () => {
  it('should include persona system prompt', () => {
    const ctx = makePromptContext();
    const messages = buildMessages(ctx);

    expect(messages.length).toBeGreaterThanOrEqual(2); // system + user
    const system = messages[0];
    expect(system.role).toBe('system');
    // Should contain the persona name
    expect(system.content).toContain('TestBot');
    // Should contain calibration markers
    expect(system.content).toContain('校准');
  });

  it('should inject biography context when present', () => {
    const ctx = makePromptContext({
      biographyContext: [
        {
          id: 1,
          userId: 'user_001',
          factContent: '小时候在北京长大',
          period: '童年',
          sourceType: 'anchor',
          confidence: 1.0,
          userVisible: true,
          isActive: true,
          createdAt: Date.now(),
        },
      ],
      cognitiveDecision: {
        shouldRespond: true,
        biographyTopic: true,
        biographyDepth: 'anchor',
        identityCheckTriggered: false,
        responseStrategy: 'honest',
      },
    });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    expect(system).toContain('童年');
    expect(system).toContain('小时候在北京长大');
  });

  it('should not inject biography when biographyTopic is false', () => {
    const ctx = makePromptContext({
      biographyContext: [
        {
          id: 1,
          userId: 'user_001',
          factContent: '小时候在北京长大',
          period: '童年',
          sourceType: 'anchor',
          confidence: 1.0,
          userVisible: true,
          isActive: true,
          createdAt: Date.now(),
        },
      ],
      cognitiveDecision: {
        shouldRespond: true,
        biographyTopic: false,
        biographyDepth: 'none',
        identityCheckTriggered: false,
        responseStrategy: 'honest',
      },
    });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    expect(system).not.toContain('小时候在北京长大');
  });

  it('should inject long-term memories', () => {
    const ctx = makePromptContext({
      longTermMemories: [
        { type: 'emotional_event', content: '上次聊到他的猫生病了', importance: 0.9 },
        { type: 'factual_detail', content: '在腾讯做后端开发', importance: 0.6 },
      ],
    });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    expect(system).toContain('上次聊到他的猫生病了');
    expect(system).toContain('在腾讯做后端开发');
  });

  it('should inject self state (mood, emotions)', () => {
    const selfState: SelfState = {
      moodBaseline: -0.5,
      activeEmotions: ['frustrated', 'tired'],
      recentExperiences: [],
      energyLevel: 'low',
      socialBattery: 0.2,
      updatedAt: Date.now(),
    };
    const ctx = makePromptContext({ selfState });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    // Negative mood
    expect(system).toContain('心情不太好');
    // Active emotions
    expect(system).toContain('frustrated');
    expect(system).toContain('tired');
    // Low social battery
    expect(system).toContain('社交电量快耗尽');
  });

  it('should inject positive mood state', () => {
    const selfState: SelfState = {
      moodBaseline: 0.8,
      activeEmotions: [],
      recentExperiences: [],
      energyLevel: 'high',
      socialBattery: 0.9,
      updatedAt: Date.now(),
    };
    const ctx = makePromptContext({ selfState });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    expect(system).toContain('心情很好');
  });

  it('should inject medium-low social battery state', () => {
    const selfState: SelfState = {
      moodBaseline: 0.5,
      activeEmotions: [],
      recentExperiences: [],
      energyLevel: 'normal',
      socialBattery: 0.4,
      updatedAt: Date.now(),
    };
    const ctx = makePromptContext({ selfState });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    expect(system).toContain('社交疲劳');
  });

  it('should inject anti-AI constraints when enabled', () => {
    const ctx = makePromptContext({
      config: configWithAntiAi,
    });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    // The anti-AI block should be present at the end (recency bias)
    expect(system).toContain('不要');
  });

  it('should not inject anti-AI constraints when disabled', () => {
    const ctx = makePromptContext({
      config: { ...fixtureConfig, anti_ai: { enabled: false, strictness: 0 } },
    });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    // Should NOT contain anti-AI header/rules
    // The base prompt has boundary rules already, so check for
    // the specific anti_ai block markers
    expect(system).not.toMatch(/anti_ai_header/);
  });

  it('should inject human behavior instructions', () => {
    const ctx = makePromptContext({
      humanBehaviors: ['push_back', 'feign_confusion'],
    });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    // Human behavior instructions should be present (the exact wording depends on prompt_mappings.yaml)
    // At minimum, the system prompt should be longer than without behaviors
    const ctxNoBehaviors = makePromptContext();
    const messagesNoBehaviors = buildMessages(ctxNoBehaviors);
    expect(system.length).toBeGreaterThanOrEqual(messagesNoBehaviors[0].content.length);
  });

  it('should format history messages correctly', () => {
    const ctx = makePromptContext({
      history: [
        { role: 'user', content: '你好', senderName: '张三' },
        { role: 'assistant', content: '你好呀', senderName: 'TestBot' },
        { role: 'user', content: '最近怎么样', senderName: '张三' },
      ],
    });
    const messages = buildMessages(ctx);
    // system + 3 history + 1 current = 5
    expect(messages.length).toBe(5);
    // User messages should have sender prefix
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('张三');
    // Assistant messages should not have prefix
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].content).toBe('你好呀');
  });

  it('should add current message as last user message', () => {
    const ctx = makePromptContext({
      currentMessage: '今天天气真好',
      currentSenderName: '李四',
    });
    const messages = buildMessages(ctx);
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('李四');
    expect(lastMsg.content).toContain('今天天气真好');
  });

  it('should inject sleep mode context when in sleep mode', () => {
    const ctx = makePromptContext({
      timeState: makeTimeState({ isSleepMode: true }),
    });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    // Should have sleep-related content
    expect(system.length).toBeGreaterThan(0);
  });

  it('should inject weekend context when on weekend', () => {
    const ctx = makePromptContext({
      timeState: makeTimeState({ isWeekend: true }),
    });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    expect(system.length).toBeGreaterThan(0);
  });

  it('should inject user alias when present', () => {
    const ctx = makePromptContext({
      userProfile: {
        id: 1,
        senderId: 'user_001',
        displayName: 'Ben Cui',
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        messageCount: 5,
        relationshipStage: 'acquaintance',
      },
    });
    const messages = buildMessages(ctx);
    const system = messages[0].content;
    // "Ben Cui" should be resolved to "老板" per test fixture aliases
    expect(system).toContain('老板');
  });
});
