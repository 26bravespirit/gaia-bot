import { resolve } from 'path';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.DB_PATH = ':memory:';

// Only set mock API key for non-attack tests (attack tests use real LLM calls)
if (!process.env.ATTACK_TEST) {
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  process.env.OPENAI_MODEL = 'test-model';
}

process.env.OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';
process.env.PERSONA_CONFIG = resolve(import.meta.dirname || '.', 'fixtures/test-persona.yaml');
