#!/usr/bin/env python3
"""
Audit cryptoUniverse.js against actual exchange coverage.

For each asset in CRYPTO_UNIVERSE, check whether at least one of our
active sources supports that symbol. The user reports that only ~half
of the top 300 universe gets returned by Market Board.

Strategy:
  1. Extract all symbols from src/lib/board/cryptoUniverse.js
  2. Fetch the actual instrument universe from each active source:
     - Hyperliquid: POST https://api.hyperliquid.xyz/info, body {type:"meta"}
     - OKX: GET https://www.okx.com/api/v5/public/instruments?instType=SWAP
     - Bybit: GET https://api.bybit.com/v5/market/instruments-info?category=linear
     - CoinGecko: snapshot.json (already has top 100 by mcap)
  3. For each CRYPTO_UNIVERSE symbol, report which sources cover it
  4. Identify orphans (no source supports the symbol) and recommend
     either: (a) renaming to a different ticker the source uses, or
     (b) removing the asset from the universe
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE_PATH = ROOT / "src/lib/board/cryptoUniverse.js"


def extract_symbols():
    """Parse all symbols from cryptoUniverse.js."""
    text = UNIVERSE_PATH.read_text()
    # Match { symbol: 'XXX', name: '...', ... }
    matches = re.findall(r"symbol:\s*'([^']+)'", text)
    return matches


def fetch_json(url, method='GET', body=None):
    """Fetch JSON from a URL."""
    headers = {'User-Agent': 'TrendScan-Audit/1.0'}
    if body:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(body).encode()
    req = urllib.request.Request(url, method=method, headers=headers, data=body)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def fetch_hyperliquid_universe():
    """Returns a set of symbol names listed on Hyperliquid perps."""
    try:
        d = fetch_json(
            'https://api.hyperliquid.xyz/info',
            method='POST',
            body={'type': 'meta'},
        )
        return set(u.get('name', '') for u in d.get('universe', []))
    except Exception as e:
        print(f"  ! Hyperliquid fetch failed: {e}", file=sys.stderr)
        return set()


def fetch_okx_universe():
    """Returns a set of base coins listed on OKX SWAP (perpetuals)."""
    try:
        d = fetch_json(
            'https://www.okx.com/api/v5/public/instruments?instType=SWAP'
        )
        coins = set()
        for inst in d.get('data', []):
            inst_id = inst.get('instId', '')
            # instId is like "BTC-USDT-SWAP"
            parts = inst_id.split('-')
            if parts:
                coins.add(parts[0])
        return coins
    except Exception as e:
        print(f"  ! OKX fetch failed: {e}", file=sys.stderr)
        return set()


def fetch_bybit_universe():
    """Returns a set of base coins listed on Bybit linear perps."""
    try:
        d = fetch_json(
            'https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'
        )
        coins = set()
        for inst in d.get('result', {}).get('list', []):
            sym = inst.get('symbol', '')
            # Symbol is like "BTCUSDT"
            if sym.endswith('USDT'):
                coins.add(sym[:-4])
        return coins
    except Exception as e:
        print(f"  ! Bybit fetch failed: {e}", file=sys.stderr)
        return set()


def fetch_coingecko_snapshot():
    """Returns a set of symbols from the local snapshot.json (top 100)."""
    snap_path = ROOT / "public" / "snapshot.json"
    if not snap_path.exists():
        return set()
    try:
        d = json.loads(snap_path.read_text())
        coins = d.get('coingecko', {}).get('coins', [])
        return set(c.get('symbol', '').upper() for c in coins)
    except Exception as e:
        print(f"  ! CoinGecko snapshot parse failed: {e}", file=sys.stderr)
        return set()


def main():
    print("━" * 70)
    print("Crypto Universe Audit — checking source coverage")
    print("━" * 70)
    print()

    symbols = extract_symbols()
    print(f"CRYPTO_UNIVERSE contains {len(symbols)} symbols")
    print()

    print("Fetching live universes from each source...")
    hl = fetch_hyperliquid_universe()
    print(f"  Hyperliquid: {len(hl)} perps listed")
    okx = fetch_okx_universe()
    print(f"  OKX SWAP:    {len(okx)} instruments ({len(okx)} unique base coins)")
    bybit = fetch_bybit_universe()
    print(f"  Bybit:       {len(bybit)} linear perps")
    cg = fetch_coingecko_snapshot()
    print(f"  CoinGecko:   {len(cg)} coins in local snapshot (top 100)")
    print()

    # Per-symbol coverage
    coverage = []
    for sym in symbols:
        sources = []
        if sym in hl: sources.append('HL')
        if sym in okx: sources.append('OKX')
        if sym in bybit: sources.append('Bybit')
        if sym in cg: sources.append('CG')
        coverage.append((sym, sources))

    orphan_count = sum(1 for _, s in coverage if not s)
    partial_count = sum(1 for _, s in coverage if len(s) == 1)
    full_count = sum(1 for _, s in coverage if len(s) >= 3)

    print("━" * 70)
    print(f"COVERAGE SUMMARY (out of {len(symbols)} symbols):")
    print(f"  ✓ Covered by 3+ sources: {full_count:>4} ({100*full_count/len(symbols):.1f}%)")
    print(f"  ~ Covered by 1-2 sources: {partial_count:>4} ({100*partial_count/len(symbols):.1f}%)")
    print(f"  ✗ Orphans (no source):   {orphan_count:>4} ({100*orphan_count/len(symbols):.1f}%)")
    print()
    print(f"EXPECTED: If only ~50% get returned, that's ~{len(symbols)//2} orphans.")
    print(f"ACTUAL:   {orphan_count} orphans + {partial_count} partial = {orphan_count + partial_count} at-risk symbols")
    print()

    # List all orphans
    print("━" * 70)
    print("ORPHAN SYMBOLS (not supported by ANY source):")
    for sym, srcs in coverage:
        if not srcs:
            print(f"  ✗ {sym}")

    print()
    print("━" * 70)
    print("PARTIAL COVERAGE (only 1 source — risky):")
    for sym, srcs in coverage:
        if len(srcs) == 1:
            print(f"  ~ {sym:<10} only on {srcs[0]}")

    print()
    print("━" * 70)
    print("RECOMMENDATIONS:")
    print("  1. Remove orphan symbols from CRYPTO_UNIVERSE (or find an")
    print("     alternative source for them).")
    print("  2. For partial-coverage symbols, consider whether they should")
    print("     remain in the universe — if the single source fails, the")
    print("     asset silently disappears from the board.")
    print("  3. The CRYPTO_UNIVERSE list appears to have been curated from")
    print("     CoinGecko's top 350 by mcap. Many of these are not listed")
    print("     on Hyperliquid/OKX/Bybit perps, which is what the board's")
    print("     fetchCandles() call uses.")

    return 0 if orphan_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
