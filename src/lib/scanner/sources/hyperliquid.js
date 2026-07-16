/**
 * Hyperliquid — free, no API key, CORS-enabled (Access-Control-Allow-Origin: *)
 * Excellent intraday crypto perps source. 230 perps listed.
 *
 * Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
 * Endpoint: POST https://api.hyperliquid.xyz/info with JSON body
 * Limits: undocumented but generous (CloudFront-cached)
 *
 * NOTE: Crypto-only. No tradfi. (PAXG ≈ gold is the only indirect tradfi exposure.)
 */

import { fetchWithTimeout } from '../fetchWithTimeout';

const BASE = 'https://api.hyperliquid.xyz/info';

const TIMEFRAME_INTERVAL = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1h',
  '4H': '4h',
  '1D': '1d',
  '1w': '1w',
  '1W': '1w',
};

const INTERVAL_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
  '1W': 604_800_000,
};

// Cache of universe (so we can reject unknown symbols without a wasted candle call)
let _universe = null;

async function loadUniverse() {
  if (_universe) return _universe;
  try {
    const res = await fetchWithTimeout(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'meta' }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    _universe = new Set((d.universe || []).map(u => u.name));
    return _universe;
  } catch {
    return null;
  }
}

/**
 * Fetch OHLC candles.
 * @param {string} symbol — e.g. "BTC", "ETH", "SOL"
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>>} or null
 */
export async function fetchCandles(symbol, timeframe = '4H', limit = 300) {
  const interval = TIMEFRAME_INTERVAL[timeframe] || '4h';
  const intervalMs = INTERVAL_MS[interval] || 14_400_000;

  // Optional universe check (skip if cache miss to avoid blocking)
  const universe = await loadUniverse();
  if (universe && !universe.has(symbol.toUpperCase())) return null;

  const end = Date.now();
  const start = end - limit * intervalMs;

  try {
    const res = await fetchWithTimeout(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: {
          coin: symbol.toUpperCase(),
          interval,
          startTime: start,
          endTime: end,
        },
      }),
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;

    // Hyperliquid returns strings for OHLC; convert to numbers
    return arr.map(c => ({
      ts: c.t,
      open: Number(c.o),
      high: Number(c.h),
      low: Number(c.l),
      close: Number(c.c),
      vol: Number(c.v),
      vwap: c.a ? Number(c.a) : undefined,
    }));
  } catch (e) {
    console.warn(`[hyperliquid] ${symbol} failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch 24h ticker data for ALL perps in one call (efficient bulk fetch).
 * Returns Map: symbol → { price, prevDayPx, dayNtlVlm, dayBaseVlm, markPx, openInterest }
 */
let _tickerCache = null;
let _tickerCacheTime = 0;
const TICKER_TTL_MS = 30 * 1000;

export async function fetchAllTickers() {
  const now = Date.now();
  if (_tickerCache && now - _tickerCacheTime < TICKER_TTL_MS) return _tickerCache;
  try {
    const res = await fetchWithTimeout(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    if (!res.ok) return _tickerCache || new Map();
    const d = await res.json();
    // Response shape: [{ universe: [...], marginTables, collateralToken }, [...assetCtxs]]
    // d[0] is the meta object (NOT the universe array directly)
    // d[1] is the array of per-asset contexts
    const meta = Array.isArray(d) ? d[0] : d;
    const ctxs = Array.isArray(d) && d.length > 1 ? d[1] : (d.assetCtxs || []);
    const universe = meta?.universe || [];

    _tickerCache = new Map();
    for (let i = 0; i < universe.length; i++) {
      const name = universe[i].name;
      const ctx = ctxs[i] || {};
      _tickerCache.set(name, {
        price: parseFloat(ctx.markPx || '0'),
        prevDayPx: parseFloat(ctx.prevDayPx || '0'),
        change24hPct: ctx.markPx && ctx.prevDayPx
          ? ((parseFloat(ctx.markPx) - parseFloat(ctx.prevDayPx)) / parseFloat(ctx.prevDayPx)) * 100
          : 0,
        volume24hUsd: parseFloat(ctx.dayNtlVlm || '0'),
        volume24hBase: parseFloat(ctx.dayBaseVlm || '0'),
        openInterest: parseFloat(ctx.openInterest || '0'),  // base currency (e.g. 33017 BTC)
        openInterestUsd: parseFloat(ctx.openInterest || '0') * parseFloat(ctx.markPx || '0'),  // USD value
        fundingRate: parseFloat(ctx.funding || '0'),
      });
    }
    _tickerCacheTime = now;
    return _tickerCache;
  } catch {
    return _tickerCache || new Map();
  }
}

export const sourceMeta = {
  id: 'hyperliquid',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '1D', '1w', '1W'],
  rateLimitPerMin: 60,  // conservative estimate
  requiresApiKey: false,
};
