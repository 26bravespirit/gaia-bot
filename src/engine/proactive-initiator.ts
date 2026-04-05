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
  private dailyCounts = new Map<string, { count: number; date: string }>();

  constructor(
    private getConfig: () => PersonaConfig,
    private memory: MemoryManager,
    private timeEngine: TimeEngine,
  ) {}

  check(): ProactiveMessage | null {
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
      // Check daily limit
      const daily = this.dailyCounts.get(user.user_id);
      if (daily && daily.date === today && daily.count >= proactive.max_daily_initiations) {
        continue;
      }

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

      if (!trigger) continue;

      // Don't fire during sleep mode
      if (timeState.isSleepMode) continue;

      // Pick a random template
      const text = templates[Math.floor(Math.random() * templates.length)];

      // Update daily count
      if (daily && daily.date === today) {
        daily.count++;
      } else {
        this.dailyCounts.set(user.user_id, { count: 1, date: today });
      }

      logger.info(`proactive: trigger=${trigger} user=${user.user_id} silence=${silenceHours.toFixed(1)}h`);

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
