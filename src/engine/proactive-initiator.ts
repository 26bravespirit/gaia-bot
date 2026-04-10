import type { PersonaConfig } from '../config/schemas.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { TimeEngine } from './time-engine.js';
import { logger } from '../utils/logger.js';

export interface ProactiveMessage {
  userId: string;
  chatId: string;
  text: string;
  trigger: string;
}

const PROACTIVE_TEMPLATES: Record<string, string[]> = {
  'time_of_day=evening': [
    '今天怎么样呀',
    '晚上在干嘛呢',
    '今天有什么好玩的事吗',
  ],
  'weekend_morning': [
    '周末早上好呀，有什么计划吗',
    '周末啦，打算做什么',
  ],
  'silence': [
    '好久没聊了诶',
    '最近在忙什么呀',
    '好几天没说话了，还好吗',
  ],
};

export class ProactiveInitiator {
  constructor(
    private getConfig: () => PersonaConfig,
    private memory: MemoryManager,
    private timeEngine: TimeEngine,
  ) {}

  /** Count today's proactive messages in a chat (from DB, survives restarts). */
  private getDailyCount(chatId: string): number {
    const db = this.memory.working.getDb();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const row = db.prepare(
      "SELECT COUNT(*) as c FROM conversation_log WHERE message_id LIKE 'proactive_%' AND chat_id = ? AND timestamp >= ?",
    ).get(chatId, todayStart) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  /** Check if the chat had any activity (any role) within the cooldown window. */
  private isRecentlyActive(chatId: string, cooldownMinutes: number = 60): boolean {
    const db = this.memory.working.getDb();
    const since = Date.now() - cooldownMinutes * 60 * 1000;
    const row = db.prepare(
      'SELECT 1 FROM conversation_log WHERE chat_id = ? AND timestamp >= ? LIMIT 1',
    ).get(chatId, since);
    return !!row;
  }

  /** Check if the last proactive message in a chat got no user response. */
  private hasUnansweredProactive(chatId: string): boolean {
    const db = this.memory.working.getDb();
    const lastProactive = db.prepare(
      "SELECT timestamp FROM conversation_log WHERE message_id LIKE 'proactive_%' AND chat_id = ? ORDER BY timestamp DESC LIMIT 1",
    ).get(chatId) as { timestamp: number } | undefined;
    if (!lastProactive) return false;

    const userReply = db.prepare(
      "SELECT 1 FROM conversation_log WHERE chat_id = ? AND role = 'user' AND timestamp > ? LIMIT 1",
    ).get(chatId, lastProactive.timestamp);
    return !userReply;
  }

  check(): ProactiveMessage | null {
    // Runtime kill switch — settable via Control Center or DB
    const enabled = this.memory.working.getRuntimeConfig('proactive_enabled');
    if (enabled === 'false') return null;

    const config = this.getConfig();
    const proactive = config.temporal?.proactive_behavior;
    if (!proactive) return null;

    const timeState = this.timeEngine.getState();
    const today = new Date().toISOString().slice(0, 10);

    // Get all known users from working memory
    const db = this.memory.working.getDb();
    const users = db.prepare(
      'SELECT DISTINCT user_id, chat_id FROM conversation_log ORDER BY timestamp DESC LIMIT 20'
    ).all() as Array<{ user_id: string; chat_id: string }>;

    // Deduplicate by user_id
    const seenUsers = new Set<string>();
    const uniqueUsers: Array<{ user_id: string; chat_id: string }> = [];
    for (const u of users) {
      if (!seenUsers.has(u.user_id)) {
        seenUsers.add(u.user_id);
        uniqueUsers.push(u);
      }
    }

    for (const user of uniqueUsers) {
      const chatId = user.chat_id;

      // Guard 1: per-chat daily limit (from DB, survives restart)
      if (this.getDailyCount(chatId) >= proactive.max_daily_initiations) continue;

      // Guard 2: last proactive in this chat got no reply — don't pile on
      if (this.hasUnansweredProactive(chatId)) continue;

      // Guard 3: conversation was active recently — give breathing room
      if (this.isRecentlyActive(chatId, 60)) continue;

      // Check silence threshold
      const lastMsg = db.prepare(
        'SELECT timestamp FROM conversation_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1'
      ).get(user.user_id) as { timestamp: number } | undefined;

      if (!lastMsg) continue;

      const silenceHours = (Date.now() - lastMsg.timestamp) / (1000 * 60 * 60);

      // Evaluate triggers
      let trigger: string | null = null;
      let templates: string[] = PROACTIVE_TEMPLATES.silence;

      if (silenceHours >= proactive.silence_threshold_hours) {
        trigger = 'silence';
        templates = PROACTIVE_TEMPLATES.silence;
      } else {
        // Check time-based triggers
        for (const t of proactive.triggers) {
          if (t === 'time_of_day=evening' && timeState.currentHour >= 19 && timeState.currentHour <= 21) {
            trigger = t;
            templates = PROACTIVE_TEMPLATES[t] || PROACTIVE_TEMPLATES.silence;
            break;
          }
          if (t === 'weekend_morning' && timeState.isWeekend && timeState.currentHour >= 9 && timeState.currentHour <= 11) {
            trigger = t;
            templates = PROACTIVE_TEMPLATES[t] || PROACTIVE_TEMPLATES.silence;
            break;
          }
        }
      }

      // Check for unfulfilled promises as a trigger
      if (!trigger) {
        const activePromises = this.memory.longTerm.getActivePromises(user.user_id, 3);
        if (activePromises.length > 0 && silenceHours >= 2) {
          trigger = 'promise_followup';
          const promise = activePromises[0];
          templates = [
            `对了，上次说的"${promise.content}"，你还需要我帮忙吗`,
            `想起来上次聊到"${promise.content}"，后来怎么样了`,
          ];
        }
      }

      if (!trigger) continue;

      // Don't fire during sleep mode
      if (timeState.isSleepMode) continue;

      // Pick a random template
      const text = templates[Math.floor(Math.random() * templates.length)];

      logger.info(`proactive: trigger=${trigger} user=${user.user_id} chat=${chatId} silence=${silenceHours.toFixed(1)}h dailyCount=${this.getDailyCount(chatId)}`);

      return {
        userId: user.user_id,
        chatId: user.chat_id,
        text,
        trigger,
      };
    }

    return null;
  }
}
