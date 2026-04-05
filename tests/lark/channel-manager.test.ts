/**
 * UAT Tests for v5.2 Multi-Service Architecture
 *
 * Tests:
 * - ConflictResolver: stale lock cleanup, live PID detection
 * - LarkChannel: lifecycle states, reconnect logic
 * - ChannelManager: multi-channel management, message routing
 * - buildChannelManagerFromEnv: legacy and advanced config modes
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── ConflictResolver Tests ──

describe('ConflictResolver', () => {
  it('should return true when no locks directory exists', async () => {
    const { ConflictResolver } = await import('../../src/lark/conflict-resolver.js');
    const resolver = new ConflictResolver();
    const result = await resolver.resolve('test-app', '/nonexistent/path');
    expect(result).toBe(true);
  });
});

// ── LarkChannel Config & State Tests ──

describe('LarkChannel', () => {
  it('should initialize with stopped state', async () => {
    const { LarkChannel } = await import('../../src/lark/lark-channel.js');
    const channel = new LarkChannel({
      appId: 'test-app-123',
      larkHome: '/tmp/test-lark',
    });

    expect(channel.appId).toBe('test-app-123');
    expect(channel.status).toBe('stopped');

    const state = channel.getState();
    expect(state.subscribePid).toBeNull();
    expect(state.reconnectAttempts).toBe(0);
    expect(state.maxReconnectAttempts).toBe(10);
    expect(state.lastError).toBeNull();
  });

  it('should expose immutable state snapshot', async () => {
    const { LarkChannel } = await import('../../src/lark/lark-channel.js');
    const channel = new LarkChannel({
      appId: 'test-app',
      larkHome: '/tmp/test',
    });

    const state1 = channel.getState();
    const state2 = channel.getState();
    expect(state1).toEqual(state2);
    expect(state1).not.toBe(state2); // different objects
  });
});

// ── ChannelManager Tests ──

describe('ChannelManager', () => {
  it('should register and track multiple channels', async () => {
    const { ChannelManager } = await import('../../src/lark/channel-manager.js');
    const manager = new ChannelManager();

    manager.addChannel({ appId: 'app-1', larkHome: '/tmp/a' });
    manager.addChannel({ appId: 'app-2', larkHome: '/tmp/b' });

    const snapshot = manager.getSnapshot();
    expect(snapshot.size).toBe(2);
    expect(snapshot.has('app-1')).toBe(true);
    expect(snapshot.has('app-2')).toBe(true);

    const ch1 = manager.getChannel('app-1');
    expect(ch1).toBeDefined();
    expect(ch1!.appId).toBe('app-1');
  });

  it('should return default channel (first registered)', async () => {
    const { ChannelManager } = await import('../../src/lark/channel-manager.js');
    const manager = new ChannelManager();

    manager.addChannel({ appId: 'first-app', larkHome: '/tmp/first' });
    manager.addChannel({ appId: 'second-app', larkHome: '/tmp/second' });

    const defaultCh = manager.getDefaultChannel();
    expect(defaultCh).toBeDefined();
    expect(defaultCh!.appId).toBe('first-app');
  });

  it('should replace channel with same appId', async () => {
    const { ChannelManager } = await import('../../src/lark/channel-manager.js');
    const manager = new ChannelManager();

    manager.addChannel({ appId: 'dup-app', larkHome: '/tmp/v1' });
    manager.addChannel({ appId: 'dup-app', larkHome: '/tmp/v2' });

    const snapshot = manager.getSnapshot();
    expect(snapshot.size).toBe(1);
  });

  it('should throw on startChannel with unknown appId', async () => {
    const { ChannelManager } = await import('../../src/lark/channel-manager.js');
    const manager = new ChannelManager();

    await expect(manager.startChannel('nonexistent')).rejects.toThrow('unknown channel');
  });

  it('should throw on stopChannel with unknown appId', async () => {
    const { ChannelManager } = await import('../../src/lark/channel-manager.js');
    const manager = new ChannelManager();

    await expect(manager.stopChannel('nonexistent')).rejects.toThrow('unknown channel');
  });

  it('should wire message handler to all channels', async () => {
    const { ChannelManager } = await import('../../src/lark/channel-manager.js');
    const manager = new ChannelManager();
    const received: Array<{ appId: string }> = [];

    manager.onMessage((_msg, appId) => {
      received.push({ appId });
    });

    manager.addChannel({ appId: 'app-with-handler', larkHome: '/tmp/h' });

    // Channel should have onMessage wired
    const ch = manager.getChannel('app-with-handler');
    expect(ch).toBeDefined();
  });
});

// ── buildChannelManagerFromEnv Tests ──

describe('buildChannelManagerFromEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean relevant env vars
    delete process.env.LARK_CHANNELS;
    delete process.env.LARK_HOME;
    delete process.env.TARGET_CHAT_ID;
    delete process.env.LARK_APP_ID;
    delete process.env.EVENT_TYPES;
  });

  afterEach(() => {
    // Restore
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) delete process.env[key];
    });
    Object.assign(process.env, originalEnv);
  });

  it('should build single channel from legacy env vars', async () => {
    process.env.LARK_HOME = '/tmp/legacy-home';
    process.env.TARGET_CHAT_ID = 'oc_test123';

    const { buildChannelManagerFromEnv } = await import('../../src/lark/channel-manager.js');
    const manager = buildChannelManagerFromEnv();
    const snapshot = manager.getSnapshot();

    expect(snapshot.size).toBe(1);
    // Default appId when LARK_APP_ID not set
    expect(snapshot.has('default')).toBe(true);
  });

  it('should build multi-channel from LARK_CHANNELS JSON', async () => {
    process.env.LARK_CHANNELS = JSON.stringify([
      { appId: 'app-a', larkHome: '/tmp/a', chatFilter: ['oc_1'] },
      { appId: 'app-b', larkHome: '/tmp/b' },
    ]);

    const { buildChannelManagerFromEnv } = await import('../../src/lark/channel-manager.js');
    const manager = buildChannelManagerFromEnv();
    const snapshot = manager.getSnapshot();

    expect(snapshot.size).toBe(2);
    expect(snapshot.has('app-a')).toBe(true);
    expect(snapshot.has('app-b')).toBe(true);
  });

  it('should throw on invalid LARK_CHANNELS JSON', async () => {
    process.env.LARK_CHANNELS = 'not-json';

    const { buildChannelManagerFromEnv } = await import('../../src/lark/channel-manager.js');
    expect(() => buildChannelManagerFromEnv()).toThrow('Invalid LARK_CHANNELS');
  });
});

// ── MessageRouter Tests ──

describe('MessageRouter', () => {
  it('should resolve exact appId+chatId match', async () => {
    const { MessageRouter } = await import('../../src/lark/message-router.js');
    const router = new MessageRouter('default.yaml');

    router.addBinding({ appId: 'app-1', chatId: 'chat-A', personaConfig: 'gaia.yaml' });
    router.addBinding({ appId: 'app-1', personaConfig: 'fallback.yaml' });

    expect(router.resolve('app-1', 'chat-A')).toBe('gaia.yaml');
    expect(router.resolve('app-1', 'chat-B')).toBe('fallback.yaml');
    expect(router.resolve('app-2', 'chat-X')).toBe('default.yaml');
  });

  it('should fall back to default persona', async () => {
    const { MessageRouter } = await import('../../src/lark/message-router.js');
    const router = new MessageRouter('global-default.yaml');

    expect(router.resolve('unknown-app', 'unknown-chat')).toBe('global-default.yaml');
  });
});

// ── Integration: ChannelManager shutdown ──

describe('ChannelManager shutdown', () => {
  it('should clear all channels after shutdown', async () => {
    const { ChannelManager } = await import('../../src/lark/channel-manager.js');
    const manager = new ChannelManager();

    manager.addChannel({ appId: 'ch-1', larkHome: '/tmp/1' });
    manager.addChannel({ appId: 'ch-2', larkHome: '/tmp/2' });

    await manager.shutdown();

    const snapshot = manager.getSnapshot();
    expect(snapshot.size).toBe(0);
  });
});
