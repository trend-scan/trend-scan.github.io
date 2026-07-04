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
    # Binance blocks the default Python urllib User-Agent with HTTP 403.
    # Use a browser-like UA to be safe across all exchanges.
    headers = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'}
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
    """Returns a set of base coins listed on OKX (SWAP perps + SPOT)."""
    coins = set()
    # SWAP perps
    try:
        d = fetch_json(
            'https://www.okx.com/api/v5/public/instruments?instType=SWAP'
        )
        for inst in d.get('data', []):
            inst_id = inst.get('instId', '')
            parts = inst_id.split('-')
            if parts:
                coins.add(parts[0])
    except Exception as e:
        print(f"  ! OKX SWAP fetch failed: {e}", file=sys.stderr)
    # Spot
    try:
        d = fetch_json(
            'https://www.okx.com/api/v5/public/instruments?instType=SPOT'
        )
        for inst in d.get('data', []):
            inst_id = inst.get('instId', '')
            parts = inst_id.split('-')
            if parts:
                coins.add(parts[0])
    except Exception as e:
        print(f"  ! OKX SPOT fetch failed: {e}", file=sys.stderr)
    return coins


def fetch_bybit_universe():
    """Returns a set of base coins listed on Bybit (linear perps + spot)."""
    coins = set()
    # Linear perps
    try:
        d = fetch_json(
            'https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000'
        )
        for inst in d.get('result', {}).get('list', []):
            sym = inst.get('symbol', '')
            if sym.endswith('USDT'):
                coins.add(sym[:-4])
    except Exception as e:
        print(f"  ! Bybit linear fetch failed: {e}", file=sys.stderr)
    # Spot
    try:
        d = fetch_json(
            'https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000'
        )
        for inst in d.get('result', {}).get('list', []):
            sym = inst.get('symbol', '')
            if sym.endswith('USDT'):
                coins.add(sym[:-4])
    except Exception as e:
        print(f"  ! Bybit spot fetch failed: {e}", file=sys.stderr)
    return coins


def fetch_binance_perps_universe():
    """Returns a dict mapping normalized_symbol -> actual_baseAsset.

    Binance lists low-priced tokens with a '1000' or '1000000' prefix
    (e.g. '1000XEC' instead of 'XEC', '1000000MOG' instead of 'MOG').
    We normalize these so the audit can match against the bare symbol,
    but we keep the actual baseAsset so the source file knows what to
    pass to the API.

    Falls back to /tmp/binance_perps.json cache if live fetch fails
    (Binance returns HTTP 418 when rate-limited).
    """
    cache_path = Path('/tmp/binance_perps.json')
    d = None
    try:
        d = fetch_json('https://fapi.binance.com/fapi/v1/exchangeInfo')
    except Exception as e:
        print(f"  ! Binance perps live fetch failed: {e}", file=sys.stderr)
        if cache_path.exists():
            try:
                d = json.loads(cache_path.read_text())
                print(f"  (Binance: loaded from cache at {cache_path})", file=sys.stderr)
            except Exception as e2:
                print(f"  ! Binance cache load failed: {e2}", file=sys.stderr)
    if d is None:
        return {}
    coins = {}  # normalized -> actual
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
    print(f"  Hyperliquid:     {len(hl)} perps listed")
    okx = fetch_okx_universe()
    print(f"  OKX SWAP:        {len(okx)} instruments ({len(okx)} unique base coins)")
    bybit = fetch_bybit_universe()
    print(f"  Bybit:           {len(bybit)} linear perps")
    binance = fetch_binance_perps_universe()  # dict: normalized -> actual
    print(f"  Binance perps:   {len(binance)} USDT-quoted perpetuals (with 1000x/1000000x normalization)")
    cg = fetch_coingecko_snapshot()
    print(f"  CoinGecko:       {len(cg)} coins in local snapshot (top 100)")
    print()

    # Per-symbol coverage
    coverage = []
    for sym in symbols:
        sources = []
        if sym in hl: sources.append('HL')
        if sym in okx: sources.append('OKX')
        if sym in bybit: sources.append('Bybit')
        if sym in binance: sources.append('Binance')  # dict 'in' check works on keys
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
    print("  1. With 4 perps exchanges (Hyperliquid + OKX + Bybit + Binance)")
    print("     + CoinGecko, true orphans should be near-zero for the top 300.")
    print("  2. If orphans remain, they are likely:")
    print("     - Tokens delisted from major exchanges (re-listed under")
    print("       different tickers, or only on DEXes)")
    print("     - Stablecoins or wrapped tokens not on perps exchanges")
    print("     - Index products (e.g. MAG7.SSI) unique to one exchange")
    print("  3. For partial-coverage symbols (only 1 source), the asset will")
    print("     silently disappear if that single source fails. Consider")
    print("     whether they should remain in the universe.")
    print("  4. If Binance perps is in the coverage list but NOT in the")
    print("     active sourceResolver chain, add a Binance perps source")
    print("     file to src/lib/scanner/sources/ and import it from")
    print("     sourceResolver.js — otherwise the coverage audit shows")
    print("     Binance support that the app can't actually use.")

    return 0 if orphan_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
