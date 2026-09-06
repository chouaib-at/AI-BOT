/**
 * Central configuration for the crypto trading analysis bot.
 *
 * Nothing here hard-codes market data — only thresholds, limits and the
 * data-provider endpoint, all of which can be overridden with environment
 * variables so the API provider or risk profile can change without code edits.
 */
import "dotenv/config";

function envFloat(name: string, def: number): number {
  const v = process.env[name];
  return v !== undefined && v !== "" ? parseFloat(v) : def;
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  return v !== undefined && v !== "" ? parseInt(v, 10) : def;
}

// --- Market data provider ---------------------------------------------------
// CoinGecko public API is used by default because it requires no API key and
// aggregates data across many exchanges. The client is written so a different
// provider (Binance, Coinbase, CryptoCompare, ...) can be swapped in behind
// the same interface (see marketData.ts).
export const COINGECKO_BASE_URL =
  process.env.COINGECKO_BASE_URL || "https://api.coingecko.com/api/v3";
export const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || "";
export const VS_CURRENCY = process.env.VS_CURRENCY || "usd";

// --- Universe selection ------------------------------------------------------
export const CANDIDATE_POOL_SIZE = envInt("CANDIDATE_POOL_SIZE", 60);
export const TOP_N_COINS = envInt("TOP_N_COINS", 10);
export const MIN_24H_VOLUME_USD = envFloat("MIN_24H_VOLUME_USD", 20_000_000);
export const MIN_MARKET_CAP_USD = envFloat("MIN_MARKET_CAP_USD", 50_000_000);
export const MAX_SPREAD_PCT = envFloat("MAX_SPREAD_PCT", 1.5);
export const MIN_VOLATILITY_PCT = envFloat("MIN_VOLATILITY_PCT", 1.0);
export const EXCLUDED_SYMBOLS = new Set(
  (
    process.env.EXCLUDED_SYMBOLS ||
    "USDT,USDC,DAI,BUSD,TUSD,FDUSD,USDP,USDD,PYUSD,GUSD,EURT,USDE"
  )
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

// --- Technical analysis ------------------------------------------------------
export const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const EMA_PERIODS = [20, 50, 100, 200];
export const RSI_PERIOD = 14;
export const ATR_PERIOD = 14;
export const BOLLINGER_PERIOD = 20;
export const BOLLINGER_STD = 2;
export const VOLUME_MA_PERIOD = 20;

// --- Risk management ----------------------------------------------------------
export const DEFAULT_ACCOUNT_BALANCE = envFloat("DEFAULT_ACCOUNT_BALANCE", 1000.0);
export const MAX_RISK_PER_TRADE_PCT = envFloat("MAX_RISK_PER_TRADE_PCT", 1.0);
export const MIN_RISK_REWARD = envFloat("MIN_RISK_REWARD", 1.5);
export const PREFERRED_RISK_REWARD = envFloat("PREFERRED_RISK_REWARD", 2.0);
export const TARGET_PROFIT_PCT: [number, number] = [3.0, 5.0];
export const MAX_PROFIT_TARGET_PCT = 10.0;

// --- Scoring --------------------------------------------------------------------
export const SCORE_WEIGHTS = {
  trend: 20,
  volume: 15,
  momentum: 15,
  support_resistance: 15,
  entry_quality: 15,
  risk_reward: 10,
  volatility: 5,
  multi_timeframe: 5,
};
export const SCORE_STRONG = 80;
export const SCORE_GOOD = 70;
export const SCORE_WATCHLIST = 60;

// --- Scheduler -------------------------------------------------------------------
export const SCAN_INTERVAL_MINUTES = envInt("SCAN_INTERVAL_MINUTES", 60);

// --- Safety -----------------------------------------------------------------------
// Analysis/signal-generation only. No order is ever placed by this codebase.
export const EXECUTION_ENABLED =
  (process.env.EXECUTION_ENABLED || "false").toLowerCase() === "true";
export const DEFAULT_LEVERAGE = 1; // spot only, never leveraged by default

export const PORT = envInt("PORT", 8000);
