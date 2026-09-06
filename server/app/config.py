"""Central configuration for the crypto trading analysis bot.

Nothing here hard-codes market data — only thresholds, limits and the
data-provider endpoint, all of which can be overridden with environment
variables so the API provider or risk profile can change without code edits.
"""
import os


def _float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


# --- Market data provider -------------------------------------------------
# CoinGecko public API is used by default because it requires no API key and
# aggregates data across many exchanges. The client is written so a different
# provider (Binance, Coinbase, CryptoCompare, ...) can be swapped in behind
# the same MarketDataProvider interface (see market_data.py).
COINGECKO_BASE_URL = os.environ.get("COINGECKO_BASE_URL", "https://api.coingecko.com/api/v3")
COINGECKO_API_KEY = os.environ.get("COINGECKO_API_KEY", "")  # optional, pro tier
VS_CURRENCY = os.environ.get("VS_CURRENCY", "usd")

# --- Universe selection -----------------------------------------------------
CANDIDATE_POOL_SIZE = _int("CANDIDATE_POOL_SIZE", 60)   # how many coins to pull before filtering
TOP_N_COINS = _int("TOP_N_COINS", 10)
MIN_24H_VOLUME_USD = _float("MIN_24H_VOLUME_USD", 20_000_000)
MIN_MARKET_CAP_USD = _float("MIN_MARKET_CAP_USD", 50_000_000)
MAX_SPREAD_PCT = _float("MAX_SPREAD_PCT", 1.5)  # proxy via high/low intraday range sanity check
MIN_VOLATILITY_PCT = _float("MIN_VOLATILITY_PCT", 1.0)  # 24h % change magnitude floor
EXCLUDED_SYMBOLS = {
    s.strip().upper()
    for s in os.environ.get(
        "EXCLUDED_SYMBOLS",
        "USDT,USDC,DAI,BUSD,TUSD,FDUSD,USDP,USDD,PYUSD,GUSD,EURT,USDE",
    ).split(",")
    if s.strip()
}

# --- Technical analysis -----------------------------------------------------
TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"]
EMA_PERIODS = [20, 50, 100, 200]
RSI_PERIOD = 14
ATR_PERIOD = 14
BOLLINGER_PERIOD = 20
BOLLINGER_STD = 2
VOLUME_MA_PERIOD = 20

# --- Risk management ---------------------------------------------------------
DEFAULT_ACCOUNT_BALANCE = _float("DEFAULT_ACCOUNT_BALANCE", 1000.0)
MAX_RISK_PER_TRADE_PCT = _float("MAX_RISK_PER_TRADE_PCT", 1.0)  # % of account
MIN_RISK_REWARD = _float("MIN_RISK_REWARD", 1.5)
PREFERRED_RISK_REWARD = _float("PREFERRED_RISK_REWARD", 2.0)
TARGET_PROFIT_PCT = (3.0, 5.0)  # preferred range
MAX_PROFIT_TARGET_PCT = 10.0

# --- Scoring -----------------------------------------------------------------
SCORE_WEIGHTS = {
    "trend": 20,
    "volume": 15,
    "momentum": 15,
    "support_resistance": 15,
    "entry_quality": 15,
    "risk_reward": 10,
    "volatility": 5,
    "multi_timeframe": 5,
}
SCORE_STRONG = 80
SCORE_GOOD = 70
SCORE_WATCHLIST = 60

# --- Scheduler ---------------------------------------------------------------
SCAN_INTERVAL_MINUTES = _int("SCAN_INTERVAL_MINUTES", 60)

# --- Safety ------------------------------------------------------------------
# Analysis/signal-generation only. No order is ever placed by this codebase.
EXECUTION_ENABLED = os.environ.get("EXECUTION_ENABLED", "false").lower() == "true"
DEFAULT_LEVERAGE = 1  # spot only, never leveraged by default
