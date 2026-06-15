import { config } from './config.js';
import { bus } from './bus.js';

/**
 * Mutable runtime state for the engine, kept in one place so the HTTP/WS layer
 * and the trading loop share a single source of truth. The kill-switch is the
 * most important field: when true, no new orders are ever placed regardless of
 * any other setting.
 */
class EngineState {
  running = false;
  killSwitch = false;
  mode: 'technical' | 'llm' = config.engine.mode;
  tradingEnabled = config.engine.tradingEnabled;
  /** Cached latest account snapshot for the dashboard. */
  lastAccount: Record<string, unknown> | null = null;

  /** True only when the bot is permitted to place real orders right now. */
  canTrade(): boolean {
    return this.tradingEnabled && !this.killSwitch;
  }

  setKillSwitch(on: boolean) {
    this.killSwitch = on;
    this.broadcast();
  }

  setTradingEnabled(on: boolean) {
    this.tradingEnabled = on;
    this.broadcast();
  }

  setMode(mode: 'technical' | 'llm') {
    this.mode = mode;
    this.broadcast();
  }

  snapshot() {
    return {
      running: this.running,
      mode: this.mode,
      tradingEnabled: this.tradingEnabled,
      killSwitch: this.killSwitch,
    };
  }

  broadcast() {
    bus.emit('engine-state', this.snapshot());
  }
}

export const engineState = new EngineState();
