import { logger } from '../utils/logger.js';

export interface RouteBinding {
  appId: string;
  chatId?: string;
  personaConfig: string;
}

/**
 * Routes incoming messages to the appropriate persona config.
 * Current implementation: transparent passthrough (single persona).
 * Future: multi-app → multi-persona routing.
 */
export class MessageRouter {
  private bindings: RouteBinding[] = [];
  private defaultPersona: string;

  constructor(defaultPersona: string) {
    this.defaultPersona = defaultPersona;
  }

  addBinding(binding: RouteBinding): void {
    this.bindings.push(binding);
    logger.debug(`MessageRouter: added binding app=${binding.appId} chat=${binding.chatId || '*'} → ${binding.personaConfig}`);
  }

  /**
   * Resolve which persona config to use for a given message.
   * Matching priority: appId + chatId > appId only > default.
   */
  resolve(appId: string, chatId: string): string {
    // Exact match: appId + chatId
    for (const b of this.bindings) {
      if (b.appId === appId && b.chatId === chatId) {
        return b.personaConfig;
      }
    }

    // App-only match
    for (const b of this.bindings) {
      if (b.appId === appId && !b.chatId) {
        return b.personaConfig;
      }
    }

    return this.defaultPersona;
  }
}
