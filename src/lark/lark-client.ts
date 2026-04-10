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
  /** Unix ms from Lark create_time; falls back to Date.now() if unavailable */
  createTime: number;
  /** ID of the message being quoted/replied to; null if not a quote */
  parentId: string | null;
  /** Root message ID of the thread; non-null when message is inside a thread */
  rootId: string | null;
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
        '--as', 'bot',
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
        '--as', 'bot',
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

  /** Cache of open_id → name from chat member lookups */
  private memberCache = new Map<string, string>();
  /** Set of chat IDs already fetched */
  private fetchedChats = new Set<string>();

  /**
   * Look up a user's display name by open_id.
   * Strategy: contact API → chat member list fallback → null
   */
  getUserName(openId: string, chatId?: string): string | null {
    // Check in-memory cache first
    const cached = this.memberCache.get(openId);
    if (cached) return cached;

    // Try contact API
    try {
      const output = this.runSync([
        'contact', '+get-user',
        '--user-id', openId,
        '--user-id-type', 'open_id',
        '--as', 'bot',
        '--format', 'json',
      ]);
      const parsed = JSON.parse(output);
      const name = parsed?.data?.user?.name || parsed?.user?.name || null;
      if (name) {
        this.memberCache.set(openId, name);
        logger.debug(`getUserName: resolved ${openId} → ${name} (contact API)`);
        return name;
      }
    } catch {
      // Fall through to chat member lookup
    }

    // Fallback: fetch chat member list (once per chat)
    if (chatId && !this.fetchedChats.has(chatId)) {
      try {
        const output = this.runSync([
          'im', 'chat.members', 'get',
          '--params', JSON.stringify({ chat_id: chatId }),
          '--as', 'bot',
          '--format', 'json',
        ]);
        const parsed = JSON.parse(output);
        const items = parsed?.data?.items || [];
        for (const item of items) {
          if (item.member_id && item.name) {
            this.memberCache.set(item.member_id, item.name);
          }
        }
        this.fetchedChats.add(chatId);
        logger.info(`getUserName: cached ${items.length} members from chat ${chatId}`);

        const found = this.memberCache.get(openId);
        if (found) return found;
      } catch (err) {
        logger.warn(`getUserName: chat members fallback failed for ${chatId}`, { error: String(err) });
      }
    }

    return null;
  }

  /**
   * Fetch message content by IDs (up to 50 at a time).
   * Returns a map of message_id → plain text content.
   */
  getMessages(messageIds: string[]): Map<string, string> {
    const result = new Map<string, string>();
    if (messageIds.length === 0) return result;
    try {
      const output = this.runSync([
        'im', '+messages-mget',
        '--message-ids', messageIds.join(','),
        '--as', 'bot',
      ]);
      const parsed = JSON.parse(output);
      for (const m of (parsed?.data?.messages ?? []) as Array<Record<string, unknown>>) {
        const id = m.message_id as string | undefined;
        const content = m.content as string | undefined;
        if (id && content) result.set(id, content);
      }
    } catch (err) {
      logger.warn('getMessages failed', { ids: messageIds, error: String(err) });
    }
    return result;
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

  /** Reply in thread — message appears in thread stream instead of main chat */
  replyInThread(rootMessageId: string, text: string): string | null {
    try {
      const output = this.runSync([
        'im', '+messages-reply',
        '--message-id', rootMessageId,
        '--reply-in-thread',
        '--text', text,
        '--as', 'bot',
      ]);
      try {
        const parsed = JSON.parse(output);
        return parsed.data?.message_id || 'sent';
      } catch {
        return output ? 'sent' : null;
      }
    } catch (err) {
      logger.error('replyInThread failed', { error: String(err) });
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

/** Extract readable text from a post (rich text) message */
function extractPostText(content: Record<string, unknown>): string {
  const parts: string[] = [];
  // Post content is typically: { "zh_cn": { "title": "...", "content": [[{tag, text}, ...]] } }
  // or directly { "content": [[{tag, text}, ...]] }
  const locales = ['zh_cn', 'en_us', 'ja_jp'];
  let postBody: Record<string, unknown> | null = null;
  for (const locale of locales) {
    if (content[locale] && typeof content[locale] === 'object') {
      postBody = content[locale] as Record<string, unknown>;
      break;
    }
  }
  if (!postBody) postBody = content;

  const title = postBody.title as string | undefined;
  if (title) parts.push(`[标题: ${title}]`);

  const rows = postBody.content as Array<Array<Record<string, unknown>>> | undefined;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const el of row) {
        if (el.tag === 'text' && el.text) parts.push(el.text as string);
        else if (el.tag === 'a' && el.href) parts.push(`[链接: ${el.text || el.href}]`);
        else if (el.tag === 'at' && el.user_name) parts.push(`@${el.user_name}`);
      }
    }
  }
  return parts.join(' ').trim();
}

/** Extract readable text from an interactive card message */
function extractCardText(content: Record<string, unknown>): string {
  const parts: string[] = [];
  const header = content.header as Record<string, unknown> | undefined;
  if (header?.title) {
    const titleObj = header.title as Record<string, unknown>;
    if (titleObj.content) parts.push(`[卡片: ${titleObj.content}]`);
  }
  const elements = content.elements as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(elements)) {
    for (const el of elements) {
      if (el.tag === 'div' && el.text) {
        const textObj = el.text as Record<string, unknown>;
        if (textObj.content) parts.push(textObj.content as string);
      } else if (el.tag === 'markdown' && el.content) {
        parts.push(el.content as string);
      }
    }
  }
  return parts.join(' ').trim();
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

  // Text extraction — supports text, post (rich text), interactive (card), share_chat
  let text = '';
  let content = dig(payload, ['event', 'message', 'content']) as string | Record<string, unknown> | undefined;
  if (!content) content = dig(payload, ['message', 'content']) as string | Record<string, unknown> | undefined;

  let parsedContent: Record<string, unknown> | null = null;
  if (typeof content === 'string') {
    try { parsedContent = JSON.parse(content); } catch { text = content; }
  } else if (typeof content === 'object' && content) {
    parsedContent = content as Record<string, unknown>;
  }

  if (parsedContent) {
    if (typeof parsedContent.text === 'string') {
      // Standard text message
      text = parsedContent.text;
    } else if (messageType === 'post' && parsedContent.content) {
      // Rich text (post): extract text from nested content array
      text = extractPostText(parsedContent);
    } else if (messageType === 'interactive' && parsedContent.elements) {
      // Interactive card: extract text from card elements
      text = extractCardText(parsedContent);
    } else if (messageType === 'share_chat') {
      text = `[分享了一个群聊: ${parsedContent.chat_id || ''}]`;
    } else if (messageType === 'image') {
      text = '[图片]';
    } else if (messageType === 'file') {
      const fileName = parsedContent.file_name || parsedContent.fileName || '';
      text = `[文件: ${fileName}]`;
    } else if (messageType === 'sticker') {
      text = '[表情包]';
    }
  }

  // Extract mentions from event payload
  const mentions = dig(payload, ['event', 'message', 'mentions']) as Array<Record<string, unknown>> | undefined;

  // Extract create_time (Lark sends unix ms as string)
  const createTimeRaw = dig(payload, ['event', 'message', 'create_time']);
  const createTime = typeof createTimeRaw === 'string' ? parseInt(createTimeRaw, 10) || Date.now()
    : typeof createTimeRaw === 'number' ? createTimeRaw
    : Date.now();

  // Extract parent_id / root_id (present when message is inside a thread or quotes another)
  const parentIdRaw = dig(payload, ['event', 'message', 'parent_id']);
  const rootIdRaw = dig(payload, ['event', 'message', 'root_id']);
  const rootId = typeof rootIdRaw === 'string' ? rootIdRaw : null;
  // parentId is only set when quoting a specific message (parent != root means it's a nested quote)
  const parentId = typeof parentIdRaw === 'string' && parentIdRaw !== rootIdRaw
    ? parentIdRaw
    : null;

  return {
    messageId,
    chatId,
    senderOpenId: senderOpenId || '',
    senderName,
    senderType,
    messageType,
    text: text.trim(),
    mentions: mentions || [],
    createTime,
    parentId,
    rootId,
    raw: payload,
  };
}
