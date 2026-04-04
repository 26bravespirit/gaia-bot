import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

export type EventType =
  | 'message_received'
  | 'message_processed'
  | 'memory_updated'
  | 'state_changed'
  | 'response_sent'
  | 'persona_reloaded'
  | 'error';

export interface BotEvent {
  type: EventType;
  timestamp: number;
  payload: Record<string, unknown>;
}

class AppEventBus extends EventEmitter {
  publish(type: EventType, payload: Record<string, unknown> = {}): void {
    const event: BotEvent = { type, timestamp: Date.now(), payload };
    logger.debug(`event: ${type}`, payload);
    this.emit(type, event);
  }

  subscribe(type: EventType, handler: (event: BotEvent) => void): void {
    this.on(type, handler);
  }

  unsubscribe(type: EventType, handler: (event: BotEvent) => void): void {
    this.off(type, handler);
  }
}

export const eventBus = new AppEventBus();
