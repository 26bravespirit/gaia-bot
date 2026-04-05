import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { loadPersona } from '../../src/config/persona-loader.js';
import { buildPromptFragments } from '../../src/config/parameter-interpreter.js';
import { IdentityGuardian } from '../../src/engine/identity-guardian.js';

describe('Persona Consistency (SAT)', () => {
  const config = loadPersona(resolve(import.meta.dirname, '../fixtures/test-persona.yaml'));

  it('should load persona config with valid schema', () => {
    expect(config.meta.name).toBe('TestBot');
    expect(config.identity.background.age).toBe(20);
    expect(config.identity.personality_traits.extraversion).toBe(0.8);
    expect(config.knowledge.expertise_domains).toContain('测试领域');
  });

  it('should build valid prompt fragments', () => {
    const fragments = buildPromptFragments(config);
    expect(fragments.systemPrompt).toContain('TestBot');
    expect(fragments.systemPrompt).toContain('20岁');
    expect(fragments.identityBlock).toBeTruthy();
    expect(fragments.knowledgeBlock).toContain('测试领域');
    expect(fragments.styleBlock).toBeTruthy();
  });

  it('should include avoided words in guardian', () => {
    const guardian = new IdentityGuardian(config);
    const result = guardian.checkOutput('敬请查阅此文档');
    expect(result.passed).toBe(false);
  });

  it('should include identity boundary in prompt', () => {
    const fragments = buildPromptFragments(config);
    expect(fragments.boundaryBlock).toContain('AI身份');
    expect(fragments.boundaryBlock).toContain('转移话题');
  });

  it('should guard against identity violations end-to-end', () => {
    const guardian = new IdentityGuardian(config);
    const violations = [
      '敬请查阅以下内容',
      '你好😊今天不错',
    ];
    for (const output of violations) {
      const result = guardian.checkOutput(output);
      expect(result.passed).toBe(false);
      expect(result.correctedResponse).toBeTruthy();
    }
  });

  it('should pass valid persona-consistent outputs', () => {
    const guardian = new IdentityGuardian(config);
    const valid = ['蛮好的', '超开心', '嗯就这样吧'];
    for (const output of valid) {
      expect(guardian.checkOutput(output).passed).toBe(true);
    }
  });

  it('should resolve aliases correctly', () => {
    expect(config.aliases?.['Ben Cui']).toBe('老板');
    expect(config.aliases?.['Test User']).toBe('测试员');
  });
});
