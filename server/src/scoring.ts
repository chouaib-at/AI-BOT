/**
 * Trade Scoring Engine.
 *
 * Produces a 0-100 confidence score from weighted factors. Trades below the
 * watchlist threshold are not returned as tradeable opportunities.
 */
import * as config from "./config";
import * as risk from "./risk";
import { classifyTrend } from "./regime";
import { Setup } from "./signals";
import { LatestIndicators } from "./indicators";

export interface ScoreResult {
  total: number;
  tier: "strong" | "good" | "watchlist" | "no_trade";
  breakdown: Record<string, number>;
}

function round(v: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(v * factor) / factor;
}

export function scoreOpportunity(
  latest: LatestIndicators,
  mtfAgreement: number,
  setup: Setup,
  levels: risk.TradeLevels,
  volume24h: number
): ScoreResult {
  const w = config.SCORE_WEIGHTS;
  const trend = classifyTrend(latest);
  const breakdown: Record<string, number> = {};

  const trendStrength: Record<string, number> = {
    strong_bullish: 1.0,
    bullish: 0.75,
    neutral: 0.4,
    bearish: 0.1,
    strong_bearish: 0,
  };
  breakdown.trend = round(w.trend * (trendStrength[trend.label] ?? 0.4), 1);

  const volumeRatio = Math.min(volume24h / config.MIN_24H_VOLUME_USD, 3) / 3;
  breakdown.volume = round(w.volume * volumeRatio, 1);

  const macdHist = latest.macd_hist ?? 0;
  const rsi = latest.rsi ?? 50;
  let momentumScore = 0.5;
  if (macdHist > 0) momentumScore += 0.3;
  if (rsi >= 45 && rsi <= 70) momentumScore += 0.2;
  else if (rsi > 80 || rsi < 20) momentumScore -= 0.2;
  breakdown.momentum = round(w.momentum * Math.min(Math.max(momentumScore, 0), 1), 1);

  const srSetups = new Set(["Resistance breakout", "Support bounce", "Trend continuation (EMA support)"]);
  breakdown.support_resistance = srSetups.has(setup.name)
    ? w.support_resistance
    : round(w.support_resistance * 0.5, 1);

  breakdown.entry_quality = round(w.entry_quality * Math.min(setup.reasons.length / 3, 1), 1);

  const rrRatio = Math.min(levels.risk_reward / config.PREFERRED_RISK_REWARD, 1.5) / 1.5;
  breakdown.risk_reward = round(w.risk_reward * rrRatio, 1);

  const atrPct = latest.close ? ((latest.atr ?? 0) / latest.close) * 100 : 0;
  const volScore = atrPct >= 0.5 && atrPct <= 6 ? 1.0 : 0.4;
  breakdown.volatility = round(w.volatility * volScore, 1);

  breakdown.multi_timeframe = round(w.multi_timeframe * mtfAgreement, 1);

  const total = round(
    Object.values(breakdown).reduce((a, b) => a + b, 0),
    1
  );

  let tier: ScoreResult["tier"];
  if (total >= config.SCORE_STRONG) tier = "strong";
  else if (total >= config.SCORE_GOOD) tier = "good";
  else if (total >= config.SCORE_WATCHLIST) tier = "watchlist";
  else tier = "no_trade";

  return { total, tier, breakdown };
}
