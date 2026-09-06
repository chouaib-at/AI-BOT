/**
 * Express application: dashboard/API layer + scheduler.
 *
 * Analysis and signal generation only — this system never places an order.
 * `EXECUTION_ENABLED` exists purely as a documented, explicit off switch for
 * a future separate execution module; it is not wired to any broker here.
 */
import path from "path";
import express from "express";
import cors from "cors";
import cron from "node-cron";

import * as config from "./config";
import { runBacktest } from "./backtest";
import { MarketDataError, MarketDataProvider } from "./marketData";
import { tradeMonitor } from "./monitor";
import { formatDailyReport } from "./reports";
import { runDailyScan } from "./scanner";

const app = express();
app.use(cors());
app.use(express.json());

const state: { latestScan: any | null } = { latestScan: null };

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", execution_enabled: config.EXECUTION_ENABLED });
});

app.post("/api/scan", async (req, res) => {
  try {
    const accountBalance = req.query.account_balance ? parseFloat(req.query.account_balance as string) : undefined;
    const scan = await runDailyScan(accountBalance);
    state.latestScan = scan;
    for (const op of scan.opportunities) {
      tradeMonitor.track(
        op.symbol,
        op.signal === "BUY" ? "long" : "short",
        op.entry,
        op.stop_loss,
        op.take_profit_1,
        op.take_profit_2
      );
    }
    res.json(scan);
  } catch (exc) {
    if (exc instanceof MarketDataError) {
      res.status(502).json({ detail: exc.message });
    } else {
      res.status(500).json({ detail: (exc as Error).message });
    }
  }
});

app.get("/api/scan/latest", (_req, res) => {
  if (state.latestScan === null) {
    res.json({ message: "No scan has run yet. POST /api/scan to run one." });
    return;
  }
  res.json(state.latestScan);
});

app.get("/api/scan/latest/report", (_req, res) => {
  if (state.latestScan === null) {
    res.status(404).json({ detail: "No scan has run yet." });
    return;
  }
  res.json({ report: formatDailyReport(state.latestScan) });
});

app.get("/api/monitor", (_req, res) => {
  res.json(tradeMonitor.all());
});

app.post("/api/monitor/tick", async (_req, res) => {
  const provider = new MarketDataProvider();
  const symbols = new Set(tradeMonitor.active().map((t) => t.symbol));
  if (symbols.size === 0) {
    res.json({ updated: 0 });
    return;
  }
  try {
    const snapshots = await provider.getMarketSnapshot(config.CANDIDATE_POOL_SIZE);
    const priceBySymbol = new Map(snapshots.map((s) => [s.symbol, s.price]));
    let updated = 0;
    for (const symbol of symbols) {
      const price = priceBySymbol.get(symbol);
      if (price !== undefined) {
        tradeMonitor.updatePrice(symbol, price);
        updated += 1;
      }
    }
    res.json({ updated });
  } catch (exc) {
    if (exc instanceof MarketDataError) {
      res.status(502).json({ detail: exc.message });
    } else {
      res.status(500).json({ detail: (exc as Error).message });
    }
  }
});

app.get("/api/backtest/:coinId", async (req, res) => {
  const provider = new MarketDataProvider();
  const timeframe = (req.query.timeframe as string) || "1h";
  try {
    const candles = await provider.getOhlc(req.params.coinId, timeframe);
    const report = runBacktest(candles);
    res.json({ coin_id: req.params.coinId, timeframe, ...report.summary() });
  } catch (exc) {
    if (exc instanceof MarketDataError) {
      res.status(502).json({ detail: exc.message });
    } else {
      res.status(500).json({ detail: (exc as Error).message });
    }
  }
});

app.get("/favicon.ico", (_req, res) => res.status(204).end());

const dashboardDir = path.resolve(__dirname, "..", "dashboard");
app.use(express.static(dashboardDir));

async function scheduledScan() {
  try {
    state.latestScan = await runDailyScan();
    console.log(`Scheduled scan complete: ${state.latestScan.opportunities.length} opportunities`);
  } catch (exc) {
    if (exc instanceof MarketDataError) {
      console.error(`Scheduled scan failed: ${exc.message}`);
    } else {
      throw exc;
    }
  }
}

// node-cron doesn't support arbitrary minute intervals directly for values
// > 59, so run every minute and gate on the configured interval.
let minutesSinceLastScan = 0;
cron.schedule("* * * * *", () => {
  minutesSinceLastScan += 1;
  if (minutesSinceLastScan >= config.SCAN_INTERVAL_MINUTES) {
    minutesSinceLastScan = 0;
    void scheduledScan();
  }
});

app.listen(config.PORT, () => {
  console.log(`Crypto Trading Analysis Bot listening on http://localhost:${config.PORT}`);
});
