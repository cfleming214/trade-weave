import { createLogger } from '../logger.js';
import type {
  Account,
  BrokerAdapter,
  Bar,
  Order,
  OptionChainQuery,
  OptionContract,
  PlaceOrderParams,
  Position,
  Quote,
} from './types.js';

const log = createLogger('mock-broker');

/** Deterministic PRNG (mulberry32) so the mock series is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * In-memory broker used when no Alpaca keys are configured. Lets you run the
 * whole stack, see the dashboard, and exercise the strategy/execution loop
 * end-to-end without any external account.
 *
 * Prices follow a seeded random walk with mild upward drift and volatility —
 * i.e. realistic-looking price action that actually trends and reverts, rather
 * than a pure oscillation. Reproducible across restarts (seeded per symbol).
 * NOTE: this is SIMULATED data, not real prices.
 */
export class MockAdapter implements BrokerAdapter {
  readonly name = 'mock';
  readonly paper = true;

  private cash = 100_000;
  private positions = new Map<string, Position>();
  private orders: Order[] = [];
  private seq = 0;
  private tick = 0;
  private rng = new Map<string, () => number>();
  private series = new Map<string, number[]>();

  private basePrice(symbol: string): number {
    const seed = [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0);
    return 50 + (seed % 400);
  }

  /** Lazily extend the per-symbol random-walk series to at least length n+1. */
  private ensureSeries(symbol: string, n: number): number[] {
    let s = this.series.get(symbol);
    if (!s) {
      s = [this.basePrice(symbol)];
      this.series.set(symbol, s);
    }
    let r = this.rng.get(symbol);
    if (!r) {
      const seed = [...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
      r = mulberry32(seed);
      this.rng.set(symbol, r);
    }
    const drift = 0.0004; // slight upward bias, like real markets
    const vol = 0.012; // ~1.2% per-bar volatility
    while (s.length <= n) {
      const prev = s[s.length - 1]!;
      const ret = drift + (r() - 0.5) * vol * 2;
      s.push(Math.max(1, Number((prev * (1 + ret)).toFixed(2))));
    }
    return s;
  }

  private priceFor(symbol: string): number {
    return this.ensureSeries(symbol, this.tick)[this.tick]!;
  }

  async getAccount(): Promise<Account> {
    const posValue = [...this.positions.values()].reduce((s, p) => s + p.marketValue, 0);
    const equity = this.cash + posValue;
    return {
      equity,
      cash: this.cash,
      buyingPower: this.cash,
      lastEquity: 100_000,
      currency: 'USD',
      tradingBlocked: false,
    };
  }

  async getPositions(): Promise<Position[]> {
    // Refresh marks against the latest simulated price.
    for (const p of this.positions.values()) {
      p.currentPrice = this.priceFor(p.symbol);
      p.marketValue = Number((p.currentPrice * p.qty).toFixed(2));
      p.unrealizedPl = Number(((p.currentPrice - p.avgEntryPrice) * p.qty).toFixed(2));
      p.unrealizedPlPct =
        p.avgEntryPrice > 0 ? (p.currentPrice - p.avgEntryPrice) / p.avgEntryPrice : 0;
    }
    return [...this.positions.values()];
  }

  async getLatestQuote(symbol: string): Promise<Quote | null> {
    this.tick += 1;
    return { symbol, price: this.priceFor(symbol), ts: new Date().toISOString() };
  }

  async getBars(symbol: string, timeframe: string, limit: number): Promise<Bar[]> {
    const end = Math.max(this.tick, limit - 1);
    const s = this.ensureSeries(symbol, end);
    const stepMs = timeframe === '1Day' ? 86_400_000 : timeframe === '1Hour' ? 3_600_000 : 60_000;
    // Stable, bar-index-aligned timestamps (NOT Date.now()-relative) so a bar's
    // timestamp only changes when a genuinely new bar appears — this is what
    // lets the strategy's one-trade-per-bar gate work.
    const EPOCH = 1_700_000_000_000;
    const start = end - limit + 1;
    const bars: Bar[] = [];
    for (let idx = start; idx <= end; idx++) {
      const close = s[idx]!;
      bars.push({
        symbol,
        ts: new Date(EPOCH + idx * stepMs).toISOString(),
        open: close,
        high: Number((close * 1.004).toFixed(2)),
        low: Number((close * 0.996).toFixed(2)),
        close,
        volume: 1000,
      });
    }
    return bars;
  }

  async placeOrder(params: PlaceOrderParams): Promise<Order> {
    const price = this.priceFor(params.symbol);
    const qty = params.qty ?? (params.notional ? params.notional / price : 1);
    const id = `mock-${++this.seq}`;
    const order: Order = {
      id,
      clientOrderId: params.clientOrderId,
      symbol: params.symbol,
      assetClass: params.symbol.includes('/') ? 'crypto' : 'us_equity',
      side: params.side,
      qty,
      filledQty: qty,
      type: params.type,
      status: 'filled',
      filledAvgPrice: price,
      submittedAt: new Date().toISOString(),
    };
    this.orders.push(order);

    // Update the simulated position.
    const existing = this.positions.get(params.symbol);
    const signedQty = params.side === 'buy' ? qty : -qty;
    if (!existing) {
      if (params.side === 'buy') {
        this.positions.set(params.symbol, {
          symbol: params.symbol,
          assetClass: order.assetClass,
          qty,
          avgEntryPrice: price,
          currentPrice: price,
          marketValue: price * qty,
          unrealizedPl: 0,
          unrealizedPlPct: 0,
          side: 'long',
        });
        this.cash -= price * qty;
      }
    } else {
      const newQty = existing.qty + signedQty;
      this.cash -= price * signedQty;
      if (Math.abs(newQty) < 1e-9) this.positions.delete(params.symbol);
      else existing.qty = newQty;
    }
    log.info(`simulated ${params.side} ${qty} ${params.symbol} @ ${price}`);
    return order;
  }

  async cancelOrder(): Promise<void> {}
  async cancelAllOrders(): Promise<void> {}
  async getOpenOrders(): Promise<Order[]> {
    return [];
  }
  async closePosition(symbol: string): Promise<void> {
    this.positions.delete(symbol);
  }
  async closeAllPositions(): Promise<void> {
    this.positions.clear();
  }

  async getOptionChain(query: OptionChainQuery): Promise<OptionContract[]> {
    const base = this.basePrice(query.underlying);
    const out: OptionContract[] = [];
    for (let k = -2; k <= 2; k++) {
      const strike = Math.round(base + k * 5);
      for (const type of ['call', 'put'] as const) {
        if (query.type && query.type !== type) continue;
        out.push({
          symbol: `${query.underlying}_MOCK_${type}_${strike}`,
          underlying: query.underlying,
          type,
          strike,
          expiration: query.expiration ?? '2026-12-18',
          openInterest: 100,
        });
      }
    }
    return out;
  }
}
