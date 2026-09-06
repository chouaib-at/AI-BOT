"""Risk Management Engine.

Calculates stop-loss / take-profit levels and position size. Every trade
setup this module touches must end up with an explicit entry, stop-loss,
take-profit and risk/reward ratio — a setup that can't produce all four is
not a valid trade.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import config


@dataclass
class TradeLevels:
    entry: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    risk_pct: float
    reward_pct_1: float
    reward_pct_2: float
    risk_reward: float

    @property
    def meets_min_rr(self) -> bool:
        return self.risk_reward >= config.MIN_RISK_REWARD


def compute_levels(entry: float, atr_value: float, direction: str = "long") -> TradeLevels:
    """Derive stop-loss and take-profit levels from ATR-based volatility,
    then clamp the take-profit target into the realistic 3-10% zone this
    system targets rather than chasing arbitrary round numbers."""
    if atr_value <= 0:
        atr_value = entry * 0.01  # fallback: 1% synthetic volatility floor

    stop_distance = max(atr_value * 1.5, entry * 0.008)
    sign = 1 if direction == "long" else -1

    stop_loss = entry - sign * stop_distance
    risk_pct = abs(entry - stop_loss) / entry * 100

    tp1_pct = min(max(risk_pct * config.PREFERRED_RISK_REWARD, config.TARGET_PROFIT_PCT[0]), config.TARGET_PROFIT_PCT[1])
    tp2_pct = min(tp1_pct * 1.6, config.MAX_PROFIT_TARGET_PCT)

    take_profit_1 = entry + sign * entry * tp1_pct / 100
    take_profit_2 = entry + sign * entry * tp2_pct / 100

    risk_reward = tp1_pct / risk_pct if risk_pct else 0

    return TradeLevels(
        entry=round(entry, 6),
        stop_loss=round(stop_loss, 6),
        take_profit_1=round(take_profit_1, 6),
        take_profit_2=round(take_profit_2, 6),
        risk_pct=round(risk_pct, 2),
        reward_pct_1=round(tp1_pct, 2),
        reward_pct_2=round(tp2_pct, 2),
        risk_reward=round(risk_reward, 2),
    )


def position_size(account_balance: float, levels: TradeLevels, risk_per_trade_pct: float | None = None) -> dict:
    """Position size from account balance and stop-loss distance, capped at
    the configured max risk per trade."""
    risk_pct = risk_per_trade_pct if risk_per_trade_pct is not None else config.MAX_RISK_PER_TRADE_PCT
    max_risk_amount = account_balance * risk_pct / 100
    risk_per_unit = abs(levels.entry - levels.stop_loss)
    if risk_per_unit <= 0:
        return {"units": 0, "position_value": 0, "max_risk_amount": round(max_risk_amount, 2)}

    units = max_risk_amount / risk_per_unit
    position_value = units * levels.entry
    return {
        "units": round(units, 6),
        "position_value": round(position_value, 2),
        "max_risk_amount": round(max_risk_amount, 2),
    }
