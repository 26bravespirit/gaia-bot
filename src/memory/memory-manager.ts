import { ImmediateMemory, type Message } from './immediate-memory.js';
import { WorkingMemory, type UserProfile } from './working-memory.js';
import type { PersonaConfig } from '../config/schemas.js';
import { eventBus } from '../engine/event-bus.js';

export class MemoryManager {
  public immediate: ImmediateMemory;
  public working: WorkingMemory;
  private config: PersonaConfig;

  constructor(config: PersonaConfig, dbPath: string) {
    this.config = config;
    const windowSize = 20; // default immediate window size
    this.immediate = new ImmediateMemory(windowSize);
    this.working = new WorkingMemory(dbPath);
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
