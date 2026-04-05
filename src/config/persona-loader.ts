import { readFileSync, watchFile } from 'fs';
import { load as yamlLoad } from 'js-yaml';
import { PersonaConfigSchema, type PersonaConfig } from './schemas.js';
import { logger } from '../utils/logger.js';

let currentConfig: PersonaConfig | null = null;
let configPath: string = '';

export function loadPersona(path: string): PersonaConfig {
  configPath = path;
  const raw = readFileSync(path, 'utf-8');
  const parsed = yamlLoad(raw);
  const result = PersonaConfigSchema.parse(parsed);
  currentConfig = result;
  logger.info(`Persona loaded: ${result.meta.name}`);
  return result;
}

export function getPersona(): PersonaConfig {
  if (!currentConfig) throw new Error('Persona not loaded. Call loadPersona() first.');
  return currentConfig;
}

export function watchPersona(path: string, onChange: (config: PersonaConfig) => void): void {
  watchFile(path, { interval: 2000 }, () => {
    try {
      const updated = loadPersona(path);
      onChange(updated);
      logger.info('Persona config reloaded');
    } catch (err) {
      logger.error('Failed to reload persona config', err);
    }
  });
}
