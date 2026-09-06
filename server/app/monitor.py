"""Real-Time Monitoring.

Tracks the lifecycle of a generated signal against live prices:
WAITING -> ENTRY_TRIGGERED -> IN_PROFIT -> TAKE_PROFIT / STOP_LOSS / INVALIDATED.
In-memory only; swap for a database-backed store for persistence across restarts.
"""
from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field

_id_counter = itertools.count(1)


@dataclass
class MonitoredTrade:
    id: int
    symbol: str
    direction: str
    entry: float
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    status: str = "WAITING"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    history: list[dict] = field(default_factory=list)

    def _transition(self, new_status: str, price: float):
        self.status = new_status
        self.updated_at = time.time()
        self.history.append({"status": new_status, "price": price, "at": self.updated_at})

    def update_price(self, price: float):
        long = self.direction == "long"
        if self.status == "WAITING":
            triggered = price >= self.entry if long else price <= self.entry
            if triggered:
                self._transition("ENTRY_TRIGGERED", price)
            return

        if self.status in ("ENTRY_TRIGGERED", "IN_PROFIT"):
            hit_tp = price >= self.take_profit_1 if long else price <= self.take_profit_1
            hit_sl = price <= self.stop_loss if long else price >= self.stop_loss
            if hit_sl:
                self._transition("STOP_LOSS", price)
            elif hit_tp:
                self._transition("TAKE_PROFIT", price)
            else:
                in_profit = price > self.entry if long else price < self.entry
                if in_profit and self.status != "IN_PROFIT":
                    self._transition("IN_PROFIT", price)


class TradeMonitor:
    def __init__(self):
        self._trades: dict[int, MonitoredTrade] = {}

    def track(self, symbol: str, direction: str, entry: float, stop_loss: float, tp1: float, tp2: float) -> MonitoredTrade:
        trade = MonitoredTrade(id=next(_id_counter), symbol=symbol, direction=direction, entry=entry, stop_loss=stop_loss, take_profit_1=tp1, take_profit_2=tp2)
        self._trades[trade.id] = trade
        return trade

    def update_price(self, symbol: str, price: float):
        for trade in self._trades.values():
            if trade.symbol == symbol and trade.status not in ("TAKE_PROFIT", "STOP_LOSS", "INVALIDATED"):
                trade.update_price(price)

    def active(self) -> list[MonitoredTrade]:
        return [t for t in self._trades.values() if t.status not in ("TAKE_PROFIT", "STOP_LOSS", "INVALIDATED")]

    def all(self) -> list[MonitoredTrade]:
        return list(self._trades.values())


trade_monitor = TradeMonitor()
