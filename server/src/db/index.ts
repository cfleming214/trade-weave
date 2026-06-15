import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('db');

const DB_PATH = resolve(process.cwd(), 'data', 'tradeweave.sqlite');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

/**
 * Local SQLite store. Holds the full audit trail: every signal the engine
 * produced, every order it placed, every fill, and periodic equity snapshots
 * used by the dashboard's performance charts.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    symbol TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    strategy TEXT,
    executed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL,
    type TEXT,
    status TEXT,
    filled_avg_price REAL,
    reason TEXT
  );

  CREATE TABLE IF NOT EXISTS equity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    equity REAL NOT NULL,
    cash REAL NOT NULL,
    unrealized_pl REAL
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    model TEXT,
    used_web_search INTEGER DEFAULT 0,
    text TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts);
  CREATE INDEX IF NOT EXISTS idx_orders_ts ON orders(ts);
  CREATE INDEX IF NOT EXISTS idx_equity_ts ON equity_snapshots(ts);
  CREATE INDEX IF NOT EXISTS idx_analyses_ts ON analyses(ts);
`);

log.info(`SQLite ready at ${DB_PATH}`);

// --- Prepared statements ---

const insertSignalStmt = db.prepare(
  `INSERT INTO signals (ts, symbol, action, reason, strategy, executed)
   VALUES (@ts, @symbol, @action, @reason, @strategy, @executed)`,
);
const insertOrderStmt = db.prepare(
  `INSERT OR REPLACE INTO orders (id, ts, symbol, side, qty, type, status, filled_avg_price, reason)
   VALUES (@id, @ts, @symbol, @side, @qty, @type, @status, @filled_avg_price, @reason)`,
);
const insertEquityStmt = db.prepare(
  `INSERT INTO equity_snapshots (ts, equity, cash, unrealized_pl)
   VALUES (@ts, @equity, @cash, @unrealized_pl)`,
);
const insertAnalysisStmt = db.prepare(
  `INSERT INTO analyses (ts, model, used_web_search, text)
   VALUES (@ts, @model, @used_web_search, @text)`,
);

export interface SignalRow {
  ts: string;
  symbol: string;
  action: string;
  reason: string | null;
  strategy: string | null;
  executed: number;
}

export const store = {
  recordSignal(s: Omit<SignalRow, 'executed'> & { executed?: boolean }) {
    insertSignalStmt.run({ ...s, executed: s.executed ? 1 : 0 });
  },
  recordOrder(o: {
    id: string;
    ts: string;
    symbol: string;
    side: string;
    qty: number;
    type: string;
    status: string;
    filled_avg_price: number | null;
    reason: string | null;
  }) {
    insertOrderStmt.run(o);
  },
  recordEquity(e: { ts: string; equity: number; cash: number; unrealized_pl: number }) {
    insertEquityStmt.run(e);
  },
  recentSignals(limit = 50): SignalRow[] {
    return db.prepare(`SELECT * FROM signals ORDER BY id DESC LIMIT ?`).all(limit) as SignalRow[];
  },
  recentOrders(limit = 50) {
    return db.prepare(`SELECT * FROM orders ORDER BY ts DESC LIMIT ?`).all(limit);
  },
  equityHistory(limit = 500) {
    return db
      .prepare(`SELECT ts, equity, cash, unrealized_pl FROM equity_snapshots ORDER BY id DESC LIMIT ?`)
      .all(limit)
      .reverse();
  },
  recordAnalysis(a: { ts: string; model: string; usedWebSearch: boolean; text: string }) {
    insertAnalysisStmt.run({ ts: a.ts, model: a.model, used_web_search: a.usedWebSearch ? 1 : 0, text: a.text });
  },
  latestAnalysis() {
    return db.prepare(`SELECT ts, model, used_web_search, text FROM analyses ORDER BY id DESC LIMIT 1`).get() ?? null;
  },
  recentAnalyses(limit = 10) {
    return db.prepare(`SELECT id, ts, model, used_web_search FROM analyses ORDER BY id DESC LIMIT ?`).all(limit);
  },
};
