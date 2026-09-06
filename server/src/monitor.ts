/**
 * Real-Time Monitoring.
 *
 * Tracks the lifecycle of a generated signal against live prices:
 * WAITING -> ENTRY_TRIGGERED -> IN_PROFIT -> TAKE_PROFIT / STOP_LOSS / INVALIDATED.
 * In-memory only; swap for a database-backed store for persistence across restarts.
 */

let idCounter = 1;

export type TradeStatus = "WAITING" | "ENTRY_TRIGGERED" | "IN_PROFIT" | "TAKE_PROFIT" | "STOP_LOSS" | "INVALIDATED";

export interface HistoryEntry {
  status: TradeStatus;
  price: number;
  at: number;
}

export class MonitoredTrade {
  id: number;
  symbol: string;
  direction: "long" | "short";
  entry: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  status: TradeStatus = "WAITING";
  created_at: number = Date.now() / 1000;
  updated_at: number = Date.now() / 1000;
  history: HistoryEntry[] = [];

  constructor(
    id: number,
    symbol: string,
    direction: "long" | "short",
    entry: number,
    stopLoss: number,
    tp1: number,
    tp2: number
  ) {
    this.id = id;
    this.symbol = symbol;
    this.direction = direction;
    this.entry = entry;
    this.stop_loss = stopLoss;
    this.take_profit_1 = tp1;
    this.take_profit_2 = tp2;
  }

  private transition(newStatus: TradeStatus, price: number) {
    this.status = newStatus;
    this.updated_at = Date.now() / 1000;
    this.history.push({ status: newStatus, price, at: this.updated_at });
  }

  updatePrice(price: number) {
    const long = this.direction === "long";
    if (this.status === "WAITING") {
      const triggered = long ? price >= this.entry : price <= this.entry;
      if (triggered) this.transition("ENTRY_TRIGGERED", price);
      return;
    }

    if (this.status === "ENTRY_TRIGGERED" || this.status === "IN_PROFIT") {
      const hitTp = long ? price >= this.take_profit_1 : price <= this.take_profit_1;
      const hitSl = long ? price <= this.stop_loss : price >= this.stop_loss;
      if (hitSl) {
        this.transition("STOP_LOSS", price);
      } else if (hitTp) {
        this.transition("TAKE_PROFIT", price);
      } else {
        const inProfit = long ? price > this.entry : price < this.entry;
        if (inProfit && this.status !== "IN_PROFIT") this.transition("IN_PROFIT", price);
      }
    }
  }
}

export class TradeMonitor {
  private trades = new Map<number, MonitoredTrade>();

  track(
    symbol: string,
    direction: "long" | "short",
    entry: number,
    stopLoss: number,
    tp1: number,
    tp2: number
  ): MonitoredTrade {
    const trade = new MonitoredTrade(idCounter++, symbol, direction, entry, stopLoss, tp1, tp2);
    this.trades.set(trade.id, trade);
    return trade;
  }

  updatePrice(symbol: string, price: number) {
    for (const trade of this.trades.values()) {
      if (trade.symbol === symbol && !["TAKE_PROFIT", "STOP_LOSS", "INVALIDATED"].includes(trade.status)) {
        trade.updatePrice(price);
      }
    }
  }

  active(): MonitoredTrade[] {
    return [...this.trades.values()].filter(
      (t) => !["TAKE_PROFIT", "STOP_LOSS", "INVALIDATED"].includes(t.status)
    );
  }

  all(): MonitoredTrade[] {
    return [...this.trades.values()];
  }
}

export const tradeMonitor = new TradeMonitor();
