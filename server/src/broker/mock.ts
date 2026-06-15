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

/**
 * In-memory broker used when no Alpaca keys are configured. Lets you run the
 * whole stack, see the dashboard, and exercise the strategy/execution loop
 * end-to-end without any external account. Prices follow a simple deterministic
 * random walk seeded per symbol so behaviour is reproducible across restarts.
 */
export class MockAdapter implements BrokerAdapter {
  readonly name = 'mock';
  readonly paper = true;

  private cash = 100_000;
  private positions = new Map<string, Position>();
  private orders: Order[] = [];
  private seq = 0;
  private tick = 0;

  private basePrice(symbol: string): number {
    // Stable pseudo-price per symbol from its char codes.
    const seed = [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0);
    return 50 + (seed % 400);
  }

  private priceFor(symbol: string): number {
    const base = this.basePrice(symbol);
    // Deterministic oscillation so signals actually fire over time.
    const wobble = Math.sin((this.tick + base) / 7) * base * 0.03;
    return Math.max(1, Number((base + wobble).toFixed(2)));
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

  async getBars(symbol: string, _timeframe: string, limit: number): Promise<Bar[]> {
    const bars: Bar[] = [];
    const now = Date.now();
    for (let i = limit; i > 0; i--) {
      const t = this.tick - i;
      const base = this.basePrice(symbol);
      const close = Math.max(1, base + Math.sin((t + base) / 7) * base * 0.03);
      bars.push({
        symbol,
        ts: new Date(now - i * 60_000).toISOString(),
        open: close,
        high: close * 1.005,
        low: close * 0.995,
        close: Number(close.toFixed(2)),
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
