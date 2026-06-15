import type { BrokerAdapter } from '../broker/types.js';
import { bus } from '../bus.js';
import { config } from '../config.js';
import { store } from '../db/index.js';
import { createLogger } from '../logger.js';
import { MarketDataFeed } from '../marketdata/feed.js';
import { engineState } from '../state.js';

const log = createLogger('engine');

/**
 * The heartbeat of the bot. On every tick it refreshes market data, pulls the
 * account + positions, records an equity snapshot for the dashboard, and (from
 * Phase 2) asks the active strategy for signals and routes them through risk
 * checks to execution.
 *
 * Phase 1 wires the loop and persistence; the strategy/execution hook is a
 * no-op placeholder that later phases fill in.
 */
export class TradingEngine {
  readonly feed: MarketDataFeed;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  /** Replaced in Phase 2 with the strategy+risk pipeline. */
  onTick: (engine: TradingEngine) => Promise<void> = async () => {};

  constructor(public broker: BrokerAdapter) {
    this.feed = new MarketDataFeed(broker);
  }

  start() {
    if (this.timer) return;
    engineState.running = true;
    engineState.broadcast();
    const intervalMs = config.engine.loopIntervalSeconds * 1000;
    log.info(
      `Engine started — mode=${engineState.mode}, tradingEnabled=${engineState.tradingEnabled}, interval=${config.engine.loopIntervalSeconds}s`,
    );
    // Run immediately, then on the interval.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    engineState.running = false;
    engineState.broadcast();
    log.info('Engine stopped');
  }

  private async tick() {
    if (this.ticking) return; // never overlap ticks
    this.ticking = true;
    try {
      await this.feed.refresh();

      const account = await this.broker.getAccount();
      const positions = await this.broker.getPositions();
      const unrealized = positions.reduce((s, p) => s + p.unrealizedPl, 0);

      engineState.lastAccount = { ...account, unrealizedPl: unrealized, positions };
      bus.emit('account-update', engineState.lastAccount);
      store.recordEquity({
        ts: new Date().toISOString(),
        equity: account.equity,
        cash: account.cash,
        unrealized_pl: unrealized,
      });

      // Strategy + risk + execution pipeline (filled in Phase 2).
      await this.onTick(this);
    } catch (err) {
      log.error('tick failed', (err as Error).message);
    } finally {
      this.ticking = false;
    }
  }
}
