import { logger } from '../utils/logger.js';
import { LarkChannel, type LarkChannelConfig, type ChannelState } from './lark-channel.js';
import type { LarkMessage } from './lark-client.js';

export class ChannelManager {
  private channels: Map<string, LarkChannel> = new Map();
  private messageHandler: ((msg: LarkMessage, appId: string) => void) | null = null;

  /**
   * Register a message handler that receives all messages from all channels.
   */
  onMessage(handler: (msg: LarkMessage, appId: string) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Add a channel configuration. Does not start it yet.
   */
  addChannel(config: LarkChannelConfig): void {
    if (this.channels.has(config.appId)) {
      logger.warn(`ChannelManager: channel ${config.appId} already registered, replacing`);
      this.channels.get(config.appId)!.stop().catch(() => {});
    }

    const channel = new LarkChannel(config);
    channel.onMessage = (msg, appId) => {
      this.messageHandler?.(msg, appId);
    };
    this.channels.set(config.appId, channel);
    logger.info(`ChannelManager: registered channel ${config.appId}`);
  }

  /**
   * Start all registered channels.
   */
  async startAll(): Promise<void> {
    logger.info(`ChannelManager: starting ${this.channels.size} channel(s)`);

    const promises: Promise<void>[] = [];
    for (const [appId, channel] of this.channels) {
      promises.push(
        channel.start().catch(err => {
          logger.error(`ChannelManager: failed to start channel ${appId}`, { error: String(err) });
        })
      );
    }
    await Promise.all(promises);

    logger.info('ChannelManager: all channels started');
  }

  /**
   * Start a single channel by appId.
   */
  async startChannel(appId: string): Promise<void> {
    const channel = this.channels.get(appId);
    if (!channel) {
      throw new Error(`ChannelManager: unknown channel ${appId}`);
    }
    await channel.start();
  }

  /**
   * Stop a single channel by appId.
   */
  async stopChannel(appId: string): Promise<void> {
    const channel = this.channels.get(appId);
    if (!channel) {
      throw new Error(`ChannelManager: unknown channel ${appId}`);
    }
    await channel.stop();
  }

  /**
   * Get state snapshot of all channels.
   */
  getSnapshot(): Map<string, ChannelState> {
    const snapshot = new Map<string, ChannelState>();
    for (const [appId, channel] of this.channels) {
      snapshot.set(appId, channel.getState());
    }
    return snapshot;
  }

  /**
   * Get a specific channel for sending messages.
   */
  getChannel(appId: string): LarkChannel | undefined {
    return this.channels.get(appId);
  }

  /**
   * Get the first (default) channel — for single-app scenarios.
   */
  getDefaultChannel(): LarkChannel | undefined {
    return this.channels.values().next().value;
  }

  /**
   * Graceful shutdown of all channels.
   */
  async shutdown(): Promise<void> {
    logger.info('ChannelManager: shutting down all channels');

    const promises: Promise<void>[] = [];
    for (const [appId, channel] of this.channels) {
      promises.push(
        channel.stop().catch(err => {
          logger.error(`ChannelManager: error stopping channel ${appId}`, { error: String(err) });
        })
      );
    }
    await Promise.all(promises);

    this.channels.clear();
    logger.info('ChannelManager: shutdown complete');
  }
}

/**
 * Build ChannelManager from environment variables.
 * Supports two modes:
 * 1. LARK_CHANNELS JSON array (advanced multi-app)
 * 2. Legacy LARK_HOME + TARGET_CHAT_ID (single app, backward-compatible)
 */
export function buildChannelManagerFromEnv(): ChannelManager {
  const manager = new ChannelManager();

  const channelsJson = process.env.LARK_CHANNELS?.trim();

  if (channelsJson) {
    // Advanced mode: parse JSON array
    try {
      const configs: LarkChannelConfig[] = JSON.parse(channelsJson);
      for (const cfg of configs) {
        manager.addChannel({
          appId: cfg.appId,
          larkHome: cfg.larkHome,
          larkBinary: cfg.larkBinary || process.env.LARK_CLI_BIN,
          eventTypes: cfg.eventTypes || (process.env.EVENT_TYPES || 'im.message.receive_v1').split(',').map(s => s.trim()).filter(Boolean),
          chatFilter: cfg.chatFilter,
          personaConfig: cfg.personaConfig,
        });
      }
      logger.info(`ChannelManager: loaded ${configs.length} channel(s) from LARK_CHANNELS`);
    } catch (err) {
      logger.error('ChannelManager: failed to parse LARK_CHANNELS JSON', { error: String(err) });
      throw new Error('Invalid LARK_CHANNELS configuration');
    }
  } else {
    // Legacy mode: single channel from individual env vars
    const larkHome = process.env.LARK_HOME?.trim() || '';
    const targetChatId = process.env.TARGET_CHAT_ID?.trim() || '';
    const appId = process.env.LARK_APP_ID?.trim() || 'default';

    manager.addChannel({
      appId,
      larkHome,
      larkBinary: process.env.LARK_CLI_BIN,
      eventTypes: (process.env.EVENT_TYPES || 'im.message.receive_v1').split(',').map(s => s.trim()).filter(Boolean),
      chatFilter: targetChatId ? [targetChatId] : undefined,
    });
    logger.info('ChannelManager: loaded 1 channel from legacy env vars');
  }

  return manager;
}
