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
import * as okxCrypto        from './sources/okxCrypto';
import * as okxTradfi        from './sources/okxTradfi';
import * as lighter          from './sources/lighter';
import * as binanceXStocks   from './sources/binanceXStocks';
import * as binancePerps     from './sources/binancePerps';   // Binance USDⓈ-M futures (perps)
import * as binanceSpot      from './sources/binanceSpot';    // Binance spot (broader coin coverage)
import * as yahooCrypto      from './sources/yahooCrypto';    // Yahoo Finance via Worker proxy (fallback)

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
//   Tier 1: OKX + Hyperliquid (fast, no rate limit, broad coverage)
//   Tier 2: Bybit + Binance (good coverage, geo-restricted in some regions)
//   Tier 3: Yahoo Finance proxy (unlimited, covers ~85% of crypto)
//   Tier 4: CoinGecko (rate-limited but widest altcoin coverage)
//
// Key optimization: sources WITHOUT supports() checks are preferred because
// supports() adds an async round-trip per symbol. Binance spot/perps have
// supports() checks but they use a cached universe (fetched once, then
// served from memory). Yahoo has no supports() check — it tries everything.
const CRYPTO_SOURCES = [
  // Tier 1: Fast, no geo-blocks, broad coverage — raced in parallel (top 3)
  { id: 'okx_perps',     tier: 1, fetch: okxCrypto.fetchCandles,     bestFor: ['all'] },
  { id: 'bybit',         tier: 1, fetch: bybit.fetchCandles,         bestFor: ['all'] },
  { id: 'yahoo_crypto',  tier: 1, fetch: yahooCrypto.fetchCandles,   bestFor: ['1D','1w','1W'] },
  // Tier 2: Tried sequentially if all tier-1 fail
  { id: 'hyperliquid',   tier: 2, fetch: hyperliquid.fetchCandles,   bestFor: ['15m','30m','1H','4H','1w'] },
  { id: 'binance_spot',  tier: 2, fetch: binanceSpot.fetchCandles,
    supports: async (s) => binanceSpot.isSupported(s),
    bestFor: ['all'] },
  { id: 'binance_perps', tier: 2, fetch: binancePerps.fetchCandles,
    supports: async (s) => binancePerps.isSupported(s),
    bestFor: ['all'] },
  { id: 'coingecko',     tier: 3, fetch: coingecko.fetchCandles,     bestFor: ['1D','1w'] },
  { id: 'massive',       tier: 4, fetch: massive.fetchCandles,       bestFor: ['1D'],
    supports: () => massive.isConfigured() },
];

// ─── Tradfi sources (in priority order) ─────────────────────────────────────
// Yahoo Finance Worker is the primary source for ALL tradfi tickers — it has
// no rate limits, covers every US stock/ETF, and is CORS-enabled via the proxy.
// Lighter and OKX are tried first for tickers they support (faster response),
// but Yahoo is the workhorse for the long tail.
const TRADFI_SOURCES = [
  // Lighter for tickers it supports (fast, no rate limit, ~95 tradfi markets)
  // Has supports() check via LIGHTER_MARKET_IDS — only matches ~95 of 374 tickers
  { id: 'lighter',         tier: 1, fetch: lighter.fetchCandles },
  // OKX SWAP perps for the 16 most liquid names (no auth, high liquidity)
  { id: 'okx_swap',        tier: 1, fetch: okxTradfi.fetchCandles,
    supports: (s) => OKX_TRADFI.has(s.toUpperCase()) },
  // Yahoo Finance via Cloudflare Worker — unlimited rate, ALL US stocks/ETFs
  // This is the primary source for the ~280 tickers not on Lighter/OKX.
  // Placed at tier 1 (same as Lighter/OKX) so it's tried immediately after them.
  { id: 'yahoo_proxy',     tier: 1, fetch: yahooCrypto.fetchCandles,
    bestFor: ['1D','1w','1W'] },
  // Binance xStocks (NVDA/TSLA backup)
  { id: 'binance_xstocks', tier: 2, fetch: binanceXStocks.fetchCandles,
    supports: (s) => binanceXStocks.isTradfi?.(s) ?? false },
  // Massive/Polygon free tier — limited (only /prev works reliably for most assets)
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

  // LRU cap: if Map grows too large, evict the 100 oldest entries.
  // Uses Map's insertion-order iteration (O(n) on the iterated entries only,
  // no array allocation or sort) — far cheaper than the previous
  // `[...entries()].sort().slice()` which allocated a 500+ element array
  // and ran an O(n log n) sort on every failure past the cap.
  // Insertion order is a good-enough proxy for recency here because
  // `_failures.set(k, f)` re-inserts on update (preserving order would
  // require delete-then-set; we accept the minor inaccuracy to keep this O(1)).
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

  // Build candidate list, filtering by deprioritization only.
  // Skip the supports() check entirely — it's an optimization that backfires:
  // 1. It's sequential (await in a loop), adding latency per symbol
  // 2. If the universe cache isn't loaded yet, supports() returns true
  //    (optimistic), so the source is included anyway — the check is wasted
  // 3. The source's fetchCandles() already returns null for unsupported
  //    symbols, so the supports() check is redundant — just let the race
  //    handle it. Promise.any() picks the first success and ignores failures.
  const candidates = sourceList.filter(src => !isDeprioritized(src.id, symbol));

  // Sort: preferred first, then by tier
  candidates.sort((a, b) => {
    if (preferredSource === a.id) return -1;
    if (preferredSource === b.id) return 1;
    return a.tier - b.tier;
  });

  // ── Parallel fetch: race ALL sources simultaneously ──────────────────────
  // Instead of racing tier-1 then falling through to tier-2 sequentially,
  // race ALL candidate sources at once using Promise.any().
  // This means:
  //   - OKX returns in 0.3s for a symbol it has → done in 0.3s
  //   - HL returns in 0.3s for a symbol OKX doesn't have → done in 0.3s
  //   - Yahoo returns in 0.3s for a symbol neither has → done in 0.3s
  //   - No waiting for timeouts on sources that don't have the symbol
  //
  // Promise.any() returns as soon as the FIRST promise resolves with a
  // non-null value. Sources that fail or timeout are simply ignored.
  // If ALL sources fail, we fall through to the null return.
  //
  // This is the key fix: the old Promise.all() approach waited for ALL
  // tier-1 sources to complete (including 5s timeouts) before trying
  // tier-2. With 111 symbols needing tier-2, that's 111 × 5s / 10
  // workers = 55s of wasted timeout waiting.

  if (candidates.length > 0) {
    // Race only the TOP 3 sources by tier (not all 7+).
    // Racing all sources simultaneously causes browser connection
    // exhaustion: 10 workers × 7 sources = 70 concurrent requests,
    // but browsers limit to 6 connections per host. Requests queue
    // up and timeout, causing cascade failures.
    //
    // By racing only the top 3 (e.g. OKX, HL, Bybit for crypto;
    // Lighter, OKX, Yahoo for tradfi), we keep concurrent requests
    // manageable: 10 × 3 = 30, with most resolving in <0.5s so
    // connections are freed quickly.
    //
    // If all top 3 fail, fall through to the remaining sources
    // sequentially (they're the fallback path).
    const topSources = candidates.slice(0, 3);
    const remainingSources = candidates.slice(3);

    const racePromises = topSources.map(src => {
      const fetchP = src.fetch(symbol, timeframe, limit).then(candles => {
        if (candles && candles.length >= 5) {
          return { source: src.id, candles };
        }
        throw new Error('no data');
      }).catch(() => { throw new Error('fetch failed'); });

      const timeoutP = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000)
      );

      return Promise.race([fetchP, timeoutP]).then(
        result => { recordSuccess(src.id, symbol); return result; },
        error => { recordFailure(src.id, symbol); throw error; }
      );
    });

    try {
      const winner = await Promise.any(racePromises);
      return winner;
    } catch {
      // All top sources failed — try remaining sources sequentially
    }

    // Sequential fallback for remaining sources
    for (const src of remainingSources) {
      try {
        const fetchPromise = src.fetch(symbol, timeframe, limit);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        );
        const candles = await Promise.race([fetchPromise, timeoutPromise]);
        if (candles && candles.length >= 5) {
          recordSuccess(src.id, symbol);
          return { source: src.id, candles };
        }
        recordFailure(src.id, symbol);
      } catch (e) {
        recordFailure(src.id, symbol);
      }
    }
  }

  return { source: null, candles: null };
}

/**
 * Fetch candles for many symbols in parallel (with concurrency control).
 *
 * @param {Array<string>} symbols - array of symbol strings, e.g. ['BTC','ETH','SOL']
 * @param {object} [opts] - options passed to fetchCandles (timeframe, limit, etc.)
 * @param {number} [concurrency=7] - max parallel requests
 * @returns {Promise<Map<string, {source: string|null, candles: Array|null}>>}
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
