"""Coin Ranking Engine.

Dynamically selects the Top N trading candidates for the day from a live
market snapshot, based on volume, liquidity, and volatility criteria —
never a hard-coded coin list.
"""
from __future__ import annotations

from . import config
from .market_data import CoinSnapshot


def select_top_coins(snapshots: list[CoinSnapshot], top_n: int | None = None) -> list[CoinSnapshot]:
    top_n = top_n or config.TOP_N_COINS

    candidates = []
    for coin in snapshots:
        if coin.symbol in config.EXCLUDED_SYMBOLS:
            continue
        if coin.volume_24h < config.MIN_24H_VOLUME_USD:
            continue
        if coin.market_cap < config.MIN_MARKET_CAP_USD:
            continue
        if coin.spread_proxy_pct > config.MAX_SPREAD_PCT * 20:
            # intraday range wildly wide relative to price -> likely an
            # illiquid/erratic market, not a genuine trading opportunity
            continue
        if abs(coin.price_change_pct_24h) < config.MIN_VOLATILITY_PCT and coin.spread_proxy_pct < 0.3:
            # essentially flat and no intraday range -> nothing to trade
            continue
        candidates.append(coin)

    # Liquidity score blends volume and market cap so mega-caps don't
    # automatically dominate purely because of size; movement/volatility
    # is weighted in too so genuinely tradeable setups rise to the top.
    def liquidity_score(c: CoinSnapshot) -> float:
        volume_score = c.volume_24h
        volatility_score = abs(c.price_change_pct_24h) * c.volume_24h * 0.01
        return volume_score + volatility_score

    candidates.sort(key=liquidity_score, reverse=True)
    return candidates[:top_n]
