/**
 * Market Data Service.
 *
 * Retrieves live cryptocurrency market data from a public API (CoinGecko by
 * default). This is the only module allowed to talk to the network for
 * prices — every other module receives data through this interface, so the
 * provider can be swapped (Binance, Coinbase, CryptoCompare, ...) without
 * touching the rest of the system.
 *
 * Nothing here invents prices: every response is timestamped with the moment
 * it was fetched, and callers must check `fetchedAt` before treating a value
 * as current.
 */
import * as config from "./config";

export class MarketDataError extends Error {}

export interface Candle {
  timestamp: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CoinSnapshot {
  id: string;
  symbol: string;
  name: string;
  price: number;
  marketCap: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  priceChangePct24h: number;
  fetchedAt: number;
}

export function spreadProxyPct(coin: CoinSnapshot): number {
  if (!coin.low24h) return 100.0;
  return ((coin.high24h - coin.low24h) / coin.low24h) * 100.0;
}

const TIMEFRAME_TO_DAYS: Record<string, number> = {
  "5m": 1,
  "15m": 1,
  "1h": 7,
  "4h": 30,
  "1d": 90,
};

export class MarketDataProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl ?? config.COINGECKO_BASE_URL;
    this.apiKey = apiKey ?? config.COINGECKO_API_KEY;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) headers["x-cg-pro-api-key"] = this.apiKey;
    return headers;
  }

  private async get(path: string, params: Record<string, string | number>): Promise<any> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let res: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      res = await fetch(url.toString(), { headers: this.headers(), signal: controller.signal });
      clearTimeout(timeout);
    } catch (exc: any) {
      throw new MarketDataError(`Failed to fetch ${path}: ${exc.message}`);
    }
    if (!res.ok) {
      throw new MarketDataError(`Failed to fetch ${path}: HTTP ${res.status}`);
    }
    return res.json();
  }

  async getMarketSnapshot(poolSize: number): Promise<CoinSnapshot[]> {
    const data = await this.get("/coins/markets", {
      vs_currency: config.VS_CURRENCY,
      order: "market_cap_desc",
      per_page: poolSize,
      page: 1,
      price_change_percentage: "24h",
    });
    const snapshots: CoinSnapshot[] = [];
    for (const row of data as any[]) {
      try {
        if (row.id === undefined || row.symbol === undefined || row.current_price === undefined) continue;
        snapshots.push({
          id: row.id,
          symbol: String(row.symbol).toUpperCase(),
          name: row.name,
          price: row.current_price,
          marketCap: row.market_cap || 0,
          volume24h: row.total_volume || 0,
          high24h: row.high_24h ?? row.current_price,
          low24h: row.low_24h ?? row.current_price,
          priceChangePct24h: row.price_change_percentage_24h ?? 0.0,
          fetchedAt: Date.now() / 1000,
        });
      } catch {
        continue; // skip malformed rows rather than inventing data
      }
    }
    return snapshots;
  }

  async getOhlc(coinId: string, timeframe: string): Promise<Candle[]> {
    const days = TIMEFRAME_TO_DAYS[timeframe] ?? 30;
    const data = (await this.get(`/coins/${coinId}/ohlc`, {
      vs_currency: config.VS_CURRENCY,
      days,
    })) as [number, number, number, number, number][];

    if (!data || data.length === 0) {
      throw new MarketDataError(`No OHLC data returned for ${coinId} (${timeframe})`);
    }

    let candles: Candle[] = data.map(([timestamp, open, high, low, close]) => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume: 0,
    }));

    // CoinGecko doesn't return volume in the OHLC endpoint; fetch market
    // chart volume separately and align it onto the same buckets.
    try {
      const chart = await this.get(`/coins/${coinId}/market_chart`, {
        vs_currency: config.VS_CURRENCY,
        days,
      });
      const volumes: [number, number][] = chart.total_volumes || [];
      let lastVol = 0;
      let vi = 0;
      for (const candle of candles) {
        while (vi < volumes.length && volumes[vi][0] <= candle.timestamp) {
          lastVol = volumes[vi][1];
          vi++;
        }
        candle.volume = lastVol;
      }
    } catch {
      // leave volumes at 0 if the volume endpoint fails
    }

    const bucketMs: Record<string, number> = {
      "5m": 5 * 60_000,
      "15m": 15 * 60_000,
      "1h": 60 * 60_000,
      "4h": 4 * 60 * 60_000,
      "1d": 24 * 60 * 60_000,
    };
    const rule = bucketMs[timeframe];
    if (rule && timeframe !== "5m") {
      candles = resample(candles, rule);
    }
    return candles;
  }
}

function resample(candles: Candle[], bucketMs: number): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const c of candles) {
    const key = Math.floor(c.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  return keys.map((key) => {
    const group = buckets.get(key)!;
    return {
      timestamp: key,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    };
  });
}
