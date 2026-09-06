# Crypto Trading Analysis Bot

An AI-assisted cryptocurrency **analysis and signal-generation** system.
It scans the market, identifies the highest-volume/liquidity coins, runs
multi-timeframe technical analysis, and surfaces high-probability spot
trade setups with explicit entry, stop-loss, take-profit and risk/reward —
or **NO TRADE** when nothing qualifies.

This is not an automated trading bot. It never places orders. See
[Safety rules](#safety-rules) below.

## How it works

```
Market Data Service   -> live prices/volume/OHLCV from CoinGecko's public API
Coin Ranking Engine    -> selects the daily Top 10 by volume/liquidity/volatility
Technical Analysis     -> EMA/RSI/MACD/ATR/Bollinger/VWAP across 5 timeframes
Market Regime Engine   -> trend classification per coin + BTC-led market context
Signal Detection       -> breakout / pullback / support bounce / VWAP reclaim / etc.
Risk Management        -> stop-loss, take-profit, position size from account risk %
Trade Scoring          -> 0-100 confidence score across 8 weighted factors
AI Analysis Layer      -> plain-language rationale, probability framing only
Dashboard / API        -> FastAPI + a static dashboard
Scheduler              -> re-scans automatically on an interval
```

Source layout:

```
server/
  app/
    config.py       # all thresholds/limits, env-overridable, no hard-coded coins
    market_data.py  # CoinGecko client (swappable provider interface)
    ranking.py      # Top-N coin selection
    indicators.py   # TA calculations (pure functions, unit-testable)
    regime.py       # trend classification + market-wide context
    signals.py      # entry/setup detection
    risk.py         # SL/TP + position sizing
    scoring.py      # 0-100 confidence scoring
    scanner.py       # orchestrates one full scan + AI explanation layer
    backtest.py     # historical strategy testing (win rate, drawdown, Sharpe, ...)
    monitor.py      # live trade-status monitoring (WAITING -> ... -> TAKE_PROFIT)
    reports.py      # formats a scan into the human-readable daily report
    main.py         # FastAPI app, scheduler, REST endpoints
  dashboard/
    index.html      # static dashboard (fetches the API directly)
```

## Running locally

```bash
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # optional — defaults work with no API key
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000` for the dashboard, or use the API directly:

```bash
curl -X POST http://localhost:8000/api/scan          # run a scan now
curl http://localhost:8000/api/scan/latest            # last scan result (JSON)
curl http://localhost:8000/api/scan/latest/report      # human-readable report
curl http://localhost:8000/api/backtest/bitcoin?timeframe=1h
```

## Safety rules

- Uses **real, live market data** only — no invented prices or fabricated
  API responses. Every result carries a `fetched_at` timestamp.
- **Spot only, no leverage** by default (`DEFAULT_LEVERAGE = 1`).
- **`EXECUTION_ENABLED`** defaults to `false` and is not wired to any broker
  or exchange order API in this codebase — it exists solely as a documented
  switch for a future, separately-audited execution module.
- `NO TRADE` is a valid, expected daily outcome. The system never forces a
  signal to hit a daily quota.
- Every returned trade setup has an entry, stop-loss, take-profit, and
  risk/reward ratio — a setup that can't produce all four is discarded.
- Language is probability-framed ("this setup has a strong bullish
  configuration...") — never a guarantee of profit.

## Configuration

All thresholds (volume floors, risk %, scoring weights, scan interval, the
market-data provider URL) are set in `server/app/config.py` and overridable
via environment variables — see `server/.env.example`. No cryptocurrency is
ever hard-coded; the Top 10 list is recomputed from live data on every scan.

## Backtesting

`server/app/backtest.py` replays the exact same signal-detection and
risk-management logic the live scanner uses over historical OHLCV data, and
reports win rate, average win/loss, profit factor, max drawdown, Sharpe
ratio, and max consecutive losses — not just win rate — so a strategy with a
high win rate but poor drawdown is visibly penalized.
