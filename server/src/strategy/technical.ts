import { RSI, SMA } from 'technicalindicators';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { PositionReview, Signal, Strategy, StrategyContext } from './types.js';

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

      // Entries only. Open-position management lives in reviewPositions().
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
      }
    }

    if (signals.length) log.debug(`produced ${signals.length} signal(s)`);
    return signals;
  }

  /**
   * Re-assess every open position against its (bullish-crossover) thesis each
   * cycle:
   *  - trend still up  → "working", hold;
   *  - trend ended in profit → "working", close (lock the gain);
   *  - trend broke while losing → "wrong": hold and give it room (within the
   *    minimum-hold window, or on a small loss with an oversold bounce setup —
   *    the stop-loss is still the hard floor), otherwise cut to limit the loss.
   */
  async reviewPositions(ctx: StrategyContext): Promise<PositionReview[]> {
    const p = this.params;
    const stopLossPct = config.risk.stopLossPct;
    const reviews: PositionReview[] = [];

    for (const pos of ctx.positions) {
      if (pos.qty <= 0) continue;
      const symbol = pos.symbol;
      const bars = ctx.bars.get(symbol) ?? [];
      const closes = bars.map((b) => b.close);
      if (closes.length < p.slowPeriod + 2) {
        reviews.push({ symbol, verdict: 'working', action: 'hold', reason: 'not enough data to reassess — holding' });
        continue;
      }

      const fast = SMA.calculate({ period: p.fastPeriod, values: closes });
      const slow = SMA.calculate({ period: p.slowPeriod, values: closes });
      const rsi = RSI.calculate({ period: p.rsiPeriod, values: closes });
      const fastNow = fast.at(-1)!;
      const slowNow = slow.at(-1)!;
      const rsiNow = rsi.at(-1) ?? 50;
      const pnl = pos.unrealizedPlPct * 100;
      const pnlStr = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;

      const st = this.stateFor(symbol);
      const holdBars = st.entryBar >= 0 ? Math.max(0, st.bar - st.entryBar) : 0;
      const trendIntact = fastNow >= slowNow;

      if (trendIntact) {
        reviews.push({
          symbol,
          verdict: 'working',
          action: 'hold',
          reason: `thesis intact: SMA${p.fastPeriod} ${fastNow.toFixed(2)} ≥ SMA${p.slowPeriod} ${slowNow.toFixed(2)}, P&L ${pnlStr}`,
        });
        continue;
      }

      // Uptrend broke.
      if (pos.unrealizedPlPct >= 0) {
        reviews.push({
          symbol,
          verdict: 'working',
          action: 'close',
          reason: `uptrend ended in profit (${pnlStr}) — locking it in`,
        });
        continue;
      }

      // Losing AND the thesis is wrong — decide cut vs. keep trying.
      const withinMinHold = holdBars < p.minHoldBars;
      const smallLoss = pos.unrealizedPlPct > -stopLossPct * 0.6;
      const oversoldBounce = rsiNow < 38;
      if (withinMinHold) {
        reviews.push({
          symbol,
          verdict: 'wrong',
          action: 'hold',
          reason: `got it wrong (trend broke) but only ${holdBars}/${p.minHoldBars} bars in — giving it room (stop at -${(stopLossPct * 100).toFixed(1)}%)`,
        });
      } else if (smallLoss && oversoldBounce) {
        reviews.push({
          symbol,
          verdict: 'wrong',
          action: 'hold',
          reason: `got it wrong but loss is small (${pnlStr}) and RSI ${rsiNow.toFixed(1)} is oversold — keeping it open to try to recover (stop still active)`,
        });
      } else {
        reviews.push({
          symbol,
          verdict: 'wrong',
          action: 'close',
          reason: `got it wrong: trend broke (SMA${p.fastPeriod} ${fastNow.toFixed(2)} < SMA${p.slowPeriod} ${slowNow.toFixed(2)}) at ${pnlStr} — cutting to limit the loss`,
        });
      }
    }

    return reviews;
  }
}
