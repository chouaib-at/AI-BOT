/**
 * Coin Ranking Engine.
 *
 * Dynamically selects the Top N trading candidates for the day from a live
 * market snapshot, based on volume, liquidity, and volatility criteria —
 * never a hard-coded coin list.
 */
import * as config from "./config";
import { CoinSnapshot, spreadProxyPct } from "./marketData";

export function selectTopCoins(snapshots: CoinSnapshot[], topN?: number): CoinSnapshot[] {
  const n = topN ?? config.TOP_N_COINS;

  const candidates = snapshots.filter((coin) => {
    if (config.EXCLUDED_SYMBOLS.has(coin.symbol)) return false;
    if (coin.volume24h < config.MIN_24H_VOLUME_USD) return false;
    if (coin.marketCap < config.MIN_MARKET_CAP_USD) return false;
    const spread = spreadProxyPct(coin);
    if (spread > config.MAX_SPREAD_PCT * 20) return false;
    if (Math.abs(coin.priceChangePct24h) < config.MIN_VOLATILITY_PCT && spread < 0.3) return false;
    return true;
  });

  // Liquidity score blends volume and market cap so mega-caps don't
  // automatically dominate purely because of size; movement/volatility is
  // weighted in too so genuinely tradeable setups rise to the top.
  const liquidityScore = (c: CoinSnapshot): number => {
    const volumeScore = c.volume24h;
    const volatilityScore = Math.abs(c.priceChangePct24h) * c.volume24h * 0.01;
    return volumeScore + volatilityScore;
  };

  candidates.sort((a, b) => liquidityScore(b) - liquidityScore(a));
  return candidates.slice(0, n);
}
