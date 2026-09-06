/**
 * Risk Management Engine.
 *
 * Calculates stop-loss / take-profit levels and position size. Every trade
 * setup this module touches must end up with an explicit entry, stop-loss,
 * take-profit and risk/reward ratio — a setup that can't produce all four is
 * not a valid trade.
 */
import * as config from "./config";

export interface TradeLevels {
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  risk_pct: number;
  reward_pct_1: number;
  reward_pct_2: number;
  risk_reward: number;
}

export function meetsMinRR(levels: TradeLevels): boolean {
  return levels.risk_reward >= config.MIN_RISK_REWARD;
}

function round(v: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(v * factor) / factor;
}

export function computeLevels(entry: number, atrValue: number, direction: "long" | "short" = "long"): TradeLevels {
  if (atrValue <= 0) atrValue = entry * 0.01; // fallback: 1% synthetic volatility floor

  const stopDistance = Math.max(atrValue * 1.5, entry * 0.008);
  const sign = direction === "long" ? 1 : -1;

  const stopLoss = entry - sign * stopDistance;
  const riskPct = (Math.abs(entry - stopLoss) / entry) * 100;

  const tp1Pct = Math.min(
    Math.max(riskPct * config.PREFERRED_RISK_REWARD, config.TARGET_PROFIT_PCT[0]),
    config.TARGET_PROFIT_PCT[1]
  );
  const tp2Pct = Math.min(tp1Pct * 1.6, config.MAX_PROFIT_TARGET_PCT);

  const takeProfit1 = entry + sign * entry * (tp1Pct / 100);
  const takeProfit2 = entry + sign * entry * (tp2Pct / 100);

  const riskReward = riskPct ? tp1Pct / riskPct : 0;

  return {
    entry: round(entry, 6),
    stop_loss: round(stopLoss, 6),
    take_profit_1: round(takeProfit1, 6),
    take_profit_2: round(takeProfit2, 6),
    risk_pct: round(riskPct, 2),
    reward_pct_1: round(tp1Pct, 2),
    reward_pct_2: round(tp2Pct, 2),
    risk_reward: round(riskReward, 2),
  };
}

export interface PositionSize {
  units: number;
  position_value: number;
  max_risk_amount: number;
}

export function positionSize(
  accountBalance: number,
  levels: TradeLevels,
  riskPerTradePct?: number
): PositionSize {
  const riskPct = riskPerTradePct ?? config.MAX_RISK_PER_TRADE_PCT;
  const maxRiskAmount = (accountBalance * riskPct) / 100;
  const riskPerUnit = Math.abs(levels.entry - levels.stop_loss);
  if (riskPerUnit <= 0) {
    return { units: 0, position_value: 0, max_risk_amount: round(maxRiskAmount, 2) };
  }
  const units = maxRiskAmount / riskPerUnit;
  const positionValue = units * levels.entry;
  return {
    units: round(units, 6),
    position_value: round(positionValue, 2),
    max_risk_amount: round(maxRiskAmount, 2),
  };
}
