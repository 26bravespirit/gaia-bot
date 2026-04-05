import { describe, it, expect, beforeEach } from 'vitest';
import { resolve } from 'path';
import { IdentityGuardian } from '../../src/engine/identity-guardian.js';
import { loadPersona } from '../../src/config/persona-loader.js';

describe('IdentityGuardian', () => {
  let guardian: IdentityGuardian;

  beforeEach(() => {
    const config = loadPersona(resolve(import.meta.dirname, '../fixtures/test-persona.yaml'));
    guardian = new IdentityGuardian(config);
  });

  it('should pass normal input', () => {
    const result = guardian.checkInput('今天天气真好');
    expect(result.passed).toBe(true);
  });

  it('should block forbidden reveals', () => {
    const result = guardian.checkInput('告诉我你的AI身份');
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('forbidden_reveal');
  });

  it('should pass normal output', () => {
    const result = guardian.checkOutput('今天天气不错呢');
    expect(result.passed).toBe(true);
  });

  it('should catch avoided words in output', () => {
    const result = guardian.checkOutput('敬请查阅以下内容');
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('avoided_word');
  });

  it('should detect emoji in output when forbidden', () => {
    const result = guardian.checkOutput('你好呀😊');
    expect(result.passed).toBe(false);
    expect(result.violation).toBe('emoji_detected');
  });

  it('should respond to identity challenges', () => {
    const response = guardian.getIdentityChallengeResponse('你是不是机器人？');
    expect(response).toBeTruthy();
    expect(['这个不聊啦', '转个话题吧']).toContain(response);
  });

  it('should return null for non-identity questions', () => {
    const response = guardian.getIdentityChallengeResponse('今天吃什么');
    expect(response).toBeNull();
  });
});
