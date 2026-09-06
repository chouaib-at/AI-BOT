/**
 * Orchestrates one full daily scan: market data -> ranking -> technical
 * analysis -> regime -> signals -> risk -> scoring -> report, tying every
 * module together. Also contains the lightweight "AI Analysis Layer" that
 * turns the structured findings into a plain-language explanation using
 * probability-style language rather than guarantees.
 */
import * as config from "./config";
import * as indicators from "./indicators";
import * as ranking from "./ranking";
import * as risk from "./risk";
import * as scoring from "./scoring";
import { MarketDataError, MarketDataProvider, CoinSnapshot } from "./marketData";
import { classifyTrend, marketContext, multiTimeframeTrend } from "./regime";
import { Setup, buildTradeSetup, detectSetup } from "./signals";
import { LatestIndicators } from "./indicators";

const PRIMARY_TIMEFRAME = "1h";

function explain(coinSymbol: string, setup: Setup, score: scoring.ScoreResult, levels: risk.TradeLevels): string {
  const tierPhrase: Record<string, string> =
    {
      strong: "a strong, well-confirmed configuration",
      good: "a good configuration with reasonable confirmation",
      watchlist: "an early-stage configuration that needs more confirmation",
    };
  const phrase = tierPhrase[score.tier] ?? "a configuration that does not yet meet the bar for a trade";
  const reasons = setup.reasons.join("; ");
  return (
    `${coinSymbol}: based on current conditions this is ${phrase} ` +
    `(${setup.name}, score ${score.total}/100). Confirming factors: ${reasons}. ` +
    `If the setup plays out favorably, price could move toward the take-profit zone ` +
    `(+${levels.reward_pct_1}% to +${levels.reward_pct_2}%), with risk capped near ` +
    `-${levels.risk_pct}% at the stop-loss. This is a probability-weighted estimate, ` +
    `not a prediction of guaranteed profit.`
  );
}

export async function analyzeCoin(provider: MarketDataProvider, coin: CoinSnapshot): Promise<any> {
  const perTimeframeLatest: Record<string, LatestIndicators> = {};
  for (const tf of config.TIMEFRAMES) {
    try {
      const candles = await provider.getOhlc(coin.id, tf);
      perTimeframeLatest[tf] = indicators.computeAll(candles);
    } catch (exc) {
      // Skip this timeframe rather than fabricating data, but surface why —
      // silently swallowing this hides rate-limit/API errors from the user.
      console.warn(`Skipping ${tf} timeframe for ${coin.symbol}: ${(exc as Error).message}`);
      continue;
    }
  }

  if (!(PRIMARY_TIMEFRAME in perTimeframeLatest)) {
    return { symbol: coin.symbol, status: "NO_TRADE", reason: "Insufficient OHLC data on primary timeframe" };
  }

  const mtf = multiTimeframeTrend(perTimeframeLatest);
  const primaryLatest = perTimeframeLatest[PRIMARY_TIMEFRAME];

  const setup = detectSetup(primaryLatest, mtf.overall);
  if (setup === null) {
    return {
      symbol: coin.symbol,
      status: "NO_TRADE",
      reason: "No qualifying setup on primary timeframe",
      trend: classifyTrend(primaryLatest).label,
    };
  }

  const levels = buildTradeSetup(setup);
  if (!risk.meetsMinRR(levels)) {
    return {
      symbol: coin.symbol,
      status: "NO_TRADE",
      reason: `Risk/reward ${levels.risk_reward}:1 below minimum ${config.MIN_RISK_REWARD}:1`,
    };
  }

  const score = scoring.scoreOpportunity(primaryLatest, mtf.agreement, setup, levels, coin.volume24h);
  if (score.tier === "no_trade") {
    return { symbol: coin.symbol, status: "NO_TRADE", reason: `Score ${score.total}/100 below watchlist threshold` };
  }

  const position = risk.positionSize(config.DEFAULT_ACCOUNT_BALANCE, levels);

  return {
    symbol: coin.symbol,
    coin_id: coin.id,
    name: coin.name,
    status: score.tier === "watchlist" ? "WATCHLIST" : "SIGNAL",
    signal: setup.direction === "long" ? "BUY" : "SELL",
    setup: setup.name,
    reasons: setup.reasons,
    entry: levels.entry,
    stop_loss: levels.stop_loss,
    take_profit_1: levels.take_profit_1,
    take_profit_2: levels.take_profit_2,
    expected_move_pct: [levels.reward_pct_1, levels.reward_pct_2],
    risk_pct: levels.risk_pct,
    risk_reward: levels.risk_reward,
    confidence_score: score.total,
    score_breakdown: score.breakdown,
    position_size: position,
    trend: mtf.overall,
    explanation: explain(coin.symbol, setup, score, levels),
    current_price: coin.price,
    volume_24h: coin.volume24h,
    fetched_at: coin.fetchedAt,
  };
}

export async function runDailyScan(accountBalance?: number): Promise<any> {
  const provider = new MarketDataProvider();
  const started = Date.now() / 1000;

  const snapshots = await provider.getMarketSnapshot(config.CANDIDATE_POOL_SIZE);
  const topCoins = ranking.selectTopCoins(snapshots);

  const btc = snapshots.find((c) => c.symbol === "BTC");
  let marketRegime: any = { btc_trend: "unknown", risk_mode: "unknown" };
  if (btc) {
    const btcTfs: Record<string, LatestIndicators> = {};
    for (const tf of config.TIMEFRAMES) {
      try {
        const candles = await provider.getOhlc(btc.id, tf);
        btcTfs[tf] = indicators.computeAll(candles);
      } catch (exc) {
        console.warn(`Skipping ${tf} timeframe for BTC market regime: ${(exc as Error).message}`);
        continue;
      }
    }
    if (Object.keys(btcTfs).length) marketRegime = marketContext(btcTfs);
  }

  const results: any[] = [];
  for (const coin of topCoins) {
    try {
      results.push(await analyzeCoin(provider, coin));
    } catch (exc: any) {
      results.push({ symbol: coin.symbol, status: "NO_TRADE", reason: `Analysis error: ${exc.message}` });
    }
  }

  const signals = results.filter((r) => r.status === "SIGNAL");
  const watchlist = results.filter((r) => r.status === "WATCHLIST");
  const noTrade = results.filter((r) => r.status === "NO_TRADE");
  signals.sort((a, b) => b.confidence_score - a.confidence_score);

  return {
    scanned_at: started,
    vs_currency: config.VS_CURRENCY,
    market_regime: marketRegime,
    top_coins: topCoins.map((c) => c.symbol),
    opportunities: signals,
    watchlist,
    no_trade: noTrade,
    account_balance: accountBalance ?? config.DEFAULT_ACCOUNT_BALANCE,
    execution_enabled: config.EXECUTION_ENABLED,
  };
}

export { MarketDataError };
