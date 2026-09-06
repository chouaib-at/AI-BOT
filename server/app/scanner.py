"""Orchestrates one full daily scan: market data -> ranking -> technical
analysis -> regime -> signals -> risk -> scoring -> report, tying every
module together. Also contains the lightweight "AI Analysis Layer" that
turns the structured findings into a plain-language explanation using
probability-style language rather than guarantees.
"""
from __future__ import annotations

import logging
import time

from . import config, indicators, ranking, risk, scoring
from .market_data import MarketDataError, MarketDataProvider
from .regime import classify_trend, market_context, multi_timeframe_trend
from .signals import Setup, build_trade_setup, detect_setup

logger = logging.getLogger("crypto_bot.scanner")

PRIMARY_TIMEFRAME = "1h"
CONFIRMATION_TIMEFRAMES = ["15m", "4h", "1d"]


def explain(coin_symbol: str, setup: Setup, score: dict, levels: risk.TradeLevels) -> str:
    """AI Analysis Layer: plain-language rationale using probability
    framing, never a guaranteed-outcome claim."""
    tier_phrase = {
        "strong": "a strong, well-confirmed configuration",
        "good": "a good configuration with reasonable confirmation",
        "watchlist": "an early-stage configuration that needs more confirmation",
    }.get(score["tier"], "a configuration that does not yet meet the bar for a trade")

    reasons = "; ".join(setup.reasons)
    return (
        f"{coin_symbol}: based on current conditions this is {tier_phrase} "
        f"({setup.name}, score {score['total']}/100). Confirming factors: {reasons}. "
        f"If the setup plays out favorably, price could move toward the take-profit zone "
        f"(+{levels.reward_pct_1}% to +{levels.reward_pct_2}%), with risk capped near "
        f"-{levels.risk_pct}% at the stop-loss. This is a probability-weighted estimate, "
        f"not a prediction of guaranteed profit."
    )


async def analyze_coin(provider: MarketDataProvider, coin) -> dict:
    """Run full multi-timeframe technical analysis + signal detection for
    a single coin. Returns a structured result including NO TRADE cases."""
    per_timeframe_latest = {}
    for tf in config.TIMEFRAMES:
        try:
            df = await provider.get_ohlc(coin.id, tf)
            per_timeframe_latest[tf] = indicators.compute_all(df)
        except (MarketDataError, ValueError) as exc:
            logger.warning("Skipping %s timeframe for %s: %s", tf, coin.symbol, exc)

    if PRIMARY_TIMEFRAME not in per_timeframe_latest:
        return {"symbol": coin.symbol, "status": "NO_TRADE", "reason": "Insufficient OHLC data on primary timeframe"}

    mtf = multi_timeframe_trend(per_timeframe_latest)
    primary_latest = per_timeframe_latest[PRIMARY_TIMEFRAME]

    setup = detect_setup(primary_latest, mtf["overall"])
    if setup is None:
        return {
            "symbol": coin.symbol,
            "status": "NO_TRADE",
            "reason": "No qualifying setup on primary timeframe",
            "trend": classify_trend(primary_latest)["label"],
        }

    levels = build_trade_setup(setup)
    if not levels.meets_min_rr:
        return {
            "symbol": coin.symbol,
            "status": "NO_TRADE",
            "reason": f"Risk/reward {levels.risk_reward}:1 below minimum {config.MIN_RISK_REWARD}:1",
        }

    score = scoring.score_opportunity(primary_latest, mtf["agreement"], setup, levels, coin.volume_24h)
    if score["tier"] == "no_trade":
        return {"symbol": coin.symbol, "status": "NO_TRADE", "reason": f"Score {score['total']}/100 below watchlist threshold"}

    position = risk.position_size(config.DEFAULT_ACCOUNT_BALANCE, levels)

    return {
        "symbol": coin.symbol,
        "coin_id": coin.id,
        "name": coin.name,
        "status": "WATCHLIST" if score["tier"] == "watchlist" else "SIGNAL",
        "signal": "BUY" if setup.direction == "long" else "SELL",
        "setup": setup.name,
        "reasons": setup.reasons,
        "entry": levels.entry,
        "stop_loss": levels.stop_loss,
        "take_profit_1": levels.take_profit_1,
        "take_profit_2": levels.take_profit_2,
        "expected_move_pct": [levels.reward_pct_1, levels.reward_pct_2],
        "risk_pct": levels.risk_pct,
        "risk_reward": levels.risk_reward,
        "confidence_score": score["total"],
        "score_breakdown": score["breakdown"],
        "position_size": position,
        "trend": mtf["overall"],
        "explanation": explain(coin.symbol, setup, score, levels),
        "current_price": coin.price,
        "volume_24h": coin.volume_24h,
        "fetched_at": coin.fetched_at,
    }


async def run_daily_scan(account_balance: float | None = None) -> dict:
    provider = MarketDataProvider()
    started = time.time()

    snapshots = await provider.get_market_snapshot(config.CANDIDATE_POOL_SIZE)
    top_coins = ranking.select_top_coins(snapshots)

    btc = next((c for c in snapshots if c.symbol == "BTC"), None)
    market_regime = {"btc_trend": "unknown", "risk_mode": "unknown"}
    if btc:
        btc_tfs = {}
        for tf in config.TIMEFRAMES:
            try:
                df = await provider.get_ohlc(btc.id, tf)
                btc_tfs[tf] = indicators.compute_all(df)
            except (MarketDataError, ValueError):
                continue
        if btc_tfs:
            market_regime = market_context(btc_tfs)

    results = []
    for coin in top_coins:
        try:
            results.append(await analyze_coin(provider, coin))
        except Exception as exc:  # noqa: BLE001 - log and continue scanning other coins
            logger.exception("Analysis failed for %s", coin.symbol)
            results.append({"symbol": coin.symbol, "status": "NO_TRADE", "reason": f"Analysis error: {exc}"})

    signals = [r for r in results if r["status"] == "SIGNAL"]
    watchlist = [r for r in results if r["status"] == "WATCHLIST"]
    no_trade = [r for r in results if r["status"] == "NO_TRADE"]
    signals.sort(key=lambda r: r["confidence_score"], reverse=True)

    return {
        "scanned_at": started,
        "vs_currency": config.VS_CURRENCY,
        "market_regime": market_regime,
        "top_coins": [c.symbol for c in top_coins],
        "opportunities": signals,
        "watchlist": watchlist,
        "no_trade": no_trade,
        "account_balance": account_balance or config.DEFAULT_ACCOUNT_BALANCE,
        "execution_enabled": config.EXECUTION_ENABLED,
    }
