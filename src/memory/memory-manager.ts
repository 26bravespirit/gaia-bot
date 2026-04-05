import { ImmediateMemory, type Message } from './immediate-memory.js';
import { WorkingMemory, type UserProfile } from './working-memory.js';
import { BiographicalFactStore, type BiographicalFact } from './biographical-facts.js';
import { LongTermMemoryStore, type LongTermMemory } from './long-term-memory.js';
import { RelationshipModel, type Relationship } from './relationship-model.js';
import type { PersonaConfig } from '../config/schemas.js';
import { eventBus } from '../engine/event-bus.js';

export interface SelfState {
  moodBaseline: number;
  activeEmotions: string[];
  recentExperiences: string[];
  energyLevel: string;
  socialBattery: number;
  updatedAt: number;
}

export class MemoryManager {
  public immediate: ImmediateMemory;
  public working: WorkingMemory;
  public biography: BiographicalFactStore;
  public longTerm: LongTermMemoryStore;
  public relationships: RelationshipModel;
  private config: PersonaConfig;

  constructor(config: PersonaConfig, dbPath: string) {
    this.config = config;
    const windowSize = config.memory?.forgetting?.low_importance_decay_days ? 20 : 20;
    this.immediate = new ImmediateMemory(windowSize);
    this.working = new WorkingMemory(dbPath);

    // Initialize v0.2.0 memory modules sharing the same DB
    const db = this.working.getDb();
    this.biography = new BiographicalFactStore(db);
    this.longTerm = new LongTermMemoryStore(db);
    this.relationships = new RelationshipModel(db);

    // Initialize biography anchors from config
    if (config.biography?.anchors?.length) {
      this.biography.initializeAnchors(config.biography.anchors);
    }
  }

  // ── Self State ──

  getSelfState(): SelfState {
    const db = this.working.getDb();
    const row = db.prepare('SELECT * FROM self_state WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) {
      return { moodBaseline: 0.6, activeEmotions: [], recentExperiences: [], energyLevel: 'normal', socialBattery: 1.0, updatedAt: Date.now() };
    }
    return {
      moodBaseline: row.mood_baseline as number,
      activeEmotions: JSON.parse((row.active_emotions as string) || '[]'),
      recentExperiences: JSON.parse((row.recent_experiences as string) || '[]'),
      energyLevel: row.energy_level as string,
      socialBattery: row.social_battery as number,
      updatedAt: row.updated_at as number,
    };
  }

  updateSelfState(updates: Partial<Omit<SelfState, 'updatedAt'>>): void {
    const db = this.working.getDb();
    const current = this.getSelfState();
    const merged = { ...current, ...updates, updatedAt: Date.now() };
    db.prepare(`
      UPDATE self_state SET
        mood_baseline = ?, active_emotions = ?, recent_experiences = ?,
        energy_level = ?, social_battery = ?, updated_at = ?
      WHERE id = 1
    `).run(
      merged.moodBaseline,
      JSON.stringify(merged.activeEmotions),
      JSON.stringify(merged.recentExperiences.slice(-10)),
      merged.energyLevel,
      merged.socialBattery,
      merged.updatedAt,
    );
  }

  // ── Event Log ──

  logEvent(eventType: string, sourceStage: string, payload: Record<string, unknown> = {}): void {
    const db = this.working.getDb();
    db.prepare(`
      INSERT INTO event_log (event_type, source_stage, payload, timestamp) VALUES (?, ?, ?, ?)
    `).run(eventType, sourceStage, JSON.stringify(payload), Date.now());
  }

  getRuntimeConfig(key: string): string | null {
    return this.working.getRuntimeConfig(key);
  }

  setRuntimeConfig(key: string, value: string): void {
    this.working.setRuntimeConfig(key, value);
  }

  getLengthDistribution(): { ultra_short: number; short: number; normal: number; long: number } {
    const raw = this.working.getRuntimeConfig('length_distribution');
    if (raw) {
      try { return JSON.parse(raw); } catch { /* fall through */ }
    }
    return { ultra_short: 0.15, short: 0.35, normal: 0.30, long: 0.20 };
  }

  getLengthTemplates(): Record<string, string> {
    const raw = this.working.getRuntimeConfig('length_templates');
    if (raw) {
      try { return JSON.parse(raw); } catch { /* fall through */ }
    }
    return {
      ultra_short: '【这次回复超短，就1-4个字，像"哈哈""好的""真的假的"这种】',
      short: '【这次回复短一点，1-2句话，不超过30字】',
      normal: '【这次正常回复，2-3句话，30-60字左右】',
      long: '【这次可以稍微多说几句，但不超过80字】',
    };
  }

  eventCount(): number {
    const db = this.working.getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM event_log').get() as { cnt: number };
    return row.cnt;
  }

  addMessage(msg: Message): void {
    this.immediate.add(msg);
    this.working.logMessage(
      msg.senderId, msg.chatId, msg.role, msg.content,
      msg.senderName, msg.timestamp, msg.id,
    );

    if (msg.role === 'user') {
      const alias = this.config.aliases?.[msg.senderName] ?? null;
      this.working.upsertUser(msg.senderId, msg.senderName, alias);

      // Update relationship interaction
      this.relationships.recordInteraction(msg.senderId, 'message');
    }

    eventBus.publish('memory_updated', { messageId: msg.id, role: msg.role });
  }

  getContext(userId: string, windowSize?: number): Message[] {
    return this.immediate.getWindow(windowSize);
  }

  getRecentHistory(userId: string, limit: number = 20): Array<{ role: string; content: string; senderName: string }> {
    return this.working.getRecentConversation(userId, limit);
  }

  getUserProfile(userId: string): UserProfile | null {
    return this.working.getUser(userId);
  }

  getRelationship(userId: string): Relationship {
    return this.relationships.getRelationship(userId);
  }

  getBiographyContext(keywords?: string[]): BiographicalFact[] {
    if (keywords?.length) {
      return this.biography.searchByKeywords(keywords);
    }
    return this.biography.getUserVisibleFacts();
  }

  searchMemories(userId: string, keywords: string[]): LongTermMemory[] {
    return this.longTerm.searchByKeywords(userId, keywords);
  }

  resolveAlias(name: string): string {
    return this.config.aliases?.[name] ?? name;
  }

  isSeen(messageId: string): boolean {
    return this.working.isSeen(messageId);
  }

  markSeen(messageId: string): void {
    this.working.markSeen(messageId);
  }

  close(): void {
    this.working.close();
  }
}
