# TradeWeave

A **personal, self-hosted, autonomous trading bot**. A local Node service runs
on your own machine as the brain *and* the execution engine — it watches the
market and autonomously manages positions (stop-losses, auto-buys, take-profits,
and options puts/calls), executing through Alpaca. A private Expo app (your
TestFlight only) provides monitoring and a kill switch.

For your own use. No SaaS, no accounts, no monetization. Everything runs locally
except outbound calls to Alpaca and (optionally) Anthropic.

See [`PLAN.md`](./PLAN.md) for the full design and [`GOING_LIVE.md`](./GOING_LIVE.md)
before trading real money.

## Layout

```
server/   Local Node + TypeScript service: market data, decision engine, risk,
          execution, SQLite audit log, and a live web dashboard + REST/WS API.
app/      React Native / Expo monitor (TestFlight) that connects over your LAN.
```

## Quick start (paper, safe defaults)

```bash
# 1. Server
cd server
npm install
cp .env.example .env          # add your Alpaca PAPER keys (runs without them on a mock broker)
npm run dev                   # dashboard at http://127.0.0.1:4000

# 2. App (optional, for your phone)
cd ../app
npm install
npx expo start                # set the server URL to your Mac's LAN IP in Settings
```

Defaults are safe: **paper trading**, **trading disabled** (observe-only). The
bot logs what it *would* do until you enable trading. To reach the dashboard
from your phone, start the server with `HOST=0.0.0.0 npm run dev`.

## How it works

```
market data → decision engine → risk checks → broker adapter → Alpaca
                  (technical | llm)   (sizing, stops, guardrails, kill switch)
        ↑                                                          │
        └──────────── fills / positions / signals ────────────────┘
                          stream to dashboard + app
```

- **Decision engine** (config `ENGINE_MODE`, switchable live):
  - `technical` — deterministic SMA-crossover + RSI; backtestable (`npm run backtest`).
  - `llm` — Claude (`claude-opus-4-8`) returns structured decisions over a
    grounded market snapshot. Requires `ANTHROPIC_API_KEY`; falls back to
    technical without one.
  - *(future)* trained ML model behind the same `Strategy` interface.
- **Risk manager** — equity-based position sizing, stop-loss/take-profit
  brackets, server-side stop enforcement (works for crypto too), and a
  daily-loss circuit breaker.
- **Assets** — stocks, ETFs, options (puts/calls, incl. multi-leg), and crypto,
  all via Alpaca behind a `BrokerAdapter` seam (so an IBKR adapter can drop in
  later).
- **Safety** — paper by default; a `CONFIRM_LIVE` interlock blocks real-money
  orders even when live keys are present; a kill switch and flatten-all are one
  tap away.

## Costs (Alpaca, mid-2026)

Commission-free stocks & options; free paper trading; free market data (IEX +
indicative options) or $99/mo for real-time SIP/OPRA. See `PLAN.md`.
