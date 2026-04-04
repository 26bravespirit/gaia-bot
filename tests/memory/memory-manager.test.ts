import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { loadPersona } from '../../src/config/persona-loader.js';
import type { Message } from '../../src/memory/immediate-memory.js';

describe('MemoryManager', () => {
  let mm: MemoryManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'persona-bot-test-'));
    const config = loadPersona(resolve(import.meta.dirname, '../fixtures/test-persona.yaml'));
    mm = new MemoryManager(config, join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    mm.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

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

  it('should add and retrieve messages from immediate memory', () => {
    mm.addMessage(makeMsg({ content: '消息1' }));
    mm.addMessage(makeMsg({ content: '消息2' }));
    const ctx = mm.getContext('user_001');
    expect(ctx.length).toBe(2);
  });

  it('should persist messages in working memory', () => {
    mm.addMessage(makeMsg({ content: '持久消息' }));
    const history = mm.getRecentHistory('user_001', 10);
    expect(history.length).toBe(1);
    expect(history[0].content).toBe('持久消息');
  });

  it('should create user profile on first message', () => {
    mm.addMessage(makeMsg({ senderName: 'Ben Cui', senderId: 'u_ben' }));
    const profile = mm.getUserProfile('u_ben');
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe('Ben Cui');
    expect(profile!.alias).toBe('老板');
  });

  it('should resolve aliases', () => {
    expect(mm.resolveAlias('Ben Cui')).toBe('老板');
    expect(mm.resolveAlias('Unknown Person')).toBe('Unknown Person');
  });

  it('should handle dedup', () => {
    expect(mm.isSeen('msg_unique')).toBe(false);
    mm.markSeen('msg_unique');
    expect(mm.isSeen('msg_unique')).toBe(true);
  });

  it('should increment message count for user', () => {
    mm.addMessage(makeMsg({ senderId: 'u_x', senderName: 'X' }));
    mm.addMessage(makeMsg({ senderId: 'u_x', senderName: 'X' }));
    mm.addMessage(makeMsg({ senderId: 'u_x', senderName: 'X' }));
    const profile = mm.getUserProfile('u_x');
    expect(profile!.messageCount).toBe(3);
  });
});
