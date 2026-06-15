# TradeWeave Server

The local Node service that is the brain + execution engine for TradeWeave. It
connects to Alpaca (paper by default), runs the decision engine, enforces risk
guardrails, and serves a live web dashboard.

## Setup

```bash
cd server
npm install
cp .env.example .env   # then fill in your Alpaca PAPER keys
npm run dev            # starts with hot reload
# or
npm start
```

Open the dashboard at **http://127.0.0.1:4000**.

> Runs fine with **no keys** — it falls back to an in-memory mock broker so you
> can see the dashboard and exercise the loop before connecting Alpaca.

## Safety posture

- `ALPACA_PAPER=true` and `TRADING_ENABLED=false` are the defaults. The bot
  observes and logs but places **no orders** until you explicitly enable
  trading (env or the dashboard).
- The **kill switch** (dashboard button / `POST /api/control/kill`) blocks all
  new orders immediately, regardless of any other setting.
- Going live (`ALPACA_PAPER=false`) trades **real money** — see the root
  `PLAN.md` Phase 5 before doing so.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/state` | engine + broker + account snapshot |
| GET | `/api/account` | live account + positions |
| GET | `/api/positions` | open positions |
| GET | `/api/signals` | recent strategy signals (audit log) |
| GET | `/api/orders` | recent orders |
| GET | `/api/equity` | equity snapshot history (for charts) |
| POST | `/api/control/start` \| `stop` | run/pause the engine loop |
| POST | `/api/control/trading` | `{ on: bool }` enable/disable order placement |
| POST | `/api/control/mode` | `{ mode: "technical" \| "llm" }` |
| POST | `/api/control/kill` | `{ on: bool }` kill switch |
| POST | `/api/control/flatten` | cancel orders + close all positions |
| WS | `/ws` | live stream of logs, quotes, signals, account updates |

## Layout

```
src/
  config.ts            validated env/config
  bus.ts               process-wide event bus
  logger.ts            structured logger (mirrors to dashboard)
  state.ts             engine state + kill switch
  broker/              BrokerAdapter interface, Alpaca + mock adapters
  marketdata/          quote feed
  engine/runtime.ts    the trading loop (strategy hook filled in Phase 2)
  server/http.ts       HTTP + WebSocket + REST API
public/index.html      web dashboard (no build step)
```
