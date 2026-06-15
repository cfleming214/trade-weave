import type { Account, Position } from '../broker/types.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { engineState } from '../state.js';

const log = createLogger('risk');

export interface EntryPlan {
  symbol: string;
  qty: number;
  /** Bracket prices for the entry (server-enforced too, see forcedExits). */
  stopLossPrice: number;
  takeProfitPrice: number;
  notional: number;
}

export interface ForcedExit {
  symbol: string;
  reason: string;
}

/**
 * The risk manager is the gate between a strategy's intent and real orders.
 * It owns position sizing, stop-loss / take-profit levels, the daily-loss
 * circuit breaker, and server-side stop enforcement (so stops work even for
 * assets/brokers without native bracket orders, e.g. crypto).
 */
export class RiskManager {
  private readonly maxPositionPct = config.risk.maxPositionPct;
  private readonly stopLossPct = config.risk.stopLossPct;
  private readonly takeProfitPct = config.risk.takeProfitPct;
  /** Read live from engine state so it can be adjusted at runtime. */
  private get maxDailyLossPct(): number {
    return engineState.maxDailyLossPct;
  }

  private isCrypto(symbol: string): boolean {
    return symbol.includes('/');
  }

  /**
   * True when the day's loss (realized + unrealized vs. start-of-day equity)
   * has breached the limit. While breached, the engine blocks NEW entries but
   * still allows exits.
   */
  dailyLossBreached(account: Account): boolean {
    if (!account.lastEquity) return false;
    const change = (account.equity - account.lastEquity) / account.lastEquity;
    if (change <= -this.maxDailyLossPct) {
      log.warn(
        `daily loss guardrail hit: ${(change * 100).toFixed(2)}% <= -${(this.maxDailyLossPct * 100).toFixed(2)}% — blocking new entries`,
      );
      return true;
    }
    return false;
  }

  /**
   * Size a new long entry. Returns null if the position would be too small to
   * place (e.g. price exceeds the per-position budget for whole-share assets).
   */
  planEntry(symbol: string, price: number, account: Account): EntryPlan | null {
    if (price <= 0) return null;
    const budget = account.equity * this.maxPositionPct;
    if (budget > account.cash) {
      // Never spend more cash than we have.
    }
    const affordable = Math.min(budget, account.buyingPower);
    let qty = this.isCrypto(symbol)
      ? Number((affordable / price).toFixed(6)) // fractional for crypto
      : Math.floor(affordable / price); // whole shares for equities

    if (qty <= 0) {
      log.info(`skip ${symbol}: budget ${affordable.toFixed(2)} too small for price ${price}`);
      return null;
    }

    return {
      symbol,
      qty,
      notional: Number((qty * price).toFixed(2)),
      stopLossPrice: Number((price * (1 - this.stopLossPct)).toFixed(2)),
      takeProfitPrice: Number((price * (1 + this.takeProfitPct)).toFixed(2)),
    };
  }

  /**
   * Server-side stop enforcement. Scans open positions and returns any that
   * have breached the stop-loss or take-profit thresholds so the engine can
   * close them this tick — independent of any native bracket order.
   */
  forcedExits(positions: Position[]): ForcedExit[] {
    const exits: ForcedExit[] = [];
    for (const p of positions) {
      if (p.qty <= 0) continue;
      const pct = p.unrealizedPlPct;
      if (pct <= -this.stopLossPct) {
        exits.push({ symbol: p.symbol, reason: `stop-loss hit (${(pct * 100).toFixed(2)}%)` });
      } else if (this.takeProfitPct > 0 && pct >= this.takeProfitPct) {
        // Take-profit is optional: set TAKE_PROFIT_PCT=0 to let winners run and
        // exit only on the strategy's signal (e.g. a death-cross) or the stop.
        exits.push({ symbol: p.symbol, reason: `take-profit hit (${(pct * 100).toFixed(2)}%)` });
      }
    }
    return exits;
  }

  /** Equities support native bracket orders on Alpaca; crypto does not. */
  supportsBracket(symbol: string): boolean {
    return !this.isCrypto(symbol);
  }
}
