#!/usr/bin/env python3
"""
Re-add symbols to cryptoUniverse.js that were removed as 'orphans' but
are actually covered by Binance perps (with 1000x/1000000x prefix
normalization) or other sources we missed in the previous audit.

Reads:
  - Original cryptoUniverse.js from git history (273 symbols)
  - Current cryptoUniverse.js (173 symbols after orphan removal)
  - Live Binance perps universe (with 1000x normalization)
  - Live Hyperliquid/OKX/Bybit perps universes (for sanity check)

Writes:
  - Updated cryptoUniverse.js with re-added symbols that are now covered
"""

import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE_PATH = ROOT / "src/lib/board/cryptoUniverse.js"


def fetch_json(url, method='GET', body=None):
    headers = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'}
    if body:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(body).encode()
    req = urllib.request.Request(url, method=method, headers=headers, data=body)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def fetch_hyperliquid_universe():
    d = fetch_json('https://api.hyperliquid.xyz/info', method='POST',
                   body={'type': 'meta'})
    return set(u.get('name', '') for u in d.get('universe', []))


def fetch_okx_universe():
    d = fetch_json('https://www.okx.com/api/v5/public/instruments?instType=SWAP')
    coins = set()
    for inst in d.get('data', []):
        parts = inst.get('instId', '').split('-')
        if parts:
            coins.add(parts[0])
    return coins


def fetch_bybit_universe():
    d = fetch_json('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000')
    coins = set()
    for inst in d.get('result', {}).get('list', []):
        sym = inst.get('symbol', '')
        if sym.endswith('USDT'):
            coins.add(sym[:-4])
    return coins


def fetch_binance_perps_universe():
    """Returns dict normalized -> actual."""
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


def fetch_okx_spot_universe():
    d = fetch_json('https://www.okx.com/api/v5/public/instruments?instType=SPOT')
    coins = set()
    for inst in d.get('data', []):
        parts = inst.get('instId', '').split('-')
        if parts:
            coins.add(parts[0])
    return coins


def fetch_bybit_spot_universe():
    d = fetch_json('https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000')
    coins = set()
    for inst in d.get('result', {}).get('list', []):
        sym = inst.get('symbol', '')
        if sym.endswith('USDT'):
            coins.add(sym[:-4])
    return coins


def extract_symbols_with_metadata(text):
    """Parse all { symbol: 'X', name: 'Y', theme: 'Z', tier: 'T', subtheme: 'S' } entries."""
    entries = []
    # Match each entry: starts with `{ symbol: 'XXX'` and ends with `},`
    # Captures the full line so we can re-add it verbatim
    pattern = re.compile(
        r"\{ symbol: '([^']+)', name: '([^']*)', theme: '([^']*)', tier: '([^']*)', subtheme: '([^']*)' \}"
    )
    for m in pattern.finditer(text):
        entries.append({
            'symbol': m.group(1),
            'name': m.group(2),
            'theme': m.group(3),
            'tier': m.group(4),
            'subtheme': m.group(5),
            'raw_line': m.group(0),
        })
    return entries


def main():
    # Read original (pre-cleanup) and current cryptoUniverse.js
    orig_text = subprocess.run(
        ['git', 'show', '786235f^:src/lib/board/cryptoUniverse.js'],
        cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout
    orig_entries = extract_symbols_with_metadata(orig_text)
    orig_symbols = {e['symbol'] for e in orig_entries}

    cur_text = UNIVERSE_PATH.read_text()
    cur_entries = extract_symbols_with_metadata(cur_text)
    cur_symbols = {e['symbol'] for e in cur_entries}

    removed = orig_symbols - cur_symbols
    print(f"━" * 70)
    print(f"Original universe: {len(orig_symbols)} symbols")
    print(f"Current universe:  {len(cur_symbols)} symbols")
    print(f"Removed as orphans: {len(removed)} symbols")
    print(f"━" * 70)
    print()

    print("Fetching live universes...")
    hl = fetch_hyperliquid_universe()
    print(f"  Hyperliquid:     {len(hl)} perps")
    okx = fetch_okx_universe()
    print(f"  OKX SWAP:        {len(okx)} perps")
    bybit = fetch_bybit_universe()
    print(f"  Bybit:           {len(bybit)} linear perps")
    binance = fetch_binance_perps_universe()  # dict
    print(f"  Binance perps:   {len(binance)} USDT perps (with 1000x normalization)")
    okx_spot = fetch_okx_spot_universe()
    print(f"  OKX SPOT:        {len(okx_spot)} spot instruments")
    bybit_spot = fetch_bybit_spot_universe()
    print(f"  Bybit SPOT:      {len(bybit_spot)} spot instruments")
    print()

    # For each removed symbol, check if it's now covered
    re_add = []
    still_orphan = []
    for entry in orig_entries:
        if entry['symbol'] not in removed:
            continue  # still in current universe
        sym = entry['symbol']
        sources = []
        if sym in hl: sources.append('HL')
        if sym in okx: sources.append('OKX')
        if sym in bybit: sources.append('Bybit')
        if sym in binance: sources.append('Binance')
        if sym in okx_spot: sources.append('OKX-spot')
        if sym in bybit_spot: sources.append('Bybit-spot')
        if sources:
            re_add.append((entry, sources))
        else:
            still_orphan.append((entry, sources))

    print(f"━" * 70)
    print(f"RE-ADD {len(re_add)} symbols (now covered by at least one source):")
    for entry, srcs in re_add:
        print(f"  + {entry['symbol']:<12} ({entry['name']}) — {','.join(srcs)}")
    print()

    print(f"━" * 70)
    print(f"STILL ORPHAN {len(still_orphan)} symbols (no source covers these):")
    for entry, srcs in still_orphan:
        print(f"  ✗ {entry['symbol']:<12} ({entry['name']})")
    print()

    if not re_add:
        print("Nothing to re-add. Universe is up to date.")
        return 0

    # Now re-add the re_add entries to the current file.
    # Insert them at the end of the array (before the closing `];`).
    # Group them by theme so the file stays organized.
    text = cur_text

    # Find the closing `];` of CRYPTO_UNIVERSE
    closing_match = re.search(r'\n\];\s*\n', text)
    if not closing_match:
        print("✗ Could not find CRYPTO_UNIVERSE closing `];` in file", file=sys.stderr)
        return 1
    closing_pos = closing_match.start()

    # Build the new lines to insert, grouped by theme
    by_theme = {}
    for entry, _ in re_add:
        by_theme.setdefault(entry['theme'], []).append(entry)

    new_lines = []
    new_lines.append('')
    new_lines.append('  // ── Re-added: covered by Binance perps (with 1000x normalization) ──')
    for theme, entries in by_theme.items():
        new_lines.append(f'  // {theme}')
        for e in entries:
            new_lines.append(f"  {{ symbol: '{e['symbol']}', name: '{e['name']}', theme: '{e['theme']}', tier: '{e['tier']}', subtheme: '{e['subtheme']}' }},")

    insert_text = '\n'.join(new_lines) + '\n'
    new_text = text[:closing_pos] + insert_text + text[closing_pos:]

    # Update header comment to reflect new count
    new_count = len(cur_symbols) + len(re_add)
    new_text = re.sub(
        r'^// Crypto universe — \d+ assets.*$',
        f'// Crypto universe — {new_count} assets with verified source coverage',
        new_text,
        count=1,
        flags=re.MULTILINE,
    )
    new_text = re.sub(
        r'^// \(\d+ assets across multiple themes.*\)$',
        f'// ({new_count} assets across multiple themes; orphans removed {len(still_orphan)} symbols with no exchange listing)',
        new_text,
        count=1,
        flags=re.MULTILINE,
    )

    UNIVERSE_PATH.write_text(new_text)
    print(f"━" * 70)
    print(f"✓ Re-added {len(re_add)} symbols to cryptoUniverse.js")
    print(f"✓ New universe size: {new_count} symbols")
    print(f"  (still removed: {len(still_orphan)} true orphans with no source)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
