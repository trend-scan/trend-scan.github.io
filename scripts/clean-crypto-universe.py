#!/usr/bin/env python3
"""
Remove orphan symbols from src/lib/board/cryptoUniverse.js.

An "orphan" is a symbol that no active source supports:
  - Not on Hyperliquid perps
  - Not on OKX SWAP
  - Not on Bybit linear perps
  - Not in CoinGecko top 100 snapshot

The audit script (audit-crypto-universe.py) identifies these orphans.
This script removes them from the CRYPTO_UNIVERSE array.

Run audit-crypto-universe.py first to see the current orphan list,
then run this script to apply the cleanup. The script is idempotent:
running it twice has no effect the second time (orphans already removed).
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE_PATH = ROOT / "src/lib/board/cryptoUniverse.js"


def fetch_json(url, method='GET', body=None):
    headers = {'User-Agent': 'TrendScan-Audit/1.0'}
    if body:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(body).encode()
    req = urllib.request.Request(url, method=method, headers=headers, data=body)
    with urllib.request.urlopen(req, timeout=20) as resp:
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


def find_orphan_lines(text):
    """
    Find all symbol lines in the file and identify which ones are orphans.

    Returns:
      orphan_symbols: set of symbol strings to remove
      orphan_line_indices: set of 0-indexed line numbers to remove
    """
    # Fetch live universes
    print("Fetching live universes from each source...")
    hl = fetch_hyperliquid_universe()
    print(f"  Hyperliquid: {len(hl)} perps")
    okx = fetch_okx_universe()
    print(f"  OKX SWAP:    {len(okx)} instruments")
    bybit = fetch_bybit_universe()
    print(f"  Bybit:       {len(bybit)} linear perps")
    cg = fetch_coingecko_snapshot()
    print(f"  CoinGecko:   {len(cg)} coins in snapshot")

    # Find all symbol lines and check coverage
    orphan_symbols = set()
    orphan_line_indices = set()
    lines = text.split('\n')
    for i, line in enumerate(lines):
        # Match lines like: "  { symbol: 'BTC', name: 'Bitcoin', theme: 'Layer 1', ... },"
        m = re.search(r"symbol:\s*'([^']+)'", line)
        if not m:
            continue
        sym = m.group(1)
        sources = []
        if sym in hl: sources.append('HL')
        if sym in okx: sources.append('OKX')
        if sym in bybit: sources.append('Bybit')
        if sym in cg: sources.append('CG')
        if not sources:
            orphan_symbols.add(sym)
            orphan_line_indices.add(i)

    return orphan_symbols, orphan_line_indices


def main():
    if not UNIVERSE_PATH.exists():
        print(f"✗ {UNIVERSE_PATH} not found", file=sys.stderr)
        return 1

    text = UNIVERSE_PATH.read_text()
    original_count = len(re.findall(r"symbol:\s*'[^']+'", text))
    print(f"━" * 70)
    print(f"CRYPTO_UNIVERSE currently has {original_count} symbols")
    print(f"━" * 70)
    print()

    orphan_symbols, orphan_lines = find_orphan_lines(text)

    if not orphan_symbols:
        print("✓ No orphans found — nothing to remove.")
        return 0

    print()
    print(f"━" * 70)
    print(f"Found {len(orphan_symbols)} orphan symbols to remove:")
    for s in sorted(orphan_symbols):
        print(f"  ✗ {s}")
    print()

    # Remove the orphan lines
    lines = text.split('\n')
    new_lines = [line for i, line in enumerate(lines) if i not in orphan_lines]
    new_text = '\n'.join(new_lines)

    # Update the header comment to reflect new count
    # Original: "// Crypto universe — top 350 by market cap (snapshot top 100 + CoinGecko 251-500)\n// 268 assets across 14 themes (excluding USD-pegged stablecoins)"
    new_count = original_count - len(orphan_symbols)
    new_text = re.sub(
        r'^// Crypto universe — top \d+ by market cap.*\n// \d+ assets across \d+ themes.*$',
        f'// Crypto universe — {new_count} assets with verified source coverage\n'
        f'// ({new_count} assets across multiple themes; orphans removed {len(orphan_symbols)} symbols with no exchange listing)',
        new_text,
        count=1,
        flags=re.MULTILINE,
    )

    UNIVERSE_PATH.write_text(new_text)
    print(f"━" * 70)
    print(f"✓ Removed {len(orphan_symbols)} orphan symbols")
    print(f"✓ CRYPTO_UNIVERSE now has {new_count} symbols (down from {original_count})")
    print(f"✓ Updated {UNIVERSE_PATH.relative_to(ROOT)}")
    print()
    print("Next steps:")
    print("  1. Run `npm run lint` to verify no syntax errors")
    print("  2. Run `npx vite build` to verify the build still works")
    print("  3. Manually verify a few removed symbols were truly orphans")
    print("     by checking the audit script output above")
    return 0


if __name__ == "__main__":
    sys.exit(main())
