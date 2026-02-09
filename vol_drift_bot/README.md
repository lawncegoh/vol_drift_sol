# Drift SOL-PERP Vol Burst Bot

Single-process TypeScript bot that runs the volatility burst + Donchian breakout strategy on Drift for the SOL-PERP market.

## Features

- Fetches SOLUSDT klines from Binance over HTTPS (no API key required) for 4h bars (and optional extra intervals via `BINANCE_INTERVALS`).
- Computes log returns, realized volatility, z-score, percentiles, quiet regime and burst checks, Donchian breakout direction, hold/ramp/cooldown logic, and target leverage/max notional sizing.
- CLI commands for inspecting on-chain collateral/positions, printing current signal, and trading toward desired target (respecting per-trade notional caps and hard DRY_RUN guard).
- Drift execution via `@drift-labs/sdk` using a single process that owns state, signal, and order flow.
- JSONL logging of every signal/state/trade decision at `logs/trades.jsonl`.

## Setup

1. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

2. Copy `.env.example` to `.env` and fill in values:

   ```bash
   cp .env.example .env
   ```

   | Variable | Description |
   | --- | --- |
   | `SOLANA_RPC_URL` | RPC endpoint with mainnet access |
   | `KEYPAIR_PATH` | Path to Drift wallet keypair JSON |
   | `DRIFT_ENV` | Drift env (`mainnet-beta`) |
   | `SUBACCOUNT_ID` | Sub-account to trade from |
   | `MAX_NOTIONAL_USDC` | Max USDC notional to size target and clamp per rebalance |
   | `MAX_LEVERAGE` | Cap on leverage ramp |
   | `DRY_RUN` | `true` to skip order submission |
   | `BINANCE_INTERVALS` | Comma list of Binance intervals (`4h,12h`) |

## Running Commands

All commands run through the dev script (TypeScript entry). Examples:

```bash
npm run dev -- state   # Prints Drift collateral + SOL-PERP base size
npm run dev -- signal  # Prints current volatility breakout signal + target
npm run dev -- trade   # Rebalances toward target (respects DRY_RUN)
```

- `signal` and `trade` fetch Binance data, evaluate the strategy, and log each evaluation.
- `trade` enforces `MAX_NOTIONAL_USDC` per rebalance, clamps trade deltas, and respects `DRY_RUN=true` by default.
- `state` connects to Drift and reports total/free collateral and SOL-PERP base exposure.

Logs are appended to `logs/trades.jsonl` so you can tail/pipe downstream.

## Strategy Highlights

- Rolling realized volatility (`rvWindow`) normalized to per-day, with z-score (`rvZWindow`) and percentile (`rvPctWindow`).
- Quiet regime requires the minimum RV percentile within `quietLookback` bars to be below `quietPct`.
- Burst trigger when either RV z-score or percentile crosses configured thresholds.
- Direction derived from Donchian breakout with buffer.
- Positions ramp toward `MAX_LEVERAGE` at `rampPerBar`, held `holdBars` bars, then cooled down for `cooldownBars`.
- Target position scaled from `MAX_NOTIONAL_USDC / price * targetLeverage` with per-trade clamps.

## Notes

- The bot currently runs in DRY_RUN mode by default. Flip `DRY_RUN=false` after validating feeds/env.
- Binance fetches are unauthenticated HTTPS calls; avoid exceeding rate limits if polling aggressively.
- The trading command requires your wallet to have a funded Drift account and SOL for fees.
- Extend `BINANCE_INTERVALS` to include `12h` or other horizons if you need supplemental analytics.
