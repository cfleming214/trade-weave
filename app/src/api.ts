import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Connection layer to the local TradeWeave server. The server URL is
 * configurable (your Mac's LAN IP, e.g. http://192.168.1.50:4000) and
 * persisted on the device, since the bot runs on your computer, not in the
 * cloud.
 */

const STORAGE_KEY = 'tradeweave.serverUrl';
const DEFAULT_URL = 'http://127.0.0.1:4000';

let serverUrl = DEFAULT_URL;

export async function loadServerUrl(): Promise<string> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) serverUrl = stored;
  return serverUrl;
}

export async function setServerUrl(url: string): Promise<void> {
  serverUrl = url.replace(/\/+$/, '');
  await AsyncStorage.setItem(STORAGE_KEY, serverUrl);
}

export function getServerUrl(): string {
  return serverUrl;
}

export function wsUrl(): string {
  return serverUrl.replace(/^http/, 'ws') + '/ws';
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

// --- Types mirrored from the server ---
export interface EngineState {
  running: boolean;
  mode: 'technical' | 'llm';
  tradingEnabled: boolean;
  killSwitch: boolean;
  maxDailyLossPct: number;
}
export interface AccountSnapshot {
  equity: number;
  cash: number;
  lastEquity: number;
  unrealizedPl?: number;
  positions?: PositionRow[];
}
export interface PositionRow {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPl: number;
  unrealizedPlPct: number;
}
export interface PortfolioPosition extends PositionRow {
  change: number;
  changePct: number;
  history: Array<{ ts: string; close: number }>;
}
export interface OrderRow {
  id: string;
  ts: string;
  symbol: string;
  side: string;
  qty: number;
  type: string;
  status: string;
  filled_avg_price: number | null;
  reason: string | null;
}
export interface PortfolioResponse {
  positions: PortfolioPosition[];
  orders: OrderRow[];
}
export interface StateResponse {
  engine: EngineState;
  broker: { name: string; paper: boolean };
  account: AccountSnapshot | null;
  watchlist: string[];
}
export interface SignalRow {
  ts: string;
  symbol: string;
  action: string;
  reason: string | null;
  strategy: string | null;
  executed: number;
}
export interface Analysis {
  ts: string;
  model: string;
  text: string;
  /** From the POST result. */
  usedWebSearch?: boolean;
  /** From the stored row. */
  used_web_search?: number;
}

export const api = {
  getState: () => req<StateResponse>('/api/state'),
  getSignals: (limit = 50) => req<SignalRow[]>(`/api/signals?limit=${limit}`),
  getEquity: (limit = 200) => req<Array<{ ts: string; equity: number }>>(`/api/equity?limit=${limit}`),
  start: () => req('/api/control/start', { method: 'POST' }),
  stop: () => req('/api/control/stop', { method: 'POST' }),
  setKill: (on: boolean) => req('/api/control/kill', { method: 'POST', body: JSON.stringify({ on }) }),
  setTrading: (on: boolean) => req('/api/control/trading', { method: 'POST', body: JSON.stringify({ on }) }),
  setMode: (mode: 'technical' | 'llm') =>
    req('/api/control/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  bumpDailyLoss: (delta: number) =>
    req<EngineState>('/api/control/daily-loss', { method: 'POST', body: JSON.stringify({ delta }) }),
  flatten: () => req('/api/control/flatten', { method: 'POST' }),
  runAnalysis: () => req<{ analysis: Analysis }>('/api/analysis', { method: 'POST' }),
  latestAnalysis: () => req<{ analysis: Analysis | null }>('/api/analysis/latest'),
  getPortfolio: () => req<PortfolioResponse>('/api/portfolio'),
};
