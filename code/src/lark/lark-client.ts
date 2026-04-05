import { execFileSync } from 'child_process';
import { logger } from '../utils/logger.js';

export interface LarkMessage {
  messageId: string;
  chatId: string;
  senderOpenId: string;
  senderName: string;
  senderType: string;
  messageType: string;
  text: string;
  mentions: Array<Record<string, unknown>>;
  raw: Record<string, unknown>;
}

/**
 * LarkClient — send-only client for lark-cli.
 * Subscribe functionality has been moved to LarkChannel/ChannelManager.
 */
export class LarkClient {
  private binary: string;
  private home: string;

  constructor(binary?: string, home?: string) {
    this.binary = binary || process.env.LARK_CLI_BIN || '/opt/homebrew/bin/lark-cli';
    this.home = home || process.env.LARK_HOME || '';
  }

  private getEnv(): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    env.PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    if (this.home) env.HOME = this.home;
    return env;
  }

  private runSync(args: string[]): string {
    const result = execFileSync(this.binary, args, {
      encoding: 'utf-8',
      timeout: 15000,
      env: this.getEnv(),
    });
    return result.trim();
  }

  sendText(chatId: string, text: string): string | null {
    try {
      const output = this.runSync([
        'im', '+messages-send',
        '--chat-id', chatId,
        '--text', text,
      ]);
      logger.debug('sendText result', { output: output.slice(0, 200) });
      try {
        const parsed = JSON.parse(output);
        return parsed.data?.message_id || parsed.message_id || 'sent';
      } catch {
        return output ? 'sent' : null;
      }
    } catch (err) {
      logger.error('sendText failed', { error: String(err) });
      return null;
    }
  }

  sendCard(chatId: string, card: Record<string, unknown>): string | null {
    try {
      const content = JSON.stringify(card);
      const output = this.runSync([
        'im', '+messages-send',
        '--chat-id', chatId,
        '--msg-type', 'interactive',
        '--content', `'${content}'`,
      ]);
      try {
        const parsed = JSON.parse(output);
        return parsed.data?.message_id || 'sent';
      } catch {
        return output ? 'sent' : null;
      }
    } catch (err) {
      logger.error('sendCard failed', { error: String(err) });
      return null;
    }
  }

  replyText(messageId: string, text: string): string | null {
    try {
      const output = this.runSync([
        'im', '+messages-reply',
        '--message-id', messageId,
        '--text', text,
      ]);
      try {
        const parsed = JSON.parse(output);
        return parsed.data?.message_id || 'sent';
      } catch {
        return output ? 'sent' : null;
      }
    } catch (err) {
      logger.error('replyText failed', { error: String(err) });
      return null;
    }
  }
}

// ── Message extraction from raw lark-cli event payload ──

function dig(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function extractLarkMessage(payload: Record<string, unknown>): LarkMessage | null {
  // Event type check
  let eventType: string | undefined;
  for (const path of [['header', 'event_type'], ['event_type'], ['type']]) {
    const v = dig(payload, path);
    if (typeof v === 'string') { eventType = v; break; }
  }
  if (!eventType || !eventType.toLowerCase().includes('message')) return null;

  // Message ID
  let messageId: string | undefined;
  for (const path of [['event', 'message', 'message_id'], ['event', 'message_id']]) {
    const v = dig(payload, path);
    if (typeof v === 'string') { messageId = v; break; }
  }

  // Chat ID
  let chatId: string | undefined;
  for (const path of [['event', 'message', 'chat_id'], ['event', 'chat_id']]) {
    const v = dig(payload, path);
    if (typeof v === 'string') { chatId = v; break; }
  }

  if (!messageId || !chatId) return null;

  // Sender
  let senderOpenId: string | undefined;
  for (const path of [['event', 'sender', 'sender_id', 'open_id'], ['event', 'sender', 'open_id']]) {
    const v = dig(payload, path);
    if (typeof v === 'string') { senderOpenId = v; break; }
  }

  let senderName = '';
  for (const path of [['event', 'sender', 'sender_id', 'name'], ['event', 'sender', 'name']]) {
    const v = dig(payload, path);
    if (typeof v === 'string') { senderName = v; break; }
  }

  const senderType = (dig(payload, ['event', 'sender', 'sender_type']) as string) || '';
  const messageType = (dig(payload, ['event', 'message', 'message_type']) as string) || '';

  // Text extraction
  let text = '';
  let content = dig(payload, ['event', 'message', 'content']) as string | Record<string, unknown> | undefined;
  if (!content) content = dig(payload, ['message', 'content']) as string | Record<string, unknown> | undefined;
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      text = typeof parsed.text === 'string' ? parsed.text : '';
    } catch {
      text = content;
    }
  } else if (typeof content === 'object' && content) {
    text = typeof content.text === 'string' ? content.text : '';
  }

  // Extract mentions from event payload
  const mentions = dig(payload, ['event', 'message', 'mentions']) as Array<Record<string, unknown>> | undefined;

  return {
    messageId,
    chatId,
    senderOpenId: senderOpenId || '',
    senderName,
    senderType,
    messageType,
    text: text.trim(),
    mentions: mentions || [],
    raw: payload,
  };
}
