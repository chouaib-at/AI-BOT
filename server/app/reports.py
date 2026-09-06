"""Formats a scan result dict into the human-readable daily report shown in
`README.md` / requested in the spec."""
from __future__ import annotations

import datetime as dt


def format_daily_report(scan: dict) -> str:
    date_str = dt.datetime.fromtimestamp(scan["scanned_at"], tz=dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "CRYPTO DAILY SCAN",
        f"Date: {date_str}",
        f"Market Condition: {scan['market_regime'].get('btc_trend', 'unknown').upper()} "
        f"(risk mode: {scan['market_regime'].get('risk_mode', 'unknown')})",
        "",
        "Top Coins Scanned:",
        ", ".join(scan["top_coins"]) or "(none met liquidity/volume criteria)",
        "",
        "BEST OPPORTUNITIES",
    ]

    if not scan["opportunities"]:
        lines.append("(none — no setup met the confidence threshold today)")
    for i, op in enumerate(scan["opportunities"], 1):
        lines += [
            f"#{i} {op['symbol']}/USDT",
            f"Signal: {op['signal']} ({op['setup']})",
            f"Entry: {op['entry']}",
            f"Stop Loss: {op['stop_loss']}",
            f"Take Profit 1: {op['take_profit_1']}",
            f"Take Profit 2: {op['take_profit_2']}",
            f"Expected Move: +{op['expected_move_pct'][0]}% to +{op['expected_move_pct'][1]}%",
            f"Risk: -{op['risk_pct']}%",
            f"Risk/Reward: {op['risk_reward']}:1",
            f"Confidence Score: {op['confidence_score']}/100",
            "Reason: " + "; ".join(op["reasons"]),
            "",
        ]

    lines.append("WATCHLIST")
    if not scan["watchlist"]:
        lines.append("(none)")
    for wl in scan["watchlist"]:
        lines.append(f"{wl['symbol']}/USDT — {wl.get('setup', 'watching')} (score {wl['confidence_score']}/100)")

    lines.append("")
    lines.append("NO TRADE")
    if not scan["no_trade"]:
        lines.append("(none)")
    for nt in scan["no_trade"]:
        lines.append(f"{nt['symbol']}/USDT — {nt.get('reason', 'no qualifying setup')}")

    return "\n".join(lines)
