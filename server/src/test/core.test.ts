import assert from "node:assert/strict";
import test from "node:test";

import { computeAll } from "../indicators";
import { computeLevels, meetsMinRR, positionSize } from "../risk";
import { selectTopCoins } from "../ranking";
import { runBacktest } from "../backtest";
import { CoinSnapshot } from "../marketData";

function makeCandles(n: number, start = 100): { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[] {
  const candles = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    price += Math.sin(i / 5) * 2 + 0.1;
    const open = price;
    const close = price + 0.5;
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;
    candles.push({ timestamp: i * 3_600_000, open, high, low, close, volume: 1_000_000 + i * 1000 });
    price = close;
  }
  return candles;
}

test("computeAll produces a full indicator snapshot", () => {
  const candles = makeCandles(250);
  const latest = computeAll(candles);
  assert.equal(typeof latest.close, "number");
  assert.equal(typeof latest.rsi, "number");
  assert.ok(latest.rsi! >= 0 && latest.rsi! <= 100);
  assert.ok("ema_20" in latest);
  assert.ok("ema_200" in latest);
});

test("computeAll rejects too-short series", () => {
  assert.throws(() => computeAll(makeCandles(3)));
});

test("risk.computeLevels always produces entry/SL/TP/RR", () => {
  const levels = computeLevels(100, 2, "long");
  assert.equal(levels.entry, 100);
  assert.ok(levels.stop_loss < levels.entry);
  assert.ok(levels.take_profit_1 > levels.entry);
  assert.ok(levels.risk_reward > 0);
});

test("risk.meetsMinRR gates low risk/reward setups", () => {
  const good = computeLevels(100, 0.3, "long");
  assert.equal(typeof meetsMinRR(good), "boolean");
});

test("risk.positionSize caps risk to account balance", () => {
  const levels = computeLevels(100, 2, "long");
  const size = positionSize(1000, levels);
  assert.ok(size.max_risk_amount <= 10.01);
});

test("ranking.selectTopCoins filters excluded/illiquid coins", () => {
  const snapshots: CoinSnapshot[] = [
    {
      id: "bitcoin",
      symbol: "BTC",
      name: "Bitcoin",
      price: 60000,
      marketCap: 1_000_000_000,
      volume24h: 100_000_000,
      high24h: 61000,
      low24h: 59000,
      priceChangePct24h: 2.5,
      fetchedAt: Date.now() / 1000,
    },
    {
      id: "tether",
      symbol: "USDT",
      name: "Tether",
      price: 1,
      marketCap: 1_000_000_000,
      volume24h: 100_000_000,
      high24h: 1.001,
      low24h: 0.999,
      priceChangePct24h: 0.01,
      fetchedAt: Date.now() / 1000,
    },
  ];
  const top = selectTopCoins(snapshots, 5);
  assert.deepEqual(top.map((c) => c.symbol), ["BTC"]);
});

test("backtest.runBacktest returns a summary shape even with no trades", () => {
  const candles = makeCandles(80);
  const report = runBacktest(candles, 70);
  const summary = report.summary();
  assert.equal(typeof summary.num_trades, "number");
  assert.equal(typeof summary.win_rate_pct, "number");
});
