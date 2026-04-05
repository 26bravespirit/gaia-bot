import type { PersonaConfig } from '../config/schemas.js';
import { logger } from '../utils/logger.js';

export interface GuardResult {
  passed: boolean;
  violation?: string;
  correctedResponse?: string;
}

export class IdentityGuardian {
  private config: PersonaConfig;

  constructor(config: PersonaConfig) {
    this.config = config;
  }

  updateConfig(config: PersonaConfig): void {
    this.config = config;
  }

  checkInput(text: string): GuardResult {
    // Check if user is probing identity
    const ib = this.config.identity.identity_boundary;
    if (ib?.forbidden_reveals?.length) {
      for (const reveal of ib.forbidden_reveals) {
        if (text.includes(reveal)) {
          const fallback = ib.fallback_phrases?.[Math.floor(Math.random() * (ib.fallback_phrases?.length || 1))]
            || '这个话题不聊啦';
          return { passed: false, violation: `forbidden_reveal:${reveal}`, correctedResponse: fallback };
        }
      }
    }
    return { passed: true };
  }

  checkOutput(response: string): GuardResult {
    // Check avoided words from language config
    const avoided = this.config.language.vocabulary?.avoided_words || [];
    for (const word of avoided) {
      if (response.includes(word)) {
        logger.warn(`Identity violation: output contains avoided word "${word}"`);
        const cleaned = response.replace(new RegExp(escapeRegex(word), 'g'), '').trim();
        return { passed: false, violation: `avoided_word:${word}`, correctedResponse: cleaned || '[已过滤]' };
      }
    }

    // Check forbidden reveals in output
    const ib = this.config.identity.identity_boundary;
    if (ib?.forbidden_reveals) {
      for (const reveal of ib.forbidden_reveals) {
        if (response.includes(reveal)) {
          const sentences = response.split(/(?<=[。！？!?，,])/);
          const filtered = sentences.filter(s => !s.includes(reveal));
          return {
            passed: false,
            violation: `forbidden_reveal_in_output:${reveal}`,
            correctedResponse: filtered.join('').trim() || '[已过滤]',
          };
        }
      }
    }

    // Check emoji if emoji_frequency is 0
    if (this.config.language.base_style.emoji_frequency <= 0 && /[\u{1F600}-\u{1F9FF}]/u.test(response)) {
      return {
        passed: false,
        violation: 'emoji_detected',
        correctedResponse: response.replace(/[\u{1F600}-\u{1F9FF}]/gu, '').trim(),
      };
    }

    return { passed: true };
  }

  getIdentityChallengeResponse(input: string): string | null {
    const challenges = [
      /你是不是(机器人|AI|人工智能|bot)/,
      /你是真人吗/,
      /你是谁/,
    ];
    for (const pattern of challenges) {
      if (pattern.test(input)) {
        const ib = this.config.identity.identity_boundary;
        if (ib?.fallback_phrases?.length) {
          return ib.fallback_phrases[Math.floor(Math.random() * ib.fallback_phrases.length)];
        }
        return null;
      }
    }
    return null;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
