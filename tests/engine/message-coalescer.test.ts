/**
 * MessageCoalescer Unit Tests
 *
 * Tests burst coalescing, quiet window, max wait, @mention bypass,
 * multi-user isolation, flushAll, and config hot-reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageCoalescer, type CoalescedMessage, type CoalescerConfig } from '../../src/engine/message-coalescer.js';

function makeMsg(overrides: Partial<{
  messageId: string; chatId: string; senderId: string; senderName: string;
  text: string; messageType: string; timestamp: number;
  mentions: Array<Record<string, unknown>>; mentionedBot: boolean;
}> = {}) {
  return {
    messageId: overrides.messageId ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    chatId: overrides.chatId ?? 'chat1',
    senderId: overrides.senderId ?? 'user1',
    senderName: overrides.senderName ?? 'TestUser',
    text: overrides.text ?? 'hello',
    messageType: overrides.messageType ?? 'text',
    timestamp: overrides.timestamp ?? Date.now(),
    mentions: overrides.mentions ?? [],
    mentionedBot: overrides.mentionedBot ?? false,
  };
}

describe('MessageCoalescer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('single message fires after quiet window', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    c.push(makeMsg({ text: 'hello' }));
    expect(bursts).toHaveLength(0);

    vi.advanceTimersByTime(2000);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].text).toBe('hello');
    expect(bursts[0].coalescedCount).toBe(1);
  });

  it('3 rapid messages coalesce into 1 burst', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    c.push(makeMsg({ messageId: 'a', text: 'one' }));
    vi.advanceTimersByTime(500);
    c.push(makeMsg({ messageId: 'b', text: 'two' }));
    vi.advanceTimersByTime(500);
    c.push(makeMsg({ messageId: 'c', text: 'three' }));

    // Not fired yet (quiet window resets each time)
    expect(bursts).toHaveLength(0);

    vi.advanceTimersByTime(2000);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].text).toBe('one\ntwo\nthree');
    expect(bursts[0].coalescedCount).toBe(3);
    expect(bursts[0].messageIds).toEqual(['a', 'b', 'c']);
    expect(bursts[0].messageId).toBe('c'); // last message ID
  });

  it('maxBurstWait forces fire even if messages keep coming', () => {
    const bursts: CoalescedMessage[] = [];
    const cfg: CoalescerConfig = { quietWindowMs: 2000, maxBurstWaitMs: 5000, forceImmediateOnMention: true };
    const c = new MessageCoalescer((b) => bursts.push(b), () => cfg);

    // Send messages every 1s for 6 seconds
    for (let i = 0; i < 6; i++) {
      c.push(makeMsg({ messageId: `m${i}`, text: `msg${i}` }));
      vi.advanceTimersByTime(1000);
    }

    // maxBurstWait=5000 should have fired after 5s (5 messages)
    expect(bursts.length).toBeGreaterThanOrEqual(1);
    expect(bursts[0].coalescedCount).toBeGreaterThanOrEqual(5);
  });

  it('@bot mention fires immediately, bypassing coalescer', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    c.push(makeMsg({ text: '@bot hello', mentionedBot: true }));

    // Should fire immediately, no timer wait
    expect(bursts).toHaveLength(1);
    expect(bursts[0].text).toBe('@bot hello');
    expect(bursts[0].coalescedCount).toBe(1);
  });

  it('@bot mention with pending burst flushes burst first', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    // Non-mention messages accumulate
    c.push(makeMsg({ messageId: 'a', text: 'one' }));
    vi.advanceTimersByTime(500);
    c.push(makeMsg({ messageId: 'b', text: 'two' }));
    vi.advanceTimersByTime(500);

    // @bot arrives — should flush pending + this message together
    c.push(makeMsg({ messageId: 'c', text: '@bot three', mentionedBot: true }));

    expect(bursts).toHaveLength(1);
    expect(bursts[0].coalescedCount).toBe(3);
    expect(bursts[0].text).toBe('one\ntwo\n@bot three');
  });

  it('different senders get independent bursts', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    c.push(makeMsg({ senderId: 'alice', senderName: 'Alice', text: 'hi from alice' }));
    c.push(makeMsg({ senderId: 'bob', senderName: 'Bob', text: 'hi from bob' }));

    vi.advanceTimersByTime(2000);

    expect(bursts).toHaveLength(2);
    const alice = bursts.find(b => b.senderId === 'alice')!;
    const bob = bursts.find(b => b.senderId === 'bob')!;
    expect(alice.text).toBe('hi from alice');
    expect(bob.text).toBe('hi from bob');
  });

  it('different chatIds get independent bursts', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    c.push(makeMsg({ chatId: 'chat_a', text: 'in chat A' }));
    c.push(makeMsg({ chatId: 'chat_b', text: 'in chat B' }));

    vi.advanceTimersByTime(2000);

    expect(bursts).toHaveLength(2);
  });

  it('flushAll fires all pending bursts', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    c.push(makeMsg({ senderId: 'a', text: 'from a' }));
    c.push(makeMsg({ senderId: 'b', text: 'from b' }));

    expect(bursts).toHaveLength(0);
    expect(c.pendingCount).toBe(2);

    c.flushAll();

    expect(bursts).toHaveLength(2);
    expect(c.pendingCount).toBe(0);
  });

  it('config hot-reload takes effect on next push', () => {
    const bursts: CoalescedMessage[] = [];
    let quietMs = 2000;
    const c = new MessageCoalescer(
      (b) => bursts.push(b),
      () => ({ quietWindowMs: quietMs, maxBurstWaitMs: 8000, forceImmediateOnMention: true }),
    );

    c.push(makeMsg({ text: 'first' }));

    // Change config to shorter window
    quietMs = 500;

    vi.advanceTimersByTime(500);
    // Original timer was 2000ms, still pending
    expect(bursts).toHaveLength(0);

    // Push another — this one uses new config (500ms)
    c.push(makeMsg({ text: 'second' }));
    vi.advanceTimersByTime(500);

    expect(bursts).toHaveLength(1);
    expect(bursts[0].coalescedCount).toBe(2);
  });

  it('mentions are deduplicated across messages', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));
    const mention = { open_id: 'bot123', name: 'Bot' };

    c.push(makeMsg({ text: 'one', mentions: [mention] }));
    c.push(makeMsg({ text: 'two', mentions: [mention] }));

    vi.advanceTimersByTime(2000);

    expect(bursts[0].mentions).toHaveLength(1);
  });

  it('empty text messages still coalesce', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    c.push(makeMsg({ text: '' }));
    c.push(makeMsg({ text: 'hello' }));

    vi.advanceTimersByTime(2000);

    expect(bursts).toHaveLength(1);
    expect(bursts[0].text).toBe('\nhello');
    expect(bursts[0].coalescedCount).toBe(2);
  });

  it('senderName updates to latest non-empty value', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    c.push(makeMsg({ senderName: '', text: 'one' }));
    c.push(makeMsg({ senderName: 'Resolved Name', text: 'two' }));

    vi.advanceTimersByTime(2000);

    expect(bursts[0].senderName).toBe('Resolved Name');
  });

  it('forceImmediateOnMention=false disables @bot bypass', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer(
      (b) => bursts.push(b),
      () => ({ quietWindowMs: 2000, maxBurstWaitMs: 8000, forceImmediateOnMention: false }),
    );

    c.push(makeMsg({ text: '@bot hello', mentionedBot: true }));

    // Should NOT fire immediately
    expect(bursts).toHaveLength(0);

    vi.advanceTimersByTime(2000);
    expect(bursts).toHaveLength(1);
  });

  it('no burst fires if no messages pushed', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    vi.advanceTimersByTime(10000);
    c.flushAll();

    expect(bursts).toHaveLength(0);
  });

  it('pendingCount tracks active bursts correctly', () => {
    const bursts: CoalescedMessage[] = [];
    const c = new MessageCoalescer((b) => bursts.push(b));

    expect(c.pendingCount).toBe(0);

    c.push(makeMsg({ senderId: 'a' }));
    expect(c.pendingCount).toBe(1);

    c.push(makeMsg({ senderId: 'b' }));
    expect(c.pendingCount).toBe(2);

    c.push(makeMsg({ senderId: 'a' })); // same sender, same burst
    expect(c.pendingCount).toBe(2);

    vi.advanceTimersByTime(2000);
    expect(c.pendingCount).toBe(0);
  });
});
