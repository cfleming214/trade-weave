# TradeWeave

## Overview

TradeWeave is a **personal, self-hosted trading bot** — for the author's own use, not a commercial product. A local Node service runs on your own machine as both the brain and the execution engine: it watches the market and autonomously manages positions (stop-losses, auto-buys, take-profits, and options puts/calls), executing through Alpaca. A private React Native / Expo app, distributed to yourself via TestFlight, provides monitoring and a kill-switch.

Everything runs locally except unavoidable outbound calls to Alpaca's market-data and trading APIs. There is no SaaS, no user tiers, no marketplace, and no monetization.

## Architecture (local-first)

- **`server/` — local Node service (the core).** An always-on process on your machine. Responsibilities: market-data ingestion, the decision engine, risk/position management, order execution, local persistence, and a local API/WebSocket the app connects to.
- **`app/` — React Native + Expo monitor (personal, TestFlight).** A read-only dashboard and status view that talks to the local server over your LAN via WebSocket. Includes a kill-switch.
- **Broker-adapter layer.** A single `BrokerAdapter` interface implemented by `AlpacaAdapter` now, leaving room for an `IBKRAdapter` later without touching strategy code.

**Data flow:** market data → strategy engine → risk checks → broker adapter → Alpaca; fills and position updates stream back to the app.

## Tech Stack

- **Server:** Node.js + TypeScript, Express + WebSocket (`ws`), and a scheduler loop driving the trading cadence.
- **Broker / data:** Alpaca Trading API + Market Data API (REST + WebSocket), via `@alpacahq/alpaca-trade-api` (or direct REST) behind the adapter.
- **Decision engine:** pluggable strategy modules — `technical` (indicator library such as `technicalindicators`) and `llm` (Claude via the Anthropic SDK, latest model). The active mode is chosen via config.
- **Persistence:** local SQLite (e.g. `better-sqlite3`) for positions, orders, signals, and the audit log. No cloud database.
- **Config / secrets:** local `.env` for Alpaca and Anthropic API keys; `config.json`/env for engine mode, asset universe, risk parameters, and the paper-vs-live toggle.
- **App:** React Native + Expo with minimal state (Context or a lightweight store — Redux optional, not required for a monitor).

**Dropped from the earlier concept:** Binance/Coinbase, FastAPI, monetization tiers, the strategy marketplace, and push-as-a-product. (Local push/notifications are kept as a personal convenience.)

## Features

1. **Autonomous execution** — stop-losses, take-profits, auto-buys, and options (puts/calls) executed without prompting. Paper mode is the default until you deliberately switch to live.
2. **Pluggable decision engine** — a `mode` setting selects `technical` or `llm`; the same interface leaves room to add `ml` later.
3. **Multi-asset** — stocks, ETFs, options, and crypto, all through Alpaca (one broker covers all four).
4. **Risk management** — automated stop-loss / take-profit / position sizing based on account equity, plus global guardrails (max position size, max daily loss, kill-switch).
5. **Backtesting** — replay strategies against Alpaca historical data before enabling them live.
6. **Local monitoring app** — live P&L, open positions, recent orders/signals, engine status, and a kill-switch.
7. **Audit log** — every decision and order persisted locally for later review.

## Decision Engine Modes

The engine is selected by config. All modes implement a common `Strategy` interface so they are interchangeable.

- **(1) Technical rules — build now.** Deterministic indicators (RSI, moving averages, etc.) plus threshold rules for entries, exits, and stops. Fully backtestable and easy to reason about.
- **(2) LLM-driven / Claude — build now.** Market context is fed to Claude, which returns a *structured* trade proposal; the proposal is validated against the risk rules before any execution. Non-deterministic, so it stays gated behind paper mode and the risk guardrails.
- **(3) Trained ML model — FUTURE SCOPE, not built yet.** A TensorFlow/Python model trained on historical data, plugged in behind the same `Strategy` interface. Requires a data pipeline and rigorous validation before it can be trusted; tracked as a roadmap item only.

## Key Screens (personal monitoring)

- **Dashboard** — portfolio value, daily/total P&L, current engine mode, on/off state, and kill-switch.
- **Positions** — open positions including options legs, with entry/exit and unrealized P&L.
- **Activity** — recent orders, fills, and the decision/audit log.
- **Settings** — engine mode, asset universe, risk parameters, and the paper/live toggle.

## Roadmap

### Phase 1 — Foundations
- Node service skeleton, config/secrets handling, SQLite persistence.
- `BrokerAdapter` interface + `AlpacaAdapter`; connect to Alpaca **paper** trading.
- Market-data ingestion (REST + WebSocket).

### Phase 2 — Engine + risk
- `Strategy` interface and the technical-rules strategy.
- Risk manager: stops, position sizing, guardrails, kill-switch.
- Autonomous execution loop running in paper mode.

### Phase 3 — Options + LLM mode
- Options (puts/calls) support, including Level-3 multi-leg.
- LLM-driven strategy (Claude) behind the `Strategy` interface.
- Backtesting harness against historical data.

### Phase 4 — App
- Expo monitor app talking to the local server over WebSocket.
- TestFlight build for personal use.

### Phase 5 — Go live (deliberate)
- Switch to live API keys, start with small size, monitor closely.
- Optionally subscribe to Algo Trader Plus ($99/mo) if real-time SIP/OPRA data is needed.

### Future
- Trained-ML strategy mode (see Decision Engine Modes #3).
- Optional `IBKRAdapter` for deeper options/futures/global markets.

## Costs (Alpaca, verified mid-2026)

| Item | Cost |
|---|---|
| Stock & options commissions | **$0** (only pass-through regulatory fees) |
| Paper trading | **Free** — Level-3 multi-leg options auto-approved in paper |
| Market data — Basic | **Free**: real-time stocks via IEX feed, *indicative* options pricing |
| Market data — Algo Trader Plus | **$99/mo**: full SIP feed + real-time OPRA options quotes |
| Live options trading | One-time approval application (no fee) |

**Note:** the free options data is *indicative*, not full real-time OPRA quotes. For timing-sensitive live options, plan to upgrade to the $99/mo tier before going live; paper and early development run fine on the free tier.

## Risks & Notes

- **Fully autonomous trading with real money is high-risk.** Paper-first development, hard risk guardrails (max position size, max daily loss), and a working kill-switch are mandatory before any live capital.
- This is for personal use with your own capital; understand the suitability and regulatory implications of automated options trading before going live.
