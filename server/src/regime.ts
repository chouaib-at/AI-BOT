/**
 * Market Regime Engine.
 *
 * Classifies a coin's trend across timeframes (strong bullish -> strong
 * bearish) and separately assesses the overall crypto market context (BTC
 * trend, risk-on/off) used to temper altcoin opportunities.
 */
import { LatestIndicators } from "./indicators";

export interface TrendClassification {
  label: string;
  score: number;
  reasons: string[];
}

export function classifyTrend(latest: LatestIndicators): TrendClassification {
  const close = latest.close;
  const ema20 = (latest as any).ema_20 as number | null;
  const ema50 = (latest as any).ema_50 as number | null;
  const ema200 = (latest as any).ema_200 as number | null;
  const macdHist = latest.macd_hist ?? 0;
  const rsi = latest.rsi ?? 50;
  const swings = latest.swings;

  let score = 0;
  const reasons: string[] = [];

  if (ema20 && ema50) {
    if (ema20 > ema50) {
      score += 1;
      reasons.push("EMA20 above EMA50");
    } else {
      score -= 1;
      reasons.push("EMA20 below EMA50");
    }
  }

  if (ema50 && ema200) {
    if (ema50 > ema200) {
      score += 1;
      reasons.push("EMA50 above EMA200 (long-term uptrend)");
    } else {
      score -= 1;
      reasons.push("EMA50 below EMA200 (long-term downtrend)");
    }
  }

  if (close && ema20) {
    score += close > ema20 ? 1 : -1;
  }

  if (macdHist > 0) {
    score += 1;
    reasons.push("MACD histogram positive");
  } else if (macdHist < 0) {
    score -= 1;
    reasons.push("MACD histogram negative");
  }

  if (swings?.higherHighs) {
    score += 1;
    reasons.push("Higher highs / higher lows structure");
  }
  if (swings?.lowerLows) {
    score -= 1;
    reasons.push("Lower highs / lower lows structure");
  }

  if (rsi >= 70) reasons.push("RSI overbought — momentum extended");
  else if (rsi <= 30) reasons.push("RSI oversold — potential reversal zone");

  let label: string;
  if (score >= 3) label = "strong_bullish";
  else if (score >= 1) label = "bullish";
  else if (score <= -3) label = "strong_bearish";
  else if (score <= -1) label = "bearish";
  else label = "neutral";

  return { label, score, reasons };
}

export interface MultiTimeframeTrend {
  perTimeframe: Record<string, TrendClassification>;
  overall: string;
  agreement: number;
}

export function multiTimeframeTrend(perTimeframe: Record<string, LatestIndicators>): MultiTimeframeTrend {
  const trends: Record<string, TrendClassification> = {};
  for (const [tf, latest] of Object.entries(perTimeframe)) trends[tf] = classifyTrend(latest);

  const labels = Object.values(trends).map((t) => t.label);
  const bullishCount = labels.filter((l) => l.includes("bullish")).length;
  const bearishCount = labels.filter((l) => l.includes("bearish")).length;
  const agreement = labels.length ? Math.max(bullishCount, bearishCount) / labels.length : 0;

  let overall: string;
  if (bullishCount > bearishCount) overall = "bullish";
  else if (bearishCount > bullishCount) overall = "bearish";
  else overall = "neutral";

  return { perTimeframe: trends, overall, agreement };
}

export interface MarketContext {
  btc_trend: string;
  btc_agreement: number;
  risk_mode: string;
}

export function marketContext(btcPerTimeframe: Record<string, LatestIndicators>): MarketContext {
  const btcTrend = multiTimeframeTrend(btcPerTimeframe);
  const riskMode =
    btcTrend.overall === "bearish" && btcTrend.agreement > 0.6 ? "risk_off" : "risk_on";
  return {
    btc_trend: btcTrend.overall,
    btc_agreement: btcTrend.agreement,
    risk_mode: riskMode,
  };
}
