import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { TimeEngine } from '../../src/engine/time-engine.js';
import { S2ContextAssembler } from '../../src/pipeline/s2-context-assembler.js';
import { loadPersona } from '../../src/config/persona-loader.js';
import type { PersonaConfig } from '../../src/config/schemas.js';
import type { PipelineContext } from '../../src/pipeline/types.js';
import type { Message } from '../../src/memory/immediate-memory.js';

const fixtureConfig = loadPersona(resolve(import.meta.dirname, '../fixtures/test-persona.yaml'));

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    rawMessageId: 'msg_001',
    rawChatId: 'chat_001',
    rawSenderId: 'user_001',
    rawSenderName: 'Test User',
    rawText: '你好',
    rawTimestamp: Date.now(),
    rawMentions: [],
    mentionedBot: false,
    mentionedOther: false,
    config: fixtureConfig,
    userProfile: null,
    history: [],
    timeState: { isActiveHours: true, isSleepMode: false, currentHour: 10, energyLevel: 0.8, replyDelayMs: 1000, sessionMessageCount: 0, isWeekend: false, moodBaseline: 0.5 },
    resolvedSenderName: 'Test User',
    generatedResponse: '',
    selectedModel: '',
    shouldReply: true,
    finalResponse: '',
    deliveryStatus: 'pending',
    ...overrides,
  };
}

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: '测试消息',
    senderName: 'Test User',
    senderId: 'user_001',
    timestamp: Date.now(),
    chatId: 'chat_001',
    ...overrides,
  };
}

// ── Self State Tests ──

describe('Phase 1: SelfState read/write', () => {
  let mm: MemoryManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'phase1-selfstate-'));
    mm = new MemoryManager(fixtureConfig, join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    mm.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return default self state', () => {
    const state = mm.getSelfState();
    expect(state.moodBaseline).toBe(0.6);
    expect(state.socialBattery).toBe(1.0);
    expect(state.energyLevel).toBe('normal');
    expect(state.activeEmotions).toEqual([]);
    expect(state.recentExperiences).toEqual([]);
  });

  it('should update self state partially', () => {
    mm.updateSelfState({ socialBattery: 0.7, moodBaseline: 0.8 });
    const state = mm.getSelfState();
    expect(state.socialBattery).toBe(0.7);
    expect(state.moodBaseline).toBe(0.8);
    // Other fields unchanged
    expect(state.energyLevel).toBe('normal');
  });

  it('should update active emotions', () => {
    mm.updateSelfState({ activeEmotions: ['happy', 'curious'] });
    const state = mm.getSelfState();
    expect(state.activeEmotions).toEqual(['happy', 'curious']);
  });

  it('should cap recent experiences at 10', () => {
    const experiences = Array.from({ length: 15 }, (_, i) => `event_${i}`);
    mm.updateSelfState({ recentExperiences: experiences });
    const state = mm.getSelfState();
    expect(state.recentExperiences.length).toBeLessThanOrEqual(10);
  });

  it('should track social battery decay', () => {
    const initial = mm.getSelfState().socialBattery;
    // Simulate multiple interactions decreasing battery
    for (let i = 0; i < 5; i++) {
      const current = mm.getSelfState();
      const newBattery = Math.max(0.1, current.socialBattery - 0.02);
      mm.updateSelfState({ socialBattery: newBattery });
    }
    const after = mm.getSelfState();
    expect(after.socialBattery).toBeCloseTo(initial - 0.1, 10);
  });
});

// ── Event Log Tests ──

describe('Phase 1: Event log persistence', () => {
  let mm: MemoryManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'phase1-eventlog-'));
    mm = new MemoryManager(fixtureConfig, join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    mm.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should log events to SQLite', () => {
    mm.logEvent('message_received', 'system', { messageId: 'msg_001', text: 'hello' });
    mm.logEvent('response_sent', 'system', { messageId: 'msg_002' });

    const db = mm.working.getDb();
    const rows = db.prepare('SELECT * FROM event_log ORDER BY id').all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(rows[0].event_type).toBe('message_received');
    expect(rows[1].event_type).toBe('response_sent');
    const payload = JSON.parse(rows[0].payload as string);
    expect(payload.messageId).toBe('msg_001');
  });

  it('should persist multiple event types', () => {
    mm.logEvent('error', 'pipeline', { error: 'timeout' });
    mm.logEvent('persona_reloaded', 'system', { name: 'TestBot' });

    const db = mm.working.getDb();
    const count = db.prepare('SELECT COUNT(*) as cnt FROM event_log').get() as Record<string, unknown>;
    expect(count.cnt).toBe(2);
  });
});

// ── Long-term Memory Tests ──

describe('Phase 1: Long-term memory retrieval', () => {
  let mm: MemoryManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'phase1-ltm-'));
    mm = new MemoryManager(fixtureConfig, join(tmpDir, 'test.db'));

    // Seed some long-term memories
    mm.longTerm.addMemory('user_001', {
      userId: 'user_001',
      type: 'emotional_event',
      content: '上次我们聊到了他养的猫生病了',
      keywords: ['猫', '生病', '宠物'],
      importance: 0.9,
      isForgettable: false,
    });
    mm.longTerm.addMemory('user_001', {
      userId: 'user_001',
      type: 'factual_detail',
      content: '他在腾讯做后端开发',
      keywords: ['腾讯', '后端', '工作'],
      importance: 0.6,
      isForgettable: true,
    });
    mm.longTerm.addMemory('user_001', {
      userId: 'user_001',
      type: 'promise',
      content: '说好下周一起去爬山',
      keywords: ['爬山', '约定', '下周'],
      importance: 0.85,
      isForgettable: false,
    });
  });

  afterEach(() => {
    mm.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should search memories by keywords', () => {
    const results = mm.searchMemories('user_001', ['猫']);
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('emotional_event');
    expect(results[0].content).toContain('猫生病');
  });

  it('should return empty for non-matching keywords', () => {
    const results = mm.searchMemories('user_001', ['火星', '太空']);
    expect(results.length).toBe(0);
  });

  it('should search across multiple keywords (OR)', () => {
    const results = mm.searchMemories('user_001', ['猫', '爬山']);
    expect(results.length).toBe(2);
  });

  it('should order by importance', () => {
    const results = mm.searchMemories('user_001', ['猫', '腾讯', '爬山']);
    expect(results.length).toBe(3);
    // Highest importance first
    expect(results[0].importance).toBeGreaterThanOrEqual(results[1].importance);
  });

  it('should not return memories for wrong user', () => {
    const results = mm.searchMemories('user_999', ['猫']);
    expect(results.length).toBe(0);
  });
});

// ── Relationship Model Tests ──

describe('Phase 1: Relationship state tracking', () => {
  let mm: MemoryManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'phase1-rel-'));
    mm = new MemoryManager(fixtureConfig, join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    mm.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create stranger relationship for new user', () => {
    const rel = mm.getRelationship('user_new');
    expect(rel.stage).toBe('stranger');
    expect(rel.intimacyScore).toBe(0);
    expect(rel.interactionCount).toBe(0);
    expect(rel.topicsShared).toEqual([]);
  });

  it('should increment intimacy on interaction', () => {
    mm.relationships.recordInteraction('user_001', 'message');
    const rel = mm.getRelationship('user_001');
    expect(rel.intimacyScore).toBeGreaterThan(0);
    expect(rel.interactionCount).toBe(1);
  });

  it('should transition stages at thresholds', () => {
    // acquaintance threshold = 0.2, each message = +0.005
    // 40 messages → 0.2 = acquaintance
    for (let i = 0; i < 40; i++) {
      mm.relationships.recordInteraction('user_001', 'message');
    }
    const rel = mm.getRelationship('user_001');
    expect(rel.stage).toBe('acquaintance');
  });

  it('should track shared topics', () => {
    mm.relationships.addTopic('user_001', '心理学');
    mm.relationships.addTopic('user_001', '冲浪');
    mm.relationships.addTopic('user_001', '心理学'); // duplicate
    const rel = mm.getRelationship('user_001');
    expect(rel.topicsShared).toEqual(['心理学', '冲浪']);
  });

  it('should track and fulfill promises', () => {
    mm.relationships.addPromise('user_001', '下周一起去冲浪');
    let rel = mm.getRelationship('user_001');
    expect(rel.promises.length).toBe(1);
    expect(rel.promises[0].fulfilled).toBe(false);

    mm.relationships.fulfillPromise('user_001', '下周一起去冲浪');
    rel = mm.getRelationship('user_001');
    expect(rel.promises[0].fulfilled).toBe(true);
  });

  it('should integrate with addMessage for automatic tracking', () => {
    mm.addMessage(makeMsg({ senderId: 'user_rel', senderName: 'RelTest' }));
    mm.addMessage(makeMsg({ senderId: 'user_rel', senderName: 'RelTest' }));
    const rel = mm.getRelationship('user_rel');
    expect(rel.interactionCount).toBe(2);
  });
});

// ── TimeEngine Config Tests ──

describe('Phase 1: TimeEngine configurable parameters', () => {
  let engine: TimeEngine;

  beforeEach(() => {
    engine = new TimeEngine(fixtureConfig);
  });

  it('should read active_hours from config', () => {
    // test-persona.yaml has active_hours: { start: 8, end: 22 }
    const state = engine.getState();
    const hour = new Date().getHours();
    const expected = hour >= 8 && hour < 22;
    expect(state.isActiveHours).toBe(expected);
  });

  it('should read history_window from config', () => {
    // test-persona.yaml has history_window: 15
    expect(engine.getHistoryWindowSize()).toBe(15);
  });

  it('should fall back to defaults when config missing', () => {
    const minimalConfig = {
      ...fixtureConfig,
      temporal: undefined,
    } as unknown as PersonaConfig;
    const minimal = new TimeEngine(minimalConfig);
    expect(minimal.getHistoryWindowSize()).toBe(25);
  });

  it('should use sleep responses from config', () => {
    // When in sleep mode, getSleepResponse should return a string
    // We can't control the hour, so just verify the method works
    const response = engine.getSleepResponse();
    // During active hours it returns null; during sleep it returns a string
    const state = engine.getState();
    if (state.isSleepMode) {
      expect(typeof response).toBe('string');
      expect(response!.length).toBeGreaterThan(0);
    } else {
      expect(response).toBeNull();
    }
  });
});

// ── S2 Context Assembler Integration Tests ──

describe('Phase 1: S2 Context Assembler integration', () => {
  let mm: MemoryManager;
  let timeEngine: TimeEngine;
  let s2: S2ContextAssembler;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'phase1-s2-'));
    mm = new MemoryManager(fixtureConfig, join(tmpDir, 'test.db'));
    timeEngine = new TimeEngine(fixtureConfig);
    s2 = new S2ContextAssembler(mm, timeEngine, () => fixtureConfig);

    // Seed user
    mm.addMessage(makeMsg({ senderId: 'user_001', senderName: 'Test User', content: '之前的消息1' }));
    mm.addMessage(makeMsg({ senderId: 'user_001', senderName: 'Test User', content: '之前的消息2' }));
  });

  afterEach(() => {
    mm.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should load user profile in S2', async () => {
    const ctx = makeCtx({ rawSenderId: 'user_001', rawSenderName: 'Test User' });
    const result = await s2.execute(ctx);
    expect(result.userProfile).not.toBeNull();
    expect(result.userProfile!.displayName).toBe('Test User');
  });

  it('should resolve sender alias', async () => {
    // "Test User" → "测试员" per test fixture aliases
    const ctx = makeCtx({ rawSenderId: 'user_001', rawSenderName: 'Test User' });
    const result = await s2.execute(ctx);
    expect(result.resolvedSenderName).toBe('测试员');
  });

  it('should populate time state', async () => {
    const ctx = makeCtx();
    const result = await s2.execute(ctx);
    expect(result.timeState).toBeDefined();
    expect(result.timeState.currentHour).toBe(new Date().getHours());
  });

  it('should retrieve long-term memories when keywords match', async () => {
    // Seed a long-term memory with keywords that match Chinese text segments
    mm.longTerm.addMemory('user_001', {
      userId: 'user_001',
      type: 'factual_detail',
      content: '喜欢吃拉面',
      keywords: ['拉面', '食物', '今天去吃拉面了'],
      importance: 0.7,
      isForgettable: true,
    });

    // extractLtmKeywords splits on punctuation/whitespace; Chinese without spaces
    // becomes a single segment, so the keyword column must contain that segment
    const ctx = makeCtx({ rawSenderId: 'user_001', rawText: '今天去吃拉面了' });
    const result = await s2.execute(ctx);
    expect(result.longTermMemories).toBeDefined();
    expect(result.longTermMemories!.length).toBeGreaterThan(0);
    expect(result.longTermMemories![0].content).toContain('拉面');
  });

  it('should populate relationship state', async () => {
    // Send a few messages to build relationship
    for (let i = 0; i < 3; i++) {
      mm.addMessage(makeMsg({ senderId: 'user_001', senderName: 'Test User', content: `消息${i}` }));
    }

    const ctx = makeCtx({ rawSenderId: 'user_001', rawText: '你好啊' });
    const result = await s2.execute(ctx);
    expect(result.relationshipState).toBeDefined();
    expect(result.relationshipState!.stage).toBe('stranger');
    expect(result.relationshipState!.interactionCount).toBeGreaterThan(0);
  });

  it('should use configurable history window size', async () => {
    // Seed 20 messages
    for (let i = 0; i < 20; i++) {
      mm.addMessage(makeMsg({ senderId: 'user_001', senderName: 'Test User', content: `历史消息${i}` }));
    }

    const ctx = makeCtx({ rawSenderId: 'user_001', rawText: '最新消息' });
    const result = await s2.execute(ctx);
    // history_window = 15 in test fixture, so history should be <= 15
    // (minus current message dedup)
    expect(result.history.length).toBeLessThanOrEqual(15);
  });

  it('should skip pipeline for sleep mode when not @mentioned', async () => {
    // Create a config where current hour is definitely sleep mode
    const sleepConfig = {
      ...fixtureConfig,
      temporal: {
        ...fixtureConfig.temporal,
        active_hours: { start: 99, end: 99 }, // impossible → always sleep
      },
    } as unknown as PersonaConfig;

    const sleepEngine = new TimeEngine(sleepConfig);
    const sleepS2 = new S2ContextAssembler(mm, sleepEngine, () => sleepConfig);

    const ctx = makeCtx({ mentionedBot: false, rawText: '你好' });
    const result = await sleepS2.execute(ctx);
    expect(result.selectedModel).toBe('sleep_mode');
    expect(result.generatedResponse.length).toBeGreaterThan(0);
  });
});
