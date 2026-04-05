import type Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export type RelationshipStage = 'stranger' | 'acquaintance' | 'familiar' | 'intimate';

export interface Relationship {
  userId: string;
  stage: RelationshipStage;
  intimacyScore: number;
  interactionCount: number;
  firstInteractionAt?: number;
  lastInteractionAt?: number;
  topicsShared: string[];
  promises: Array<{ content: string; madeAt: number; fulfilled: boolean }>;
  notes: string[];
  updatedAt: number;
}

// Stage transition thresholds
const STAGE_THRESHOLDS: Record<RelationshipStage, number> = {
  stranger: 0,
  acquaintance: 0.2,
  familiar: 0.5,
  intimate: 0.8,
};

// Intimacy score increments per interaction type
const INTIMACY_INCREMENTS = {
  message: 0.005,
  emotional_event: 0.03,
  shared_experience: 0.02,
  promise_made: 0.02,
  promise_fulfilled: 0.05,
};

export class RelationshipModel {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Get or create a relationship for a user.
   */
  getRelationship(userId: string): Relationship {
    const row = this.db.prepare(
      'SELECT * FROM relationships WHERE user_id = ?'
    ).get(userId) as Record<string, unknown> | undefined;

    if (row) return this.rowToRelationship(row);

    // Create new relationship
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO relationships (user_id, stage, intimacy_score, interaction_count, first_interaction_at, last_interaction_at, updated_at)
      VALUES (?, 'stranger', 0.0, 0, ?, ?, ?)
    `).run(userId, now, now, now);

    return {
      userId,
      stage: 'stranger',
      intimacyScore: 0,
      interactionCount: 0,
      firstInteractionAt: now,
      lastInteractionAt: now,
      topicsShared: [],
      promises: [],
      notes: [],
      updatedAt: now,
    };
  }

  /**
   * Record an interaction and update intimacy/stage.
   */
  recordInteraction(userId: string, type: keyof typeof INTIMACY_INCREMENTS = 'message'): Relationship {
    const rel = this.getRelationship(userId);
    const increment = INTIMACY_INCREMENTS[type] || INTIMACY_INCREMENTS.message;
    const newIntimacy = Math.min(1.0, rel.intimacyScore + increment);
    const newStage = this.calculateStage(newIntimacy);
    const now = Date.now();

    if (newStage !== rel.stage) {
      logger.info(`Relationship stage change: ${userId} ${rel.stage} → ${newStage}`);
    }

    this.db.prepare(`
      UPDATE relationships SET
        intimacy_score = ?, stage = ?, interaction_count = interaction_count + 1,
        last_interaction_at = ?, updated_at = ?
      WHERE user_id = ?
    `).run(newIntimacy, newStage, now, now, userId);

    return { ...rel, intimacyScore: newIntimacy, stage: newStage, interactionCount: rel.interactionCount + 1, lastInteractionAt: now, updatedAt: now };
  }

  /**
   * Add a shared topic.
   */
  addTopic(userId: string, topic: string): void {
    const rel = this.getRelationship(userId);
    if (!rel.topicsShared.includes(topic)) {
      const updated = [...rel.topicsShared, topic];
      this.db.prepare(
        'UPDATE relationships SET topics_shared = ?, updated_at = ? WHERE user_id = ?'
      ).run(JSON.stringify(updated), Date.now(), userId);
    }
  }

  /**
   * Add a promise.
   */
  addPromise(userId: string, content: string): void {
    const rel = this.getRelationship(userId);
    const updated = [...rel.promises, { content, madeAt: Date.now(), fulfilled: false }];
    this.db.prepare(
      'UPDATE relationships SET promises = ?, updated_at = ? WHERE user_id = ?'
    ).run(JSON.stringify(updated), Date.now(), userId);
    this.recordInteraction(userId, 'promise_made');
  }

  /**
   * Fulfill a promise.
   */
  fulfillPromise(userId: string, content: string): void {
    const rel = this.getRelationship(userId);
    const updated = rel.promises.map(p =>
      p.content === content && !p.fulfilled ? { ...p, fulfilled: true } : p
    );
    this.db.prepare(
      'UPDATE relationships SET promises = ?, updated_at = ? WHERE user_id = ?'
    ).run(JSON.stringify(updated), Date.now(), userId);
    this.recordInteraction(userId, 'promise_fulfilled');
  }

  private calculateStage(intimacy: number): RelationshipStage {
    if (intimacy >= STAGE_THRESHOLDS.intimate) return 'intimate';
    if (intimacy >= STAGE_THRESHOLDS.familiar) return 'familiar';
    if (intimacy >= STAGE_THRESHOLDS.acquaintance) return 'acquaintance';
    return 'stranger';
  }

  private rowToRelationship(row: Record<string, unknown>): Relationship {
    return {
      userId: row.user_id as string,
      stage: row.stage as RelationshipStage,
      intimacyScore: row.intimacy_score as number,
      interactionCount: row.interaction_count as number,
      firstInteractionAt: row.first_interaction_at as number | undefined,
      lastInteractionAt: row.last_interaction_at as number | undefined,
      topicsShared: JSON.parse((row.topics_shared as string) || '[]'),
      promises: JSON.parse((row.promises as string) || '[]'),
      notes: JSON.parse((row.notes as string) || '[]'),
      updatedAt: row.updated_at as number,
    };
  }
}
