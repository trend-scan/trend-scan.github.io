# TrendScan

Multi-source crypto + tradfi market scanner with macro regime monitoring. Deployed as a static site on GitHub Pages with daily server-side data refreshes via GitHub Actions.

## Architecture

```
[Client Browser]
  ├─ Loads index.html (with inlined Vite bundle)
  ├─ Reads /snapshot.json (small ~450 KB: FRED macro + CoinGecko top + Fear & Greed + ETF flows + signal metrics)
  ├─ Lazy-loads /snapshot.tradfi.json (only on Board/Macro pages — ~13 MB of OHLCV)
  ├─ Live fetches crypto OHLC via sourceResolver (auto fallback):
  │     OKX Perps → Bybit → Kraken → Hyperliquid → Yahoo Crypto →
  │     Binance Spot/Perps → CoinGecko → (opt-in: Massive/Polygon)
  ├─ Live fetches tradfi OHLC — SNAPSHOT-FIRST for public tickers (Yahoo
  │     server-side data refreshed 4× daily), live sources only for private/
  │     pre-IPO tickers not in snapshot. Live fallback chain when snapshot
  │     has no data: Lighter → OKX SWAP perps → Yahoo proxy → Binance xStocks
  └─ Computes regime signals, factor scores, breadth — all client-side

[GitHub Actions]
  ├─ refresh-snapshot.yml (4× daily 7 days/week at 04:00/10:00/16:00/22:00 UTC)
  │     ├─ Runs scripts/build_snapshot.js with FRED_API_KEY secret
  │     ├─ Fetches FRED + CoinGecko + Fear&Greed + Ken French + CBOE + Yahoo tradfi + Farside ETF
  │     ├─ Computes crypto factors + signal metrics (BTC/Majors/Cash verdicts)
  │     ├─ Writes public/snapshot.json (small) → commits to main
  │     ├─ Writes public/snapshot.tradfi.json (large) → pushes to gh-pages branch (bypasses main)
  │     └─ Dispatches deploy.yml to rebuild + redeploy
  └─ deploy.yml (on push to main + daily at 22:00 UTC)
        ├─ Builds the Vite bundle
        ├─ Fetches snapshot.tradfi.json from gh-pages branch
        ├─ Copies both snapshot files into dist/
        └─ Pushes dist/ to gh-pages branch → live site updates
```

## Quick start (local dev)

```bash
npm install
npm run dev          # start Vite dev server
# open http://localhost:5173
```

No API keys needed for local development — all primary sources are free and CORS-enabled.

## Setup for production (GitHub Pages)

### 1. Get a free FRED API key

Register at https://fred.stlouisfed.org/docs/api/api_key.html (free, takes 30 seconds).

### 2. Add it as a repository secret

1. Go to your repo on GitHub → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `FRED_API_KEY`
4. Value: paste your FRED key
5. Click **Add secret**

### 3. Ensure GitHub Pages is configured

1. Go to **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `gh-pages` / root
4. Save

(If `gh-pages` doesn't exist yet, the deploy workflow will create it on the first run.)

### 4. Push to main

```bash
git add .
git commit -m "feat: multi-source resolver + daily snapshot workflow"
git push origin main
```

The `deploy.yml` workflow will:
1. Install deps
2. Run `scripts/build_snapshot.js` with your `FRED_API_KEY` secret
3. Build the Vite bundle
4. Push to `gh-pages` branch

Your site at `https://trend-scan.github.io/` will be live within ~2 minutes.

### 5. (Optional) Add a paid Polygon/MASSIVE key

If you have a paid Polygon plan and want to use it as a (high-priority) source:

1. Repo → Settings → Secrets → Actions
2. Add secret `VITE_MASSIVE_API_KEY` with your Polygon key
3. The deploy workflow injects it at build time

This is **optional** — the resolver works fine with just the free sources.

### 6. (Optional) Enable FactorWatch integration

FactorWatch (factorwatch.ai) provides professional-grade TradFi equity factor data — 7 factors × 5 timeframes with z-scores, estimate revision spreads, and 19 thematic baskets for both S&P 500 and FW 3000 universes.

When enabled, the site adds:
- **Macro Regime page:** narrative banner (shakeout/junk rally signals) + cross-asset divergence chart (S&P vs FW 3000 momentum σ)
- **Board Factor Monitor tab:** TradFi thematic proxy cards (baskets → crypto theme mapping) + revision arbitrage table (analyst upgrade/downgrade spreads)
- **Snapshot:** `factor_watch` section (current data) + `factor_watch_history` (90-day rolling accumulation for the divergence chart)

The scraper runs server-side in GitHub Actions (3 pages from factorwatch.ai, 2s delay between requests). No client-side fetch to factorwatch.ai — all data is baked into `snapshot.json`.

To enable:

1. Repo → Settings → Secrets → Actions
2. Add secret `VITE_ENABLE_FACTORWATCH` with value `true`
3. The next deploy will activate all FactorWatch components

To disable: set the secret to `false` or delete it. All components check the flag and render nothing when it's not `'true'`. The FactorWatch-gated components are lazy-loaded (`React.lazy`) so they're tree-shaken from the bundle when the flag is off.

**Factor Signal Engine** (always active, not gated): The crypto Factor Monitor also includes a shared factor signal engine (`src/lib/factors/`) that provides:
- Rotation detection (3-session confirm / 10-session fresh, generalized from the regime engine)
- Composite stance scoring (CONSTRUCTIVE / SELECTIVE / DEFENSIVE / WAIT + 0-10 confidence)
- Crowding matrix (pairwise correlation of 90-day spread returns)
- Narrative generation (plain-English signal sentences)
- Factor quilt (monthly returns heatmap)

This engine runs on the crypto factor data the Factor Monitor already computes — no FactorWatch integration needed.

## Source priority (auto mode)

### Crypto OHLC

| Tier | Source           | Timeframes supported        | Auth required |
|------|------------------|-----------------------------|---------------|
| 1    | OKX Perps        | All                         | No            |
| 1    | Bybit            | All                         | No            |
| 2    | Kraken           | All                         | No            |
| 2    | Hyperliquid      | 15m–1w (intraday best)      | No            |
| 3    | Yahoo Finance    | 1D, 1w (daily best)         | No (proxy)    |
| 4    | Binance Spot/Perps| All                        | No            |
| 5    | CoinGecko        | 1D, 1w (daily best)         | No            |
| 6    | Massive/Polygon  | All                         | Yes (opt-in)  |

The resolver tries sources in tier order; if a source is geo-blocked, returns
errors, or doesn't list the symbol, it falls through to the next tier.

### Tradfi OHLC

**Snapshot-first policy (since 2026-07-22):** For all public tickers in
TRAD_UNIVERSE, the Board/Macro pages read directly from `/snapshot.tradfi.json`
(Yahoo Finance data fetched server-side 4× daily). Live sources are only
invoked for tickers NOT in the snapshot — pre-IPO names (OPENAI, ANTHROPIC,
SPACEX, etc.) and any new ticker added before the next snapshot refresh.

Live fallback chain (only used when snapshot has no data for a ticker):

| Tier | Source           | Tickers                                                     | Auth required |
|------|------------------|-------------------------------------------------------------|---------------|
| 1    | Lighter          | 214 markets (stocks, ETFs, indices, commodities, FX)        | No            |
| 1    | OKX SWAP perps   | SPY, QQQ, NVDA, TSLA, AAPL, XAU, XAG, etc. (16 tickers)    | No            |
| 1    | Yahoo proxy      | All public US/intl tickers (via Cloudflare Worker)          | No (proxy)    |
| 2    | Binance xStocks  | NVDA, TSLA                                                  | No            |
| 3    | Massive/Polygon  | All US stocks/ETFs                                          | Yes (opt-in)  |

For private/pre-IPO tickers, Lighter is the only source (Yahoo has no data).
For public tickers, Lighter is a low-liquidity prediction market and is the
LAST resort — its prices trail real market prices by 0.5–2% and its volume
is 4–5 orders of magnitude smaller than real exchanges.

### Macro data (FRED replacements)

| Series         | Primary source       | Live fallback         |
|----------------|----------------------|-----------------------|
| CPIAUCSL       | snapshot (FRED)      | Alpha Vantage         |
| M2SL           | snapshot (FRED)      | Alpha Vantage         |
| ICSA           | snapshot (FRED)      | Alpha Vantage         |
| WTREGEN        | snapshot (FRED)      | Treasury.gov          |
| RRPONTSYD      | snapshot (FRED)      | Treasury.gov          |
| BAMLH0A0HYM2   | snapshot (FRED only) | —                     |
| T10YIE         | snapshot (FRED only) | —                     |
| T5YIFR         | snapshot (FRED only) | —                     |
| NFCI           | snapshot (FRED only) | —                     |
| WALCL          | snapshot (FRED only) | —                     |
| WRESBAL        | snapshot (FRED only) | —                     |

Series marked "snapshot (FRED only)" cannot be fetched from the browser (FRED is CORS-blocked). They are fetched server-side by GitHub Actions and baked into `/snapshot.json`.

## Workflows

### `.github/workflows/deploy.yml`

- Triggers on: push to main, daily at 22:00 UTC, manual dispatch
- Builds the site, fetches FRED data, deploys to `gh-pages` branch

### `.github/workflows/refresh-snapshot.yml`

- Triggers: 04:00, 10:00, 16:00, 22:00 UTC Mon-Sat, manual dispatch
- Saturday 04:00 UTC captures Friday's final market-close data flows
- Only refreshes `snapshot.json` + `snapshot.tradfi.json` (no full bundle rebuild)
- If snapshot changed, commits to main → dispatches `deploy.yml` for rebuild
- Verifies the deploy workflow actually started (polls for the resulting run)

## Development commands

```bash
npm run dev              # Vite dev server
npm run build            # Production build → dist/
npm run build:snapshot   # Manually build snapshot.json (requires FRED_API_KEY env)
npm run lint             # ESLint
npm run typecheck        # TypeScript check
```

## File structure (key paths)

```
.
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml                # Build + deploy to gh-pages
│   │   └── refresh-snapshot.yml      # Refresh snapshot data 4× daily
│   ├── ISSUE_TEMPLATE/               # Bug / feature / data issue templates
│   └── PULL_REQUEST_TEMPLATE.md      # PR checklist
├── public/
│   ├── snapshot.json                 # Small (~450 KB) FRED + CoinGecko + ETF flows
│   ├── snapshot.tradfi.json          # Large (~13 MB) tradfi OHLCV (lazy-loaded)
│   ├── robots.txt                    # SEO
│   ├── sitemap.xml                   # SEO
│   ├── safari-pinned-tab.svg         # Safari tab icon
│   ├── browserconfig.xml             # Windows tiles
│   └── mstile-*.png                  # Windows tile icons
├── scripts/
│   ├── build_snapshot.js             # Server-side data fetcher (runs in CI)
│   └── verify-csp.py                 # CSP allowlist verification
├── cloudflare/
│   └── yahoo-proxy-worker.js         # Cloudflare Worker for Yahoo Finance proxy
├── LICENSE                           # MIT
├── SECURITY.md                       # Vulnerability disclosures + key rotation
└── src/
    └── lib/
        ├── scanner/
        │   ├── sourceResolver.js     # Multi-source auto-fallback dispatcher
        │   ├── sourceHealth.js       # Global geo-block tracking (HTTP 451)
        │   ├── sources/
        │   │   ├── okxCrypto.js      # OKX SWAP+SPOT with universe cache
        │   │   ├── bybit.js          # Bybit linear perps + spot
        │   │   ├── kraken.js         # Kraken spot with dynamic AssetPairs
        │   │   ├── hyperliquid.js    # Hyperliquid perps + funding/OI tickers
        │   │   ├── yahooCrypto.js    # Yahoo Finance via Cloudflare Worker proxy
        │   │   ├── binanceSpot.js    # Binance spot (geo-blocked in US/UK)
        │   │   ├── binancePerps.js   # Binance USD-M futures
        │   │   ├── coingecko.js      # Free daily OHLC
        │   │   ├── okxTradfi.js      # SPY/QQQ/NVDA/TSLA/AAPL/XAU/XAG perps
        │   │   ├── lighter.js        # 214-market tradfi universe
        │   │   └── binanceXStocks.js
        │   └── exchanges.js          # Legacy dispatcher (delegates to resolver + GeoBlockedError)
        ├── signal/
        │   └── compute.js            # Pure signal engine (backtested v3.1, 9 gates)
        └── regime/
            ├── macroResolver.js      # Multi-source macro fallback chain
            ├── macroSources/
            │   ├── alphaVantage.js   # CPI/M2/ICSA live fallback
            │   ├── treasuryGov.js    # TGA/RRP live fallback
            │   └── fredProxy.js      # Reads pre-baked snapshot.json
            └── regimeSources.js      # Top-level regime data fetcher
```

## Troubleshooting

### "FRED data unavailable" warning on Macro Regime page

The `snapshot.json` hasn't been built yet. Either:
- Wait for the daily workflow to run (check the Actions tab)
- Manually trigger the deploy workflow from the Actions tab
- Run `npm run build:snapshot` locally with `FRED_API_KEY=your_key` and commit `public/snapshot.json` + `public/snapshot.tradfi.json`

### Scanner shows 0 results

The auto-resolver tries multiple sources. If all fail:
- Check the browser console for `[resolver]` warnings
- Try forcing a single source from the dropdown (e.g. "Hyperliquid")
- Some sources may rate-limit IPs that hit them heavily; wait 5 min and retry

### Build fails in CI

- Check that `FRED_API_KEY` is set in repo secrets
- Check the Actions tab for the failing workflow's logs
- The build script retains the previous snapshot's FRED data if the FRED API
  fails (stale-data fallback). The site still deploys with the last known-good
  macro data rather than shipping an empty snapshot. Check the workflow logs
  for the `⚠ FRED data empty — using previous snapshot (stale)` message.

## Security

### API Keys — Client vs Server

**Server-side only (never exposed to client):**
- `FRED_API_KEY` — Federal Reserve Economic Data. Used by `build_snapshot.js` in GitHub Actions.

**Runtime only (set via localStorage, NOT baked into bundle):**
- `MASSIVE_API_KEY` — Polygon.io paid key. Set via browser console: `localStorage.setItem('MASSIVE_API_KEY', '...')`
- `TWELVEDATA_KEY` — Twelve Data paid key. Same pattern.
- `ALPHAVANTAGE_KEY` — Alpha Vantage key. Same pattern.

**VITE_ env vars (baked into bundle — safe because non-secret):**
- `VITE_YAHOO_PROXY_URL` — Cloudflare Worker URL (just a URL, not a secret)
- `VITE_YAHOO_PROXY_TOKEN` — Worker auth token (only useful for THIS worker, rotatable)
- `VITE_ENABLE_FACTORWATCH` — boolean feature flag

**Why no VITE_ prefix for paid keys?**
Vite statically inlines `VITE_`-prefixed env vars into the client JS bundle. Anyone can inspect the bundle and extract the key. Paid keys (Polygon, Twelve Data, Alpha Vantage) must be provided at runtime via localStorage instead.

### Cloudflare Worker Auth

The Yahoo Finance proxy worker uses two layers of protection:
1. **Origin allowlist (CORS)** — blocks browser requests from non-TrendScan sites
2. **Shared-secret token** — blocks non-browser requests (curl, Python) that bypass CORS

Set the worker token via `wrangler secret put WORKER_TOKEN` and the client token via `VITE_YAHOO_PROXY_TOKEN` GitHub Actions secret (or `localStorage.setItem('YAHOO_PROXY_TOKEN', '...')` for local dev).

### Git Repository Size

`snapshot.tradfi.json` (~13 MB) is pushed directly to the `gh-pages` branch, NOT committed to `main`. This prevents Git history bloat — committing a 13 MB file 4× daily to main would add ~52 MB/day to the `.git` folder.

## License

MIT — see [LICENSE](LICENSE).
