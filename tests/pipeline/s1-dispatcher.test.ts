import { describe, it, expect, beforeEach } from 'vitest';
import { S1MessageDispatcher } from '../../src/pipeline/s1-message-dispatcher.js';
import type { PipelineContext } from '../../src/pipeline/types.js';

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
    config: {} as any,
    userProfile: null,
    history: [],
    timeState: { isActiveHours: true, isSleepMode: false, currentHour: 10, energyLevel: 0.8, replyDelayMs: 1000, sessionMessageCount: 0 },
    resolvedSenderName: 'Test User',
    generatedResponse: '',
    selectedModel: '',
    shouldReply: true,
    finalResponse: '',
    deliveryStatus: 'pending',
    ...overrides,
  };
}

describe('S1MessageDispatcher', () => {
  let s1: S1MessageDispatcher;

  beforeEach(() => {
    process.env.BOT_OPEN_ID = 'bot_123';
    process.env.BOT_MENTION_PATTERNS = '@Lark CLI,lark cli';
    s1 = new S1MessageDispatcher();
  });

  it('should pass normal text messages', async () => {
    const ctx = makeCtx({ rawText: '你好世界' });
    const result = await s1.execute(ctx);
    expect(result.shouldReply).toBe(true);
    expect(result.rawText).toBe('你好世界');
  });

  it('should skip empty messages', async () => {
    const ctx = makeCtx({ rawText: '' });
    const result = await s1.execute(ctx);
    expect(result.shouldReply).toBe(false);
    expect(result.skipReason).toBe('empty_text');
  });

  it('should skip self messages', async () => {
    const ctx = makeCtx({ rawSenderId: 'bot_123' });
    const result = await s1.execute(ctx);
    expect(result.shouldReply).toBe(false);
    expect(result.skipReason).toBe('self_message');
  });

  it('should detect @mention', async () => {
    const ctx = makeCtx({ rawText: '@Lark CLI 你好' });
    const result = await s1.execute(ctx);
    expect(result.mentionedBot).toBe(true);
    expect(result.rawText).toBe('你好');
  });

  it('should strip @mention markers and keep text', async () => {
    const ctx = makeCtx({ rawText: '@someone 测试消息' });
    const result = await s1.execute(ctx);
    expect(result.rawText).toBe('测试消息');
  });
});
