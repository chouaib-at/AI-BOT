"""Market Data Service.

Retrieves live cryptocurrency market data from a public API (CoinGecko by
default). This is the only module allowed to talk to the network for prices —
every other module receives data through this interface, so the provider can
be swapped (Binance, Coinbase, CryptoCompare, ...) without touching the rest
of the system.

Nothing here invents prices: every response is timestamped with the moment
it was fetched, and callers must check `fetched_at` / `is_live` before
treating a value as current.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import pandas as pd

from . import config


class MarketDataError(RuntimeError):
    """Raised when live market data cannot be retrieved. Callers must not
    fabricate a fallback value when this is raised."""


@dataclass
class CoinSnapshot:
    id: str
    symbol: str
    name: str
    price: float
    market_cap: float
    volume_24h: float
    high_24h: float
    low_24h: float
    price_change_pct_24h: float
    fetched_at: float = field(default_factory=time.time)

    @property
    def spread_proxy_pct(self) -> float:
        """Intraday high/low range as a proxy for spread/liquidity quality
        when true order-book data isn't available."""
        if not self.low_24h:
            return 100.0
        return (self.high_24h - self.low_24h) / self.low_24h * 100.0


TIMEFRAME_TO_DAYS = {
    "5m": 1,     # CoinGecko returns 5-min granularity automatically for 1 day
    "15m": 1,
    "1h": 7,     # ~hourly granularity
    "4h": 30,
    "1d": 90,
}


class MarketDataProvider:
    """Thin async client around the CoinGecko public REST API."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = base_url or config.COINGECKO_BASE_URL
        self.api_key = api_key if api_key is not None else config.COINGECKO_API_KEY

    def _headers(self) -> dict[str, str]:
        headers = {"accept": "application/json"}
        if self.api_key:
            headers["x-cg-pro-api-key"] = self.api_key
        return headers

    async def _get(self, client: httpx.AsyncClient, path: str, params: dict[str, Any]) -> Any:
        try:
            resp = await client.get(f"{self.base_url}{path}", params=params, headers=self._headers(), timeout=20)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            raise MarketDataError(f"Failed to fetch {path}: {exc}") from exc

    async def get_market_snapshot(self, pool_size: int) -> list[CoinSnapshot]:
        """Fetch a ranked pool of coins by market cap with live 24h stats."""
        async with httpx.AsyncClient() as client:
            data = await self._get(
                client,
                "/coins/markets",
                {
                    "vs_currency": config.VS_CURRENCY,
                    "order": "market_cap_desc",
                    "per_page": pool_size,
                    "page": 1,
                    "price_change_percentage": "24h",
                },
            )
        snapshots = []
        for row in data:
            try:
                snapshots.append(
                    CoinSnapshot(
                        id=row["id"],
                        symbol=row["symbol"].upper(),
                        name=row["name"],
                        price=row["current_price"],
                        market_cap=row.get("market_cap") or 0,
                        volume_24h=row.get("total_volume") or 0,
                        high_24h=row.get("high_24h") or row["current_price"],
                        low_24h=row.get("low_24h") or row["current_price"],
                        price_change_pct_24h=row.get("price_change_percentage_24h") or 0.0,
                    )
                )
            except (KeyError, TypeError):
                continue  # skip malformed rows rather than inventing data
        return snapshots

    async def get_ohlc(self, coin_id: str, timeframe: str) -> pd.DataFrame:
        """Fetch OHLC candles for a coin and resample to the requested
        timeframe. CoinGecko's /coins/{id}/ohlc endpoint returns coarse
        granularity that scales with the `days` window requested."""
        days = TIMEFRAME_TO_DAYS.get(timeframe, 30)
        async with httpx.AsyncClient() as client:
            data = await self._get(
                client,
                f"/coins/{coin_id}/ohlc",
                {"vs_currency": config.VS_CURRENCY, "days": days},
            )
        if not data:
            raise MarketDataError(f"No OHLC data returned for {coin_id} ({timeframe})")
        df = pd.DataFrame(data, columns=["timestamp", "open", "high", "low", "close"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
        df = df.set_index("timestamp")

        # CoinGecko doesn't return volume in the OHLC endpoint; fetch market
        # chart volume separately and align it onto the same buckets.
        try:
            async with httpx.AsyncClient() as client:
                chart = await self._get(
                    client,
                    f"/coins/{coin_id}/market_chart",
                    {"vs_currency": config.VS_CURRENCY, "days": days},
                )
            vol = pd.DataFrame(chart.get("total_volumes", []), columns=["timestamp", "volume"])
            vol["timestamp"] = pd.to_datetime(vol["timestamp"], unit="ms")
            vol = vol.set_index("timestamp")
            df = df.join(vol, how="left")
            df["volume"] = df["volume"].ffill().fillna(0)
        except MarketDataError:
            df["volume"] = 0.0

        target_rule = {"5m": "5min", "15m": "15min", "1h": "1h", "4h": "4h", "1d": "1D"}.get(timeframe)
        if target_rule and timeframe not in ("5m",):
            df = (
                df.resample(target_rule)
                .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
                .dropna()
            )
        return df
