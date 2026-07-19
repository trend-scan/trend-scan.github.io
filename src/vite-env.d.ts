/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Cloudflare Worker URL for Yahoo Finance proxy (avoids CORS in browser).
  // See cloudflare/yahoo-proxy-worker.js. If unset, falls back to the
  // hardcoded worker URL below (acceptable — not a secret, just a URL).
  readonly VITE_YAHOO_PROXY_URL?: string;
  // Shared-secret token for the Cloudflare Worker. Prevents quota abuse via
  // non-browser requests (curl, Python) that bypass CORS. This IS baked into
  // the bundle, but that's acceptable: the token is only useful for THIS
  // worker, and rotating it is trivial.
  readonly VITE_YAHOO_PROXY_TOKEN?: string;
  // Feature flag for FactorWatch integration. Set to 'true' in GitHub Actions
  // secrets to enable the TradFi factor signals, narrative banner, divergence
  // chart, and revision arbitrage table. Defaults to off — all FactorWatch
  // UI components check this flag and render nothing when it's not 'true'.
  readonly VITE_ENABLE_FACTORWATCH?: string;
  // Feature flag for Signal page. Set to 'true' in GitHub Actions secrets
  // to enable the /signal route with STRONG/WEAK/NEUTRAL verdicts.
  readonly VITE_ENABLE_SIGNAL_PAGE?: string;
  // NOTE: Paid API keys (Massive/Polygon, Twelve Data, Alpha Vantage) are
  // deliberately NOT declared here. They must NOT be passed as VITE_ env vars
  // — Vite statically inlines VITE_-prefixed vars into the client bundle,
  // exposing the keys to anyone who inspects the JS. Users who want these
  // sources must set them at runtime via localStorage:
  //   localStorage.setItem('MASSIVE_API_KEY', '...')
  //   localStorage.setItem('TWELVEDATA_KEY', '...')
  //   localStorage.setItem('ALPHAVANTAGE_KEY', '...')
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
