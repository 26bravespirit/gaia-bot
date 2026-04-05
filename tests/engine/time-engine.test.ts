import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'path';
import { TimeEngine } from '../../src/engine/time-engine.js';
import { loadPersona } from '../../src/config/persona-loader.js';

describe('TimeEngine', () => {
  let engine: TimeEngine;

  beforeEach(() => {
    const config = loadPersona(resolve(import.meta.dirname, '../fixtures/test-persona.yaml'));
    engine = new TimeEngine(config);
  });

  it('should return time state', () => {
    const state = engine.getState();
    expect(state).toHaveProperty('isActiveHours');
    expect(state).toHaveProperty('isSleepMode');
    expect(state).toHaveProperty('currentHour');
    expect(state).toHaveProperty('energyLevel');
    expect(state.energyLevel).toBeGreaterThan(0);
    expect(state.energyLevel).toBeLessThanOrEqual(1);
  });

  it('should track interactions', () => {
    const before = engine.getState().sessionMessageCount;
    engine.recordInteraction();
    engine.recordInteraction();
    const after = engine.getState().sessionMessageCount;
    expect(after).toBe(before + 2);
  });

  it('should decrease energy with interactions', () => {
    const initial = engine.getState().energyLevel;
    for (let i = 0; i < 20; i++) engine.recordInteraction();
    const after = engine.getState().energyLevel;
    expect(after).toBeLessThan(initial);
  });

  it('should arbitrate decisions by priority', () => {
    const result = engine.arbitrate([
      { source: 'low', priority: 1, value: 'slow' },
      { source: 'high', priority: 10, value: 'fast' },
      { source: 'mid', priority: 5, value: 'medium' },
    ]);
    expect(result).toBe('fast');
  });
});
