import { logger } from '../utils/logger.js';
import { resolveApiKey } from '../utils/env.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  text: string;
  model: string;
  modelIndex: number;
}

function parseModelCandidates(): string[] {
  const explicit = process.env.OPENAI_MODEL_CANDIDATES?.trim();
  if (explicit) {
    return [...new Set(explicit.split(',').map(s => s.trim()).filter(Boolean))];
  }
  const primary = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
  const fallback = process.env.OPENAI_FALLBACK_MODEL?.trim() || 'gpt-4.1-mini';
  const result = [primary];
  if (fallback !== primary) result.push(fallback);
  return result;
}

function shouldTryFallback(detail: string): boolean {
  const lower = detail.toLowerCase();
  return ['model_not_found', 'does not have access', 'not found', 'organization must be verified']
    .some(m => lower.includes(m));
}

function extractOutputText(parsed: Record<string, unknown>): string {
  const outputText = parsed.output_text;
  if (typeof outputText === 'string' && outputText.trim()) return outputText.trim();

  const output = parsed.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item !== 'object' || !item) continue;
      const contents = (item as Record<string, unknown>).content;
      if (!Array.isArray(contents)) continue;
      for (const c of contents) {
        if (typeof c === 'object' && c && typeof (c as Record<string, unknown>).text === 'string') {
          return ((c as Record<string, unknown>).text as string).trim();
        }
      }
    }
  }
  throw new Error('No output text in LLM response');
}

export async function callLLM(messages: LLMMessage[]): Promise<LLMResponse> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');

  const models = parseModelCandidates();
  const apiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';

  let lastError = '';

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const body = {
      model,
      input: messages.map(m => ({
        role: m.role === 'system' ? 'system' : m.role,
        content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
      })),
    };

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const detail = await response.text();
        lastError = `OpenAI ${response.status}: ${detail}`;
        if (i < models.length - 1 && shouldTryFallback(detail)) {
          logger.warn(`Model ${model} failed, trying next`, { error: lastError });
          continue;
        }
        throw new Error(lastError);
      }

      const parsed = await response.json() as Record<string, unknown>;
      const text = extractOutputText(parsed);
      return { text, model, modelIndex: i };
    } catch (err) {
      if (err instanceof Error && err.message === lastError) throw err;
      lastError = `LLM error: ${err}`;
      if (i < models.length - 1) {
        logger.warn(`Model ${model} failed, trying next`, { error: lastError });
        continue;
      }
      throw new Error(lastError);
    }
  }

  throw new Error(lastError || 'LLM call failed');
}
