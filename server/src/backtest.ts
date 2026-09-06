/**
 * Historical Testing.
 *
 * Walks a historical OHLCV series bar-by-bar, re-using the same signal
 * detection and risk-management logic the live scanner uses, so backtest
 * results actually reflect the live strategy rather than a separate
 * approximation of it.
 */
import * as indicators from "./indicators";
import * as risk from "./risk";
import { classifyTrend } from "./regime";
import { detectSetup } from "./signals";
import { Candle } from "./marketData";

export interface TradeResult {
  entry_index: number;
  entry_price: number;
  exit_price: number;
  exit_reason: "take_profit" | "stop_loss" | "end_of_data";
  pnl_pct: number;
}

function round(v: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(v * factor) / factor;
}

export class BacktestReport {
  trades: TradeResult[] = [];

  get winRate(): number {
    if (!this.trades.length) return 0.0;
    const wins = this.trades.filter((t) => t.pnl_pct > 0).length;
    return round((wins / this.trades.length) * 100, 2);
  }

  get avgWinPct(): number {
    const wins = this.trades.filter((t) => t.pnl_pct > 0).map((t) => t.pnl_pct);
    return wins.length ? round(wins.reduce((a, b) => a + b, 0) / wins.length, 2) : 0.0;
  }

  get avgLossPct(): number {
    const losses = this.trades.filter((t) => t.pnl_pct <= 0).map((t) => t.pnl_pct);
    return losses.length ? round(losses.reduce((a, b) => a + b, 0) / losses.length, 2) : 0.0;
  }

  get profitFactor(): number {
    const grossWin = this.trades.filter((t) => t.pnl_pct > 0).reduce((a, t) => a + t.pnl_pct, 0);
    const grossLoss = Math.abs(this.trades.filter((t) => t.pnl_pct <= 0).reduce((a, t) => a + t.pnl_pct, 0));
    if (grossLoss) return round(grossWin / grossLoss, 2);
    return grossWin ? Infinity : 0.0;
  }

  get maxDrawdownPct(): number {
    if (!this.trades.length) return 0.0;
    let equity = 0;
    let runningMax = -Infinity;
    let worstDrawdown = 0;
    for (const t of this.trades) {
      equity += t.pnl_pct;
      runningMax = Math.max(runningMax, equity);
      worstDrawdown = Math.min(worstDrawdown, equity - runningMax);
    }
    return round(worstDrawdown, 2);
  }

  get sharpeRatio(): number {
    if (this.trades.length < 2) return 0.0;
    const returns = this.trades.map((t) => t.pnl_pct);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    if (std === 0) return 0.0;
    return round((mean / std) * Math.sqrt(returns.length), 2);
  }

  get maxConsecutiveLosses(): number {
    let streak = 0;
    let worst = 0;
    for (const t of this.trades) {
      if (t.pnl_pct <= 0) {
        streak += 1;
        worst = Math.max(worst, streak);
      } else {
        streak = 0;
      }
    }
    return worst;
  }

  summary() {
    return {
      num_trades: this.trades.length,
      win_rate_pct: this.winRate,
      avg_win_pct: this.avgWinPct,
      avg_loss_pct: this.avgLossPct,
      profit_factor: this.profitFactor,
      max_drawdown_pct: this.maxDrawdownPct,
      sharpe_ratio: this.sharpeRatio,
      max_consecutive_losses: this.maxConsecutiveLosses,
    };
  }
}

export function runBacktest(candles: Candle[], warmup = 60): BacktestReport {
  const report = new BacktestReport();
  let inTrade = false;
  let levels: risk.TradeLevels | null = null;
  let entryIndex = -1;

  for (let i = warmup; i < candles.length; i++) {
    const window = candles.slice(0, i + 1);

    if (inTrade && levels) {
      const bar = candles[i];
      if (bar.low <= levels.stop_loss) {
        const pnl = ((levels.stop_loss - levels.entry) / levels.entry) * 100;
        report.trades.push({
          entry_index: entryIndex,
          entry_price: levels.entry,
          exit_price: levels.stop_loss,
          exit_reason: "stop_loss",
          pnl_pct: round(pnl, 2),
        });
        inTrade = false;
      } else if (bar.high >= levels.take_profit_1) {
        const pnl = ((levels.take_profit_1 - levels.entry) / levels.entry) * 100;
        report.trades.push({
          entry_index: entryIndex,
          entry_price: levels.entry,
          exit_price: levels.take_profit_1,
          exit_reason: "take_profit",
          pnl_pct: round(pnl, 2),
        });
        inTrade = false;
      }
      continue;
    }

    let latest;
    try {
      latest = indicators.computeAll(window);
    } catch {
      continue;
    }

    const trend = classifyTrend(latest);
    const setup = detectSetup(latest, trend.label);
    if (setup === null) continue;

    levels = risk.computeLevels(setup.entry, setup.atr, setup.direction);
    if (!risk.meetsMinRR(levels)) continue;

    inTrade = true;
    entryIndex = i;
  }

  if (inTrade && levels) {
    const lastClose = candles[candles.length - 1].close;
    const pnl = ((lastClose - levels.entry) / levels.entry) * 100;
    report.trades.push({
      entry_index: entryIndex,
      entry_price: levels.entry,
      exit_price: lastClose,
      exit_reason: "end_of_data",
      pnl_pct: round(pnl, 2),
    });
  }

  return report;
}
