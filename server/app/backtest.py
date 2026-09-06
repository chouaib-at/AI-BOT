"""Historical Testing.

Walks a historical OHLCV series bar-by-bar, re-using the same signal
detection and risk-management logic the live scanner uses, so backtest
results actually reflect the live strategy rather than a separate
approximation of it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import indicators, risk
from .regime import classify_trend
from .signals import detect_setup


@dataclass
class TradeResult:
    entry_index: int
    entry_price: float
    exit_price: float
    exit_reason: str  # "take_profit" | "stop_loss" | "end_of_data"
    pnl_pct: float


@dataclass
class BacktestReport:
    trades: list[TradeResult] = field(default_factory=list)

    @property
    def win_rate(self) -> float:
        if not self.trades:
            return 0.0
        wins = sum(1 for t in self.trades if t.pnl_pct > 0)
        return round(wins / len(self.trades) * 100, 2)

    @property
    def avg_win_pct(self) -> float:
        wins = [t.pnl_pct for t in self.trades if t.pnl_pct > 0]
        return round(float(np.mean(wins)), 2) if wins else 0.0

    @property
    def avg_loss_pct(self) -> float:
        losses = [t.pnl_pct for t in self.trades if t.pnl_pct <= 0]
        return round(float(np.mean(losses)), 2) if losses else 0.0

    @property
    def profit_factor(self) -> float:
        gross_win = sum(t.pnl_pct for t in self.trades if t.pnl_pct > 0)
        gross_loss = abs(sum(t.pnl_pct for t in self.trades if t.pnl_pct <= 0))
        return round(gross_win / gross_loss, 2) if gross_loss else float("inf") if gross_win else 0.0

    @property
    def max_drawdown_pct(self) -> float:
        if not self.trades:
            return 0.0
        equity = np.cumsum([t.pnl_pct for t in self.trades])
        running_max = np.maximum.accumulate(equity)
        drawdown = equity - running_max
        return round(float(drawdown.min()), 2)

    @property
    def sharpe_ratio(self) -> float:
        if len(self.trades) < 2:
            return 0.0
        returns = np.array([t.pnl_pct for t in self.trades])
        if returns.std() == 0:
            return 0.0
        return round(float(returns.mean() / returns.std() * np.sqrt(len(returns))), 2)

    @property
    def max_consecutive_losses(self) -> int:
        streak = worst = 0
        for t in self.trades:
            if t.pnl_pct <= 0:
                streak += 1
                worst = max(worst, streak)
            else:
                streak = 0
        return worst

    def summary(self) -> dict:
        return {
            "num_trades": len(self.trades),
            "win_rate_pct": self.win_rate,
            "avg_win_pct": self.avg_win_pct,
            "avg_loss_pct": self.avg_loss_pct,
            "profit_factor": self.profit_factor,
            "max_drawdown_pct": self.max_drawdown_pct,
            "sharpe_ratio": self.sharpe_ratio,
            "max_consecutive_losses": self.max_consecutive_losses,
        }


def run_backtest(df: pd.DataFrame, warmup: int = 60) -> BacktestReport:
    """Re-runs the live setup-detection + risk logic bar-by-bar over
    historical OHLCV data. `warmup` bars are reserved for indicators to
    become valid before the first possible trade."""
    report = BacktestReport()
    in_trade = False
    levels = None
    entry_index = None

    for i in range(warmup, len(df)):
        window = df.iloc[: i + 1]

        if in_trade:
            bar = df.iloc[i]
            if bar["low"] <= levels.stop_loss:
                pnl = (levels.stop_loss - levels.entry) / levels.entry * 100
                report.trades.append(TradeResult(entry_index, levels.entry, levels.stop_loss, "stop_loss", round(pnl, 2)))
                in_trade = False
            elif bar["high"] >= levels.take_profit_1:
                pnl = (levels.take_profit_1 - levels.entry) / levels.entry * 100
                report.trades.append(TradeResult(entry_index, levels.entry, levels.take_profit_1, "take_profit", round(pnl, 2)))
                in_trade = False
            continue

        try:
            latest = indicators.compute_all(window)
        except ValueError:
            continue

        trend = classify_trend(latest)
        setup = detect_setup(latest, trend["label"])
        if setup is None:
            continue

        levels = risk.compute_levels(setup.entry, setup.atr, setup.direction)
        if not levels.meets_min_rr:
            continue

        in_trade = True
        entry_index = i

    if in_trade and levels is not None:
        last_close = df.iloc[-1]["close"]
        pnl = (last_close - levels.entry) / levels.entry * 100
        report.trades.append(TradeResult(entry_index, levels.entry, last_close, "end_of_data", round(pnl, 2)))

    return report
