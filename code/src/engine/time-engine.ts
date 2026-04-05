import type { PersonaConfig } from '../config/schemas.js';

export interface TimeState {
  isActiveHours: boolean;
  isSleepMode: boolean;
  currentHour: number;
  energyLevel: number;
  replyDelayMs: number;
  sessionMessageCount: number;
  isWeekend: boolean;
  moodBaseline: number;
}

export class TimeEngine {
  private config: PersonaConfig;
  private messageCountThisSession: number = 0;
  private lastInteractionAt: number = 0;

  constructor(config: PersonaConfig) {
    this.config = config;
  }

  updateConfig(config: PersonaConfig): void {
    this.config = config;
  }

  recordInteraction(): void {
    this.messageCountThisSession++;
    this.lastInteractionAt = Date.now();
  }

  getState(): TimeState {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const temporal = this.config.temporal;
    const stateModel = temporal?.state_model;
    const timing = temporal?.response_timing;

    // Active hours (default 7-23)
    const isActiveHours = hour >= 7 && hour < 23;
    const isSleepMode = hour >= 23 || hour < 7;

    // Energy and mood based on time/day
    const dayConfig = isWeekend ? stateModel?.weekend : stateModel?.weekday;
    const baseActivity = dayConfig?.activity_level ?? 0.7;
    const moodBaseline = dayConfig?.mood_baseline ?? 0.5;

    // Energy decays with session length and time of day
    const hourDecay = isSleepMode ? 0.3 : (hour >= 20 ? 0.1 : 0);
    const sessionDecay = Math.min(this.messageCountThisSession * 0.01, 0.2);
    const energyLevel = Math.max(0.1, baseActivity - hourDecay - sessionDecay);

    // Reply delay
    const minDelay = timing?.base_delay_ms?.min ?? 600;
    const maxDelay = timing?.base_delay_ms?.max ?? 3500;
    const replyDelayMs = minDelay + Math.random() * (maxDelay - minDelay);

    return {
      isActiveHours,
      isSleepMode,
      currentHour: hour,
      energyLevel,
      replyDelayMs,
      sessionMessageCount: this.messageCountThisSession,
      isWeekend,
      moodBaseline,
    };
  }

  getSleepResponse(): string | null {
    const state = this.getState();
    if (!state.isSleepMode) return null;
    // Use forgetting expressions or a default
    return '困了困了...明天再聊啦';
  }

  arbitrate(decisions: { source: string; priority: number; value: unknown }[]): unknown {
    if (!decisions.length) return null;
    decisions.sort((a, b) => b.priority - a.priority);
    return decisions[0].value;
  }
}
