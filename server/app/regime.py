"""Market Regime Engine.

Classifies a coin's trend across timeframes (strong bullish -> strong
bearish) and separately assesses the overall crypto market context (BTC
trend, risk-on/off) used to temper altcoin opportunities.
"""
from __future__ import annotations

TREND_LEVELS = ["strong_bearish", "bearish", "neutral", "bullish", "strong_bullish"]


def classify_trend(latest: dict) -> dict:
    """Combine EMA alignment, momentum, and structure into a single trend
    label for one timeframe's indicator snapshot."""
    close = latest["close"]
    ema20, ema50, ema100, ema200 = (latest.get(f"ema_{p}") for p in (20, 50, 100, 200))
    macd_hist = latest.get("macd_hist") or 0
    rsi = latest.get("rsi") or 50
    swings = latest.get("swings", {})

    score = 0
    reasons = []

    if ema20 and ema50:
        if ema20 > ema50:
            score += 1
            reasons.append("EMA20 above EMA50")
        else:
            score -= 1
            reasons.append("EMA20 below EMA50")

    if ema50 and ema200:
        if ema50 > ema200:
            score += 1
            reasons.append("EMA50 above EMA200 (long-term uptrend)")
        else:
            score -= 1
            reasons.append("EMA50 below EMA200 (long-term downtrend)")

    if close and ema20:
        if close > ema20:
            score += 1
        else:
            score -= 1

    if macd_hist > 0:
        score += 1
        reasons.append("MACD histogram positive")
    elif macd_hist < 0:
        score -= 1
        reasons.append("MACD histogram negative")

    if swings.get("higher_highs"):
        score += 1
        reasons.append("Higher highs / higher lows structure")
    if swings.get("lower_lows"):
        score -= 1
        reasons.append("Lower highs / lower lows structure")

    if rsi >= 70:
        reasons.append("RSI overbought — momentum extended")
    elif rsi <= 30:
        reasons.append("RSI oversold — potential reversal zone")

    if score >= 3:
        label = "strong_bullish"
    elif score >= 1:
        label = "bullish"
    elif score <= -3:
        label = "strong_bearish"
    elif score <= -1:
        label = "bearish"
    else:
        label = "neutral"

    return {"label": label, "score": score, "reasons": reasons}


def multi_timeframe_trend(per_timeframe: dict[str, dict]) -> dict:
    """Aggregate per-timeframe trend classifications and flag whether they
    agree (confirmation) or conflict (caution)."""
    trends = {tf: classify_trend(latest) for tf, latest in per_timeframe.items()}
    labels = [t["label"] for t in trends.values()]
    bullish_count = sum(1 for l in labels if "bullish" in l)
    bearish_count = sum(1 for l in labels if "bearish" in l)
    agreement = max(bullish_count, bearish_count) / len(labels) if labels else 0

    if bullish_count > bearish_count:
        overall = "bullish"
    elif bearish_count > bullish_count:
        overall = "bearish"
    else:
        overall = "neutral"

    return {"per_timeframe": trends, "overall": overall, "agreement": agreement}


def market_context(btc_per_timeframe: dict[str, dict]) -> dict:
    """Overall market regime derived from BTC's multi-timeframe trend, used
    to decide whether the environment is risk-on or risk-off for altcoins."""
    btc_trend = multi_timeframe_trend(btc_per_timeframe)
    risk_mode = "risk_off" if btc_trend["overall"] == "bearish" and btc_trend["agreement"] > 0.6 else "risk_on"
    return {
        "btc_trend": btc_trend["overall"],
        "btc_agreement": btc_trend["agreement"],
        "risk_mode": risk_mode,
    }
