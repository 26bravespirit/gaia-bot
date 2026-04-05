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

      -- v0.2.0: Biographical facts
      CREATE TABLE IF NOT EXISTS biographical_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '_self',
        period TEXT NOT NULL,
        age_approx INTEGER,
        fact_content TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK(source_type IN ('anchor', 'generated')),
        source_conversation_id TEXT,
        source_message_timestamp INTEGER,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 1.0,
        retrieval_count INTEGER DEFAULT 0,
        last_retrieved_at INTEGER,
        is_active INTEGER DEFAULT 1,
        conflict_with_id INTEGER,
        user_visible INTEGER DEFAULT 1,
        visible_position TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      -- v0.2.0: Long-term memories
      CREATE TABLE IF NOT EXISTS long_term_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('emotional_event','promise','shared_experience','factual_detail','casual_banter')),
        content TEXT NOT NULL,
        keywords TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        retrieval_count INTEGER DEFAULT 0,
        last_retrieved_at INTEGER,
        is_forgettable INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      -- v0.2.0: Self state (singleton)
      CREATE TABLE IF NOT EXISTS self_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        mood_baseline REAL DEFAULT 0.6,
        active_emotions TEXT DEFAULT '[]',
        recent_experiences TEXT DEFAULT '[]',
        energy_level TEXT DEFAULT 'normal',
        social_battery REAL DEFAULT 1.0,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      -- v0.2.0: Event log
      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        source_stage TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      -- v0.2.0: Extended relationships
      CREATE TABLE IF NOT EXISTS relationships (
        user_id TEXT PRIMARY KEY,
        stage TEXT NOT NULL DEFAULT 'stranger' CHECK(stage IN ('stranger','acquaintance','familiar','intimate')),
        intimacy_score REAL DEFAULT 0.0,
        interaction_count INTEGER DEFAULT 0,
        first_interaction_at INTEGER,
        last_interaction_at INTEGER,
        topics_shared TEXT DEFAULT '[]',
        promises TEXT DEFAULT '[]',
        notes TEXT DEFAULT '[]',
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      -- Runtime hot config (modifiable without restart)
      CREATE TABLE IF NOT EXISTS runtime_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      -- Initialize self_state singleton
      INSERT OR IGNORE INTO self_state (id, mood_baseline, energy_level) VALUES (1, 0.6, 'normal');

      -- Initialize default length distribution
      INSERT OR IGNORE INTO runtime_config (key, value) VALUES
        ('length_distribution', '{"ultra_short":0.15,"short":0.35,"normal":0.30,"long":0.20}'),
        ('length_templates', '{"ultra_short":"【这次回复超短，就1-4个字，像\\"哈哈\\"\\"好的\\"\\"真的假的\\"这种】","short":"【这次回复短一点，1-2句话，不超过30字】","normal":"【这次正常回复，2-3句话，30-60字左右】","long":"【这次可以稍微多说几句，但不超过80字】"}');

      CREATE INDEX IF NOT EXISTS idx_conv_user_ts ON conversation_log(user_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_user ON important_events(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bio_facts_period ON biographical_facts(period);
      CREATE INDEX IF NOT EXISTS idx_bio_facts_active ON biographical_facts(is_active);
      CREATE INDEX IF NOT EXISTS idx_bio_facts_importance ON biographical_facts(importance);
      CREATE INDEX IF NOT EXISTS idx_bio_facts_user_visible ON biographical_facts(user_visible);
      CREATE INDEX IF NOT EXISTS idx_ltm_user ON long_term_memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_ltm_keywords ON long_term_memories(keywords);
      CREATE INDEX IF NOT EXISTS idx_ltm_type ON long_term_memories(type);
      CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_event_log_ts ON event_log(timestamp);
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

  // ── Runtime Config ──

  getRuntimeConfig(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM runtime_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setRuntimeConfig(key: string, value: string): void {
    this.db.prepare(
      'INSERT INTO runtime_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?'
    ).run(key, value, Date.now(), value, Date.now());
  }

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
