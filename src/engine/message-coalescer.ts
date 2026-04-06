import { logger } from '../utils/logger.js';

export interface CoalescedMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  messageType: string;
  timestamp: number;
  mentions: Array<Record<string, unknown>>;
  coalescedCount: number;
  messageIds: string[];
}

interface BurstMessage {
  messageId: string;
  text: string;
  timestamp: number;
  mentions: Array<Record<string, unknown>>;
  messageType: string;
}

interface PendingBurst {
  chatId: string;
  senderId: string;
  senderName: string;
  messages: BurstMessage[];
  firstTs: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface CoalescerConfig {
  quietWindowMs: number;
  maxBurstWaitMs: number;
  forceImmediateOnMention: boolean;
}

const DEFAULT_CONFIG: CoalescerConfig = {
  quietWindowMs: 2000,
  maxBurstWaitMs: 8000,
  forceImmediateOnMention: true,
};

export class MessageCoalescer {
  private pending = new Map<string, PendingBurst>();
  private onBurst: (msg: CoalescedMessage) => void;
  private getConfig: () => CoalescerConfig;

  constructor(
    onBurst: (msg: CoalescedMessage) => void,
    getConfig?: () => CoalescerConfig,
  ) {
    this.onBurst = onBurst;
    this.getConfig = getConfig ?? (() => DEFAULT_CONFIG);
  }

  push(msg: {
    messageId: string;
    chatId: string;
    senderId: string;
    senderName: string;
    text: string;
    messageType: string;
    timestamp: number;
    mentions: Array<Record<string, unknown>>;
    mentionedBot: boolean;
  }): void {
    const cfg = this.getConfig();
    const key = `${msg.chatId}:${msg.senderId}`;

    // @bot → flush existing burst (if any) with this message appended, then fire immediately
    if (msg.mentionedBot && cfg.forceImmediateOnMention) {
      const existing = this.pending.get(key);
      if (existing) {
        existing.messages.push({
          messageId: msg.messageId,
          text: msg.text,
          timestamp: msg.timestamp,
          mentions: msg.mentions,
          messageType: msg.messageType,
        });
        if (msg.senderName) existing.senderName = msg.senderName;
        clearTimeout(existing.timer);
        this.pending.delete(key);
        this.fireBurst(existing);
      } else {
        this.onBurst({
          messageId: msg.messageId,
          chatId: msg.chatId,
          senderId: msg.senderId,
          senderName: msg.senderName,
          text: msg.text,
          messageType: msg.messageType,
          timestamp: msg.timestamp,
          mentions: msg.mentions,
          coalescedCount: 1,
          messageIds: [msg.messageId],
        });
      }
      return;
    }

    const existing = this.pending.get(key);

    if (existing) {
      existing.messages.push({
        messageId: msg.messageId,
        text: msg.text,
        timestamp: msg.timestamp,
        mentions: msg.mentions,
        messageType: msg.messageType,
      });
      if (msg.senderName) existing.senderName = msg.senderName;

      // maxBurstWait exceeded → fire immediately
      if (Date.now() - existing.firstTs >= cfg.maxBurstWaitMs) {
        clearTimeout(existing.timer);
        this.pending.delete(key);
        this.fireBurst(existing);
        return;
      }

      // Reset quiet window timer
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => {
        this.pending.delete(key);
        this.fireBurst(existing);
      }, cfg.quietWindowMs);
    } else {
      const burst: PendingBurst = {
        chatId: msg.chatId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        messages: [{
          messageId: msg.messageId,
          text: msg.text,
          timestamp: msg.timestamp,
          mentions: msg.mentions,
          messageType: msg.messageType,
        }],
        firstTs: Date.now(),
        timer: setTimeout(() => {
          this.pending.delete(key);
          this.fireBurst(burst);
        }, cfg.quietWindowMs),
      };
      this.pending.set(key, burst);
    }
  }

  private fireBurst(burst: PendingBurst): void {
    const msgs = burst.messages;
    if (msgs.length === 0) return;

    const last = msgs[msgs.length - 1];

    // Deduplicate mentions by JSON key
    const seenMentions = new Set<string>();
    const uniqueMentions = msgs.flatMap(m => m.mentions).filter(m => {
      const k = JSON.stringify(m);
      if (seenMentions.has(k)) return false;
      seenMentions.add(k);
      return true;
    });

    const text = msgs.length === 1
      ? msgs[0].text
      : msgs.map(m => m.text).join('\n');

    logger.info(
      `Coalescer: burst [${burst.senderName}] ${msgs.length} msg(s), ` +
      `wait=${Date.now() - burst.firstTs}ms, text="${text.slice(0, 60)}"`,
    );

    this.onBurst({
      messageId: last.messageId,
      chatId: burst.chatId,
      senderId: burst.senderId,
      senderName: burst.senderName,
      text,
      messageType: last.messageType,
      timestamp: last.timestamp,
      mentions: uniqueMentions,
      coalescedCount: msgs.length,
      messageIds: msgs.map(m => m.messageId),
    });
  }

  /** Flush all pending bursts immediately (shutdown path). */
  flushAll(): void {
    for (const [key, burst] of this.pending) {
      clearTimeout(burst.timer);
      this.fireBurst(burst);
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
