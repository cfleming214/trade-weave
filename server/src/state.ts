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
  /**
   * Daily-loss circuit-breaker threshold (fraction of equity), adjustable at
   * runtime. Seeded from config; the risk manager reads this live value.
   */
  maxDailyLossPct = config.risk.maxDailyLossPct;
  /** Cached latest account snapshot for the dashboard. */
  lastAccount: Record<string, unknown> | null = null;
  /** Latest per-symbol position review (thesis still working / wrong). */
  lastReviews: Record<string, { verdict: string; action: string; reason: string; ts: string }> = {};

  /**
   * True only when the bot is permitted to place orders right now. In addition
   * to the trading toggle and kill switch, live (real-money) trading requires
   * the CONFIRM_LIVE interlock — paper trading is always allowed.
   */
  canTrade(): boolean {
    if (!this.tradingEnabled || this.killSwitch) return false;
    if (!config.alpaca.paper && !config.alpaca.confirmLive) return false;
    return true;
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

  /** Adjust the daily-loss guardrail, clamped to a sane range (0.5%–100%). */
  setMaxDailyLossPct(pct: number) {
    if (!Number.isFinite(pct)) return;
    this.maxDailyLossPct = Math.min(1, Math.max(0.005, pct));
    this.broadcast();
  }

  snapshot() {
    return {
      running: this.running,
      mode: this.mode,
      tradingEnabled: this.tradingEnabled,
      killSwitch: this.killSwitch,
      maxDailyLossPct: this.maxDailyLossPct,
    };
  }

  broadcast() {
    bus.emit('engine-state', this.snapshot());
  }
}

export const engineState = new EngineState();
