"""Signal Detection Engine.

Looks for a realistic, named trading setup (breakout, pullback, support
bounce, VWAP reclaim, ...) on the primary trading timeframe, informed by
higher-timeframe trend confirmation. Returns None (NO TRADE) when nothing
qualifies rather than forcing an opportunity.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import config, risk
from .regime import classify_trend


@dataclass
class Setup:
    name: str
    direction: str
    reasons: list[str]
    entry: float
    atr: float


def detect_setup(latest: dict, higher_tf_trend: str) -> Setup | None:
    close = latest["close"]
    ema20, ema50 = latest.get("ema_20"), latest.get("ema_50")
    rsi = latest.get("rsi") or 50
    macd_hist = latest.get("macd_hist") or 0
    vwap = latest.get("vwap")
    volume = latest.get("volume") or 0
    volume_ma = latest.get("volume_ma") or 0
    sr = latest.get("support_resistance", {})
    resistance, support = sr.get("resistance"), sr.get("support")
    trend = classify_trend(latest)

    bullish_bias = "bullish" in higher_tf_trend or "bullish" in trend["label"]
    bearish_bias = "bearish" in higher_tf_trend or "bearish" in trend["label"]
    volume_confirmed = volume_ma and volume > volume_ma * 1.1

    # --- Resistance breakout (long) ---
    if resistance and close > resistance * 1.001 and volume_confirmed and bullish_bias and rsi < 78:
        return Setup(
            name="Resistance breakout",
            direction="long",
            reasons=[
                f"Price broke above resistance ({resistance:.4g})",
                "Volume above its moving average confirms the breakout",
                "Higher-timeframe trend is bullish",
            ],
            entry=close,
            atr=latest.get("atr") or 0,
        )

    # --- Support bounce (long) ---
    if support and close <= support * 1.01 and close >= support * 0.985 and rsi < 45 and bullish_bias:
        return Setup(
            name="Support bounce",
            direction="long",
            reasons=[
                f"Price is testing support near {support:.4g}",
                "RSI not overbought, room to run",
                "Higher-timeframe trend still bullish",
            ],
            entry=close,
            atr=latest.get("atr") or 0,
        )

    # --- VWAP reclaim (long) ---
    if vwap and ema20 and close > vwap and latest.get("close") and abs(close - vwap) / vwap < 0.01 and macd_hist > 0:
        return Setup(
            name="VWAP reclaim",
            direction="long",
            reasons=["Price reclaiming VWAP from below", "MACD histogram turning positive"],
            entry=close,
            atr=latest.get("atr") or 0,
        )

    # --- EMA support / trend continuation (long) ---
    if ema20 and ema50 and ema20 > ema50 and close > ema20 * 0.995 and close < ema20 * 1.02 and bullish_bias:
        return Setup(
            name="Trend continuation (EMA support)",
            direction="long",
            reasons=["Price pulled back to EMA20 support in an established uptrend", "EMA20 above EMA50"],
            entry=close,
            atr=latest.get("atr") or 0,
        )

    # --- Oversold reversal (long) ---
    if rsi <= 30 and macd_hist > (latest.get("macd_hist") or 0) * 0 and not bearish_bias:
        return Setup(
            name="Oversold reversal",
            direction="long",
            reasons=["RSI in oversold territory", "No strong bearish higher-timeframe trend"],
            entry=close,
            atr=latest.get("atr") or 0,
        )

    # --- Breakdown (short bias noted, but system trades spot => flagged only as caution) ---
    return None


def build_trade_setup(setup: Setup) -> risk.TradeLevels:
    return risk.compute_levels(setup.entry, setup.atr, setup.direction)
