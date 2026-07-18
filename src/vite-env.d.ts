/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Polygon.io / Massive API — used by src/lib/scanner/sources/massive.js
  // (and traditionalMarkets.js). Free tier ~5 req/min. Set via GitHub
  // Actions secret VITE_MASSIVE_API_KEY. Runtime override: localStorage.MASSIVE_API_KEY.
  readonly VITE_MASSIVE_API_KEY?: string;
  // Alpha Vantage — used by src/lib/regime/macroSources/alphaVantage.js
  // (live fallback for CPI, M2, ICSA when FRED snapshot is stale).
  // Free tier: 25 req/day. 'demo' key works for CPI only.
  readonly VITE_ALPHAVANTAGE_KEY?: string;
  // Twelve Data — used by src/lib/board/traditionalMarkets.js as last-resort
  // OHLCV source for tickers not on Lighter/OKX/Yahoo. Free tier: 800 req/day, 8 req/min.
  // Marked `source: 'twelvedata'` in TRAD_UNIVERSE.
  readonly VITE_TWELVEDATA_KEY?: string;
  // Cloudflare Worker URL for Yahoo Finance proxy (avoids CORS in browser).
  // See cloudflare/yahoo-proxy-worker.js. If unset, falls back to the
  // hardcoded worker URL below (acceptable — not a secret).
  readonly VITE_YAHOO_PROXY_URL?: string;
  // Feature flag for FactorWatch integration. Set to 'true' in GitHub Actions
  // secrets to enable the TradFi factor signals, narrative banner, divergence
  // chart, and revision arbitrage table. Defaults to off — all FactorWatch
  // UI components check this flag and render nothing when it's not 'true'.
  readonly VITE_ENABLE_FACTORWATCH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
