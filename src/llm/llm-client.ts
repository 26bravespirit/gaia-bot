import { logger } from '../utils/logger.js';
import { resolveApiKey } from '../utils/env.js';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Raw input item for Responses API (function_call echo + function_call_output) */
export interface LLMRawInputItem {
  type: string;
  [key: string]: unknown;
}

export interface ToolCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDef {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  model: string;
  modelIndex: number;
  toolCalls: ToolCall[];
  /** Raw output items from the API (for echoing back in tool loops) */
  rawOutput: LLMRawInputItem[];
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

interface ParsedOutput {
  text: string;
  toolCalls: ToolCall[];
  rawOutput: LLMRawInputItem[];
}

function extractOutput(parsed: Record<string, unknown>): ParsedOutput {
  let text = '';
  const toolCalls: ToolCall[] = [];
  const rawOutput: LLMRawInputItem[] = [];

  // Try output_text shortcut first
  const outputText = parsed.output_text;
  if (typeof outputText === 'string' && outputText.trim()) {
    text = outputText.trim();
  }

  // Walk output array for both text and function_call blocks
  const output = parsed.output;
  if (Array.isArray(output)) {
    // Capture all raw output items for echoing back
    for (const item of output) {
      if (typeof item === 'object' && item) {
        rawOutput.push(item as LLMRawInputItem);
      }
    }
    for (const item of output) {
      if (typeof item !== 'object' || !item) continue;
      const rec = item as Record<string, unknown>;

      // Function call output block
      if (rec.type === 'function_call') {
        const name = rec.name as string;
        const callId = (rec.call_id ?? rec.id ?? '') as string;
        let args: Record<string, unknown> = {};
        try {
          args = typeof rec.arguments === 'string' ? JSON.parse(rec.arguments) : (rec.arguments as Record<string, unknown>) ?? {};
        } catch { /* leave empty */ }
        toolCalls.push({ callId, name, arguments: args });
        continue;
      }

      // Text content block
      if (!text) {
        const contents = rec.content;
        if (Array.isArray(contents)) {
          for (const c of contents) {
            if (typeof c === 'object' && c && typeof (c as Record<string, unknown>).text === 'string') {
              text = ((c as Record<string, unknown>).text as string).trim();
              break;
            }
          }
        }
      }
    }
  }

  if (!text && toolCalls.length === 0) {
    throw new Error('No output text or tool calls in LLM response');
  }

  return { text, toolCalls, rawOutput };
}

export async function callLLM(messages: LLMMessage[], tools?: ToolDef[], rawItems?: LLMRawInputItem[], timeoutMs = 60000, modelOverride?: string): Promise<LLMResponse> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');

  const models = modelOverride ? [modelOverride] : parseModelCandidates();
  const apiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';

  let lastError = '';

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const inputItems: unknown[] = messages.map(m => ({
      role: m.role === 'system' ? 'system' : m.role,
      content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
    }));
    // Append raw items (function_call echoes + function_call_output) for tool loop
    if (rawItems?.length) {
      inputItems.push(...rawItems);
    }
    const body: Record<string, unknown> = { model, input: inputItems };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
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
      // Log token usage
      const usage = parsed.usage as Record<string, number> | undefined;
      if (usage) {
        logger.info(`LLM usage: model=${model} input=${usage.input_tokens ?? 0} output=${usage.output_tokens ?? 0} total=${usage.total_tokens ?? 0}`);
      }
      const output = extractOutput(parsed);
      return { text: output.text, model, modelIndex: i, toolCalls: output.toolCalls, rawOutput: output.rawOutput };
    } catch (err) {
      if (err instanceof Error && err.message === lastError) throw err;

      // Distinguish timeout from other network errors
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
      lastError = isTimeout
        ? `LLM timeout after ${timeoutMs / 1000}s (model=${model})`
        : `LLM error (model=${model}): ${err}`;

      if (i < models.length - 1) {
        logger.warn(`Model ${model} failed, trying next`, { error: lastError });
        continue;
      }
      throw new Error(
        models.length > 1
          ? `All ${models.length} LLM models failed. Last: ${lastError}`
          : lastError
      );
    }
  }

  throw new Error(lastError || 'LLM call failed');
}
