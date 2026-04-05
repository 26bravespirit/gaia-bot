import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

export function loadEnv(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const value = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key.trim()]) {
      process.env[key.trim()] = value;
    }
  }
}

export function resolveApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) return key;

  const service = process.env.OPENAI_API_KEY_KEYCHAIN_SERVICE?.trim();
  if (!service) return '';

  try {
    const loginHome = process.env.LOGIN_HOME || process.env.REAL_HOME || '/Users/' + (process.env.USER || '');
    const result = execSync(
      `HOME="${loginHome}" /usr/bin/security find-generic-password -s "${service}" -w`,
      { encoding: 'utf-8', timeout: 5000 },
    );
    return result.trim();
  } catch {
    return '';
  }
}
