import type { BrokerAdapter, Quote } from '../broker/types.js';
import { bus } from '../bus.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('marketdata');

/**
 * Market-data feed. For Phase 1 this polls latest quotes for the watchlist on
 * each loop tick via the broker adapter and caches them, emitting to the bus
 * for the dashboard. (A streaming WebSocket upgrade can replace polling later
 * without changing consumers, which read getQuote().)
 */
export class MarketDataFeed {
  private quotes = new Map<string, Quote>();

  constructor(private broker: BrokerAdapter) {}

  getQuote(symbol: string): Quote | undefined {
    return this.quotes.get(symbol);
  }

  async refresh(symbols: string[] = config.engine.watchlist): Promise<void> {
    await Promise.all(
      symbols.map(async (symbol) => {
        const q = await this.broker.getLatestQuote(symbol);
        if (q) {
          this.quotes.set(symbol, q);
          bus.emit('quote', q);
        }
      }),
    );
    log.debug(`refreshed ${this.quotes.size} quotes`);
  }
}
