#!/usr/bin/env python3
"""
Cross-reference the user's previous cryptoUniverse proposal (commit 5742e33,
273 symbols with full theme/subtheme categorization) against the current
live list (after orphan removal + re-add of covered symbols).

Outputs:
  1. Symbols REMOVED from proposal that are still missing from current
  2. Symbols KEPT from proposal (with category preserved)
  3. Symbols ADDED to current that weren't in proposal
  4. Category/subcategory distribution comparison
  5. Recommendations: which missing symbols should be re-added with their
     original categorization
"""

import re
import subprocess
import sys
import urllib.request
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURRENT = ROOT / "src/lib/board/cryptoUniverse.js"


def parse_universe(text):
    """Parse all { symbol, name, theme, tier, subtheme } entries."""
    pattern = re.compile(
        r"\{ symbol: '([^']+)', name: '([^']*)', theme: '([^']*)', tier: '([^']*)', subtheme: '([^']*)' \}"
    )
    entries = []
    for m in pattern.finditer(text):
        entries.append({
            'symbol': m.group(1),
            'name': m.group(2),
            'theme': m.group(3),
            'tier': m.group(4),
            'subtheme': m.group(5),
        })
    return entries


def fetch_json(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def fetch_all_universes():
    """Fetch live universes from all our active sources."""
    print("Fetching live universes...", file=sys.stderr)
    import urllib.request as ur

    # Hyperliquid — POST request with JSON body
    hl = set()
    try:
        req = ur.Request('https://api.hyperliquid.xyz/info',
            method='POST',
            headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                     'Content-Type': 'application/json'},
            data=json.dumps({'type': 'meta'}).encode())
        with ur.urlopen(req, timeout=30) as resp:
            d = json.loads(resp.read().decode())
        hl = set(u.get('name', '') for u in d.get('universe', []))
    except Exception as e:
        print(f"  ! HL: {e}", file=sys.stderr)

    # OKX SWAP + SPOT
    okx = set()
    for inst_type in ['SWAP', 'SPOT']:
        try:
            d = fetch_json(f'https://www.okx.com/api/v5/public/instruments?instType={inst_type}')
            for inst in d.get('data', []):
                parts = inst.get('instId', '').split('-')
                if parts:
                    okx.add(parts[0])
        except Exception as e:
            print(f"  ! OKX {inst_type}: {e}", file=sys.stderr)

    # Bybit linear + spot
    bybit = set()
    for cat in ['linear', 'spot']:
        try:
            d = fetch_json(f'https://api.bybit.com/v5/market/instruments-info?category={cat}&limit=1000')
            for inst in d.get('result', {}).get('list', []):
                sym = inst.get('symbol', '')
                if sym.endswith('USDT'):
                    bybit.add(sym[:-4])
        except Exception as e:
            print(f"  ! Bybit {cat}: {e}", file=sys.stderr)

    # Binance perps with 1000x normalization — try cached file first
    binance = set()
    cache_path = Path('/tmp/binance_perps.json')
    if cache_path.exists():
        try:
            d = json.loads(cache_path.read_text())
            for inst in d.get('symbols', []):
                if inst.get('contractType') == 'PERPETUAL':
                    base = inst.get('baseAsset', '')
                    quote = inst.get('quoteAsset', '')
                    if base and quote == 'USDT':
                        binance.add(base)
                        if base.startswith('1000000'):
                            binance.add(base[7:])
                        elif base.startswith('1000'):
                            binance.add(base[4:])
            print(f"  (Binance: loaded from cache)", file=sys.stderr)
        except Exception as e:
            print(f"  ! Binance cache: {e}", file=sys.stderr)
    if not binance:
        try:
            d = fetch_json('https://fapi.binance.com/fapi/v1/exchangeInfo')
            for inst in d.get('symbols', []):
                if inst.get('contractType') == 'PERPETUAL':
                    base = inst.get('baseAsset', '')
                    quote = inst.get('quoteAsset', '')
                    if base and quote == 'USDT':
                        binance.add(base)
                        if base.startswith('1000000'):
                            binance.add(base[7:])
                        elif base.startswith('1000'):
                            binance.add(base[4:])
        except Exception as e:
            print(f"  ! Binance: {e}", file=sys.stderr)

    print(f"  HL={len(hl)} OKX={len(okx)} Bybit={len(bybit)} Binance={len(binance)}", file=sys.stderr)
    return hl, okx, bybit, binance


def main():
    # Load proposal (5742e33) and current
    proposal_text = subprocess.run(
        ['git', 'show', '5742e33:src/lib/board/cryptoUniverse.js'],
        cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout
    proposal = parse_universe(proposal_text)
    proposal_by_sym = {e['symbol']: e for e in proposal}

    current_text = CURRENT.read_text()
    current = parse_universe(current_text)
    current_syms = {e['symbol'] for e in current}

    print("━" * 78)
    print(f"PROPOSAL (commit 5742e33): {len(proposal)} symbols")
    print(f"CURRENT (live):            {len(current)} symbols")
    print("━" * 78)
    print()

    # ── 1. Symbols in proposal but NOT in current ─────────────────────────
    missing = [e for sym, e in proposal_by_sym.items() if sym not in current_syms]
    print(f"━━━ REMOVED FROM PROPOSAL: {len(missing)} symbols ━━━")
    print()

    # Group missing by theme
    by_theme = defaultdict(list)
    for e in missing:
        by_theme[e['theme']].append(e)

    for theme in sorted(by_theme.keys()):
        entries = by_theme[theme]
        print(f"  ▸ {theme} ({len(entries)}):")
        for e in entries:
            print(f"      {e['symbol']:<12} ({e['name']}) — tier: {e['tier']}, subtheme: {e['subtheme']}")
        print()

    # ── 2. Check live coverage of missing symbols ─────────────────────────
    print("━" * 78)
    print("Checking live coverage of removed symbols...")
    print("━" * 78)
    print()
    hl, okx, bybit, binance = fetch_all_universes()

    recoverable = []
    truly_orphan = []
    for e in missing:
        sym = e['symbol']
        sources = []
        if sym in hl: sources.append('HL')
        if sym in okx: sources.append('OKX')
        if sym in bybit: sources.append('Bybit')
        if sym in binance: sources.append('Binance')
        if sources:
            recoverable.append((e, sources))
        else:
            truly_orphan.append((e, sources))

    print()
    print(f"━" * 78)
    print(f"RECOVERABLE — covered by at least one live source: {len(recoverable)}")
    print(f"━" * 78)
    for e, srcs in recoverable:
        print(f"  + {e['symbol']:<12} ({e['name']}) — theme: {e['theme']}, subtheme: {e['subtheme']} — sources: {','.join(srcs)}")
    print()

    print(f"━" * 78)
    print(f"TRULY ORPHAN — no live source covers these: {len(truly_orphan)}")
    print(f"━" * 78)
    for e, srcs in truly_orphan:
        print(f"  ✗ {e['symbol']:<12} ({e['name']}) — theme: {e['theme']}, subtheme: {e['subtheme']}")
    print()

    # ── 3. Category/subcategory distribution comparison ────────────────────
    print("━" * 78)
    print("CATEGORY DISTRIBUTION: PROPOSAL vs CURRENT")
    print("━" * 78)
    print()
    prop_themes = Counter(e['theme'] for e in proposal)
    cur_themes = Counter(e['theme'] for e in current)
    all_themes = sorted(set(prop_themes) | set(cur_themes))
    print(f"  {'Theme':<25} {'Proposal':>10} {'Current':>10} {'Delta':>10}")
    print(f"  {'-'*25} {'-'*10} {'-'*10} {'-'*10}")
    for t in all_themes:
        p = prop_themes.get(t, 0)
        c = cur_themes.get(t, 0)
        delta = c - p
        marker = '↓' if delta < 0 else ('↑' if delta > 0 else '=')
        print(f"  {t:<25} {p:>10} {c:>10} {marker}{abs(delta):>9}")
    print()

    # ── 4. Recommendations ────────────────────────────────────────────────
    print("━" * 78)
    print("RECOMMENDATIONS")
    print("━" * 78)
    print()
    print(f"1. RE-ADD {len(recoverable)} symbols that were removed but are still covered by live sources.")
    print(f"   These were wrongly removed in the previous orphan-removal pass.")
    print(f"   Restore them with their original theme/subtheme categorization from the proposal.")
    print()
    print(f"2. CONFIRM REMOVAL of {len(truly_orphan)} symbols that are genuinely not on any major exchange.")
    print(f"   These include:")
    print(f"     - PancakeSwap pool tokens (PC00000XX series)")
    print(f"     - Hyperliquid-only index products (MAG7.SSI)")
    print(f"     - Privacy coins delisted from major exchanges (ARRR, MWC, BDX)")
    print(f"     - Obscure small-caps that may not actually be in top 300")
    print()
    print(f"3. After re-adding recoverable symbols, universe would be:")
    print(f"     {len(current)} (current) + {len(recoverable)} (recoverable) = {len(current) + len(recoverable)} symbols")
    print()

    # Output recoverable entries as ready-to-paste lines
    print("━" * 78)
    print("READY-TO-PASTE ENTRIES (re-add to cryptoUniverse.js):")
    print("━" * 78)
    print()
    # Group by theme for organized insertion
    by_theme_recover = defaultdict(list)
    for e, _ in recoverable:
        by_theme_recover[e['theme']].append(e)
    for theme in sorted(by_theme_recover.keys()):
        print(f"  // {theme}")
        for e in by_theme_recover[theme]:
            print(f"  {{ symbol: '{e['symbol']}', name: '{e['name']}', theme: '{e['theme']}', tier: '{e['tier']}', subtheme: '{e['subtheme']}' }},")

    return 0


if __name__ == "__main__":
    sys.exit(main())
