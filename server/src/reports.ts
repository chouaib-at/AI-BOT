/**
 * Formats a scan result into the human-readable daily report shown in
 * README.md.
 */
export function formatDailyReport(scan: any): string {
  const dateStr = new Date(scan.scanned_at * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const lines: string[] = [
    "CRYPTO DAILY SCAN",
    `Date: ${dateStr}`,
    `Market Condition: ${(scan.market_regime.btc_trend || "unknown").toUpperCase()} ` +
      `(risk mode: ${scan.market_regime.risk_mode || "unknown"})`,
    "",
    "Top Coins Scanned:",
    scan.top_coins.join(", ") || "(none met liquidity/volume criteria)",
    "",
    "BEST OPPORTUNITIES",
  ];

  if (!scan.opportunities.length) {
    lines.push("(none — no setup met the confidence threshold today)");
  }
  scan.opportunities.forEach((op: any, i: number) => {
    lines.push(
      `#${i + 1} ${op.symbol}/USDT`,
      `Signal: ${op.signal} (${op.setup})`,
      `Entry: ${op.entry}`,
      `Stop Loss: ${op.stop_loss}`,
      `Take Profit 1: ${op.take_profit_1}`,
      `Take Profit 2: ${op.take_profit_2}`,
      `Expected Move: +${op.expected_move_pct[0]}% to +${op.expected_move_pct[1]}%`,
      `Risk: -${op.risk_pct}%`,
      `Risk/Reward: ${op.risk_reward}:1`,
      `Confidence Score: ${op.confidence_score}/100`,
      "Reason: " + op.reasons.join("; "),
      ""
    );
  });

  lines.push("WATCHLIST");
  if (!scan.watchlist.length) lines.push("(none)");
  for (const wl of scan.watchlist) {
    lines.push(`${wl.symbol}/USDT — ${wl.setup || "watching"} (score ${wl.confidence_score}/100)`);
  }

  lines.push("");
  lines.push("NO TRADE");
  if (!scan.no_trade.length) lines.push("(none)");
  for (const nt of scan.no_trade) {
    lines.push(`${nt.symbol}/USDT — ${nt.reason || "no qualifying setup"}`);
  }

  return lines.join("\n");
}
