import type { Account, Bar, Position, Quote } from '../broker/types.js';

/**
 * What a strategy can tell the engine to do for a symbol. The engine + risk
 * manager decide the actual size and whether to act; a strategy never places
 * orders itself.
 */
export type SignalAction = 'buy' | 'sell' | 'close' | 'hold';

export interface Signal {
  symbol: string;
  action: SignalAction;
  /** Human-readable justification, stored in the audit log + shown on the dashboard. */
  reason: string;
  /**
   * When present, this signal is an OPTIONS play on `symbol` (the underlying):
   * the pipeline resolves a concrete contract from the chain and trades it.
   * Absent for plain equity/crypto signals.
   */
  option?: {
    type: 'call' | 'put';
    /** Target expiration (YYYY-MM-DD). Pipeline picks the nearest available if omitted. */
    expiration?: string;
    /** How far OTM/ITM to target, as a fraction of spot (0 = ATM, +0.05 = 5% OTM call). */
    moneyness?: number;
  };
}

/** Everything a strategy needs to make a decision on a given tick. */
export interface StrategyContext {
  account: Account;
  positions: Position[];
  /** Recent OHLCV bars per watchlist symbol (oldest → newest). */
  bars: Map<string, Bar[]>;
  /** Latest quote per symbol. */
  quotes: Map<string, Quote | undefined>;
  watchlist: string[];
}

/**
 * Common interface for every decision engine mode (technical, llm, and the
 * future ml mode). Selected at runtime via config/dashboard.
 */
export interface Strategy {
  readonly name: string;
  evaluate(ctx: StrategyContext): Promise<Signal[]>;
}
