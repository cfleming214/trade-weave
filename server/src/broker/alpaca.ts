import { config } from '../config.js';
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

const log = createLogger('alpaca');

const TRADING_HOST = config.alpaca.paper
  ? 'https://paper-api.alpaca.markets'
  : 'https://api.alpaca.markets';
const DATA_HOST = 'https://data.alpaca.markets';

/**
 * Direct REST adapter over Alpaca's v2 Trading and Market Data APIs. We use
 * fetch rather than the SDK so options endpoints and order shapes are fully
 * under our control. All Alpaca-specific JSON is normalised into the
 * broker-agnostic types here.
 */
export class AlpacaAdapter implements BrokerAdapter {
  readonly name = 'alpaca';
  readonly paper = config.alpaca.paper;

  private headers() {
    return {
      'APCA-API-KEY-ID': config.alpaca.keyId,
      'APCA-API-SECRET-KEY': config.alpaca.secretKey,
      'Content-Type': 'application/json',
    };
  }

  private async req<T>(host: string, path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${host}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Alpaca ${init?.method ?? 'GET'} ${path} -> ${res.status}: ${body}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // --- Account / positions ---

  async getAccount(): Promise<Account> {
    const a = await this.req<any>(TRADING_HOST, '/v2/account');
    return {
      equity: Number(a.equity),
      cash: Number(a.cash),
      buyingPower: Number(a.buying_power),
      lastEquity: Number(a.last_equity),
      currency: a.currency,
      tradingBlocked: Boolean(a.trading_blocked),
    };
  }

  async getPositions(): Promise<Position[]> {
    const ps = await this.req<any[]>(TRADING_HOST, '/v2/positions');
    return ps.map((p) => ({
      symbol: p.symbol,
      assetClass: p.asset_class === 'crypto' ? 'crypto' : p.asset_class === 'us_option' ? 'option' : 'us_equity',
      qty: Number(p.qty),
      avgEntryPrice: Number(p.avg_entry_price),
      currentPrice: Number(p.current_price),
      marketValue: Number(p.market_value),
      unrealizedPl: Number(p.unrealized_pl),
      unrealizedPlPct: Number(p.unrealized_plpc),
      side: p.side === 'short' ? 'short' : 'long',
    }));
  }

  // --- Market data ---

  /** Crypto symbols use the "BTC/USD" form and a different data endpoint. */
  private isCrypto(symbol: string): boolean {
    return symbol.includes('/');
  }

  async getLatestQuote(symbol: string): Promise<Quote | null> {
    try {
      if (this.isCrypto(symbol)) {
        const r = await this.req<any>(
          DATA_HOST,
          `/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(symbol)}`,
        );
        const t = r.trades?.[symbol];
        if (!t) return null;
        return { symbol, price: Number(t.p), ts: t.t };
      }
      const r = await this.req<any>(DATA_HOST, `/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`);
      if (!r.trade) return null;
      return { symbol, price: Number(r.trade.p), ts: r.trade.t };
    } catch (err) {
      log.warn(`quote failed for ${symbol}`, (err as Error).message);
      return null;
    }
  }

  async getBars(symbol: string, timeframe: string, limit: number): Promise<Bar[]> {
    const path = this.isCrypto(symbol)
      ? `/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`
      : `/v2/stocks/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`;
    const r = await this.req<any>(DATA_HOST, path);
    const raw: any[] = r.bars?.[symbol] ?? [];
    return raw.map((b) => ({
      symbol,
      ts: b.t,
      open: Number(b.o),
      high: Number(b.h),
      low: Number(b.l),
      close: Number(b.c),
      volume: Number(b.v),
    }));
  }

  // --- Orders ---

  async placeOrder(params: PlaceOrderParams): Promise<Order> {
    const body: Record<string, unknown> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      time_in_force: params.timeInForce,
    };
    if (params.qty !== undefined) body.qty = String(params.qty);
    if (params.notional !== undefined) body.notional = String(params.notional);
    if (params.limitPrice !== undefined) body.limit_price = String(params.limitPrice);
    if (params.stopPrice !== undefined) body.stop_price = String(params.stopPrice);
    if (params.clientOrderId) body.client_order_id = params.clientOrderId;
    if (params.bracket && (params.bracket.stopLossPrice || params.bracket.takeProfitPrice)) {
      body.order_class = 'bracket';
      if (params.bracket.takeProfitPrice)
        body.take_profit = { limit_price: String(params.bracket.takeProfitPrice) };
      if (params.bracket.stopLossPrice)
        body.stop_loss = { stop_price: String(params.bracket.stopLossPrice) };
    }
    if (params.legs && params.legs.length > 1) {
      body.order_class = 'mleg';
      body.legs = params.legs.map((l) => ({
        symbol: l.symbol,
        side: l.side,
        ratio_qty: String(l.ratioQty ?? 1),
        position_intent: l.side === 'buy' ? 'buy_to_open' : 'sell_to_open',
      }));
      delete body.symbol;
      delete body.side;
    }
    const o = await this.req<any>(TRADING_HOST, '/v2/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return this.normalizeOrder(o);
  }

  async cancelOrder(id: string): Promise<void> {
    await this.req(TRADING_HOST, `/v2/orders/${id}`, { method: 'DELETE' });
  }

  async cancelAllOrders(): Promise<void> {
    await this.req(TRADING_HOST, '/v2/orders', { method: 'DELETE' });
  }

  async getOpenOrders(): Promise<Order[]> {
    const os = await this.req<any[]>(TRADING_HOST, '/v2/orders?status=open&limit=100');
    return os.map((o) => this.normalizeOrder(o));
  }

  async closePosition(symbol: string): Promise<void> {
    await this.req(TRADING_HOST, `/v2/positions/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
  }

  async closeAllPositions(): Promise<void> {
    await this.req(TRADING_HOST, '/v2/positions?cancel_orders=true', { method: 'DELETE' });
  }

  // --- Options (Phase 3) ---

  async getOptionChain(query: OptionChainQuery): Promise<OptionContract[]> {
    const qs = new URLSearchParams({ underlying_symbols: query.underlying, limit: '100' });
    if (query.type) qs.set('type', query.type);
    if (query.expiration) qs.set('expiration_date', query.expiration);
    if (query.strikeGte !== undefined) qs.set('strike_price_gte', String(query.strikeGte));
    if (query.strikeLte !== undefined) qs.set('strike_price_lte', String(query.strikeLte));
    const r = await this.req<any>(TRADING_HOST, `/v2/options/contracts?${qs.toString()}`);
    const contracts: any[] = r.option_contracts ?? [];
    return contracts.map((c) => ({
      symbol: c.symbol,
      underlying: c.underlying_symbol,
      type: c.type === 'put' ? 'put' : 'call',
      strike: Number(c.strike_price),
      expiration: c.expiration_date,
      openInterest: c.open_interest ? Number(c.open_interest) : undefined,
    }));
  }

  private normalizeOrder(o: any): Order {
    return {
      id: o.id,
      clientOrderId: o.client_order_id,
      symbol: o.symbol,
      assetClass: o.asset_class === 'crypto' ? 'crypto' : o.asset_class === 'us_option' ? 'option' : 'us_equity',
      side: o.side,
      qty: Number(o.qty ?? 0),
      filledQty: Number(o.filled_qty ?? 0),
      type: o.type,
      status: o.status,
      filledAvgPrice: o.filled_avg_price ? Number(o.filled_avg_price) : undefined,
      submittedAt: o.submitted_at ?? o.created_at,
    };
  }
}
