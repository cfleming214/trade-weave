import { createLogger } from '../logger.js';
import { TechnicalStrategy } from './technical.js';
import type { Strategy } from './types.js';

const log = createLogger('strategy');

/**
 * Returns the active strategy for the given engine mode. The `llm` mode is
 * added in Phase 3; until then it falls back to the technical strategy with a
 * warning so the engine still runs.
 */
export function createStrategy(mode: 'technical' | 'llm'): Strategy {
  switch (mode) {
    case 'technical':
      return new TechnicalStrategy();
    case 'llm':
      log.warn('LLM mode not available yet (Phase 3) — falling back to technical strategy');
      return new TechnicalStrategy();
    default:
      return new TechnicalStrategy();
  }
}

export * from './types.js';
