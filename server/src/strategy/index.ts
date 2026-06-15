import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { LlmStrategy } from './llm.js';
import { TechnicalStrategy } from './technical.js';
import type { Strategy } from './types.js';

const log = createLogger('strategy');

/**
 * Returns the active strategy for the given engine mode. `llm` requires an
 * Anthropic API key; without one it falls back to the technical strategy so
 * the engine still runs.
 */
export function createStrategy(mode: 'technical' | 'llm'): Strategy {
  switch (mode) {
    case 'technical':
      return new TechnicalStrategy();
    case 'llm':
      if (!config.anthropic.configured) {
        log.warn('LLM mode requested but ANTHROPIC_API_KEY is not set — falling back to technical strategy');
        return new TechnicalStrategy();
      }
      return new LlmStrategy();
    default:
      return new TechnicalStrategy();
  }
}

export * from './types.js';
