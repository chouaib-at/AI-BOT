/**
 * Signal Detection Engine.
 *
 * Looks for a realistic, named trading setup (breakout, pullback, support
 * bounce, VWAP reclaim, ...) on the primary trading timeframe, informed by
 * higher-timeframe trend confirmation. Returns null (NO TRADE) when nothing
 * qualifies rather than forcing an opportunity.
 */
import * as risk from "./risk";
import { classifyTrend } from "./regime";
import { LatestIndicators } from "./indicators";

export interface Setup {
  name: string;
  direction: "long" | "short";
  reasons: string[];
  entry: number;
  atr: number;
}

export function detectSetup(latest: LatestIndicators, higherTfTrend: string): Setup | null {
  const close = latest.close;
  const ema20 = (latest as any).ema_20 as number | null;
  const ema50 = (latest as any).ema_50 as number | null;
  const rsi = latest.rsi ?? 50;
  const macdHist = latest.macd_hist ?? 0;
  const vwap = latest.vwap;
  const volume = latest.volume ?? 0;
  const volumeMa = latest.volume_ma ?? 0;
  const sr = latest.support_resistance ?? { support: null, resistance: null };
  const { resistance, support } = sr;
  const trend = classifyTrend(latest);

  const bullishBias = higherTfTrend.includes("bullish") || trend.label.includes("bullish");
  const bearishBias = higherTfTrend.includes("bearish") || trend.label.includes("bearish");
  const volumeConfirmed = !!volumeMa && volume > volumeMa * 1.1;

  // --- Resistance breakout (long) ---
  if (
    resistance &&
    close > resistance * 1.001 &&
    volumeConfirmed &&
    bullishBias &&
    rsi < 78
  ) {
    return {
      name: "Resistance breakout",
      direction: "long",
      reasons: [
        `Price broke above resistance (${resistance.toPrecision(4)})`,
        "Volume above its moving average confirms the breakout",
        "Higher-timeframe trend is bullish",
      ],
      entry: close,
      atr: latest.atr ?? 0,
    };
  }

  // --- Support bounce (long) ---
  if (support && close <= support * 1.01 && close >= support * 0.985 && rsi < 45 && bullishBias) {
    return {
      name: "Support bounce",
      direction: "long",
      reasons: [
        `Price is testing support near ${support.toPrecision(4)}`,
        "RSI not overbought, room to run",
        "Higher-timeframe trend still bullish",
      ],
      entry: close,
      atr: latest.atr ?? 0,
    };
  }

  // --- VWAP reclaim (long) ---
  if (vwap && ema20 && close > vwap && Math.abs(close - vwap) / vwap < 0.01 && macdHist > 0) {
    return {
      name: "VWAP reclaim",
      direction: "long",
      reasons: ["Price reclaiming VWAP from below", "MACD histogram turning positive"],
      entry: close,
      atr: latest.atr ?? 0,
    };
  }

  // --- EMA support / trend continuation (long) ---
  if (
    ema20 &&
    ema50 &&
    ema20 > ema50 &&
    close > ema20 * 0.995 &&
    close < ema20 * 1.02 &&
    bullishBias
  ) {
    return {
      name: "Trend continuation (EMA support)",
      direction: "long",
      reasons: ["Price pulled back to EMA20 support in an established uptrend", "EMA20 above EMA50"],
      entry: close,
      atr: latest.atr ?? 0,
    };
  }

  // --- Oversold reversal (long) ---
  if (rsi <= 30 && !bearishBias) {
    return {
      name: "Oversold reversal",
      direction: "long",
      reasons: ["RSI in oversold territory", "No strong bearish higher-timeframe trend"],
      entry: close,
      atr: latest.atr ?? 0,
    };
  }

  return null;
}

export function buildTradeSetup(setup: Setup): risk.TradeLevels {
  return risk.computeLevels(setup.entry, setup.atr, setup.direction);
}
