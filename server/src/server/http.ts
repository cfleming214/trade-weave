import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { runAnalysis } from '../advisor/analyze.js';
import { bus } from '../bus.js';
import { config } from '../config.js';
import { store } from '../db/index.js';
import { createLogger } from '../logger.js';
import { engineState } from '../state.js';
import type { TradingEngine } from '../engine/runtime.js';

const log = createLogger('http');
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '../../public');

/**
 * Local HTTP + WebSocket server. Serves the web dashboard, a small REST API
 * the dashboard / Expo app read for current state, control endpoints (start,
 * stop, kill-switch, mode, paper/live toggle), and a WebSocket that streams
 * every bus event live to connected clients.
 */
export function startServer(engine: TradingEngine) {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  // --- Read API ---
  app.get('/api/state', (_req, res) => {
    res.json({
      engine: engineState.snapshot(),
      broker: {
        name: engine.broker.name,
        paper: engine.broker.paper,
        liveAuthorized: config.alpaca.liveAuthorized,
      },
      account: engineState.lastAccount,
      watchlist: config.engine.watchlist,
    });
  });

  app.get('/api/account', async (_req, res) => {
    try {
      const account = await engine.broker.getAccount();
      const positions = await engine.broker.getPositions();
      res.json({ account, positions });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.get('/api/positions', async (_req, res) => {
    try {
      res.json(await engine.broker.getPositions());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Portfolio: every holding enriched with live price, daily change, P&L, and a
  // price-history series for the graph — plus the recent trade history.
  app.get('/api/portfolio', async (_req, res) => {
    try {
      const positions = await engine.broker.getPositions();
      const enriched = await Promise.all(
        positions.map(async (p) => {
          const bars = await engine.broker.getBars(p.symbol, '1Day', 60).catch(() => []);
          const closes = bars.map((b) => b.close);
          const prevClose = closes.at(-2) ?? closes.at(-1) ?? p.currentPrice;
          const change = Number((p.currentPrice - prevClose).toFixed(2));
          const changePct = prevClose ? Number(((change / prevClose) * 100).toFixed(2)) : 0;
          const review = engineState.lastReviews[p.symbol] ?? null;
          return { ...p, change, changePct, review, history: bars.map((b) => ({ ts: b.ts, close: b.close })) };
        }),
      );
      res.json({ positions: enriched, orders: store.recentOrders(50) });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.get('/api/signals', (req, res) => {
    res.json(store.recentSignals(Number(req.query.limit ?? 50)));
  });
  app.get('/api/orders', (req, res) => {
    res.json(store.recentOrders(Number(req.query.limit ?? 50)));
  });
  app.get('/api/equity', (req, res) => {
    res.json(store.equityHistory(Number(req.query.limit ?? 500)));
  });

  // --- On-demand Claude analysis (advisory only, never trades) ---
  let analysisRunning = false;
  app.get('/api/analysis/latest', (_req, res) => {
    res.json({ analysis: store.latestAnalysis(), history: store.recentAnalyses(10) });
  });
  app.post('/api/analysis', async (_req, res) => {
    if (analysisRunning) return res.status(409).json({ error: 'An analysis is already running.' });
    if (!config.anthropic.configured) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set — add it to server/.env.' });
    }
    analysisRunning = true;
    log.info('on-demand Claude analysis requested');
    try {
      const result = await runAnalysis(engine.broker, config.engine.watchlist);
      store.recordAnalysis(result);
      res.json({ analysis: result });
    } catch (err) {
      log.error('analysis failed', (err as Error).message);
      res.status(502).json({ error: (err as Error).message });
    } finally {
      analysisRunning = false;
    }
  });

  // --- Control API ---
  app.post('/api/control/start', (_req, res) => {
    engine.start();
    res.json(engineState.snapshot());
  });
  app.post('/api/control/stop', (_req, res) => {
    engine.stop();
    res.json(engineState.snapshot());
  });
  app.post('/api/control/kill', (req, res) => {
    const on = req.body?.on ?? true;
    engineState.setKillSwitch(Boolean(on));
    if (on) log.warn('KILL SWITCH ENGAGED — no new orders will be placed');
    res.json(engineState.snapshot());
  });
  app.post('/api/control/trading', (req, res) => {
    engineState.setTradingEnabled(Boolean(req.body?.on));
    res.json(engineState.snapshot());
  });
  app.post('/api/control/mode', (req, res) => {
    const mode = req.body?.mode;
    if (mode !== 'technical' && mode !== 'llm') {
      return res.status(400).json({ error: 'mode must be "technical" or "llm"' });
    }
    engineState.setMode(mode);
    res.json(engineState.snapshot());
  });

  // Adjust the daily-loss guardrail at runtime. Accepts an absolute fraction
  // (`maxDailyLossPct`) or a relative nudge (`delta`, e.g. +0.01 = +1pt).
  app.post('/api/control/daily-loss', (req, res) => {
    const current = engineState.maxDailyLossPct;
    const next =
      typeof req.body?.maxDailyLossPct === 'number'
        ? req.body.maxDailyLossPct
        : typeof req.body?.delta === 'number'
          ? current + req.body.delta
          : NaN;
    if (!Number.isFinite(next)) {
      return res.status(400).json({ error: 'provide a numeric maxDailyLossPct or delta' });
    }
    engineState.setMaxDailyLossPct(next);
    log.info(`daily-loss guardrail set to ${(engineState.maxDailyLossPct * 100).toFixed(2)}%`);
    res.json(engineState.snapshot());
  });

  app.post('/api/control/flatten', async (_req, res) => {
    try {
      await engine.broker.cancelAllOrders();
      await engine.broker.closeAllPositions();
      log.warn('Flatten requested — cancelled orders and closed all positions');
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  const httpServer = createServer(app);

  // --- WebSocket live stream ---
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (ws) => {
    log.info('dashboard client connected');
    ws.send(JSON.stringify({ type: 'engine-state', payload: engineState.snapshot() }));
    if (engineState.lastAccount) {
      ws.send(JSON.stringify({ type: 'account-update', payload: engineState.lastAccount }));
    }
  });

  const relay = (type: string) => (payload: unknown) => {
    const msg = JSON.stringify({ type, payload });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };
  bus.on('log', relay('log'));
  bus.on('quote', relay('quote'));
  bus.on('signal', relay('signal'));
  bus.on('order', relay('order'));
  bus.on('fill', relay('fill'));
  bus.on('account-update', relay('account-update'));
  bus.on('engine-state', relay('engine-state'));

  httpServer.listen(config.server.port, config.server.host, () => {
    log.info(`Dashboard + API at http://${config.server.host}:${config.server.port}`);
  });

  return httpServer;
}
