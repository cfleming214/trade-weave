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
 * A re-assessment of an OPEN position: is the original entry thesis still
 * working, or did we get it wrong — and if wrong, do we cut or hold and give it
 * room to recover (bounded by the stop)?
 */
export interface PositionReview {
  symbol: string;
  verdict: 'working' | 'wrong';
  /** 'close' = act on it now; 'hold' = keep the position open. */
  action: 'hold' | 'close';
  reason: string;
}

/**
 * Common interface for every decision engine mode (technical, llm, and the
 * future ml mode). Selected at runtime via config/dashboard.
 */
export interface Strategy {
  readonly name: string;
  /** Decide entries (and, for some strategies, exits) for the watchlist. */
  evaluate(ctx: StrategyContext): Promise<Signal[]>;
  /**
   * Optional: re-assess each currently-open position against its thesis every
   * cycle. Strategies without this just rely on evaluate() + risk stops.
   */
  reviewPositions?(ctx: StrategyContext): Promise<PositionReview[]>;
}
