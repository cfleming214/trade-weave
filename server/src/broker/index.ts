import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { AlpacaAdapter } from './alpaca.js';
import { MockAdapter } from './mock.js';
import type { BrokerAdapter } from './types.js';

const log = createLogger('broker');

/**
 * Returns the broker the bot should use. With Alpaca keys present we use the
 * real (paper or live) Alpaca API; otherwise we fall back to an in-memory mock
 * so the stack still runs for local development and dashboard testing.
 */
export function createBroker(): BrokerAdapter {
  if (config.alpaca.configured) {
    log.info(`Using Alpaca (${config.alpaca.paper ? 'PAPER' : 'LIVE'} trading)`);
    return new AlpacaAdapter();
  }
  log.warn('No Alpaca keys found — using in-memory MOCK broker. Set ALPACA_KEY_ID/SECRET in .env to connect.');
  return new MockAdapter();
}

export * from './types.js';
