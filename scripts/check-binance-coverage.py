#!/usr/bin/env python3
"""
Check what the ORIGINAL cryptoUniverse (273 symbols) coverage looks like
when Binance perps is included as a 5th source.

This script does NOT modify cryptoUniverse.js. It just reports what the
coverage WOULD be if we had kept all 273 symbols and added Binance perps
to the sourceResolver chain.

The goal: identify which of the 100 "orphans" we removed are actually
covered by Binance, so we can re-add them.
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def fetch_json(url, method='GET', body=None):
    headers = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'}
    if body:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(body).encode()
    req = urllib.request.Request(url, method=method, headers=headers, data=body)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def fetch_hyperliquid_universe():
    try:
        d = fetch_json('https://api.hyperliquid.xyz/info', method='POST',
                       body={'type': 'meta'})
        return set(u.get('name', '') for u in d.get('universe', []))
    except Exception as e:
        print(f"  ! Hyperliquid fetch failed: {e}", file=sys.stderr)
        return set()


def fetch_okx_universe():
    try:
        d = fetch_json('https://www.okx.com/api/v5/public/instruments?instType=SWAP')
        coins = set()
        for inst in d.get('data', []):
            inst_id = inst.get('instId', '')
            parts = inst_id.split('-')
            if parts:
                coins.add(parts[0])
        return coins
    except Exception as e:
        print(f"  ! OKX fetch failed: {e}", file=sys.stderr)
        return set()


def fetch_bybit_universe():
    try:
        d = fetch_json('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000')
        coins = set()
        for inst in d.get('result', {}).get('list', []):
            sym = inst.get('symbol', '')
            if sym.endswith('USDT'):
                coins.add(sym[:-4])
        return coins
    except Exception as e:
        print(f"  ! Bybit fetch failed: {e}", file=sys.stderr)
        return set()


def fetch_binance_perps_universe():
    """Returns a dict mapping normalized_symbol -> actual_baseAsset."""
    try:
        d = fetch_json('https://fapi.binance.com/fapi/v1/exchangeInfo')
        coins = {}
        for inst in d.get('symbols', []):
            if inst.get('contractType') == 'PERPETUAL':
                base = inst.get('baseAsset', '')
                quote = inst.get('quoteAsset', '')
                if base and quote == 'USDT':
                    coins[base] = base
                    if base.startswith('1000000'):
                        coins[base[7:]] = base
                    elif base.startswith('1000'):
                        coins[base[4:]] = base
        return coins
    except Exception as e:
        print(f"  ! Binance perps fetch failed: {e}", file=sys.stderr)
        return {}


def fetch_coingecko_snapshot():
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
    # Read the ORIGINAL (pre-cleanup) cryptoUniverse.js from git history
    import subprocess
    orig_text = subprocess.run(
        ['git', 'show', '786235f^:src/lib/board/cryptoUniverse.js'],
        cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout
    symbols = re.findall(r"symbol:\s*'([^']+)'", orig_text)

    print(f"━" * 70)
    print(f"ORIGINAL CRYPTO_UNIVERSE (before orphan removal): {len(symbols)} symbols")
    print(f"━" * 70)
    print()
    print("Fetching live universes from each source...")
    hl = fetch_hyperliquid_universe()
    print(f"  Hyperliquid:     {len(hl)} perps")
    okx = fetch_okx_universe()
    print(f"  OKX SWAP:        {len(okx)} instruments")
    bybit = fetch_bybit_universe()
    print(f"  Bybit:           {len(bybit)} linear perps")
    binance = fetch_binance_perps_universe()  # dict
    print(f"  Binance perps:   {len(binance)} USDT perpetuals (with 1000x/1000000x normalization)")
    cg = fetch_coingecko_snapshot()
    print(f"  CoinGecko:       {len(cg)} coins in snapshot")
    print()

    # Per-symbol coverage
    coverage = []
    for sym in symbols:
        sources = []
        if sym in hl: sources.append('HL')
        if sym in okx: sources.append('OKX')
        if sym in bybit: sources.append('Bybit')
        if sym in binance: sources.append('Binance')
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
    print(f"VS PREVIOUS AUDIT (without Binance): 100 orphans (36.6%)")
    print(f"WITH BINANCE PERPS:                  {orphan_count} orphans ({100*orphan_count/len(symbols):.1f}%)")
    print(f"DELTA: {100 - orphan_count} symbols recovered by adding Binance perps")
    print()

    # List TRUE orphans (still no source even with Binance)
    print("━" * 70)
    print("TRUE ORPHANS (still no source even with Binance perps added):")
    true_orphans = [(s, srcs) for s, srcs in coverage if not srcs]
    for sym, _ in true_orphans:
        print(f"  ✗ {sym}")
    print()

    # List symbols that are ONLY on Binance (would be invisible without it)
    print("━" * 70)
    print("SYMBOLS ONLY ON BINANCE (recovered by adding Binance to resolver):")
    binance_only = [(s, srcs) for s, srcs in coverage if srcs == ['Binance']]
    for sym, _ in binance_only:
        print(f"  + {sym}")
    print()

    # Write the re-add list (symbols that should come back)
    re_add = [s for s, srcs in coverage if srcs and 'Binance' in srcs]
    print(f"━" * 70)
    print(f"RECOMMENDATION: re-add {len(re_add)} symbols that Binance covers")
    print(f"(these were wrongly removed as 'orphans' in the previous pass)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
