/**
 * OKX SWAP perps — free, no API key, CORS-enabled
 * Tokenized tradfi as USDT-quoted perpetual swaps: ~150 of the site's TRAD_UNIVERSE
 * answer here (verified 2026-09-29), including mega-caps, ETFs, metals, index
 * perps (US500/US100) and pre-IPO names — plus, of course, all crypto perps.
 *
 * Docs: https://www.okx.com/docs-v5/en/#rest-api-market-data-get-tickers
 */

import { fetchWithTimeout } from '../fetchWithTimeout';

const BASE = 'https://www.okx.com/api/v5';

const TIMEFRAME_BAR = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1H',
  '4H': '4H',
  '12H': '12H',
  '1D': '1D',
  '1w': '1W',
  '1W': '1W',
};

// OKX SWAP perps that are tradfi (not crypto)
export const TRADFI_TICKERS = new Set([
  'SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'XAU', 'XAG',
]);

export function isTradfi(symbol) {
  return TRADFI_TICKERS.has(symbol.toUpperCase());
}

/**
 * Fetch OHLC candles for an OKX SWAP perp.
 * @param {string} symbol — base ticker, e.g. "SPY", "BTC"
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>>} or null
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const instId = `${symbol.toUpperCase()}-USDT-SWAP`;
  const bar = TIMEFRAME_BAR[timeframe] || '1D';
  const url = `${BASE}/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${Math.min(limit, 300)}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code !== '0' || !Array.isArray(d.data) || d.data.length === 0) return null;

    // OKX returns newest-first; reverse for chronological order
    return d.data.slice().reverse().map(c => ({
      ts: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol: parseFloat(c[5]),
      volCcy: parseFloat(c[7]),  // quote currency volume
    }));
  } catch (e) {
    console.warn(`[okxTradfi] ${symbol} failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch 24h ticker for one OKX SWAP perp.
 */
export async function fetchTicker(symbol) {
  const instId = `${symbol.toUpperCase()}-USDT-SWAP`;
  const url = `${BASE}/market/ticker?instId=${encodeURIComponent(instId)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code !== '0' || !d.data?.length) return null;
    // The single-instrument response carries its own instId — pass it through.
    return parseTickerEntry(d.data[0], d.data[0].instId);
  } catch {
    return null;
  }
}

// ─── Bulk tickers (Task 33, 2026-09-30) ────────────────────────────────────────
//
// The Watchlist auto-refreshes every 15s. Per-symbol probes (fetchTicker) would
// fire N requests per cycle and flirt with OKX's 20-req/2s per-IP limit on
// larger watchlists; the bulk endpoint returns ALL ~490 SWAP instruments in
// ONE call (~35KB gzipped, ~90ms — verified live), so any watchlist size costs
// a single request per refresh. The response also doubles as live listing
// knowledge: new OKX perps appear in the map immediately, with no negative
// cache wait. 10s TTL keeps the data per-cycle fresh (interval is 15s, so the
// cache is always expired by the next cycle) while collapsing bursts from
// other callers (e.g. multiple Board components mounting together).

let _swapTickersCache = null;
let _swapTickersCacheTime = 0;
const SWAP_TICKERS_TTL_MS = 10 * 1000;

/**
 * Shared ticker parser — single-instrument and bulk entries have the same fields.
 * `instId` (optional: single-instrument responses carry it themselves) lets
 * callers display the real instrument id.
 */
function parseTickerEntry(t, instId = null) {
  const last = parseFloat(t.last);
  const open24h = parseFloat(t.open24h);
  return {
    price: last,
    change24hPct: open24h ? ((last - open24h) / open24h) * 100 : 0,
    high24h: parseFloat(t.high24h),
    low24h: parseFloat(t.low24h),
    volume24hBase: parseFloat(t.vol24h),
    volume24hUsd: parseFloat(t.volCcy24h),
    instId,
  };
}

/**
 * Fetch tickers for ALL USDT-quoted SWAP perps in one bulk call.
 * @returns {Promise<Map<string, object>>} base coin ("AAPL", "XAU", "US500"…) →
 *          { price, change24hPct, high24h, low24h, volume24hBase, volume24hUsd, instId }
 *          Entries with a non-positive last are skipped. On failure the stale
 *          cache is returned (better than nothing); null only when nothing has
 *          ever succeeded — callers should fall back to per-symbol probes.
 */
export async function fetchAllSwapTickers() {
  const now = Date.now();
  if (_swapTickersCache && now - _swapTickersCacheTime < SWAP_TICKERS_TTL_MS) return _swapTickersCache;
  try {
    const res = await fetchWithTimeout(`${BASE}/market/tickers?instType=SWAP`);
    if (!res.ok) return _swapTickersCache;
    const d = await res.json();
    if (d.code !== '0' || !Array.isArray(d.data)) return _swapTickersCache;
    const m = new Map();
    for (const t of d.data) {
      if (typeof t.instId !== 'string' || !t.instId.endsWith('-USDT-SWAP')) continue;
      const parsed = parseTickerEntry(t, t.instId);
      if (!(parsed.price > 0)) continue;
      m.set(t.instId.slice(0, -'-USDT-SWAP'.length), parsed);
    }
    _swapTickersCache = m;
    _swapTickersCacheTime = now;
    return m;
  } catch {
    return _swapTickersCache;
  }
}

export const sourceMeta = {
  id: 'okx_swap',
  type: 'tradfi',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D'],
  rateLimitPerMin: 20,  // per-IP
  requiresApiKey: false,
  maxCandlesPerCall: 300,
};
