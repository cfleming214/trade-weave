import { RSI, SMA } from 'technicalindicators';
import { createLogger } from '../logger.js';
import type { Signal, Strategy, StrategyContext } from './types.js';

const log = createLogger('strategy:technical');

export interface TechnicalParams {
  fastPeriod: number;
  slowPeriod: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
}

const DEFAULTS: TechnicalParams = {
  fastPeriod: 10,
  slowPeriod: 30,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
};

/**
 * Deterministic technical-rules strategy: a fast/slow SMA crossover gated by
 * RSI. Fully explainable and backtestable.
 *
 *  - ENTER long when the fast SMA is above the slow SMA (uptrend) and RSI is
 *    not overbought, and we are flat in the symbol.
 *  - CLOSE the long when the fast SMA falls below the slow SMA (trend break)
 *    or RSI becomes overbought.
 *
 * Stops/take-profits and sizing are NOT decided here — that is the risk
 * manager's job. This keeps strategy logic pure and easy to reason about.
 */
export class TechnicalStrategy implements Strategy {
  readonly name = 'technical';
  private params: TechnicalParams;

  constructor(params: Partial<TechnicalParams> = {}) {
    this.params = { ...DEFAULTS, ...params };
  }

  async evaluate(ctx: StrategyContext): Promise<Signal[]> {
    const signals: Signal[] = [];
    const held = new Set(ctx.positions.filter((p) => p.qty > 0).map((p) => p.symbol));

    for (const symbol of ctx.watchlist) {
      const bars = ctx.bars.get(symbol) ?? [];
      const closes = bars.map((b) => b.close);
      if (closes.length < this.params.slowPeriod + 2) {
        continue; // not enough history yet
      }

      const fast = SMA.calculate({ period: this.params.fastPeriod, values: closes });
      const slow = SMA.calculate({ period: this.params.slowPeriod, values: closes });
      const rsi = RSI.calculate({ period: this.params.rsiPeriod, values: closes });

      const fastNow = fast.at(-1)!;
      const slowNow = slow.at(-1)!;
      const rsiNow = rsi.at(-1) ?? 50;
      const trendUp = fastNow > slowNow;
      const holding = held.has(symbol);

      if (!holding && trendUp && rsiNow < this.params.rsiOverbought) {
        signals.push({
          symbol,
          action: 'buy',
          reason: `SMA${this.params.fastPeriod} ${fastNow.toFixed(2)} > SMA${this.params.slowPeriod} ${slowNow.toFixed(2)}, RSI ${rsiNow.toFixed(1)}`,
        });
      } else if (holding && (!trendUp || rsiNow > this.params.rsiOverbought)) {
        signals.push({
          symbol,
          action: 'close',
          reason: !trendUp
            ? `trend break: SMA${this.params.fastPeriod} ${fastNow.toFixed(2)} < SMA${this.params.slowPeriod} ${slowNow.toFixed(2)}`
            : `RSI overbought ${rsiNow.toFixed(1)}`,
        });
      }
    }

    if (signals.length) log.debug(`produced ${signals.length} signal(s)`);
    return signals;
  }
}
