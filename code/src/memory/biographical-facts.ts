import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export interface BiographicalFact {
  id?: number;
  userId: string;
  period: string;
  ageApprox?: number;
  factContent: string;
  sourceType: 'anchor' | 'generated';
  sourceConversationId?: string;
  sourceMessageTimestamp?: number;
  importance: number;
  confidence: number;
  retrievalCount: number;
  lastRetrievedAt?: number;
  isActive: boolean;
  conflictWithId?: number;
  userVisible: boolean;
  visiblePosition?: string;
  createdAt: number;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingFact?: BiographicalFact;
  conflictType: 'time_mismatch' | 'detail_contradiction' | 'anchor_conflict' | 'none';
  resolution: 'reject_new' | 'keep_both_flagged' | 'merge';
}

export class BiographicalFactStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Initialize anchor facts from persona config.
   * Only inserts if no anchors exist yet.
   */
  initializeAnchors(anchors: Array<{ period: string; age_approx?: number; fact_content: string }>): void {
    const existing = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM biographical_facts WHERE source_type = 'anchor'"
    ).get() as { cnt: number };

    if (existing.cnt > 0) return;

    const insert = this.db.prepare(`
      INSERT INTO biographical_facts (user_id, period, age_approx, fact_content, source_type, importance, confidence, is_active, user_visible, created_at)
      VALUES ('_self', ?, ?, ?, 'anchor', 0.9, 1.0, 1, 1, ?)
    `);

    const now = Date.now();
    const tx = this.db.transaction(() => {
      for (const anchor of anchors) {
        insert.run(anchor.period, anchor.age_approx ?? null, anchor.fact_content, now);
      }
    });
    tx();
    logger.info(`Initialized ${anchors.length} biography anchors`);
  }

  /**
   * Add a new generated biographical fact with conflict detection.
   */
  addFact(fact: Omit<BiographicalFact, 'id' | 'createdAt' | 'retrievalCount' | 'lastRetrievedAt'>): number | null {
    // Check for conflicts first
    const conflict = this.checkConflict(fact);
    if (conflict.hasConflict && conflict.resolution === 'reject_new') {
      logger.debug(`Biographical fact rejected due to ${conflict.conflictType}`);
      return null;
    }

    const result = this.db.prepare(`
      INSERT INTO biographical_facts (user_id, period, age_approx, fact_content, source_type,
        source_conversation_id, source_message_timestamp, importance, confidence,
        is_active, conflict_with_id, user_visible, visible_position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fact.userId, fact.period, fact.ageApprox ?? null, fact.factContent, fact.sourceType,
      fact.sourceConversationId ?? null, fact.sourceMessageTimestamp ?? null,
      fact.importance, fact.confidence,
      fact.isActive ? 1 : 0, conflict.conflictingFact?.id ?? null,
      fact.userVisible ? 1 : 0, fact.visiblePosition ?? null, Date.now()
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Check if a new fact conflicts with existing facts.
   */
  checkConflict(newFact: Omit<BiographicalFact, 'id' | 'createdAt' | 'retrievalCount' | 'lastRetrievedAt'>): ConflictCheckResult {
    const existing = this.getActiveFactsByPeriod(newFact.period);

    for (const existingFact of existing) {
      const similarity = this.textSimilarity(newFact.factContent, existingFact.factContent);

      // ≥0.9: near-duplicate → reject
      if (similarity >= 0.9) {
        return {
          hasConflict: true,
          conflictingFact: existingFact,
          conflictType: 'detail_contradiction',
          resolution: 'reject_new',
        };
      }

      // Anchor conflict: new generated fact contradicts anchor (similarity < 0.5 = unrelated content in same period)
      if (existingFact.sourceType === 'anchor' && similarity >= 0.3 && similarity < 0.5) {
        // Partially overlapping with anchor but divergent — likely contradiction
        return {
          hasConflict: true,
          conflictingFact: existingFact,
          conflictType: 'anchor_conflict',
          resolution: 'reject_new',
        };
      }

      // 0.5-0.9: suspicious similarity — detail contradiction, flag both
      if (similarity >= 0.5 && similarity < 0.9) {
        return {
          hasConflict: true,
          conflictingFact: existingFact,
          conflictType: 'detail_contradiction',
          resolution: 'keep_both_flagged',
        };
      }

      // Age mismatch check
      if (newFact.ageApprox && existingFact.ageApprox) {
        if (Math.abs(newFact.ageApprox - existingFact.ageApprox) > 3) {
          return {
            hasConflict: true,
            conflictingFact: existingFact,
            conflictType: 'time_mismatch',
            resolution: 'reject_new',
          };
        }
      }
    }

    return { hasConflict: false, conflictType: 'none', resolution: 'merge' };
  }

  /**
   * Get active facts by period.
   */
  getActiveFactsByPeriod(period: string): BiographicalFact[] {
    const rows = this.db.prepare(
      'SELECT * FROM biographical_facts WHERE period = ? AND is_active = 1 ORDER BY importance DESC'
    ).all(period) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToFact(r));
  }

  /**
   * Get all active facts.
   */
  getAllActiveFacts(): BiographicalFact[] {
    const rows = this.db.prepare(
      'SELECT * FROM biographical_facts WHERE is_active = 1 ORDER BY importance DESC'
    ).all() as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToFact(r));
  }

  /**
   * Get user-visible facts for S2 prompt injection.
   */
  getUserVisibleFacts(limit: number = 10, confidenceThreshold: number = 0.3): BiographicalFact[] {
    const rows = this.db.prepare(
      'SELECT * FROM biographical_facts WHERE is_active = 1 AND user_visible = 1 AND confidence >= ? ORDER BY source_type ASC, importance DESC, confidence DESC LIMIT ?'
    ).all(confidenceThreshold, limit) as Array<Record<string, unknown>>;
    // source_type ASC puts 'anchor' before 'generated' — anchors always prioritized

    // Update retrieval counts
    const ids = rows.map(r => r.id as number);
    if (ids.length > 0) {
      this.updateRetrievalCount(ids);
    }

    return rows.map(r => this.rowToFact(r));
  }

  /**
   * Search facts by keywords.
   */
  searchByKeywords(keywords: string[], limit: number = 5, confidenceThreshold: number = 0.3): BiographicalFact[] {
    if (keywords.length === 0) return [];
    const conditions = keywords.map(() => 'fact_content LIKE ?').join(' OR ');
    const params = keywords.map(k => `%${k}%`);
    const rows = this.db.prepare(
      `SELECT * FROM biographical_facts WHERE is_active = 1 AND user_visible = 1 AND confidence >= ? AND (${conditions}) ORDER BY source_type ASC, importance DESC LIMIT ?`
    ).all(confidenceThreshold, ...params, limit) as Array<Record<string, unknown>>;
    return rows.map(r => this.rowToFact(r));
  }

  /**
   * Mark a fact as not user-visible (truncated by S5 R04).
   */
  markInvisible(factId: number): void {
    this.db.prepare(
      'UPDATE biographical_facts SET user_visible = 0, visible_position = ? WHERE id = ?'
    ).run('truncated', factId);
  }

  /**
   * Deactivate a fact (soft delete).
   */
  deactivateFact(factId: number, conflictWithId?: number): void {
    this.db.prepare(
      'UPDATE biographical_facts SET is_active = 0, conflict_with_id = ? WHERE id = ?'
    ).run(conflictWithId ?? null, factId);
  }

  /**
   * Update retrieval counts for accessed facts.
   */
  updateRetrievalCount(factIds: number[]): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      'UPDATE biographical_facts SET retrieval_count = retrieval_count + 1, last_retrieved_at = ? WHERE id = ?'
    );
    for (const id of factIds) {
      stmt.run(now, id);
    }
  }

  /**
   * N-gram based text similarity (bigram Dice coefficient).
   * More accurate than character-level Jaccard for Chinese text.
   * Returns 0-1, where 1 = identical.
   */
  private textSimilarity(a: string, b: string): number {
    const ngramsA = this.bigrams(a);
    const ngramsB = this.bigrams(b);
    if (ngramsA.size === 0 && ngramsB.size === 0) return 1;
    if (ngramsA.size === 0 || ngramsB.size === 0) return 0;

    let intersection = 0;
    for (const gram of ngramsA) {
      if (ngramsB.has(gram)) intersection++;
    }
    // Dice coefficient: 2 * |A ∩ B| / (|A| + |B|)
    return (2 * intersection) / (ngramsA.size + ngramsB.size);
  }

  private bigrams(text: string): Set<string> {
    const cleaned = text.replace(/[\s，。！？、；：""''（）\[\]【】]/g, '');
    const grams = new Set<string>();
    for (let i = 0; i < cleaned.length - 1; i++) {
      grams.add(cleaned.slice(i, i + 2));
    }
    return grams;
  }

  private rowToFact(row: Record<string, unknown>): BiographicalFact {
    return {
      id: row.id as number,
      userId: row.user_id as string,
      period: row.period as string,
      ageApprox: row.age_approx as number | undefined,
      factContent: row.fact_content as string,
      sourceType: row.source_type as 'anchor' | 'generated',
      sourceConversationId: row.source_conversation_id as string | undefined,
      sourceMessageTimestamp: row.source_message_timestamp as number | undefined,
      importance: row.importance as number,
      confidence: row.confidence as number,
      retrievalCount: row.retrieval_count as number,
      lastRetrievedAt: row.last_retrieved_at as number | undefined,
      isActive: (row.is_active as number) === 1,
      conflictWithId: row.conflict_with_id as number | undefined,
      userVisible: (row.user_visible as number) === 1,
      visiblePosition: row.visible_position as string | undefined,
      createdAt: row.created_at as number,
    };
  }
}
