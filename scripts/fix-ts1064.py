#!/usr/bin/env python3
"""
Fix TS1064 typecheck errors across all source files.

The error is:
  "The return type of an async function or method must be the global
   Promise<T> type. Did you mean to write 'Promise<...>'?"

Cause: JSDoc @returns annotations on async functions say
  @returns {Array<{ts,open,...}>} or null
but should say
  @returns {Promise<Array<{ts,open,...}>> | null}

Strategy: for each line containing '@returns {...}' that documents an
async function, wrap the entire type expression in Promise<...>.
Handles nested braces correctly by tracking depth.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

TARGET_FILES = [
    "src/lib/regime/macroSources/fredProxy.js",
    "src/lib/regime/macroSources/treasuryGov.js",
    "src/lib/scanner/sources/bybit.js",
    "src/lib/scanner/sources/coingecko.js",
    "src/lib/scanner/sources/hyperliquid.js",
    "src/lib/scanner/sources/kraken.js",
    "src/lib/scanner/sources/lighter.js",
    "src/lib/scanner/sources/massive.js",
    "src/lib/scanner/sources/okxCrypto.js",
    "src/lib/scanner/sources/okxTradfi.js",
    "src/lib/scanner/sources/twelvedata.js",
]


def extract_braced_type(line: str):
    """
    Find the first '{...}' block in the line after '@returns', tracking
    nested braces correctly. Returns (start, end, content) or None.
    """
    # Find '@returns {' (the opening)
    m = re.search(r'@returns\s+\{', line)
    if not m:
        return None
    start = m.end() - 1  # index of the opening '{'
    # Track brace depth
    depth = 0
    for i in range(start, len(line)):
        c = line[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                # Found the matching close
                content = line[start + 1:i]  # content between { and }
                return (start, i, content)
    return None  # unbalanced


def is_async_function_ahead(lines, from_idx):
    """Look ahead to see if the next non-comment, non-empty line is async."""
    j = from_idx + 1
    while j < len(lines):
        s = lines[j].strip()
        if not s or s.startswith('*') or s.startswith('/*'):
            j += 1
            continue
        return bool(re.match(r'^\s*(export\s+)?async\s+function', lines[j]))
    return False


def fix_file(path: Path) -> int:
    text = path.read_text()
    lines = text.split('\n')
    fixes = 0

    for i, line in enumerate(lines):
        if '@returns' not in line:
            continue
        result = extract_braced_type(line)
        if not result:
            continue
        start, end, content = result
        # Already wrapped in Promise? Skip.
        content_stripped = content.strip()
        if content_stripped.startswith('Promise<') or content_stripped.startswith('Promise '):
            continue
        # Only fix if the function being documented is async
        if not is_async_function_ahead(lines, i):
            continue
        # Wrap the content in Promise<...>
        new_content = f'Promise<{content_stripped}>'
        new_line = line[:start + 1] + new_content + line[end:]
        if new_line != line:
            lines[i] = new_line
            fixes += 1

    if fixes > 0:
        path.write_text('\n'.join(lines))
    return fixes


def main():
    total = 0
    for rel_path in TARGET_FILES:
        path = ROOT / rel_path
        if not path.exists():
            print(f"  ! {rel_path}: not found, skipping")
            continue
        n = fix_file(path)
        if n > 0:
            print(f"  ✓ {rel_path}: fixed {n} @returns annotation(s)")
            total += n
        else:
            print(f"  · {rel_path}: no fixes needed")
    print()
    print(f"Total fixes: {total}")


if __name__ == "__main__":
    main()
