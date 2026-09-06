"""FastAPI application: dashboard/API layer + scheduler.

Analysis and signal generation only — this system never places an order.
`EXECUTION_ENABLED` exists purely as a documented, explicit off switch for a
future separate execution module; it is not wired to any broker here.
"""
from __future__ import annotations

import logging

from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config
from .backtest import run_backtest
from .market_data import MarketDataError, MarketDataProvider
from .monitor import trade_monitor
from .reports import format_daily_report
from .scanner import run_daily_scan

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crypto_bot")

app = FastAPI(title="Crypto Trading Analysis Bot", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_state = {"latest_scan": None}
scheduler = AsyncIOScheduler()


@app.on_event("startup")
async def startup():
    async def scheduled_scan():
        try:
            _state["latest_scan"] = await run_daily_scan()
            logger.info("Scheduled scan complete: %d opportunities", len(_state["latest_scan"]["opportunities"]))
        except MarketDataError as exc:
            logger.error("Scheduled scan failed: %s", exc)

    scheduler.add_job(scheduled_scan, "interval", minutes=config.SCAN_INTERVAL_MINUTES, id="daily_scan")
    scheduler.start()


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown(wait=False)


@app.get("/api/health")
async def health():
    return {"status": "ok", "execution_enabled": config.EXECUTION_ENABLED}


@app.post("/api/scan")
async def trigger_scan(account_balance: float | None = None):
    try:
        scan = await run_daily_scan(account_balance)
    except MarketDataError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    _state["latest_scan"] = scan
    for op in scan["opportunities"]:
        trade_monitor.track(op["symbol"], "long" if op["signal"] == "BUY" else "short", op["entry"], op["stop_loss"], op["take_profit_1"], op["take_profit_2"])
    return scan


@app.get("/api/scan/latest")
async def latest_scan():
    if _state["latest_scan"] is None:
        return {"message": "No scan has run yet. POST /api/scan to run one."}
    return _state["latest_scan"]


@app.get("/api/scan/latest/report", response_class=None)
async def latest_report():
    if _state["latest_scan"] is None:
        raise HTTPException(status_code=404, detail="No scan has run yet.")
    return {"report": format_daily_report(_state["latest_scan"])}


@app.get("/api/monitor")
async def monitor_status():
    return [t.__dict__ for t in trade_monitor.all()]


@app.post("/api/monitor/tick")
async def monitor_tick():
    """Refresh monitored trades against current live prices."""
    provider = MarketDataProvider()
    symbols = {t.symbol for t in trade_monitor.active()}
    if not symbols:
        return {"updated": 0}
    snapshots = await provider.get_market_snapshot(config.CANDIDATE_POOL_SIZE)
    price_by_symbol = {s.symbol: s.price for s in snapshots}
    updated = 0
    for symbol in symbols:
        if symbol in price_by_symbol:
            trade_monitor.update_price(symbol, price_by_symbol[symbol])
            updated += 1
    return {"updated": updated}


@app.get("/api/backtest/{coin_id}")
async def backtest_coin(coin_id: str, timeframe: str = "1h"):
    provider = MarketDataProvider()
    try:
        df = await provider.get_ohlc(coin_id, timeframe)
    except MarketDataError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    report = run_backtest(df)
    return {"coin_id": coin_id, "timeframe": timeframe, **report.summary()}


_dashboard_dir = Path(__file__).resolve().parent.parent / "dashboard"
if _dashboard_dir.exists():
    app.mount("/", StaticFiles(directory=str(_dashboard_dir), html=True), name="dashboard")
