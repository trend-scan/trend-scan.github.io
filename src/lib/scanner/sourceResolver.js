/**
 * Source Resolver — multi-source auto-fallback for OHLC candle fetches.
 *
 * SIMPLE SEQUENTIAL STRATEGY:
 *   Try each source in priority order. Return the first non-null result.
 *   No parallel racing, no Promise.any, no tier-grouping.
 *
 * Why sequential (not parallel)?
 *   1. Browsers limit ~6 concurrent connections per host. Racing 3 sources
 *      across 12 workers = 36 concurrent requests, causing queue saturation
 *      and cascade timeouts. Sequential = 12 concurrent requests max.
 *   2. sourceHealth.js globally blocks geo-blocked sources (HTTP 451) after
 *      the first failure, so subsequent symbols skip them instantly —
 *      no need to race to "find the working source" on every call.
 *   3. Per-symbol deprioritization skips (source, symbol) pairs that have
 *      failed 3+ times in 5 min, avoiding retries on known-missing symbols.
 *   4. Simpler code = easier to debug and maintain.
 *
 * Usage:
 *   const { source, candles } = await fetchCandles('BTC', { timeframe: '1D' });
 *   if (candles) { ... } else { /* all sources failed *\/ }
 *
 * To force a specific source (e.g. user-selected in UI):
 *   await fetchCandles('BTC', { preferredSource: 'hyperliquid' });
 */

import * as massive          from './sources/massive';        // Polygon.io (paid key)
import * as coingecko        from './sources/coingecko';
import * as hyperliquid      from './sources/hyperliquid';
import * as bybit            from './sources/bybit';
import * as okxCrypto        from './sources/okxCrypto';
import * as okxTradfi        from './sources/okxTradfi';
import * as kraken           from './sources/kraken';          // ← ADDED: reliable, no geo-block
import * as lighter          from './sources/lighter';
import * as binanceXStocks   from './sources/binanceXStocks';
import * as binancePerps     from './sources/binancePerps';
import * as binanceSpot      from './sources/binanceSpot';
import * as yahooCrypto      from './sources/yahooCrypto';
import { isGloballyBlocked, getBlockedSources } from './sourceHealth';

// Tradfi tickers handled by OKX SWAP (high liquidity perps)
const OKX_TRADFI = new Set(['SPY','QQQ','NVDA','TSLA','AAPL','XAU','XAG']);

function classifySymbol(symbol) {
  const s = symbol.toUpperCase();
  if (OKX_TRADFI.has(s)) return 'tradfi';
  if (binanceXStocks.isTradfi?.(s)) return 'tradfi';
  return 'crypto';
}

// ─── Crypto sources (in priority order) ─────────────────────────────────────
// Tried sequentially top-to-bottom. The first source to return ≥5 candles wins.
//
// Priority rationale:
//   1. OKX      — fast, broad coverage, no geo-block in most regions
//   2. Bybit    — fast, broad coverage, may be geo-blocked (451 → auto-blocked)
//   3. Kraken   — reliable, NO geo-block, ~300/378 symbol coverage
//   4. Hyperliquid — 230 perps, no geo-block, fast DEX API
//   5. Yahoo    — broad coverage via Cloudflare Worker proxy, no geo-block
//   6. Binance  — deepest coverage but geo-blocked in US/UK (VPN required)
//   7. CoinGecko — rate-limited but widest altcoin coverage
//   8. Massive  — paid Polygon key (last resort)
//
// With VPN OFF: OKX/Bybit/Binance get 451 → auto-blocked by sourceHealth.
//   Kraken becomes the primary (300/378), Yahoo fills the gap (~40 more).
//   Expected coverage: ~320-340
//
// With VPN ON: OKX succeeds for most symbols (~320/378).
//   Binance fills in the rest. Expected coverage: ~350+
const CRYPTO_SOURCES = [
  { id: 'okx_perps',     tier: 1, fetch: okxCrypto.fetchCandles,
    supports: async (s) => okxCrypto.isSupported(s) },
  { id: 'bybit',         tier: 1, fetch: bybit.fetchCandles },
  { id: 'kraken',        tier: 2, fetch: kraken.fetchCandles },
  { id: 'hyperliquid',   tier: 2, fetch: hyperliquid.fetchCandles },
  { id: 'yahoo_crypto',  tier: 3, fetch: yahooCrypto.fetchCandles },
  { id: 'binance_spot',  tier: 4, fetch: binanceSpot.fetchCandles,
    supports: async (s) => binanceSpot.isSupported(s) },
  { id: 'binance_perps', tier: 4, fetch: binancePerps.fetchCandles,
    supports: async (s) => binancePerps.isSupported(s) },
  { id: 'coingecko',     tier: 5, fetch: coingecko.fetchCandles },
  { id: 'massive',       tier: 6, fetch: massive.fetchCandles,
    supports: () => massive.isConfigured() },
];

// ─── Tradfi sources (in priority order) ─────────────────────────────────────
const TRADFI_SOURCES = [
  { id: 'lighter',         tier: 1, fetch: lighter.fetchCandles },
  { id: 'okx_swap',        tier: 1, fetch: okxTradfi.fetchCandles,
    supports: (s) => OKX_TRADFI.has(s.toUpperCase()) },
  { id: 'yahoo_proxy',     tier: 1, fetch: yahooCrypto.fetchCandles },
  { id: 'binance_xstocks', tier: 2, fetch: binanceXStocks.fetchCandles,
    supports: (s) => binanceXStocks.isTradfi?.(s) ?? false },
  { id: 'massive',         tier: 3, fetch: massive.fetchCandles,
    supports: () => massive.isConfigured() },
];

// ─── Per-symbol failure tracking ────────────────────────────────────────────
// If a (source, symbol) pair fails 3+ times in 5 min, skip that source for
// that symbol. This avoids retrying sources that don't list a given symbol.
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

  // LRU cap: evict 100 oldest entries when Map exceeds 500
  if (_failures.size > 500) {
    const it = _failures.keys();
    for (let i = 0; i < 100; i++) {
      const { value, done } = it.next();
      if (done) break;
      _failures.delete(value);
    }
  }
}

function recordSuccess(sourceId, symbol) {
  _failures.delete(`${sourceId}:${symbol}`);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch candles for a symbol by trying sources sequentially in priority order.
 *
 * The first source to return ≥ minCandles candles (default 5) wins. Sources
 * that are globally blocked (HTTP 451) or per-symbol deprioritized (3+
 * failures) are skipped.
 *
 * Deep-lookback mode (2026-09-08, VWAP cap 90→365): pass minCandles equal to
 * the candle count your indicator needs. A source returning ≥5 but < minCandles
 * candles is NOT accepted (not its fault — it just can't go that deep), so
 * shallower tier-1 sources (OKX, 300-candle API max) yield to deeper ones
 * (Bybit 1000 / Binance perps 1500 / Kraken 720 / Hyperliquid start-end).
 * If no source satisfies minCandles, the longest ≥5 result is returned as
 * best-effort so the caller can decide what to do with it.
 *
 * @param {string} symbol
 * @param {object} opts
 * @param {string} [opts.timeframe='1D']
 * @param {number} [opts.limit=300]
 * @param {number} [opts.minCandles=5] - accept a source only if it returns at least this many candles
 * @param {string} [opts.preferredSource]  - force a specific source id
 * @param {string} [opts.type]             - 'crypto' | 'tradfi'
 * @returns {Promise<{source: string|null, candles: Array|null}>}
 */
export async function fetchCandles(symbol, opts = {}) {
  const { timeframe = '1D', limit = 300, minCandles = 5, preferredSource, type } = opts;
  const acceptAt = Math.max(minCandles, 5);
  const assetType = type || classifySymbol(symbol);
  const sourceList = assetType === 'tradfi' ? TRADFI_SOURCES : CRYPTO_SOURCES;

  // Build candidate list:
  //   1. Skip globally blocked sources (HTTP 451 — geo-blocked in this region)
  //   2. Skip per-symbol deprioritized sources (3+ failures for this symbol)
  //   3. Skip sources whose supports() check returns false (universe filter)
  //
  // Audit F-14-e-14 (2026-08-26): previously the supports() checks ran
  // sequentially with `await` inside the for-loop, adding 3-8s of cold-cache
  // delay on the first scan of a session. Now we filter the sync blockers
  // (geo-blocked + deprioritized) first, then race the supports() checks in
  // parallel via Promise.all — they're independent queries (each is a cached
  // universe lookup, no shared state).
  const prefiltered = sourceList.filter(src =>
    !isGloballyBlocked(src.id) && !isDeprioritized(src.id, symbol)
  );
  const supportsResults = await Promise.all(
    prefiltered.map(src => src.supports ? src.supports(symbol) : Promise.resolve(true))
  );
  const candidates = prefiltered.filter((_, i) => supportsResults[i] !== false);

  // Sort: preferred source first (if specified), then by tier
  if (preferredSource) {
    candidates.sort((a, b) => {
      if (a.id === preferredSource) return -1;
      if (b.id === preferredSource) return 1;
      return a.tier - b.tier;
    });
  }

  // Try each source sequentially. First result meeting minCandles wins.
  // No parallel racing, no Promise.any — just simple sequential fallback.
  //
  // This is deliberately simple. The complexity of parallel racing caused
  // connection contention (12 workers × 3 sources = 36 concurrent requests
  // hitting browser's 6-connections-per-host limit) which DECREASED
  // coverage vs. a single explicit source. Sequential + sourceHealth gives
  // us better coverage with simpler code.
  //
  // A source returning ≥5 but < minCandles candles counts as neither success
  // nor failure (depth shortfall isn't a source health problem — we must not
  // deprioritize OKX for other minCandles-agnostic callers). We keep the
  // longest one as best-effort in case no source can go deep enough.
  let best = null;
  for (const src of candidates) {
    try {
      const candles = await src.fetch(symbol, timeframe, limit);
      if (candles && candles.length >= acceptAt) {
        recordSuccess(src.id, symbol);
        return { source: src.id, candles };
      }
      if (candles && candles.length >= 5) {
        if (!best || candles.length > best.candles.length) best = { source: src.id, candles };
      } else {
        recordFailure(src.id, symbol);
      }
    } catch {
      recordFailure(src.id, symbol);
    }
  }

  if (best) {
    recordSuccess(best.source, symbol);
    return best;
  }
  return { source: null, candles: null };
}

/**
 * Fetch candles for many symbols in parallel (with concurrency control).
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

// Audit F-14-e-10 (2026-08-26): `getAvailableSources` + `getSourceHealth`
// removed — zero callers across src/ + tests. The canonical UI entry points
// are `getGloballyBlockedSources()` (used by Board.jsx) and `fetchCandles()`
// (used everywhere). The internal `_failures` Map remains in scope for the
// blocking-decision logic, but is no longer surfaced as a per-symbol health
// summary (no consumer ever read it).

/**
 * List of sources currently globally blocked (geo-restricted in this region).
 */
export function getGloballyBlockedSources() {
  return getBlockedSources();
}

export const ALL_SOURCE_IDS = [
  ...CRYPTO_SOURCES.map(s => s.id),
  ...TRADFI_SOURCES.map(s => s.id),
];
