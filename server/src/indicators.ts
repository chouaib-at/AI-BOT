/**
 * Technical Analysis Engine.
 *
 * Pure functions that compute indicators on an OHLCV candle series. No
 * network calls here — this module only transforms data it is given, so it
 * is trivially unit-testable and reusable by both the live scanner and the
 * backtester.
 */
import * as config from "./config";
import { Candle } from "./marketData";

export function ema(series: number[], period: number): number[] {
  const alpha = 2 / (period + 1);
  const out: number[] = [];
  let prev: number | undefined;
  for (const v of series) {
    prev = prev === undefined ? v : v * alpha + prev * (1 - alpha);
    out.push(prev);
  }
  return out;
}

// Wilder-style smoothing (ewm with alpha=1/period, min_periods=period),
// matching pandas' `.ewm(alpha=1/period, min_periods=period, adjust=False)`.
function wilderSmooth(series: number[], period: number): (number | null)[] {
  const alpha = 1 / period;
  const out: (number | null)[] = [];
  let prev: number | undefined;
  for (let i = 0; i < series.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === undefined) {
      // seed with the simple mean of the first `period` values
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += series[j];
      prev = sum / period;
    } else {
      prev = alpha * series[i] + (1 - alpha) * prev;
    }
    out.push(prev);
  }
  return out;
}

export function rsi(close: number[], period: number = config.RSI_PERIOD): number[] {
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < close.length; i++) {
    const delta = close[i] - close[i - 1];
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }
  const avgGain = wilderSmooth(gains, period);
  const avgLoss = wilderSmooth(losses, period);
  return close.map((_, i) => {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (g === null || l === null) return 50;
    if (l === 0) return g === 0 ? 50 : 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  });
}

export interface MacdResult {
  macd: number[];
  signal: number[];
  hist: number[];
}

export function macd(close: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(close, fast);
  const emaSlow = ema(close, slow);
  const macdLine = close.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const hist = macdLine.map((v, i) => v - signalLine[i]);
  return { macd: macdLine, signal: signalLine, hist };
}

export function atr(candles: Candle[], period: number = config.ATR_PERIOD): (number | null)[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  return wilderSmooth(tr, period);
}

export interface BollingerResult {
  mid: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

function rollingMean(series: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    if (i >= period) sum -= series[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

function rollingStd(series: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < series.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    const window = series.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / (period - 1);
    out.push(Math.sqrt(variance));
  }
  return out;
}

function rollingMax(series: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < series.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    out.push(Math.max(...series.slice(i - period + 1, i + 1)));
  }
  return out;
}

function rollingMin(series: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < series.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    out.push(Math.min(...series.slice(i - period + 1, i + 1)));
  }
  return out;
}

export function bollingerBands(
  close: number[],
  period: number = config.BOLLINGER_PERIOD,
  numStd: number = config.BOLLINGER_STD
): BollingerResult {
  const mid = rollingMean(close, period);
  const std = rollingStd(close, period);
  const upper = mid.map((m, i) => (m === null || std[i] === null ? null : m + numStd * (std[i] as number)));
  const lower = mid.map((m, i) => (m === null || std[i] === null ? null : m - numStd * (std[i] as number)));
  return { mid, upper, lower };
}

export function vwap(candles: Candle[]): number[] {
  let cumPV = 0;
  let cumVol = 0;
  return candles.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumVol += c.volume;
    return cumVol === 0 ? typical : cumPV / cumVol;
  });
}

export function volumeMa(candles: Candle[], period: number = config.VOLUME_MA_PERIOD): (number | null)[] {
  return rollingMean(
    candles.map((c) => c.volume),
    period
  );
}

export interface Swings {
  recentHigh: number | null;
  recentLow: number | null;
  higherHighs: boolean;
  lowerLows: boolean;
}

function arraySplit<T>(arr: T[], parts: number): T[][] {
  const result: T[][] = [];
  const n = arr.length;
  const base = Math.floor(n / parts);
  const extra = n % parts;
  let idx = 0;
  for (let i = 0; i < parts; i++) {
    const size = base + (i < extra ? 1 : 0);
    result.push(arr.slice(idx, idx + size));
    idx += size;
  }
  return result;
}

export function swingPoints(candles: Candle[], lookback = 5): Swings {
  const tailLen = lookback * 4;
  const highs = candles.slice(-tailLen).map((c) => c.high);
  const lows = candles.slice(-tailLen).map((c) => c.low);
  const recentHigh = highs.length ? Math.max(...highs) : null;
  const recentLow = lows.length ? Math.min(...lows) : null;

  const partsH = Math.min(4, Math.max(1, Math.floor(highs.length / lookback) || 1));
  const partsL = Math.min(4, Math.max(1, Math.floor(lows.length / lookback) || 1));
  const segH = arraySplit(highs, partsH).filter((s) => s.length);
  const segL = arraySplit(lows, partsL).filter((s) => s.length);

  let hh = false;
  if (segH.length > 1) {
    hh = true;
    for (let i = 0; i < segH.length - 1; i++) {
      if (Math.max(...segH[i]) > Math.max(...segH[i + 1])) {
        hh = false;
        break;
      }
    }
  }
  let ll = false;
  if (segL.length > 1) {
    ll = true;
    for (let i = 0; i < segL.length - 1; i++) {
      if (Math.min(...segL[i]) < Math.min(...segL[i + 1])) {
        ll = false;
        break;
      }
    }
  }

  return { recentHigh, recentLow, higherHighs: hh, lowerLows: ll };
}

export interface SupportResistance {
  support: number | null;
  resistance: number | null;
}

export function supportResistance(candles: Candle[], window = 20): SupportResistance {
  const highs = rollingMax(
    candles.map((c) => c.high),
    window
  );
  const lows = rollingMin(
    candles.map((c) => c.low),
    window
  );
  return {
    resistance: highs[highs.length - 1] ?? null,
    support: lows[lows.length - 1] ?? null,
  };
}

export interface FullSeries {
  ema: Record<number, number[]>;
  rsi: number[];
  macd: number[];
  macdSignal: number[];
  macdHist: number[];
  atr: (number | null)[];
  bbMid: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
  vwap: number[];
  volumeMa: (number | null)[];
}

export interface LatestIndicators {
  close: number;
  volume: number;
  rsi: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  atr: number | null;
  bb_mid: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
  vwap: number | null;
  volume_ma: number | null;
  swings: Swings;
  support_resistance: SupportResistance;
  [key: `ema_${number}`]: number | null | any;
  _series: FullSeries;
}

export function computeAll(candles: Candle[]): LatestIndicators {
  if (!candles || candles.length < 5) {
    throw new Error("Not enough candles to compute indicators");
  }
  const close = candles.map((c) => c.close);
  const last = close.length - 1;

  const emaMap: Record<number, number[]> = {};
  for (const period of config.EMA_PERIODS) emaMap[period] = ema(close, period);

  const rsiSeries = rsi(close);
  const macdRes = macd(close);
  const atrSeries = atr(candles);
  const bb = bollingerBands(close);
  const vwapSeries = vwap(candles);
  const volMa = volumeMa(candles);

  const series: FullSeries = {
    ema: emaMap,
    rsi: rsiSeries,
    macd: macdRes.macd,
    macdSignal: macdRes.signal,
    macdHist: macdRes.hist,
    atr: atrSeries,
    bbMid: bb.mid,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    vwap: vwapSeries,
    volumeMa: volMa,
  };

  const latest: LatestIndicators = {
    close: close[last],
    volume: candles[last].volume,
    rsi: rsiSeries[last] ?? null,
    macd: macdRes.macd[last] ?? null,
    macd_signal: macdRes.signal[last] ?? null,
    macd_hist: macdRes.hist[last] ?? null,
    atr: atrSeries[last],
    bb_mid: bb.mid[last],
    bb_upper: bb.upper[last],
    bb_lower: bb.lower[last],
    vwap: vwapSeries[last] ?? null,
    volume_ma: volMa[last],
    swings: swingPoints(candles),
    support_resistance: supportResistance(candles),
    _series: series,
  };
  for (const period of config.EMA_PERIODS) {
    (latest as any)[`ema_${period}`] = emaMap[period][last];
  }
  return latest;
}
