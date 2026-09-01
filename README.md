# TrendScan

Multi-source crypto + tradfi market scanner with macro regime monitoring. Deployed as a static site on GitHub Pages with 4× daily server-side data refreshes via GitHub Actions + Cloudflare Workers.

## Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | **Scanner** | Crypto screener across top-500 market cap universe (snapshot-first via CMC → live fallbacks). Multi-source OHLC resolver, RSI/volume/market-cap filters, sortable results. |
| `/board` | **Market Board** | Two-row tab layout: **Crypto** (Daily, Crypto, Momentum, Themes, Breadth, Factor Monitor) + **TradFi** (TradFi, Theme Scores, ETF Pulse, Scanners, Levered ETFs). Crypto + TradFi breadth, theme scoring, extension lists, factor monitor. |
| `/macro` | **Macro Regime** | FRED macro data, regime quadrant (Ultra6 + OB1 + Core9), allocation verdict (ALLOCATE / STABLECOINS), FactorWatch cross-asset divergence, narrative banner. |
| `/signal` | **Signal Engine** | STRONG / WEAK / NEUTRAL verdicts for BTC, Majors (ETH/SOL/HYPE), and Cash. Reads pre-computed `signal_metrics` from `snapshot.json` (server-side computed by the 9-signal v3.1 engine in `src/lib/signal/compute.js`). |

## Architecture

```
[Client Browser]
  ├─ Loads index.html (with inlined Vite bundle)
  ├─ Reads /snapshot.json (~1.1 MB: FRED macro + CoinGecko top + crypto_universe
  │     (CMC top-500 with tags + supply + multi-tf changes) + Fear & Greed +
  │     ETF flows + signal metrics + crypto factors + regime history +
  │     tradfi breadth history + VIX + Ken French + FactorWatch + global metrics)
  ├─ Lazy-loads /snapshot.tradfi.json (only on Board/Macro pages — ~22 MB of
  │     OHLCV for ~470 tradfi tickers)
  ├─ Live fetches crypto OHLC via sourceResolver (auto fallback):
  │     OKX Perps → Bybit → Kraken → Hyperliquid → Yahoo Crypto →
  │     Binance Spot → Binance Perps → CoinGecko → (opt-in: Massive/Polygon)
  ├─ Live fetches tradfi OHLC — SNAPSHOT-FIRST for public tickers (Yahoo
  │     server-side data refreshed 4× daily), live sources only for private/
  │     pre-IPO tickers not in snapshot. Live fallback chain when snapshot
  │     has no data: Lighter → OKX SWAP perps → Yahoo proxy → Binance xStocks
  │     → Kraken → Massive/Polygon → Twelve Data
  └─ Computes regime signals, factor scores, breadth — all client-side

[GitHub Actions]
  ├─ refresh-snapshot.yml (4× daily 7 days/week at 04:00/10:00/16:00/22:00 UTC)
  │     ├─ Runs scripts/build_snapshot.js with FRED_API_KEY + CMC_API_KEY secrets
  │     ├─ Fetches FRED + CoinGecko + CMC (top-500 + tags + global metrics) +
  │     │   Fear&Greed + Ken French + CBOE VIX + Yahoo tradfi (470 tickers) +
  │     │   Farside ETF flows + Binance OI + crypto factors + signal metrics
  │     ├─ Computes crypto factors + signal metrics (BTC/Majors/Cash verdicts)
  │     ├─ Writes public/snapshot.json (~1.1 MB) → commits to main
  │     ├─ Writes public/snapshot.tradfi.json (~22 MB) → pushes to gh-pages branch (bypasses main)
  │     └─ Dispatches deploy.yml to rebuild + redeploy
  └─ deploy.yml (on push to main + daily at 23:00 UTC)
        ├─ Builds the Vite bundle
        ├─ Fetches snapshot.tradfi.json from gh-pages branch
        ├─ Copies both snapshot files into dist/
        └─ Pushes dist/ to gh-pages branch → live site updates
```

## Quick start (local dev)

**Requires Node ≥ 22** (CI runs Node 22; `package.json` engines field enforces this).

```bash
npm install
npm run dev          # start Vite dev server
# open http://localhost:5173
```

No API keys needed for local development — all primary sources are free and CORS-enabled.

## Setup for production (GitHub Pages)

### 1. Get a free FRED API key

Register at https://fred.stlouisfed.org/docs/api/api_key.html (free, takes 30 seconds).

### 2. Get a free CoinMarketCap API key (optional but recommended)

Register at https://pro.coinmarketcap.com/signup (free Basic tier, 15,000 credits/day). Used by `build_snapshot.js` to build the `crypto_universe` (top-500 coins with tags + supply + multi-tf changes — powers the Screener's Top 500 universe + chain/sector filters).

Without `CMC_API_KEY`: the snapshot falls back to CoinGecko top-250-by-volume (smaller universe, no tags, no chain/sector filters). The Screener still works, just with a smaller universe.

### 3. Add them as repository secrets

1. Go to your repo on GitHub → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add `FRED_API_KEY` with your FRED key
4. Add `CMC_API_KEY` with your CoinMarketCap key (optional but recommended)

### 4. Ensure GitHub Pages is configured

1. Go to **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `gh-pages` / root
4. Save

(If `gh-pages` doesn't exist yet, the deploy workflow will create it on the first run.)

### 5. Push to main

```bash
git add .
git commit -m "feat: multi-source resolver + daily snapshot workflow"
git push origin main
```

The `deploy.yml` workflow will:
1. Install deps
2. Run `scripts/build_snapshot.js` with your `FRED_API_KEY` + `CMC_API_KEY` secrets
3. Build the Vite bundle
4. Push to `gh-pages` branch

Your site at `https://trend-scan.github.io/` will be live within ~2 minutes.

### 6. (Optional) Add a paid Polygon/MASSIVE key

If you have a paid Polygon plan and want to use it as a last-resort source for crypto/tradfi OHLC:

1. In the browser console on the live site: `localStorage.setItem('MASSIVE_API_KEY', 'your_key')`
2. The resolver will use it as the final fallback when all free sources fail

This is **optional** — the resolver works fine with just the free sources. The key is read from localStorage only (NOT baked into the bundle — see SECURITY.md).

### 7. (Optional) Enable FactorWatch integration

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
- Rotation detection (3-session confirm / 10-session fresh, run-based semantics)
- Composite stance scoring (CONSTRUCTIVE / SELECTIVE / DEFENSIVE / WAIT + 0-10 confidence)
- Crowding matrix (pairwise correlation of 90-day spread returns)
- Narrative generation (plain-English signal sentences)
- Factor quilt (monthly returns heatmap)
- Tradable-universe filter (`universeFilter.js` — strips stablecoins, tokenized gold, wrapped/staked derivatives, and exchange revenue tokens from the factor universe on both server and client paths)

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
| 4    | Binance Spot     | All (broader coin coverage than perps — GNO, XNO, TFUEL, etc.) | No |
| 4    | Binance Perps    | All                         | No            |
| 5    | CoinGecko        | 1D, 1w (daily best)         | No            |
| 6    | Massive/Polygon  | All                         | Yes (opt-in, localStorage) |

The resolver tries sources in tier order; if a source is geo-blocked, returns
errors, or doesn't list the symbol, it falls through to the next tier.

### Tradfi OHLC

**Snapshot-first policy (since 2026-07-22):** For all public tickers in
TRAD_UNIVERSE (~470 tickers), the Board/Macro pages read directly from
`/snapshot.tradfi.json` (Yahoo Finance data fetched server-side 4× daily).
Live sources are only invoked for tickers NOT in the snapshot — pre-IPO names
(OPENAI, ANTHROPIC, SPACEX, etc.) and any new ticker added before the next
snapshot refresh.

Live fallback chain (only used when snapshot has no data for a ticker):

| Tier | Source           | Tickers                                                     | Auth required |
|------|------------------|-------------------------------------------------------------|---------------|
| 1    | Lighter          | ~94 tradfi markets (stocks, ETFs, indices, commodities, FX, pre-IPO) out of 214 total | No          |
| 1    | OKX SWAP perps   | SPY, QQQ, NVDA, TSLA, AAPL, XAU, XAG (7 tickers)           | No            |
| 1    | Yahoo proxy      | All public US/intl tickers (via Cloudflare Worker)          | No (proxy)    |
| 2    | Binance xStocks  | NVDA, TSLA (xStocks tokens; more available on Binance but only 2 whitelisted) | No |
| 3    | Kraken           | 11 tradfi pairs (forex + metals)                            | No            |
| 4    | Massive/Polygon  | All US stocks/ETFs                                          | Yes (opt-in, localStorage) |
| 5    | Twelve Data      | US stocks, ETFs, forex, crypto (800 req/day free tier)      | Yes (opt-in, localStorage) |

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

- Triggers on: push to main, daily at 23:00 UTC, manual dispatch
- Builds the site, fetches FRED data, deploys to `gh-pages` branch

### `.github/workflows/refresh-snapshot.yml`

- Triggers: 04:00, 10:00, 16:00, 22:00 UTC (7 days/week), manual dispatch
- Saturday 04:00 UTC captures Friday's final market-close data flows
- Only refreshes `snapshot.json` + `snapshot.tradfi.json` (no full bundle rebuild)
- If snapshot changed, commits to main → dispatches `deploy.yml` for rebuild
- Verifies the deploy workflow actually started (polls for the resulting run)

### `.github/workflows/snapshot-health-check.yml`

- Triggers: every 2 hours, 24/7 (`0 */2 * * *`)
- Fetches live `snapshot.json`, checks `generated_at` age
- Thresholds: FRESH <8h, STALE 8-24h, CRITICAL >24h
- Auto-opens GitHub Issues with `stale-snapshot` / `stale-snapshot-critical` labels
- Auto-closes issues when snapshot recovers (prevents issue rot)
- Deliberate threshold gap with user-facing FreshnessBanner (6h/12h vs 8h/24h) — users see warnings before maintainers get paged

### Cloudflare Workers

- **`yahoo-proxy-worker.js`** — on-demand Yahoo Finance proxy with CORS allowlist + shared-secret token + IP rate limiting (60 req/min). Setup guide: `cloudflare/WORKER_TOKEN_SETUP.md`
- **`refresh-trigger-worker.js`** — cron every 4h (`0 */4 * * *`), calls GitHub `workflow_dispatch` API to trigger `refresh-snapshot.yml`. Breaks dependency on unreliable GitHub Actions cron. Setup guide: `cloudflare/REFRESH_TRIGGER_SETUP.md`

## Development commands

```bash
npm run dev              # Vite dev server
npm run build            # Production build → dist/
npm run build:snapshot   # Manually build snapshot.json (requires FRED_API_KEY + CMC_API_KEY env)
npm run lint             # ESLint
npm run typecheck        # TypeScript check (jsconfig.json)
npm test                 # 149-test suite (signal compute + orthogonal + factor engine)
```

## Snapshot keys

`snapshot.json` (~1.1 MB) contains 28 top-level keys built by `scripts/build_snapshot.js`:

| Key | Description | Source |
|-----|-------------|--------|
| `generated_at` | ISO timestamp | build_snapshot.js |
| `fred` | 11 FRED macro series (CPI, M2, ICSA, WTREGEN, RRPONTSYD, BAMLH0A0HYM2, T10YIE, T5YIFR, NFCI, WALCL, WRESBAL) | FRED API (server-side) |
| `coingecko_top` | Top coins by market cap (volume + price) | CoinGecko API |
| `crypto_universe` | Top-500 coins with tags + supply + multi-tf changes + platform | CMC API (fallback: CoinGecko) |
| `cmc_trending` | Trending/gainers/losers/most-visited/community | CMC API (paid tier required; null on free tier) |
| `global_metrics` | BTC dominance, total mcap, active coins | CMC API |
| `binance_oi` | Open interest per asset | Binance API |
| `fear_greed` | Daily Fear & Greed index history | alternative.me API |
| `ken_french` | Ken French monthly factor returns | Dartmouth website |
| `vix_realtime` | Real-time VIX price + change | CBOE JSON API |
| `etf_flows` | BTC/ETH/SOL/HYPE ETF flow data | Farside.co.uk |
| `factor_watch` | TradFi equity factor data (7 factors × 5 timeframes) | factorwatch.ai (gated by `VITE_ENABLE_FACTORWATCH`) |
| `factor_watch_history` | 90-day rolling FactorWatch accumulation | factorwatch.ai |
| `factor_watch_leader_history` | FactorWatch leadership shifts | factorwatch.ai |
| `crypto_factors` | Crypto factor quintile portfolios + spreads | `scripts/compute_crypto_factors.js` |
| `crypto_factor_history` | Daily crypto factor history | `scripts/compute_crypto_factors.js` |
| `crypto_factor_spread_history` | Factor spread time series | `scripts/compute_crypto_factors.js` |
| `regime_history` | Daily regime quadrant history | `scripts/build_snapshot.js` |
| `tradfi_breadth_history` | 90-day TradFi advancers/decliners (Zweig thrust) | `scripts/build_snapshot.js` |
| `signal_metrics` | STRONG/WEAK/NEUTRAL verdicts for BTC/Majors/Cash | `scripts/compute_signal_metrics.js` |
| `signal_history` | Signal verdict history | `scripts/compute_signal_metrics.js` |
| `signal_verification` | Walk-forward hit rates for the signal engine | `scripts/compute_signal_metrics.js` |
| `crypto_grid` | Crypto grid-heatmap data (Screener) | `scripts/build_snapshot.js` |
| `dominance_history` | BTC dominance history series | `scripts/build_snapshot.js` |
| `environment` | Market environment panel (temperature + posture) | `scripts/build_snapshot.js` |
| `factor_universe` | Factor baskets for thematic mapping (4 categories, 21 baskets) | `scripts/build_snapshot.js` |
| `levered_appetite` | Levered ETF risk-appetite read | `scripts/build_snapshot.js` |
| `cboe_pc` | CBOE equity put/call ratio — dormant (`null`; scraper retained for documentation, see audit F-14-a-1) | — |

`snapshot.tradfi.json` (~22 MB) contains `generated_at` + `tradfi_ohlcv` (compact OHLCV for ~470 tradfi tickers, ~250 days each).

## Server-side config

`config/settings.json` (committed to repo) controls tunable thresholds: MA periods, extension thresholds (too_hot_atr, clean_momentum ranges), scanner limits (rvol_min, gap_min, momentum_top_n), theme scoring weights. Loaded at runtime by `src/lib/config/settingsLoader.js` (fetches `/config/settings.json`, falls back to hardcoded DEFAULTS if fetch fails). Changes require a commit + deploy.

## File structure (key paths)

```
.
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml                # Build + deploy to gh-pages
│   │   ├── refresh-snapshot.yml      # Refresh snapshot data 4× daily
│   │   └── snapshot-health-check.yml # Every 2h: staleness check + auto-issue
│   ├── ISSUE_TEMPLATE/               # Bug / feature / data issue templates
│   └── PULL_REQUEST_TEMPLATE.md      # PR checklist
├── config/
│   └── settings.json                 # Server-side config (MA periods, thresholds, weights)
├── public/
│   ├── snapshot.json                 # ~1.1 MB FRED + CoinGecko + CMC + factors + signals
│   ├── snapshot.tradfi.json          # ~22 MB tradfi OHLCV (lazy-loaded)
│   ├── robots.txt                    # SEO
│   ├── sitemap.xml                   # SEO
│   ├── safari-pinned-tab.svg         # Safari tab icon
│   ├── browserconfig.xml             # Windows tiles
│   └── mstile-*.png                  # Windows tile icons
├── scripts/
│   ├── build_snapshot.js             # Server-side data fetcher (runs in CI)
│   ├── compute_crypto_factors.js     # Crypto factor quintile + spread computation
│   ├── compute_signal_metrics.js     # Signal verdict computation (runs in CI)
│   ├── verify-csp.py                 # CSP allowlist verification
│   └── signal/                       # Signal backtest + test suite
│       ├── compute.test.js           # Signal engine tests
│       ├── orthogonal.test.js        # OrthoSys v6.1 tests
│       └── backtest.js               # Historical replay
├── cloudflare/
│   ├── yahoo-proxy-worker.js         # Yahoo Finance proxy (CORS + token + rate limit)
│   ├── refresh-trigger-worker.js     # Cron every 4h → dispatches refresh-snapshot.yml
│   ├── WORKER_TOKEN_SETUP.md         # Yahoo proxy token setup guide
│   └── REFRESH_TRIGGER_SETUP.md      # Refresh trigger Worker deployment guide
├── docs/
│   ├── SIGNAL_CATALOG.md             # Inventory of every signal/metric/indicator
│   ├── ORTHOSYS_BACKTEST_REPORT.md   # OrthoSys v6.1 backtest (point-in-time, 2026-07-21)
│   └── ORTHOSYS_DAILY_BACKTEST_REVISED.md  # OrthoSys daily-tuned backtest (revised)
├── LICENSE                           # MIT
├── SECURITY.md                       # Vulnerability disclosures + key rotation
└── src/
    ├── pages/
    │   ├── Scanner.jsx               # / — crypto screener (Top 500)
    │   ├── Board.jsx                 # /board — two-row tab layout (crypto + tradfi)
    │   ├── MacroRegime.jsx           # /macro — FRED + regime + FactorWatch
    │   └── Signal.jsx                # /signal — STRONG/WEAK/NEUTRAL verdicts
    ├── components/
    │   ├── board/                    # 22 Board tab components (DailyBoard, MacroTab, etc.)
    │   ├── scanner/                  # Scanner UI components
    │   ├── regime/                   # MacroRegime components
    │   └── FreshnessBanner.jsx       # Staleness warning banner
    ├── hooks/
    │   ├── useSnapshot.js            # Snapshot fetch + cache (TanStack Query)
    │   ├── useSnapshotFreshness.js   # Centralized staleness logic (FRESH/STALE/CRITICAL)
    │   └── useFactorSignals.js       # Factor signal hook
    └── lib/
        ├── scanner/
        │   ├── factorEngine.js       # Crypto factor quintile portfolios + spread monitor + quilt
        │   ├── sourceResolver.js     # Multi-source auto-fallback dispatcher
        │   ├── sourceHealth.js       # Global geo-block tracking (HTTP 451)
        │   ├── exchanges.js          # Top-500 universe fetcher + filterUniverse
        │   ├── constants.js          # STABLECOINS, WRAPPED, TOKENIZED_TAGS sets
        │   └── sources/
        │       ├── okxCrypto.js      # OKX SWAP+SPOT with universe cache
        │       ├── bybit.js          # Bybit linear perps + spot
        │       ├── kraken.js         # Kraken spot with dynamic AssetPairs
        │       ├── hyperliquid.js    # Hyperliquid perps + funding/OI tickers
        │       ├── yahooCrypto.js    # Yahoo Finance via Cloudflare Worker proxy
        │       ├── binanceSpot.js    # Binance spot (broader coin coverage; geo-blocked US/UK)
        │       ├── binancePerps.js   # Binance USD-M futures
        │       ├── coingecko.js      # Free daily OHLC
        │       ├── okxTradfi.js      # SPY/QQQ/NVDA/TSLA/AAPL/XAU/XAG perps (7 tickers)
        │       ├── lighter.js        # Lighter ~94 tradfi markets (incl. pre-IPO)
        │       ├── massive.js        # Polygon.io (opt-in, localStorage key)
        │       └── binanceXStocks.js # Binance xStocks (NVDA, TSLA)
        │       # (Twelve Data is fetched inline in traditionalMarkets.js — no separate source module)
        ├── board/
        │   ├── boardEngine.js        # Crypto board analysis (metrics + themes + breadth)
        │   ├── traditionalMarkets.js # TradFi universe (~470 tickers) + snapshot-first loader
        │   ├── tradfiScoring.js      # TradFi theme scoring + extension lists
        │   ├── cryptoUniverse.js     # Crypto board universe (382 curated assets)
        │   ├── leveredETFs.js        # Levered ETF metadata (93 ETFs)
        │   ├── tableUtils.js         # Sort + heat-color utilities
        │   └── useSortableTable.js   # Reusable sortable table hook
        ├── signal/
        │   ├── compute.js            # Signal engine v3.1 (9-signal STRONG/WEAK/NEUTRAL)
        │   └── orthogonal.js         # OrthoSys v6.1 (9-signal Gram-Schmidt decorrelated)
        ├── factors/                   # Factor signal engine (composite, rotation, crowding)
        │   ├── compositeEngine.js    # Unified stance computation (CONSTRUCTIVE/SELECTIVE/DEFENSIVE/WAIT)
        │   ├── rotationDetector.js   # 3-session confirm rotation detection (run-based semantics)
        │   ├── crowdingMatrix.js     # Cross-asset crowding heatmap
        │   ├── narrativeGenerator.js # Auto-generated factor narrative text
        │   └── universeFilter.js     # Pegged-asset filter (stablecoins/gold/wrapped/exchange tokens)
        ├── regime/
        │   ├── macroResolver.js      # Multi-source macro fallback chain
        │   ├── regimeEngine.js       # Ultra6 + OB1 + Core9 regime computation
        │   ├── regimeSignals.js      # Allocation verdict (ALLOCATE / STABLECOINS)
        │   ├── regimeRotation.js     # Quadrant flip detection
        │   ├── regimePercentile.js   # Non-parametric rank statistics
        │   ├── seasonality.js        # Ken French baselines
        │   ├── changeLog.js          # Regime diff persistence
        │   ├── factorSignals.js      # FactorWatch signal integration
        │   ├── macroSources/
        │   │   ├── alphaVantage.js   # CPI/M2/ICSA live fallback
        │   │   ├── treasuryGov.js    # TGA/RRP live fallback
        │   │   └── fredProxy.js      # Reads pre-baked snapshot.json
        │   └── regimeSources.js      # Top-level regime data fetcher
        └── config/
            └── settingsLoader.js     # Server-side config loader (config/settings.json)
```

## Troubleshooting

### "FRED data unavailable" warning on Macro Regime page

The `snapshot.json` hasn't been built yet. Either:
- Wait for the 4× daily workflow to run (check the Actions tab)
- Manually trigger the refresh-snapshot workflow from the Actions tab
- Run `npm run build:snapshot` locally with `FRED_API_KEY=your_key` and commit `public/snapshot.json` + `public/snapshot.tradfi.json`

### Scanner shows 0 results

The auto-resolver tries multiple sources. If all fail:
- Check the browser console for `[resolver]` warnings
- Try forcing a single source from the dropdown (e.g. "Hyperliquid")
- Some sources may rate-limit IPs that hit them heavily; wait 5 min and retry
- If you're in the US/UK, Binance returns 451 (geo-blocked) — this is expected, the resolver falls through to other sources automatically

### Scanner shows tokenized stocks (NVDAON, TSLAX, etc.)

These are filtered out by `filterUniverse()` in `src/lib/scanner/exchanges.js` via the `TOKENIZED_TAGS` set in `src/lib/scanner/constants.js`. If a new tokenized stock slips through:
- Check its CMC tags in the browser console (inspect `crypto_universe` from `/snapshot.json`)
- Add the relevant tag slug to `TOKENIZED_TAGS` in `src/lib/scanner/constants.js`
- Or add its symbol to the `WRAPPED` set if it's a wrapped token

### Board Refresh button doesn't update snapshot

Fixed in 2026-08-10 build — the Refresh button now re-fetches `/snapshot.json` + `/snapshot.tradfi.json` (cache-busting via `?t=Date.now()`) in addition to live candles. If you're still seeing stale data after clicking Refresh:
- Hard-reload the browser (Ctrl+Shift+R / Cmd+Shift+R) to clear the HTTP cache
- Check the browser console for `Snapshot re-fetch failed` warnings
- Check that `refresh-snapshot.yml` ran recently in the Actions tab

### TradFi tab shows duplicate rows

Fixed in 2026-08-07 build — `buildTradResult()` in `src/lib/board/traditionalMarkets.js` now dedupes by symbol. If duplicates reappear:
- Check `TRAD_UNIVERSE` in `src/lib/board/traditionalMarkets.js` for accidental dupes
- The dedupe keeps the first occurrence (main universe before the appended levered ETFs section)

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
- `CMC_API_KEY` — CoinMarketCap. Used by `build_snapshot.js` in GitHub Actions (1 credit/refresh for top-500 universe).

**Runtime only (set via localStorage, NOT baked into bundle):**
- `MASSIVE_API_KEY` — Polygon.io paid key. Set via browser console: `localStorage.setItem('MASSIVE_API_KEY', '...')`
- `TWELVEDATA_KEY` — Twelve Data paid key. Same pattern.
- `ALPHAVANTAGE_KEY` — Alpha Vantage key. Same pattern.

**VITE_ env vars (baked into bundle — safe because non-secret):**
- `VITE_YAHOO_PROXY_URL` — Cloudflare Worker URL (just a URL, not a secret)
- `VITE_YAHOO_PROXY_TOKEN` — Worker auth token (only useful for THIS worker, rotatable)
- `VITE_ENABLE_FACTORWATCH` — boolean feature flag

**Why no VITE_ prefix for paid keys?**
Vite statically inlines `VITE_`-prefixed env vars into the client JS bundle. Anyone can inspect the bundle and extract the key. Paid keys (Polygon, Twelve Data, Alpha Vantage) must be provided at runtime via localStorage instead. The `VITE_MASSIVE_API_KEY` GitHub Actions secret was removed in 2026-07-16 (see SECURITY.md) — the resolver no longer ships any Polygon key in the bundle.

### Cloudflare Worker Auth

The Yahoo Finance proxy worker uses two layers of protection:
1. **Origin allowlist (CORS)** — blocks browser requests from non-TrendScan sites
2. **Shared-secret token** — blocks non-browser requests (curl, Python) that bypass CORS

Set the worker token via `wrangler secret put WORKER_TOKEN` and the client token via `VITE_YAHOO_PROXY_TOKEN` GitHub Actions secret (or `localStorage.setItem('YAHOO_PROXY_TOKEN', '...')` for local dev). See `cloudflare/WORKER_TOKEN_SETUP.md` for the full setup guide.

### Git Repository Size

`snapshot.tradfi.json` (~22 MB) is pushed directly to the `gh-pages` branch, NOT committed to `main`. This prevents Git history bloat — committing a 22 MB file 4× daily to main would add ~88 MB/day to the `.git` folder.

## License

MIT — see [LICENSE](LICENSE).
