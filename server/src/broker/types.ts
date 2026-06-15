/**
 * Broker-agnostic domain types and the BrokerAdapter interface.
 *
 * The trading core only ever talks to a BrokerAdapter, never to Alpaca
 * directly. Swapping in an IBKRAdapter later means implementing this same
 * interface — no strategy/risk code changes. Options are modelled here from
 * day one so Phase 3 is purely additive.
 */

export type AssetClass = 'us_equity' | 'crypto' | 'option';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';
export type OptionType = 'call' | 'put';

export interface Account {
  /** Total account equity (cash + positions). */
  equity: number;
  cash: number;
  buyingPower: number;
  /** Equity at the start of the trading day, used for daily P&L guardrails. */
  lastEquity: number;
  currency: string;
  /** True when the broker has flagged the account as restricted from trading. */
  tradingBlocked: boolean;
}

export interface Position {
  symbol: string;
  assetClass: AssetClass;
  qty: number;
  /** Average entry/cost basis per unit. */
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPl: number;
  unrealizedPlPct: number;
  side: 'long' | 'short';
}

export interface Quote {
  symbol: string;
  price: number;
  ts: string;
}

export interface Bar {
  symbol: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A single leg of an order. Equity/crypto orders have exactly one leg. */
export interface OrderLeg {
  symbol: string;
  side: OrderSide;
  /** Ratio quantity for multi-leg option strategies; 1 for single orders. */
  ratioQty?: number;
}

export interface PlaceOrderParams {
  symbol: string;
  side: OrderSide;
  qty?: number;
  /** For equities that support fractional/notional orders. */
  notional?: number;
  type: OrderType;
  timeInForce: TimeInForce;
  limitPrice?: number;
  stopPrice?: number;
  /** Attach a bracket (stop-loss / take-profit) to the entry. */
  bracket?: { takeProfitPrice?: number; stopLossPrice?: number };
  /** Multi-leg option orders (Phase 3). When set, `symbol`/`side` describe the net order. */
  legs?: OrderLeg[];
  clientOrderId?: string;
}

export interface Order {
  id: string;
  clientOrderId?: string;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  qty: number;
  filledQty: number;
  type: OrderType;
  status: string;
  filledAvgPrice?: number;
  submittedAt: string;
}

export interface OptionContract {
  symbol: string;
  underlying: string;
  type: OptionType;
  strike: number;
  expiration: string; // YYYY-MM-DD
  openInterest?: number;
}

export interface OptionChainQuery {
  underlying: string;
  type?: OptionType;
  expiration?: string;
  strikeGte?: number;
  strikeLte?: number;
}

/**
 * The single seam between the trading core and any brokerage.
 */
export interface BrokerAdapter {
  readonly name: string;
  readonly paper: boolean;

  getAccount(): Promise<Account>;
  getPositions(): Promise<Position[]>;
  getLatestQuote(symbol: string): Promise<Quote | null>;
  getBars(symbol: string, timeframe: string, limit: number): Promise<Bar[]>;

  placeOrder(params: PlaceOrderParams): Promise<Order>;
  cancelOrder(id: string): Promise<void>;
  cancelAllOrders(): Promise<void>;
  getOpenOrders(): Promise<Order[]>;
  closePosition(symbol: string): Promise<void>;
  closeAllPositions(): Promise<void>;

  /** Options support (Phase 3). May throw 'not supported' on adapters without it. */
  getOptionChain(query: OptionChainQuery): Promise<OptionContract[]>;
}
