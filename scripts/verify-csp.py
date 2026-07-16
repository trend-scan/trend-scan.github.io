#!/usr/bin/env python3
"""
Verify that every external URL referenced in src/ is allowed by the
Content-Security-Policy declared in index.html.

Run after any code change that adds a new API endpoint — the build will
succeed but the browser will block the request at runtime if the CSP
doesn't include the host.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
INDEX_HTML = ROOT / "index.html"


def extract_csp_hosts(csp_text: str) -> set[str]:
    """Extract all https:// hosts from the connect-src directive."""
    # Find the connect-src directive value (everything between 'connect-src'
    # and the next ';').
    m = re.search(r"connect-src\s+([^;]+)", csp_text)
    if not m:
        return set()
    chunk = m.group(1)
    return set(re.findall(r"https://[a-zA-Z0-9.-]+", chunk))


def extract_csp_from_html(html: str) -> str:
    m = re.search(
        r'<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"',
        html,
        re.DOTALL,
    )
    if not m:
        return ""
    # Unescape HTML entities and collapse whitespace
    return m.group(1).replace("&#39;", "'").replace("&quot;", '"')


def find_external_urls_in_src() -> set[str]:
    """Find all https:// URLs referenced in src/ source code.

    NOTE: We deliberately do NOT scan cloudflare/ — the Worker runs
    server-side and its fetched URLs (e.g. query1.finance.yahoo.com)
    are not subject to the browser CSP. The Worker's *deployed URL*
    (trendscan-yahoo-proxy.drew-724.workers.dev) IS browser-fetched
    and is verified because it appears in src/lib/board/traditionalMarkets.js.
    """
    urls = set()
    # Match https://host patterns, ignoring URL paths
    pattern = re.compile(r"https://([a-zA-Z0-9.-]+)")
    # Documentation hosts that are referenced in comments but never fetched
    docs_hosts = {
        "docs.coingecko.com",
        "docs.kraken.com",
        "developers.binance.com",
        "apidocs.lighter.xyz",
        "hyperliquid.gitbook.io",
        "explorer.elliot.ai",
        "factorwatch.ai",
        "www.gate.io",
        "www.kucoin.com",
        "twelvedata.com",
        "bybit-exchange.github.io",
    }
    # Placeholder / example hosts that appear in comments only
    placeholder_hosts = {
        "your-worker.workers.dev",   # example in localStorage.setItem comment
        "trend-scan.github.io",       # the site itself (og:url, deep-link docs)
    }
    for path in SRC.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in {".js", ".jsx", ".ts", ".tsx", ".css", ".html"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        # Don't strip comments — we want to be conservative and surface
        # any URL that appears in the source. Doc URLs are filtered by
        # the docs_hosts set above.
        for match in pattern.finditer(text):
            host = match.group(1)
            if host in docs_hosts or host in placeholder_hosts:
                continue
            urls.add(f"https://{host}")
    return urls


def main() -> int:
    html = INDEX_HTML.read_text(encoding="utf-8")
    csp_text = extract_csp_from_html(html)
    if not csp_text:
        print("✗ No CSP meta tag found in index.html", file=sys.stderr)
        return 1

    # Build a unified allowlist of all hosts mentioned anywhere in the CSP
    # (connect-src + style-src + font-src + script-src + img-src + default-src).
    # This way we don't false-flag a URL that's correctly in style-src but
    # not in connect-src (e.g. CSS @import URLs).
    all_csp_hosts = set(re.findall(r"https://[a-zA-Z0-9.-]+", csp_text))

    csp_hosts = extract_csp_hosts(csp_text)
    src_urls = find_external_urls_in_src()

    print(f"CSP connect-src allows {len(csp_hosts)} hosts:")
    for h in sorted(csp_hosts):
        print(f"  ✓ {h}")
    print()
    print(f"src/ references {len(src_urls)} external https:// hosts:")
    for u in sorted(src_urls):
        print(f"  • {u}")
    print()

    missing = src_urls - all_csp_hosts
    if missing:
        print(f"✗ {len(missing)} hosts referenced in code but NOT in any CSP directive:")
        for m in sorted(missing):
            print(f"  ✗ {m}")
        print()
        print("These URLs will be blocked by the browser at runtime.")
        print("Add them to the appropriate directive in index.html.")
        return 1

    print(f"✓ All {len(src_urls)} external hosts referenced in src/ are allowed by some CSP directive.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
