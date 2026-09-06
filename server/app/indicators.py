"""Technical Analysis Engine.

Pure functions that compute indicators on an OHLCV DataFrame
(columns: open, high, low, close, volume). No network calls here — this
module only transforms data it is given, so it is trivially unit-testable
and reusable by both the live scanner and the backtester.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def rsi(series: pd.Series, period: int = config.RSI_PERIOD) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - (100 / (1 + rs))).fillna(50)


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    ema_fast = ema(series, fast)
    ema_slow = ema(series, slow)
    macd_line = ema_fast - ema_slow
    signal_line = ema(macd_line, signal)
    return pd.DataFrame({"macd": macd_line, "signal": signal_line, "hist": macd_line - signal_line})


def atr(df: pd.DataFrame, period: int = config.ATR_PERIOD) -> pd.Series:
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def bollinger_bands(series: pd.Series, period: int = config.BOLLINGER_PERIOD, num_std: float = config.BOLLINGER_STD):
    mid = series.rolling(period).mean()
    std = series.rolling(period).std()
    upper = mid + num_std * std
    lower = mid - num_std * std
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower})


def vwap(df: pd.DataFrame) -> pd.Series:
    typical_price = (df["high"] + df["low"] + df["close"]) / 3
    cum_vol = df["volume"].cumsum().replace(0, np.nan)
    return (typical_price * df["volume"]).cumsum() / cum_vol


def volume_ma(df: pd.DataFrame, period: int = config.VOLUME_MA_PERIOD) -> pd.Series:
    return df["volume"].rolling(period).mean()


def swing_points(df: pd.DataFrame, lookback: int = 5) -> dict:
    """Recent swing high/low over the trailing `lookback` candles, plus
    simple higher-highs/lower-lows detection for structure."""
    highs = df["high"].tail(lookback * 4)
    lows = df["low"].tail(lookback * 4)
    recent_high = highs.max()
    recent_low = lows.min()

    segments_h = np.array_split(highs, min(4, max(1, len(highs) // lookback or 1)))
    segments_l = np.array_split(lows, min(4, max(1, len(lows) // lookback or 1)))
    hh = all(segments_h[i].max() <= segments_h[i + 1].max() for i in range(len(segments_h) - 1)) if len(segments_h) > 1 else False
    ll = all(segments_l[i].min() >= segments_l[i + 1].min() for i in range(len(segments_l) - 1)) if len(segments_l) > 1 else False

    return {
        "recent_high": float(recent_high) if pd.notna(recent_high) else None,
        "recent_low": float(recent_low) if pd.notna(recent_low) else None,
        "higher_highs": bool(hh),
        "lower_lows": bool(ll),
    }


def support_resistance(df: pd.DataFrame, window: int = 20) -> dict:
    """Approximate support/resistance using rolling extremes — a lightweight
    stand-in for full pivot/cluster analysis."""
    resistance = df["high"].rolling(window).max().iloc[-1]
    support = df["low"].rolling(window).min().iloc[-1]
    return {
        "support": float(support) if pd.notna(support) else None,
        "resistance": float(resistance) if pd.notna(resistance) else None,
    }


def compute_all(df: pd.DataFrame) -> dict:
    """Compute the full indicator set for one OHLCV timeframe DataFrame and
    return the latest values plus key series needed downstream."""
    if df is None or len(df) < 5:
        raise ValueError("Not enough candles to compute indicators")

    close = df["close"]
    out: dict = {}

    for period in config.EMA_PERIODS:
        out[f"ema_{period}"] = ema(close, period)

    out["rsi"] = rsi(close)
    macd_df = macd(close)
    out["macd"] = macd_df["macd"]
    out["macd_signal"] = macd_df["signal"]
    out["macd_hist"] = macd_df["hist"]
    out["atr"] = atr(df)
    bb = bollinger_bands(close)
    out["bb_mid"] = bb["mid"]
    out["bb_upper"] = bb["upper"]
    out["bb_lower"] = bb["lower"]
    out["vwap"] = vwap(df)
    out["volume_ma"] = volume_ma(df)
    out["swings"] = swing_points(df)
    out["support_resistance"] = support_resistance(df)

    latest = {}
    for key, val in out.items():
        if isinstance(val, pd.Series):
            latest[key] = float(val.iloc[-1]) if pd.notna(val.iloc[-1]) else None
        else:
            latest[key] = val
    latest["close"] = float(close.iloc[-1])
    latest["volume"] = float(df["volume"].iloc[-1])
    latest["_series"] = out  # full series retained for regime/signal logic
    return latest
