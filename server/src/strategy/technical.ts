import { RSI, SMA } from 'technicalindicators';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { Signal, Strategy, StrategyContext } from './types.js';

const log = createLogger('strategy:technical');

export interface TechnicalParams {
  fastPeriod: number;
  slowPeriod: number;
  trendPeriod: number;
  rsiPeriod: number;
  rsiOverbought: number;
  /** Minimum bars to hold a position before a crossover exit is allowed. */
  minHoldBars: number;
  /** Bars to wait after an exit before re-entering the same symbol. */
  reentryBars: number;
  /** Fraction the fast MA must clear the slow MA by for a cross to count. */
  band: number;
  /** Require the slow MA to be rising before taking a long. */
  trendFilter: boolean;
}

interface SymbolState {
  /** Timestamp of the last bar we evaluated, so we act at most once per bar. */
  lastBarTs: string | null;
  /** Monotonic count of distinct bars seen (our notion of "bars"). */
  bar: number;
  /** Bar index at which the current position was entered. */
  entryBar: number;
  /** Bar index of the most recent exit (for re-entry cooldown). */
  exitBar: number;
  /** Whether we considered the symbol held on the previous evaluation. */
  wasHolding: boolean;
}

/**
 * Trend-following SMA crossover with the usual anti-whipsaw guards. The
 * previous version acted on the raw condition (fast > slow) every loop tick,
 * which re-bought constantly and churned. This version instead:
 *
 *  - acts at most ONCE PER BAR (ignores intra-bar loop ticks);
 *  - enters only on a fresh bullish CROSSOVER (fast crosses above slow this
 *    bar) — not merely while fast > slow — gated by a hysteresis band;
 *  - only goes long when the slow MA is rising (trend filter) and RSI isn't
 *    overbought;
 *  - holds for a minimum number of bars before a crossover exit;
 *  - waits a cooldown after an exit before re-entering the same symbol.
 *
 * Stops/take-profits are still enforced by the risk manager and always win.
 */
export class TechnicalStrategy implements Strategy {
  readonly name = 'technical';
  private params: TechnicalParams;
  private state = new Map<string, SymbolState>();

  constructor(params: Partial<TechnicalParams> = {}) {
    this.params = {
      fastPeriod: config.strategy.fast,
      slowPeriod: config.strategy.slow,
      trendPeriod: config.strategy.trend,
      rsiPeriod: config.strategy.rsiPeriod,
      rsiOverbought: config.strategy.rsiOverbought,
      minHoldBars: config.strategy.minHoldBars,
      reentryBars: config.strategy.reentryBars,
      band: config.strategy.band,
      trendFilter: config.strategy.trendFilter,
      ...params,
    };
  }

  private stateFor(symbol: string): SymbolState {
    let s = this.state.get(symbol);
    if (!s) {
      s = { lastBarTs: null, bar: 0, entryBar: -1, exitBar: -1e9, wasHolding: false };
      this.state.set(symbol, s);
    }
    return s;
  }

  async evaluate(ctx: StrategyContext): Promise<Signal[]> {
    const p = this.params;
    const needed = p.trendPeriod + 2;
    const signals: Signal[] = [];
    const held = new Set(ctx.positions.filter((pos) => pos.qty > 0).map((pos) => pos.symbol));

    for (const symbol of ctx.watchlist) {
      const bars = ctx.bars.get(symbol) ?? [];
      if (bars.length < needed) continue;

      const st = this.stateFor(symbol);
      const newestTs = bars[bars.length - 1]!.ts;
      // One evaluation per new bar — ignore repeated intra-bar loop ticks.
      if (st.lastBarTs === newestTs) continue;
      st.lastBarTs = newestTs;
      st.bar += 1;

      const closes = bars.map((b) => b.close);
      const fast = SMA.calculate({ period: p.fastPeriod, values: closes });
      const slow = SMA.calculate({ period: p.slowPeriod, values: closes });
      const trend = SMA.calculate({ period: p.trendPeriod, values: closes });
      const rsi = RSI.calculate({ period: p.rsiPeriod, values: closes });

      const fastNow = fast.at(-1)!;
      const fastPrev = fast.at(-2)!;
      const slowNow = slow.at(-1)!;
      const slowPrev = slow.at(-2)!;
      const rsiNow = rsi.at(-1) ?? 50;
      const trendRising = (trend.at(-1) ?? 0) >= (trend.at(-4) ?? trend.at(-1) ?? 0);

      // Crossover events: fast must have been clearly below/above the slow MA
      // (hysteresis on the SETUP, not the trigger) and then cross it this bar.
      const crossUp = fastPrev <= slowPrev * (1 - p.band) && fastNow > slowNow;
      const crossDown = fastPrev >= slowPrev * (1 + p.band) && fastNow < slowNow;

      const holding = held.has(symbol);
      // Track entry bar on the transition into a position.
      if (holding && !st.wasHolding) st.entryBar = st.bar;
      if (!holding && st.wasHolding) st.exitBar = st.bar;
      st.wasHolding = holding;

      if (!holding) {
        const cooldownOk = st.bar - st.exitBar >= p.reentryBars;
        const trendOk = !p.trendFilter || trendRising;
        if (crossUp && cooldownOk && trendOk && rsiNow < p.rsiOverbought) {
          signals.push({
            symbol,
            action: 'buy',
            reason: `crossover: SMA${p.fastPeriod} ${fastNow.toFixed(2)} crossed above SMA${p.slowPeriod} ${slowNow.toFixed(2)}, RSI ${rsiNow.toFixed(1)}, trend ${trendRising ? 'up' : 'flat/down'}`,
          });
          st.entryBar = st.bar; // optimistic; corrected on next eval if not filled
        }
      } else {
        const heldLongEnough = st.bar - st.entryBar >= p.minHoldBars;
        if ((crossDown && heldLongEnough) || rsiNow > p.rsiOverbought + 10) {
          signals.push({
            symbol,
            action: 'close',
            reason: crossDown
              ? `crossover down: SMA${p.fastPeriod} ${fastNow.toFixed(2)} crossed below SMA${p.slowPeriod} ${slowNow.toFixed(2)}`
              : `RSI extreme ${rsiNow.toFixed(1)}`,
          });
        }
      }
    }

    if (signals.length) log.debug(`produced ${signals.length} signal(s)`);
    return signals;
  }
}
