import 'dotenv/config';
import { z } from 'zod';

/**
 * Centralised, validated configuration. Everything the bot needs to run is
 * read once here so the rest of the code can depend on a typed object rather
 * than poking at process.env. Secrets stay in a local .env file (gitignored).
 */

const boolish = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v.toLowerCase() === 'true'));

const numeric = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  ALPACA_KEY_ID: z.string().optional().default(''),
  ALPACA_SECRET_KEY: z.string().optional().default(''),
  ALPACA_PAPER: boolish(true),
  // Hard safety interlock: live (real-money) trading is refused unless this is
  // explicitly set to true, even if ALPACA_PAPER=false and TRADING_ENABLED=true.
  CONFIRM_LIVE: boolish(false),

  ANTHROPIC_API_KEY: z.string().optional().default(''),
  // Let the on-demand advisor use Claude's web search to ground its week-ahead
  // view in current prices/news. Falls back to data-only analysis if disabled
  // or unavailable.
  ANALYSIS_WEB_SEARCH: boolish(true),

  ENGINE_MODE: z.enum(['technical', 'llm']).optional().default('technical'),
  TRADING_ENABLED: boolish(false),
  WATCHLIST: z
    .string()
    .optional()
    .default('AAPL,MSFT,SPY,BTC/USD')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  LOOP_INTERVAL_SECONDS: numeric(60),

  MAX_POSITION_PCT: numeric(0.1),
  STOP_LOSS_PCT: numeric(0.05),
  TAKE_PROFIT_PCT: numeric(0.1),
  MAX_DAILY_LOSS_PCT: numeric(0.03),

  // --- Technical strategy tuning ---
  STRATEGY_TIMEFRAME: z.string().optional().default('1Min'),
  STRATEGY_FAST: numeric(10),
  STRATEGY_SLOW: numeric(30),
  STRATEGY_TREND: numeric(50),
  STRATEGY_RSI_PERIOD: numeric(14),
  // Entry veto: skip a crossover entry if RSI is already this hot. A crossover
  // is a lagging momentum signal (RSI is typically ~70 at the cross), so this
  // is deliberately lenient — a tighter cap blocks essentially all entries.
  STRATEGY_RSI_OVERBOUGHT: numeric(80),
  // Anti-whipsaw: minimum bars to hold before a crossover exit, bars to wait
  // before re-entering a symbol after an exit, and a hysteresis band (fraction)
  // the fast MA must clear the slow MA by for a crossover to count.
  STRATEGY_MIN_HOLD_BARS: numeric(5),
  STRATEGY_REENTRY_BARS: numeric(5),
  STRATEGY_BAND: numeric(0.001),
  // Optional extra filter: only take longs when the slow MA is rising. Off by
  // default — the crossover is already the trend signal, and this laggy filter
  // tends to veto the single entry at the very start of a trend.
  STRATEGY_TREND_FILTER: boolish(false),

  PORT: numeric(4000),
  HOST: z.string().optional().default('127.0.0.1'),
});

const parsed = schema.parse(process.env);

export const config = {
  alpaca: {
    keyId: parsed.ALPACA_KEY_ID,
    secretKey: parsed.ALPACA_SECRET_KEY,
    paper: parsed.ALPACA_PAPER,
    confirmLive: parsed.CONFIRM_LIVE,
    /** True only when real API keys are present. */
    get configured(): boolean {
      return Boolean(parsed.ALPACA_KEY_ID && parsed.ALPACA_SECRET_KEY);
    },
    /**
     * True only when live trading is fully authorized: not paper AND the
     * operator explicitly set CONFIRM_LIVE=true. The engine refuses to place
     * real-money orders otherwise.
     */
    get liveAuthorized(): boolean {
      return !parsed.ALPACA_PAPER && parsed.CONFIRM_LIVE;
    },
  },
  anthropic: {
    apiKey: parsed.ANTHROPIC_API_KEY,
    analysisWebSearch: parsed.ANALYSIS_WEB_SEARCH,
    get configured(): boolean {
      return Boolean(parsed.ANTHROPIC_API_KEY);
    },
  },
  engine: {
    mode: parsed.ENGINE_MODE,
    tradingEnabled: parsed.TRADING_ENABLED,
    watchlist: parsed.WATCHLIST,
    loopIntervalSeconds: parsed.LOOP_INTERVAL_SECONDS,
  },
  risk: {
    maxPositionPct: parsed.MAX_POSITION_PCT,
    stopLossPct: parsed.STOP_LOSS_PCT,
    takeProfitPct: parsed.TAKE_PROFIT_PCT,
    maxDailyLossPct: parsed.MAX_DAILY_LOSS_PCT,
  },
  strategy: {
    timeframe: parsed.STRATEGY_TIMEFRAME,
    fast: parsed.STRATEGY_FAST,
    slow: parsed.STRATEGY_SLOW,
    trend: parsed.STRATEGY_TREND,
    rsiPeriod: parsed.STRATEGY_RSI_PERIOD,
    rsiOverbought: parsed.STRATEGY_RSI_OVERBOUGHT,
    minHoldBars: parsed.STRATEGY_MIN_HOLD_BARS,
    reentryBars: parsed.STRATEGY_REENTRY_BARS,
    band: parsed.STRATEGY_BAND,
    trendFilter: parsed.STRATEGY_TREND_FILTER,
  },
  server: {
    port: parsed.PORT,
    host: parsed.HOST,
  },
} as const;

export type Config = typeof config;
