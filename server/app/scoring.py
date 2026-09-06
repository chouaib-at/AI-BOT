"""Trade Scoring Engine.

Produces a 0-100 confidence score from weighted factors. Trades below the
watchlist threshold are not returned as tradeable opportunities.
"""
from __future__ import annotations

from . import config, risk
from .regime import classify_trend
from .signals import Setup


def score_opportunity(
    latest: dict,
    mtf_agreement: float,
    setup: Setup,
    levels: risk.TradeLevels,
    volume_24h: float,
) -> dict:
    w = config.SCORE_WEIGHTS
    trend = classify_trend(latest)
    breakdown = {}

    # Trend (0-20): strength of the classified trend
    trend_strength = {"strong_bullish": 1.0, "bullish": 0.75, "neutral": 0.4, "bearish": 0.1, "strong_bearish": 0}
    breakdown["trend"] = round(w["trend"] * trend_strength.get(trend["label"], 0.4), 1)

    # Volume (0-15): scaled against the minimum liquidity floor
    volume_ratio = min(volume_24h / config.MIN_24H_VOLUME_USD, 3) / 3
    breakdown["volume"] = round(w["volume"] * volume_ratio, 1)

    # Momentum (0-15): MACD histogram direction + RSI positioning
    macd_hist = latest.get("macd_hist") or 0
    rsi = latest.get("rsi") or 50
    momentum_score = 0.5
    if macd_hist > 0:
        momentum_score += 0.3
    if 45 <= rsi <= 70:
        momentum_score += 0.2
    elif rsi > 80 or rsi < 20:
        momentum_score -= 0.2
    breakdown["momentum"] = round(w["momentum"] * min(max(momentum_score, 0), 1), 1)

    # Support/resistance (0-15): setups anchored to S/R score higher
    sr_setups = {"Resistance breakout", "Support bounce", "Trend continuation (EMA support)"}
    breakdown["support_resistance"] = w["support_resistance"] if setup.name in sr_setups else round(w["support_resistance"] * 0.5, 1)

    # Entry quality (0-15): number of confirming reasons behind the setup
    breakdown["entry_quality"] = round(w["entry_quality"] * min(len(setup.reasons) / 3, 1), 1)

    # Risk/reward (0-10)
    rr_ratio = min(levels.risk_reward / config.PREFERRED_RISK_REWARD, 1.5) / 1.5
    breakdown["risk_reward"] = round(w["risk_reward"] * rr_ratio, 1)

    # Volatility (0-5): enough ATR to be worth trading, not so much it's reckless
    atr_pct = (latest.get("atr") or 0) / latest["close"] * 100 if latest.get("close") else 0
    vol_score = 1.0 if 0.5 <= atr_pct <= 6 else 0.4
    breakdown["volatility"] = round(w["volatility"] * vol_score, 1)

    # Multi-timeframe confirmation (0-5)
    breakdown["multi_timeframe"] = round(w["multi_timeframe"] * mtf_agreement, 1)

    total = round(sum(breakdown.values()), 1)

    if total >= config.SCORE_STRONG:
        tier = "strong"
    elif total >= config.SCORE_GOOD:
        tier = "good"
    elif total >= config.SCORE_WATCHLIST:
        tier = "watchlist"
    else:
        tier = "no_trade"

    return {"total": total, "tier": tier, "breakdown": breakdown}
