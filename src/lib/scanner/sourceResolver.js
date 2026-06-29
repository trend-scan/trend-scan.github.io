/**
 * Source Resolver — multi-source auto-fallback for OHLC candle fetches.
 *
 * Tries sources in priority order per request. First non-null result wins.
 * Failed (source, symbol) pairs are deprioritized for 5 minutes to avoid retry storms.
 *
 * Usage:
 *   const { source, candles } = await fetchCandles('BTC', { timeframe: '1D' });
 *   if (candles) { ... } else { /* all sources failed *\/ }
 *
 * To force a specific source (e.g. user-selected in UI):
 *   await fetchCandles('BTC', { preferredSource: 'hyperliquid' });
 *
 * To check what's available without fetching:
 *   const sources = await getAvailableSources('SPY');
 */

import * as massive          from './sources/massive';        // Polygon.io (paid key — VITE_MASSIVE_API_KEY)
import * as coingecko        from './sources/coingecko';
import * as hyperliquid      from './sources/hyperliquid';
import * as bybit            from './sources/bybit';
import * as gate             from './sources/gate';
import * as kucoin           from './sources/kucoin';
import * as okxCrypto        from './sources/okxCrypto';
import * as kraken           from './sources/kraken';
import * as okxTradfi        from './sources/okxTradfi';
import * as lighter          from './sources/lighter';
import * as binanceXStocks   from './sources/binanceXStocks';

// OKX SWAP perps tradfi tickers (high liquidity, preferred for these names)
const OKX_TRADFI = new Set(['SPY','QQQ','NVDA','TSLA','AAPL','XAU','XAG']);

// Determine asset type from symbol
function classifySymbol(symbol) {
  const s = symbol.toUpperCase();
  if (OKX_TRADFI.has(s)) return 'tradfi';
  if (binanceXStocks.isTradfi?.(s)) return 'tradfi';
  return 'crypto';
}

// ─── Crypto sources (in priority order) ─────────────────────────────────────
// Strategy:
//   Tier 0: Massive/Polygon (paid key) — broadest coverage, highest limits, intraday+daily
//   Tier 1: Free high-reliability exchanges (no auth, no rate limits, no geo blocks)
//   Tier 2: Solid backup exchanges
//   Tier 3: More rate-limited or narrower coverage
//   Tier 4: Last resort — CoinGecko (rate-limited but widest altcoin coverage)
//
// Massive is tier 0 only when VITE_MASSIVE_API_KEY is configured; otherwise
// it's filtered out by the `supports` check (returns false if no key).
const CRYPTO_SOURCES = [
  { id: 'okx_perps',   tier: 1, fetch: okxCrypto.fetchCandles,   bestFor: ['all'] },
  { id: 'hyperliquid', tier: 1, fetch: hyperliquid.fetchCandles, bestFor: ['15m','30m','1H','4H','1w'] },
  { id: 'kraken',      tier: 1, fetch: kraken.fetchCandles,      bestFor: ['1D','1w'] },
  { id: 'bybit',       tier: 2, fetch: bybit.fetchCandles,       bestFor: ['all'] },
  { id: 'gate',        tier: 3, fetch: gate.fetchCandles,        bestFor: ['all'] },
  { id: 'kucoin',      tier: 3, fetch: kucoin.fetchCandles,      bestFor: ['all'] },
  { id: 'coingecko',   tier: 4, fetch: coingecko.fetchCandles,   bestFor: ['1D','1w'] },
  // Massive/Polygon free tier: only /prev works for crypto (NOT /range).
  // Keep as absolute last resort — fetchCandles will return null for /range calls,
  // and the resolver will move on. Useful only for the fetchPrevClose() helper.
  { id: 'massive',     tier: 5, fetch: massive.fetchCandles,     bestFor: ['1D'],
    supports: () => massive.isConfigured() },
];

// ─── Tradfi sources (in priority order) ─────────────────────────────────────
// Massive/Polygon has the broadest tradfi coverage (all US stocks, ETFs, forex,
// commodities, indices) — preferred when API key is configured.
const TRADFI_SOURCES = [
  // OKX SWAP perps for the 7 most liquid names (no auth needed, high liquidity)
  { id: 'okx_swap',        tier: 1, fetch: okxTradfi.fetchCandles,
    supports: (s) => OKX_TRADFI.has(s.toUpperCase()) },
  // Lighter for everything else (214-market universe — stocks, ETFs, FX, commodities)
  // No supports() check — try for ALL tradfi symbols. fetchCandles returns null
  // if the symbol isn't found, and the resolver falls through to the next source.
  { id: 'lighter',         tier: 1, fetch: lighter.fetchCandles },
  // Binance xStocks (NVDA/TSLA backup)
  { id: 'binance_xstocks', tier: 2, fetch: binanceXStocks.fetchCandles,
    supports: (s) => binanceXStocks.isTradfi?.(s) ?? false },
  // Massive/Polygon free tier — limited (only /prev works reliably for most assets)
  // Keep as last resort; useful for tickers not on any exchange (obscure stocks/ETFs)
  { id: 'massive',         tier: 3, fetch: massive.fetchCandles,
    supports: () => massive.isConfigured() },
];

// ─── Failure tracking ────────────────────────────────────────────────────────

const _failures = new Map();
const FAILURE_THRESHOLD = 3;
const FAILURE_TTL_MS = 5 * 60 * 1000;

function isDeprioritized(sourceId, symbol) {
  const k = `${sourceId}:${symbol}`;
  const f = _failures.get(k);
  if (!f) return false;
  if (Date.now() - f.lastFail > FAILURE_TTL_MS) {
    _failures.delete(k);
    return false;
  }
  return f.count >= FAILURE_THRESHOLD;
}

function recordFailure(sourceId, symbol) {
  const k = `${sourceId}:${symbol}`;
  const f = _failures.get(k) || { count: 0, lastFail: 0 };
  f.count++;
  f.lastFail = Date.now();
  _failures.set(k, f);
}

function recordSuccess(sourceId, symbol) {
  _failures.delete(`${sourceId}:${symbol}`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch candles for a symbol, trying multiple sources automatically.
 *
 * @param {string} symbol  - "BTC", "ETH", "SPY", "QQQ", "XAU", etc.
 * @param {object} opts
 * @param {string} [opts.timeframe='1D']   - '15m','30m','1H','4H','12H','1D','1w'
 * @param {number} [opts.limit=300]
 * @param {string} [opts.preferredSource]  - force a specific source id
 * @param {string} [opts.type]             - 'crypto' | 'tradfi' (auto-detected if omitted)
 *
 * @returns {Promise<{source: string|null, candles: Array|null}>}
 */
export async function fetchCandles(symbol, opts = {}) {
  const { timeframe = '1D', limit = 300, preferredSource, type } = opts;
  const assetType = type || classifySymbol(symbol);

  const sourceList = assetType === 'tradfi' ? TRADFI_SOURCES : CRYPTO_SOURCES;

  // Build candidate list, filtering by explicit support + deprioritization
  const candidates = [];
  for (const src of sourceList) {
    if (isDeprioritized(src.id, symbol)) continue;
    if (src.supports) {
      const supported = await src.supports(symbol);
      if (!supported) continue;
    }
    candidates.push(src);
  }

  // Sort: preferred first, then by tier
  candidates.sort((a, b) => {
    if (preferredSource === a.id) return -1;
    if (preferredSource === b.id) return 1;
    return a.tier - b.tier;
  });

  for (const src of candidates) {
    try {
      // Add 8-second timeout per source to prevent hanging
      const fetchPromise = src.fetch(symbol, timeframe, limit);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 8000)
      );
      const candles = await Promise.race([fetchPromise, timeoutPromise]);
      if (candles && candles.length >= Math.min(20, limit * 0.1)) {
        recordSuccess(src.id, symbol);
        return { source: src.id, candles };
      }
      recordFailure(src.id, symbol);
    } catch (e) {
      recordFailure(src.id, symbol);
      // Don't log timeouts — they're expected when sources are slow
      if (!e.message.includes('timeout')) {
        console.warn(`[resolver] ${src.id} failed for ${symbol}: ${e.message}`);
      }
    }
  }

  return { source: null, candles: null };
}

/**
 * Fetch candles for many symbols in parallel (with concurrency control).
 *
 * @returns {Promise<Map<symbol, {source, candles}>>}
 */
export async function fetchCandlesBatch(symbols, opts = {}, concurrency = 7) {
  const results = new Map();
  let idx = 0;

  async function worker() {
    while (idx < symbols.length) {
      const sym = symbols[idx++];
      results.set(sym, await fetchCandles(sym, opts));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/**
 * Return which sources are likely available for a symbol (for UI display).
 */
export async function getAvailableSources(symbol) {
  const type = classifySymbol(symbol);
  const list = type === 'tradfi' ? TRADFI_SOURCES : CRYPTO_SOURCES;
  const available = [];
  for (const src of list) {
    if (src.supports) {
      const ok = await src.supports(symbol);
      if (ok) available.push(src.id);
    } else {
      available.push(src.id);
    }
  }
  return available;
}

/**
 * Health summary for UI display (which sources are currently failing).
 */
export function getSourceHealth() {
  const out = [];
  for (const [k, f] of _failures.entries()) {
    const [source, symbol] = k.split(':');
    if (Date.now() - f.lastFail > FAILURE_TTL_MS) continue;
    out.push({ source, symbol, failures: f.count, lastFail: f.lastFail });
  }
  return out;
}

export const ALL_SOURCE_IDS = [
  ...CRYPTO_SOURCES.map(s => s.id),
  ...TRADFI_SOURCES.map(s => s.id),
];
