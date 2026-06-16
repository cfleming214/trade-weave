import { createBroker } from '../broker/index.js';
import type { Bar, Position } from '../broker/types.js';
import { config } from '../config.js';
import { TechnicalStrategy } from '../strategy/technical.js';

/**
 * Backtest harness. Replays historical bars for the watchlist through the
 * technical strategy, simulating entries/exits with the configured stop-loss
 * and take-profit, then prints per-symbol and aggregate performance.
 *
 * Run with: npm run backtest
 *
 * Note: the LLM strategy is intentionally not backtested here — it is
 * non-deterministic and would incur per-bar API costs. Backtesting is for the
 * deterministic technical strategy.
 */

interface Trade {
  symbol: string;
  entry: number;
  exit: number;
  pnlPct: number;
  reason: string;
}

const STARTING_EQUITY = 100_000;
const BARS_LIMIT = 500;

async function backtestSymbol(symbol: string, bars: Bar[], strategy: TechnicalStrategy): Promise<Trade[]> {
  const trades: Trade[] = [];
  let holding: { entry: number; qty: number } | null = null;
  const perSymbolBudget = STARTING_EQUITY * config.risk.maxPositionPct;

  for (let i = config.strategy.trend + 2; i < bars.length; i++) {
    const slice = bars.slice(0, i + 1);
    const price = bars[i]!.close;

    // Reflect current holding as a position for the strategy + stops.
    const positions: Position[] = holding
      ? [
          {
            symbol,
            assetClass: 'us_equity',
            qty: holding.qty,
            avgEntryPrice: holding.entry,
            currentPrice: price,
            marketValue: price * holding.qty,
            unrealizedPl: (price - holding.entry) * holding.qty,
            unrealizedPlPct: (price - holding.entry) / holding.entry,
            side: 'long',
          },
        ]
      : [];

    // Server-side stop/take-profit check first.
    if (holding) {
      const pct = (price - holding.entry) / holding.entry;
      if (pct <= -config.risk.stopLossPct || pct >= config.risk.takeProfitPct) {
        trades.push({
          symbol,
          entry: holding.entry,
          exit: price,
          pnlPct: pct,
          reason: pct < 0 ? 'stop-loss' : 'take-profit',
        });
        holding = null;
        continue;
      }
    }

    const ctx = {
      account: { equity: STARTING_EQUITY, cash: STARTING_EQUITY, buyingPower: STARTING_EQUITY, lastEquity: STARTING_EQUITY, currency: 'USD' as const, tradingBlocked: false },
      positions,
      bars: new Map([[symbol, slice]]),
      quotes: new Map([[symbol, { symbol, price, ts: bars[i]!.ts }]]),
      watchlist: [symbol],
    };

    // Position management (exit decisions) — mirrors the live pipeline.
    if (holding) {
      const reviews = (await strategy.reviewPositions?.(ctx)) ?? [];
      const close = reviews.find((r) => r.symbol === symbol && r.action === 'close');
      if (close) {
        trades.push({ symbol, entry: holding.entry, exit: price, pnlPct: (price - holding.entry) / holding.entry, reason: 'review' });
        holding = null;
        continue;
      }
    }

    // Entries.
    const signals = await strategy.evaluate(ctx);
    for (const s of signals) {
      if (s.action === 'buy' && !holding) {
        holding = { entry: price, qty: Math.max(1, Math.floor(perSymbolBudget / price)) };
      } else if ((s.action === 'close' || s.action === 'sell') && holding) {
        trades.push({ symbol, entry: holding.entry, exit: price, pnlPct: (price - holding.entry) / holding.entry, reason: 'signal' });
        holding = null;
      }
    }
  }

  // Mark-to-market any open position at the last bar.
  if (holding && bars.length) {
    const last = bars.at(-1)!.close;
    trades.push({ symbol, entry: holding.entry, exit: last, pnlPct: (last - holding.entry) / holding.entry, reason: 'open@end' });
  }
  return trades;
}

function summarize(label: string, trades: Trade[]) {
  if (!trades.length) {
    console.log(`${label}: no trades`);
    return;
  }
  const wins = trades.filter((t) => t.pnlPct > 0);
  const totalPct = trades.reduce((s, t) => s + t.pnlPct, 0);
  const winRate = (wins.length / trades.length) * 100;
  console.log(
    `${label}: ${trades.length} trades | win rate ${winRate.toFixed(1)}% | cumulative ${(totalPct * 100).toFixed(2)}% | avg ${((totalPct / trades.length) * 100).toFixed(2)}%/trade`,
  );
}

async function main() {
  const broker = createBroker();
  const strategy = new TechnicalStrategy();
  console.log(`\nBacktest — broker=${broker.name}, watchlist=${config.engine.watchlist.join(', ')}\n`);

  const all: Trade[] = [];
  for (const symbol of config.engine.watchlist) {
    const bars = await broker.getBars(symbol, '1Day', BARS_LIMIT);
    if (bars.length < 40) {
      console.log(`${symbol}: not enough bars (${bars.length}), skipping`);
      continue;
    }
    const trades = await backtestSymbol(symbol, bars, strategy);
    summarize(symbol.padEnd(10), trades);
    all.push(...trades);
  }

  console.log('');
  summarize('TOTAL'.padEnd(10), all);
  console.log('');
}

main().catch((err) => {
  console.error('Backtest failed:', err);
  process.exit(1);
});
