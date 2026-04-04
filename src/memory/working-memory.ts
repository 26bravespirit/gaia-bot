import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export interface UserProfile {
  userId: string;
  displayName: string;
  alias: string | null;
  relationshipStage: string;
  trustLevel: number;
  firstSeenAt: number;
  lastSeenAt: number;
  messageCount: number;
  metadata: Record<string, unknown>;
}

export class WorkingMemory {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        alias TEXT,
        relationship_stage TEXT NOT NULL DEFAULT 'stranger',
        trust_level REAL NOT NULL DEFAULT 0.5,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS conversation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sender_name TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL,
        message_id TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS important_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS dedup (
        message_id TEXT PRIMARY KEY,
        processed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conv_user_ts ON conversation_log(user_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_user ON important_events(user_id, created_at DESC);
    `);
  }

  // ── User Profiles ──

  upsertUser(userId: string, displayName: string, alias?: string | null): UserProfile {
    const now = Date.now();
    const existing = this.getUser(userId);
    if (existing) {
      this.db.prepare(`
        UPDATE users SET display_name = ?, alias = COALESCE(?, alias),
        last_seen_at = ?, message_count = message_count + 1 WHERE user_id = ?
      `).run(displayName, alias ?? null, now, userId);
      return { ...existing, displayName, lastSeenAt: now, messageCount: existing.messageCount + 1 };
    }
    this.db.prepare(`
      INSERT INTO users (user_id, display_name, alias, first_seen_at, last_seen_at, message_count)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(userId, displayName, alias ?? null, now, now);
    return {
      userId, displayName, alias: alias ?? null,
      relationshipStage: 'stranger', trustLevel: 0.5,
      firstSeenAt: now, lastSeenAt: now, messageCount: 1, metadata: {},
    };
  }

  getUser(userId: string): UserProfile | null {
    const row = this.db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      userId: row.user_id as string,
      displayName: row.display_name as string,
      alias: row.alias as string | null,
      relationshipStage: row.relationship_stage as string,
      trustLevel: row.trust_level as number,
      firstSeenAt: row.first_seen_at as number,
      lastSeenAt: row.last_seen_at as number,
      messageCount: row.message_count as number,
      metadata: JSON.parse((row.metadata as string) || '{}'),
    };
  }

  // ── Conversation Log ──

  logMessage(userId: string, chatId: string, role: string, content: string,
             senderName: string, timestamp: number, messageId?: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO conversation_log (user_id, chat_id, role, content, sender_name, timestamp, message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, chatId, role, content, senderName, timestamp, messageId ?? null);
  }

  getRecentConversation(userId: string, limit: number = 20): Array<{ role: string; content: string; senderName: string; timestamp: number }> {
    const rows = this.db.prepare(
      'SELECT role, content, sender_name, timestamp FROM conversation_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(userId, limit) as Array<Record<string, unknown>>;
    return rows.reverse().map(r => ({
      role: r.role as string,
      content: r.content as string,
      senderName: r.sender_name as string,
      timestamp: r.timestamp as number,
    }));
  }

  // ── Important Events ──

  recordEvent(userId: string, eventType: string, content: string, importance: number = 1): void {
    this.db.prepare(`
      INSERT INTO important_events (user_id, event_type, content, importance, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, eventType, content, importance, Date.now());
  }

  searchEvents(keyword: string, userId?: string): Array<{ eventType: string; content: string; createdAt: number }> {
    const query = userId
      ? 'SELECT event_type, content, created_at FROM important_events WHERE user_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 10'
      : 'SELECT event_type, content, created_at FROM important_events WHERE content LIKE ? ORDER BY created_at DESC LIMIT 10';
    const params = userId ? [userId, `%${keyword}%`] : [`%${keyword}%`];
    const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      eventType: r.event_type as string,
      content: r.content as string,
      createdAt: r.created_at as number,
    }));
  }

  // ── Dedup ──

  isSeen(messageId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM dedup WHERE message_id = ?').get(messageId);
    return !!row;
  }

  markSeen(messageId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO dedup (message_id, processed_at) VALUES (?, ?)').run(messageId, Date.now());
  }

  close(): void {
    this.db.close();
  }
}
