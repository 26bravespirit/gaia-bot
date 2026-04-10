import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { logger } from '../utils/logger.js';
import { ConflictResolver } from './conflict-resolver.js';
import type { LarkMessage } from './lark-client.js';
import { extractLarkMessage } from './lark-client.js';

export interface LarkChannelConfig {
  appId: string;
  larkHome: string;
  larkBinary?: string;
  eventTypes?: string[];
  chatFilter?: string[];
  personaConfig?: string;
}

export type ChannelStatus = 'stopped' | 'starting' | 'running' | 'reconnecting' | 'error';

export interface ChannelState {
  appId: string;
  status: ChannelStatus;
  subscribePid: number | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  lastError: string | null;
  lastStartAt: number | null;
  lastStopAt: number | null;
}

export class LarkChannel {
  private config: LarkChannelConfig;
  private state: ChannelState;
  private proc: ChildProcess | null = null;
  private abortController: AbortController;
  private conflictResolver: ConflictResolver;
  private buffer = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private spawning = false; // Mutex: prevent double subscribe spawn

  // Callback for incoming messages
  onMessage: ((msg: LarkMessage, appId: string) => void) | null = null;

  constructor(config: LarkChannelConfig) {
    this.config = config;
    this.abortController = new AbortController();
    this.conflictResolver = new ConflictResolver();
    this.state = {
      appId: config.appId,
      status: 'stopped',
      subscribePid: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 10,
      lastError: null,
      lastStartAt: null,
      lastStopAt: null,
    };
  }

  get appId(): string { return this.config.appId; }
  get status(): ChannelStatus { return this.state.status; }

  getState(): Readonly<ChannelState> {
    return { ...this.state };
  }

  private getBinary(): string {
    return this.config.larkBinary || process.env.LARK_CLI_BIN || '/opt/homebrew/bin/lark-cli';
  }

  private getEnv(): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    env.PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    if (this.config.larkHome) env.HOME = this.config.larkHome;
    return env;
  }

  async start(): Promise<void> {
    if (this.state.status === 'running') {
      logger.warn(`LarkChannel[${this.config.appId}]: already running`);
      return;
    }

    this.abortController = new AbortController();
    this.state.status = 'starting';
    this.state.lastStartAt = Date.now();

    // Resolve conflicts first
    const resolved = await this.conflictResolver.resolve(this.config.appId, this.config.larkHome);
    if (!resolved) {
      this.state.status = 'error';
      this.state.lastError = 'conflict_resolution_failed';
      logger.error(`LarkChannel[${this.config.appId}]: conflict resolution failed`);
      return;
    }

    await this.spawnSubscribe();
  }

  private async spawnSubscribe(): Promise<void> {
    if (this.spawning) {
      logger.warn(`LarkChannel[${this.config.appId}]: spawnSubscribe skipped (already spawning)`);
      return;
    }
    if (this.proc && this.proc.exitCode === null) {
      logger.warn(`LarkChannel[${this.config.appId}]: killing existing subscribe pid=${this.proc.pid} before respawn`);
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
    this.spawning = true;
    const binary = this.getBinary();
    const args = ['event', '+subscribe', '--as', 'bot', '--quiet'];
    const eventTypes = this.config.eventTypes || ['im.message.receive_v1'];
    args.push('--event-types', eventTypes.join(','));

    const proc = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.getEnv(),
    });

    this.proc = proc;
    this.state.subscribePid = proc.pid ?? null;
    this.buffer = '';
    this.spawning = false;

    logger.info(`LarkChannel[${this.config.appId}]: subscribe started, pid=${proc.pid}`);

    // Early failure detection via stderr (2s window)
    let earlyFail = false;
    const earlyFailTimer = setTimeout(() => {
      if (!earlyFail && proc.exitCode === null) {
        this.state.status = 'running';
        this.state.reconnectAttempts = 0;
        logger.info(`LarkChannel[${this.config.appId}]: running`);
      }
    }, 2000);

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (!text) return;
      logger.warn(`LarkChannel[${this.config.appId}] stderr: ${text}`);

      if (text.includes('another') && text.includes('instance')) {
        earlyFail = true;
        clearTimeout(earlyFailTimer);
        this.state.lastError = 'another_instance_running';
        this.state.status = 'error';
        proc.kill();
      }
    });

    // NDJSON stdout processing
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (this.abortController.signal.aborted) return;

      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(trimmed);
        } catch {
          continue;
        }

        // DIAG: capture raw payload to investigate phantom replay
        logger.info(`RAW_EVENT: ${trimmed}`);

        const msg = extractLarkMessage(payload);
        if (!msg) continue;

        // Apply chat filter
        if (this.config.chatFilter?.length && !this.config.chatFilter.includes(msg.chatId)) {
          continue;
        }

        // Only text messages from users
        if (msg.messageType && msg.messageType !== 'text') continue;
        if (msg.senderType && msg.senderType !== 'user') continue;

        this.onMessage?.(msg, this.config.appId);
      }
    });

    proc.on('exit', (code) => {
      clearTimeout(earlyFailTimer);
      this.state.subscribePid = null;
      this.proc = null;

      if (this.abortController.signal.aborted || this.state.status === 'stopped') {
        // Intentional stop — don't reconnect
        logger.info(`LarkChannel[${this.config.appId}]: stopped (code=${code})`);
        this.state.status = 'stopped';
        this.state.lastStopAt = Date.now();
        return;
      }

      // Unexpected exit — attempt reconnect
      logger.warn(`LarkChannel[${this.config.appId}]: unexpected exit (code=${code}), will reconnect`);
      this.state.lastError = `exit_code_${code}`;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.state.reconnectAttempts >= this.state.maxReconnectAttempts) {
      // Don't give up permanently — schedule a long-interval retry every 10 minutes
      logger.error(`LarkChannel[${this.config.appId}]: max reconnect attempts (${this.state.maxReconnectAttempts}) exhausted, entering long-interval retry (10min)`);
      this.state.status = 'reconnecting';
      this.reconnectTimer = setTimeout(async () => {
        this.reconnectTimer = null;
        if (this.abortController.signal.aborted) return;
        logger.info(`LarkChannel[${this.config.appId}]: long-interval retry, resetting reconnect counter`);
        this.state.reconnectAttempts = 0;
        await this.conflictResolver.resolve(this.config.appId, this.config.larkHome);
        await this.spawnSubscribe();
      }, 10 * 60_000);
      return;
    }

    this.state.status = 'reconnecting';
    this.state.reconnectAttempts++;

    // Exponential backoff: 5s, 10s, 20s, 40s, ... max 5min
    const delay = Math.min(5000 * Math.pow(2, this.state.reconnectAttempts - 1), 300_000);
    logger.info(`LarkChannel[${this.config.appId}]: reconnect #${this.state.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.abortController.signal.aborted) return;

      // Re-resolve conflicts before reconnecting
      await this.conflictResolver.resolve(this.config.appId, this.config.larkHome);
      await this.spawnSubscribe();
    }, delay);
  }

  async stop(): Promise<void> {
    this.state.status = 'stopped';
    this.abortController.abort();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.proc && this.proc.exitCode === null) {
      logger.info(`LarkChannel[${this.config.appId}]: stopping subscribe pid=${this.proc.pid}`);
      this.proc.kill('SIGTERM');

      // Wait up to 5s for graceful exit, then SIGKILL
      const exitPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.proc && this.proc.exitCode === null) {
            logger.warn(`LarkChannel[${this.config.appId}]: SIGKILL after timeout`);
            this.proc.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.proc?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      await exitPromise;
    }

    this.state.subscribePid = null;
    this.state.lastStopAt = Date.now();
    this.proc = null;
    logger.info(`LarkChannel[${this.config.appId}]: stopped`);
  }

  /**
   * Send a text message via this channel's lark-cli.
   */
  sendText(chatId: string, text: string): string | null {
    try {
      const output = execFileSync(this.getBinary(), [
        'im', '+messages-send',
        '--chat-id', chatId,
        '--text', text,
        '--as', 'bot',
      ], {
        encoding: 'utf-8',
        timeout: 15000,
        env: this.getEnv(),
      }).trim();

      try {
        const parsed = JSON.parse(output);
        return parsed.data?.message_id || parsed.message_id || 'sent';
      } catch {
        return output ? 'sent' : null;
      }
    } catch (err) {
      logger.error(`LarkChannel[${this.config.appId}] sendText failed`, { error: String(err) });
      return null;
    }
  }
}
