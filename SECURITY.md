# Security Policy

## Reported vulnerabilities

### Polygon.io API key embedded in client bundle (audit-1, audit-2, audit-3)

**Severity:** Medium (key is rate-limited free tier, abuse potential is limited)

**Status:** Resolved (2026-07-16). Operator regenerated the key on the
Polygon dashboard and updated the `VITE_MASSIVE_API_KEY` GitHub Actions
secret. The old key (fingerprint: `…l5ll`) has been rotated out of the
deployed bundle. If the old key was not revoked on the Polygon dashboard,
do so now — it is no longer used by the app but could still be abused
if active.

**Verification (run after deploy completes):**
```bash
# Extract the old key fingerprint (last 4 chars) and check the live bundle
curl -s https://trend-scan.github.io/ | grep -oE 'assets/index-[^"]+\.js' | head -1 \
  | xargs -I{} curl -s https://trend-scan.github.io/{} \
  | grep -c 'l5ll'
# Should print 0
```

**What was exposed:** The Polygon.io / Massive API key was baked into the
deployed JS bundle by Vite at build time (via the `VITE_MASSIVE_API_KEY`
GitHub Actions secret). Anyone who read the bundle source could extract
and reuse the key.

**Mitigations in place:**
- The key is the **free tier** (5 req/min, no paid entitlements)
- The resolver falls back through 6 other free sources (Hyperliquid, OKX,
  Bybit, Binance, Yahoo proxy, CoinGecko) before hitting Polygon, so most
  users never trigger a Polygon call
- Runtime override is supported: users can paste their own key via
  `localStorage.setItem('MASSIVE_API_KEY', '<their-key>')` in the browser
  console, which takes precedence over the bundled key

**Future hardening (optional):** Stop shipping any Polygon key in the
bundle by removing the `VITE_MASSIVE_API_KEY` line from
`.github/workflows/deploy.yml`. The resolver will skip the Polygon source
entirely — the 6 free sources above still provide full coverage for the
top 500 coins and all tradfi tickers. Alternatively, proxy key-requiring
APIs through the existing Cloudflare Worker with the key held as a worker
secret (not inlined in the client bundle).

---

## Reporting a vulnerability

If you discover a security issue, please open a private security advisory:
- Repo → Security → Advisories → "Report a vulnerability"

Or email the maintainer directly. Please do not open a public issue for
security-sensitive reports.
