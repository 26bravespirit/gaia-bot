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

// Configurable via persona.yaml temporal.active_hours
const DEFAULT_ACTIVE_START = 7;
const DEFAULT_ACTIVE_END = 23;

const SLEEP_RESPONSES_DEFAULT = [
  '困了困了...明天再聊啦',
  '太晚了...眼睛快睁不开了',
  '我先睡了哦，晚安~',
];

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

  private getActiveHours(): { start: number; end: number } {
    const ah = this.config.temporal?.active_hours;
    return {
      start: ah?.start ?? DEFAULT_ACTIVE_START,
      end: ah?.end ?? DEFAULT_ACTIVE_END,
    };
  }

  getState(): TimeState {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const temporal = this.config.temporal;
    const stateModel = temporal?.state_model;
    const timing = temporal?.response_timing;

    // Active hours from config
    const { start, end } = this.getActiveHours();
    const isActiveHours = hour >= start && hour < end;
    const isSleepMode = !isActiveHours;

    // Energy and mood based on time/day
    const dayConfig = isWeekend ? stateModel?.weekend : stateModel?.weekday;
    const baseActivity = dayConfig?.activity_level ?? 0.7;
    let moodBaseline = dayConfig?.mood_baseline ?? 0.5;

    // Dynamic mood modulation by hour
    if (hour >= 6 && hour < 11) moodBaseline += 0.15;        // morning freshness
    else if (hour >= 14 && hour < 16) moodBaseline -= 0.05;  // afternoon slump
    else if (hour >= 22 || hour < 6) moodBaseline -= 0.2;    // night fatigue
    moodBaseline = Math.max(-1, Math.min(1, moodBaseline));

    // Energy cycle with hour-based curve
    let hourDecay = isSleepMode ? 0.3 : 0;
    if (!isSleepMode) {
      if (hour >= 6 && hour < 10) hourDecay = -0.15;       // morning boost
      else if (hour >= 14 && hour < 16) hourDecay = 0.2;    // afternoon dip
      else if (hour >= 16 && hour < 20) hourDecay = 0.05;   // slight decline
      else if (hour >= 20) hourDecay = 0.2;                 // night crash
    }
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
    // Use forgetting expressions from config, or defaults
    const expressions = this.config.memory?.forgetting?.forgetting_expression;
    const pool = expressions?.length ? SLEEP_RESPONSES_DEFAULT.concat(expressions) : SLEEP_RESPONSES_DEFAULT;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  getHistoryWindowSize(): number {
    return this.config.temporal?.history_window ?? 25;
  }

  arbitrate(decisions: { source: string; priority: number; value: unknown }[]): unknown {
    if (!decisions.length) return null;
    decisions.sort((a, b) => b.priority - a.priority);
    return decisions[0].value;
  }
}
