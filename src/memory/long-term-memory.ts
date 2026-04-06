import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export interface LongTermMemory {
  id?: number;
  userId: string;
  type: 'emotional_event' | 'promise' | 'shared_experience' | 'factual_detail' | 'casual_banter';
  content: string;
  keywords: string[];
  importance: number;
  retrievalCount: number;
  lastRetrievedAt?: number;
  isForgettable: boolean;
  status?: 'active' | 'overridden' | 'fulfilled';
  createdAt: number;
}

export class LongTermMemoryStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Add a new long-term memory.
   */
  addMemory(userId: string, memory: Omit<LongTermMemory, 'id' | 'createdAt' | 'retrievalCount' | 'lastRetrievedAt'>): number {
    const result = this.db.prepare(`
      INSERT INTO long_term_memories (user_id, type, content, keywords, importance, is_forgettable, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, memory.type, memory.content,
      JSON.stringify(memory.keywords), memory.importance,
      memory.isForgettable ? 1 : 0, Date.now()
    );
    return result.lastInsertRowid as number;
  }

  /**
   * Search memories by keywords (OR match).
   */
  searchByKeywords(userId: string, keywords: string[], limit: number = 5): LongTermMemory[] {
    if (keywords.length === 0) return [];
    const conditions = keywords.map(() => 'keywords LIKE ?').join(' OR ');
    const params = keywords.map(k => `%${k}%`);
    const rows = this.db.prepare(
      `SELECT * FROM long_term_memories WHERE user_id = ? AND (${conditions}) ORDER BY importance DESC LIMIT ?`
    ).all(userId, ...params, limit) as Array<Record<string, unknown>>;

    // Update retrieval counts
    const ids = rows.map(r => r.id as number);
    if (ids.length > 0) this.recordRetrieval(ids);

    return rows.map(r => this.rowToMemory(r));
  }

  /**
   * Get memories by type.
   */
  getByType(userId: string, type: string, limit: number = 10): LongTermMemory[] {
    const rows = this.db.prepare(
      'SELECT * FROM long_term_memories WHERE user_id = ? AND type = ? ORDER BY importance DESC LIMIT ?'
    ).all(userId, type, limit) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToMemory(r));
  }

  /**
   * Get most important memories for a user.
   */
  getImportant(userId: string, limit: number = 10): LongTermMemory[] {
    const rows = this.db.prepare(
      'SELECT * FROM long_term_memories WHERE user_id = ? ORDER BY importance DESC LIMIT ?'
    ).all(userId, limit) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToMemory(r));
  }

  /**
   * Mark memories as forgettable after decay period.
   */
  forgetOld(userId: string, daysOld: number): number {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      'DELETE FROM long_term_memories WHERE user_id = ? AND is_forgettable = 1 AND created_at < ? AND importance < 0.5'
    ).run(userId, cutoff);
    if (result.changes > 0) {
      logger.info(`Forgot ${result.changes} old memories for user ${userId}`);
    }
    return result.changes;
  }

  /**
   * Update promise status (active → overridden/fulfilled).
   */
  updatePromiseStatus(id: number, status: 'active' | 'overridden' | 'fulfilled'): void {
    this.db.prepare('UPDATE long_term_memories SET status = ? WHERE id = ? AND type = ?')
      .run(status, id, 'promise');
    logger.info(`LTM: promise #${id} status → ${status}`);
  }

  /**
   * Get active promises for a user.
   */
  getActivePromises(userId: string, limit: number = 10): LongTermMemory[] {
    const rows = this.db.prepare(
      "SELECT * FROM long_term_memories WHERE user_id = ? AND type = 'promise' AND (status = 'active' OR status IS NULL) ORDER BY importance DESC LIMIT ?"
    ).all(userId, limit) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToMemory(r));
  }

  private recordRetrieval(ids: number[]): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      'UPDATE long_term_memories SET retrieval_count = retrieval_count + 1, last_retrieved_at = ? WHERE id = ?'
    );
    for (const id of ids) {
      stmt.run(now, id);
    }
  }

  private rowToMemory(row: Record<string, unknown>): LongTermMemory {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      type: row.type as LongTermMemory['type'],
      content: row.content as string,
      keywords: JSON.parse((row.keywords as string) || '[]'),
      importance: row.importance as number,
      retrievalCount: row.retrieval_count as number,
      lastRetrievedAt: row.last_retrieved_at as number | undefined,
      isForgettable: (row.is_forgettable as number) === 1,
      status: (row.status as string as LongTermMemory['status']) || 'active',
      createdAt: row.created_at as number,
    };
  }
}
