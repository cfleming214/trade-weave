# Going Live

Switching TradeWeave from paper to real money. Read this fully before risking
any capital. **Autonomous trading with real money is high-risk** — the bot can
and will place orders without asking you.

## Prerequisites

1. **Validate in paper first.** Run for a meaningful period on Alpaca paper
   (`ALPACA_PAPER=true`) and review the audit log (`/api/signals`, `/api/orders`)
   and equity curve. Backtest the technical strategy (`npm run backtest`).
2. **Get live Alpaca keys** from <https://app.alpaca.markets/> and, for options,
   complete the live options-trading approval (paper auto-approves Level 3; live
   requires an application).
3. **Decide on data.** The free options feed is *indicative*. For timing-
   sensitive live options, subscribe to Algo Trader Plus ($99/mo) for real-time
   SIP/OPRA data before going live.

## The safety interlock

Live trading is gated by **two** independent switches, so it can't happen by
accident:

| Setting | Paper default | Required for live |
| --- | --- | --- |
| `ALPACA_PAPER` | `true` | set to `false` |
| `CONFIRM_LIVE` | `false` | set to `true` |
| `TRADING_ENABLED` | `false` | `true` (or enable in the app) |

If `ALPACA_PAPER=false` but `CONFIRM_LIVE` is not `true`, the bot connects to
the live account for **read-only** monitoring and **refuses to place orders** —
you'll see `real-money orders are BLOCKED` in the log. Only when all three align
does `canTrade()` return true.

## Go-live checklist

1. Put **live** keys in `server/.env`, set `ALPACA_PAPER=false`.
2. Keep `CONFIRM_LIVE=false` for a first read-only run — confirm the dashboard
   shows your real account equity and positions correctly.
3. Tighten risk in `.env` for first live use, e.g.:
   ```
   MAX_POSITION_PCT=0.02      # 2% of equity per position
   MAX_DAILY_LOSS_PCT=0.02    # halt new entries after 2% daily loss
   STOP_LOSS_PCT=0.03
   WATCHLIST=SPY              # start with one liquid symbol
   ```
4. Set `CONFIRM_LIVE=true` and `TRADING_ENABLED=true`, restart, and **watch it**.
5. Keep the **kill switch** one tap away (dashboard or app). It blocks all new
   orders instantly; **Flatten all** cancels orders and closes every position.

## If something looks wrong

- **Kill switch** → no new orders (positions stay open).
- **Flatten all** → close everything now.
- Stop the process (`Ctrl-C`) → the loop halts; open positions remain at the
  broker and any native bracket stops stay live on Alpaca's side.

## Reminders

- This is for personal use with your own capital. Understand the suitability and
  regulatory implications of automated options trading before going live.
- The bot is only as good as its strategy. Paper results do not guarantee live
  results (slippage, fills, fees, and real liquidity differ).
