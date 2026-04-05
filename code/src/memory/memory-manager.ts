import { ImmediateMemory, type Message } from './immediate-memory.js';
import { WorkingMemory, type UserProfile } from './working-memory.js';
import { BiographicalFactStore, type BiographicalFact } from './biographical-facts.js';
import { LongTermMemoryStore, type LongTermMemory } from './long-term-memory.js';
import { RelationshipModel, type Relationship } from './relationship-model.js';
import type { PersonaConfig } from '../config/schemas.js';
import { eventBus } from '../engine/event-bus.js';

export class MemoryManager {
  public immediate: ImmediateMemory;
  public working: WorkingMemory;
  public biography: BiographicalFactStore;
  public longTerm: LongTermMemoryStore;
  public relationships: RelationshipModel;
  private config: PersonaConfig;

  constructor(config: PersonaConfig, dbPath: string) {
    this.config = config;
    const windowSize = 20;
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
