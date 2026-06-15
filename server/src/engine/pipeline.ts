import { bus } from '../bus.js';
import { config } from '../config.js';
import { store } from '../db/index.js';
import { createLogger } from '../logger.js';
import { selectContract } from '../options/select.js';
import { RiskManager } from '../risk/manager.js';
import { engineState } from '../state.js';
import { createStrategy } from '../strategy/index.js';
import type { Signal, Strategy } from '../strategy/types.js';
import type { TickContext } from './runtime.js';

const log = createLogger('pipeline');

/**
 * Builds the per-tick pipeline: gather data → run the active strategy → apply
 * risk (server-side stops + sizing) → place orders. Strategies are cached per
 * mode so switching engine mode from the dashboard takes effect on the next
 * tick with no restart.
 *
 * Safety: when the engine cannot trade (trading disabled or kill switch on),
 * signals are still produced and logged for the audit trail, but NO orders are
 * placed.
 */
export function createPipeline() {
  const risk = new RiskManager();
  const strategies = new Map<string, Strategy>();

  const strategyFor = (mode: 'technical' | 'llm'): Strategy => {
    let s = strategies.get(mode);
    if (!s) {
      s = createStrategy(mode);
      strategies.set(mode, s);
    }
    return s;
  };

  const recordSignal = (s: Signal, strategy: string, executed: boolean) => {
    const ts = new Date().toISOString();
    store.recordSignal({ ts, symbol: s.symbol, action: s.action, reason: s.reason, strategy, executed });
    bus.emit('signal', { ts, symbol: s.symbol, action: s.action, reason: s.reason, strategy });
  };

  return async function onTick({ engine, account, positions }: TickContext): Promise<void> {
    const broker = engine.broker;

    // 1. Gather recent bars for the watchlist.
    const bars = new Map();
    await Promise.all(
      config.engine.watchlist.map(async (symbol) => {
        bars.set(symbol, await broker.getBars(symbol, '1Min', 60).catch(() => []));
      }),
    );
    const quotes = new Map(config.engine.watchlist.map((s) => [s, engine.feed.getQuote(s)]));

    // 2. Server-side stop/take-profit enforcement always comes first.
    const forced = risk.forcedExits(positions);

    // 3. Strategy signals.
    const strategy = strategyFor(engineState.mode);
    const signals = await strategy.evaluate({ account, positions, bars, quotes, watchlist: config.engine.watchlist });

    const canTrade = engineState.canTrade();

    // Record forced exits as signals too (audit trail).
    for (const f of forced) recordSignal({ symbol: f.symbol, action: 'close', reason: f.reason }, 'risk', canTrade);

    if (!canTrade) {
      // Observe-only: log signals, place nothing.
      for (const s of signals) if (s.action !== 'hold') recordSignal(s, strategy.name, false);
      if (signals.length || forced.length)
        log.info(`observe-only: ${signals.length} signal(s), ${forced.length} stop(s) — not trading`);
      return;
    }

    // 4. Execute forced exits.
    for (const f of forced) {
      try {
        await broker.closePosition(f.symbol);
        log.warn(`closed ${f.symbol}: ${f.reason}`);
        emitOrder(f.symbol, 'sell', 0, 'forced-exit');
      } catch (err) {
        log.error(`failed to close ${f.symbol}`, (err as Error).message);
      }
    }
    const forcedSymbols = new Set(forced.map((f) => f.symbol));

    // 5. Execute strategy signals.
    const dailyBreached = risk.dailyLossBreached(account);
    for (const s of signals) {
      if (s.action === 'hold') continue;
      if (forcedSymbols.has(s.symbol)) continue; // already handled by a stop this tick

      if (s.action === 'close' || s.action === 'sell') {
        try {
          await broker.closePosition(s.symbol);
          recordSignal(s, strategy.name, true);
          log.info(`closed ${s.symbol}: ${s.reason}`);
          emitOrder(s.symbol, 'sell', 0, s.reason);
        } catch (err) {
          log.error(`close failed ${s.symbol}`, (err as Error).message);
        }
        continue;
      }

      // BUY
      if (dailyBreached) {
        recordSignal({ ...s, reason: `${s.reason} (blocked: daily loss guardrail)` }, strategy.name, false);
        continue;
      }
      const quote = engine.feed.getQuote(s.symbol);
      if (!quote) {
        log.warn(`no quote for ${s.symbol}, skipping buy`);
        continue;
      }

      // OPTIONS play: resolve a contract and buy_to_open (one contract = 100 shares).
      if (s.option) {
        try {
          const contract = await selectContract(broker, {
            underlying: s.symbol,
            type: s.option.type,
            spot: quote.price,
            moneyness: s.option.moneyness,
            expiration: s.option.expiration,
          });
          if (!contract) {
            recordSignal({ ...s, reason: `${s.reason} (no contract found)` }, strategy.name, false);
            continue;
          }
          const order = await broker.placeOrder({
            symbol: contract.symbol,
            side: 'buy',
            qty: 1,
            type: 'market',
            timeInForce: 'day',
          });
          recordSignal({ ...s, reason: `${s.reason} → ${contract.symbol}` }, strategy.name, true);
          store.recordOrder({
            id: order.id,
            ts: order.submittedAt,
            symbol: contract.symbol,
            side: 'buy',
            qty: order.qty,
            type: order.type,
            status: order.status,
            filled_avg_price: order.filledAvgPrice ?? null,
            reason: s.reason,
          });
          bus.emit('order', {
            ts: order.submittedAt,
            id: order.id,
            symbol: contract.symbol,
            side: 'buy',
            qty: order.qty,
            status: order.status,
          });
          log.info(`BUY 1 ${s.option.type} ${contract.symbol} — ${s.reason}`);
        } catch (err) {
          log.error(`option buy failed ${s.symbol}`, (err as Error).message);
        }
        continue;
      }

      const plan = risk.planEntry(s.symbol, quote.price, account);
      if (!plan) {
        recordSignal({ ...s, reason: `${s.reason} (skipped: position too small)` }, strategy.name, false);
        continue;
      }
      try {
        const order = await broker.placeOrder({
          symbol: s.symbol,
          side: 'buy',
          qty: plan.qty,
          type: 'market',
          timeInForce: s.symbol.includes('/') ? 'gtc' : 'day',
          bracket: risk.supportsBracket(s.symbol)
            ? { stopLossPrice: plan.stopLossPrice, takeProfitPrice: plan.takeProfitPrice }
            : undefined,
        });
        recordSignal(s, strategy.name, true);
        store.recordOrder({
          id: order.id,
          ts: order.submittedAt,
          symbol: order.symbol,
          side: order.side,
          qty: order.qty,
          type: order.type,
          status: order.status,
          filled_avg_price: order.filledAvgPrice ?? null,
          reason: s.reason,
        });
        bus.emit('order', {
          ts: order.submittedAt,
          id: order.id,
          symbol: order.symbol,
          side: order.side,
          qty: order.qty,
          status: order.status,
        });
        log.info(
          `BUY ${plan.qty} ${s.symbol} @ ~${quote.price} (stop ${plan.stopLossPrice}, target ${plan.takeProfitPrice}) — ${s.reason}`,
        );
      } catch (err) {
        log.error(`buy failed ${s.symbol}`, (err as Error).message);
      }
    }
  };

  function emitOrder(symbol: string, side: string, qty: number, reason: string) {
    const ts = new Date().toISOString();
    store.recordOrder({
      id: `close-${symbol}-${Date.now()}`,
      ts,
      symbol,
      side,
      qty,
      type: 'market',
      status: 'sent',
      filled_avg_price: null,
      reason,
    });
    bus.emit('order', { ts, id: `close-${symbol}`, symbol, side, qty, status: 'sent' });
  }
}
