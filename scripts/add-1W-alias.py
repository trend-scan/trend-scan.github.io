#!/usr/bin/env python3
"""
Add '1W' (capital W) as an alias for '1w' in all scanner source files.

The UI now sends '1W' but all source files have '1w' as the key in their
TIMEFRAME_INTERVAL and INTERVAL_MS maps. This script adds '1W' alongside
each '1w' entry so both work.

Also updates the supportsTimeframes arrays to include '1W'.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "src/lib/scanner/sources"

FILES = [
    "hyperliquid.js",
    "bybit.js",
    "okxCrypto.js",
    "okxTradfi.js",
    "binancePerps.js",
    "binanceXStocks.js",
    "kraken.js",
    "coingecko.js",
    "massive.js",
    "twelvedata.js",
]


def fix_file(path: Path) -> int:
    """Add '1W' alias for each '1w' map entry. Returns count of additions."""
    text = path.read_text()
    fixes = 0

    # Pattern: match lines like:  '1w': '1w',  or  '1w': 604_800_000,  or  '1w': 10080,
    # Capture the value after the colon
    pattern = re.compile(r"^(\s+)'1w':\s*([^,\n]+),\s*$", re.MULTILINE)

    def add_alias(m):
        nonlocal fixes
        indent = m.group(1)
        value = m.group(2).strip()
        fixes += 1
        return f"{indent}'1w': {value},\n{indent}'1W': {value},"

    text = pattern.sub(add_alias, text)

    # Also add '1W' to supportsTimeframes arrays that contain '1w'
    # Pattern: ['15m', '30m', '1H', '4H', '12H', '1D', '1w']
    # Replace '1w' with '1w', '1W' in these arrays
    def add_to_array(m):
        full = m.group(0)
        if "'1w'" in full and "'1W'" not in full:
            return full.replace("'1w'", "'1w', '1W'")
        return full

    text = re.sub(r"\[([^\]]*'1w'[^\]]*)\]", add_to_array, text)

    path.write_text(text)
    return fixes


def main():
    total = 0
    for fname in FILES:
        path = SOURCES / fname
        if not path.exists():
            print(f"  ! {fname}: not found")
            continue
        n = fix_file(path)
        if n > 0:
            print(f"  ✓ {fname}: added {n} '1W' alias(es)")
            total += n
        else:
            print(f"  · {fname}: no changes needed")
    print(f"\nTotal: {total} alias additions")


if __name__ == "__main__":
    main()
