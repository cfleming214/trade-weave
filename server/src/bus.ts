import { EventEmitter } from 'node:events';

/**
 * Process-wide event bus. The strategy loop, broker, and market-data feed all
 * publish here; the WebSocket layer subscribes and fans events out to the
 * dashboard / app. Keeping this decoupled means the trading core never imports
 * the web layer.
 */

export interface BusEvents {
  log: { ts: string; level: string; scope: string; msg: string; extra?: unknown };
  quote: { symbol: string; price: number; ts: string };
  signal: {
    ts: string;
    symbol: string;
    action: string;
    reason: string;
    strategy: string;
  };
  order: { ts: string; id: string; symbol: string; side: string; qty: number; status: string };
  fill: { ts: string; id: string; symbol: string; side: string; qty: number; price: number };
  'account-update': Record<string, unknown>;
  'engine-state': { running: boolean; mode: string; tradingEnabled: boolean; killSwitch: boolean };
}

class TypedBus extends EventEmitter {
  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): boolean {
    return super.emit(event, payload);
  }
  on<K extends keyof BusEvents>(event: K, listener: (payload: BusEvents[K]) => void): this {
    return super.on(event, listener);
  }
}

export const bus = new TypedBus();
// The dashboard can register many short-lived listeners; lift the default cap.
bus.setMaxListeners(100);
