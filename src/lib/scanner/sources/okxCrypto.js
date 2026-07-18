/**
 * OKX SWAP perps + SPOT (crypto) — free, no API key, CORS-enabled
 * HIGH liquidity, no geographical restrictions in most regions.
 *
 * This module handles crypto perps (BTC, ETH, SOL, etc.) with automatic
 * fallback to OKX spot for tokens that aren't listed as perps (e.g.
 * LEO, KCS, NEXO, ZIG, etc. — exchange tokens and smaller caps that
 * are only on spot markets).
 *
 * Tradfi perps (SPY, QQQ, XAU, etc.) are in okxTradfi.js.
 *
 * Universe cache: fetches the SWAP + SPOT instrument lists once on first
 * use, then serves from memory. This lets `isSupported()` instantly skip
 * symbols OKX doesn't have — avoiding 2 wasted HTTP requests per missing
 * symbol (SWAP 404 + SPOT 404 = ~600ms wasted per symbol).
 *
 * Docs: https://www.okx.com/docs-v5/en/#rest-api-market-data-get-candlesticks
 */

import { fetchWithTimeout } from '../fetchWithTimeout';
import { markGloballyBlocked } from '../sourceHealth';

const SOURCE_ID = 'okx_perps';
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

// Tradfi tickers handled by okxTradfi.js — exclude them here to avoid duplicate attempts
const TRADFI_TICKERS = new Set(['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'XAU', 'XAG']);

export function isCryptoSymbol(symbol) {
  const s = symbol.toUpperCase();
  return !TRADFI_TICKERS.has(s);
}

// ─── Universe cache ──────────────────────────────────────────────────────────
// Fetches SWAP + SPOT instrument lists once, caches for 10 min.
// Used by isSupported() for instant lookup (no HTTP request per symbol).

let _universe = null;          // Set of bare symbols (e.g. 'BTC', 'ETH')
let _universeTime = 0;
let _universePromise = null;   // deduplicates concurrent loadUniverse() calls
const UNIVERSE_TTL_MS = 10 * 60 * 1000;

async function loadUniverse() {
  const now = Date.now();
  if (_universe && now - _universeTime < UNIVERSE_TTL_MS) return _universe;
  if (_universePromise) return _universePromise;

  _universePromise = (async () => {
    try {
      // Fetch SWAP and SPOT instruments in parallel
      const [swapRes, spotRes] = await Promise.all([
        fetchWithTimeout(`${BASE}/public/instruments?instType=SWAP`),
        fetchWithTimeout(`${BASE}/public/instruments?instType=SPOT`),
      ]);

      const symbols = new Set();

      // SWAP: instId format is 'BTC-USDT-SWAP' — extract bare symbol
      if (swapRes.ok) {
        const swapData = await swapRes.json();
        if (swapData.code === '0' && Array.isArray(swapData.data)) {
          for (const inst of swapData.data) {
            if (inst.settleCcy === 'USDT' && inst.instId) {
              const bare = inst.instId.split('-')[0];  // 'BTC-USDT-SWAP' → 'BTC'
              if (bare) symbols.add(bare);
            }
          }
        }
      }

      // SPOT: instId format is 'BTC-USDT' — extract bare symbol
      if (spotRes.ok) {
        const spotData = await spotRes.json();
        if (spotData.code === '0' && Array.isArray(spotData.data)) {
          for (const inst of spotData.data) {
            if (inst.quoteCcy === 'USDT' && inst.instId) {
              const bare = inst.instId.split('-')[0];  // 'BTC-USDT' → 'BTC'
              if (bare) symbols.add(bare);
            }
          }
        }
      }

      if (symbols.size > 0) {
        _universe = symbols;
        _universeTime = Date.now();
      }
      return _universe;
    } catch {
      return _universe || null;
    } finally {
      _universePromise = null;
    }
  })();

  return _universePromise;
}

/**
 * Check if OKX supports this symbol (SWAP or SPOT).
 * Uses cached universe — instant after first load, no HTTP request per call.
 * @param {string} symbol
 * @returns {Promise<boolean>}
 */
export async function isSupported(symbol) {
  const universe = await loadUniverse();
  if (!universe) return true;  // optimistic if universe fetch failed
  return universe.has(symbol.toUpperCase());
}

/**
 * Internal: fetch candles from OKX for a specific instrument type.
 * @param {string} instId  e.g. 'BTC-USDT-SWAP' or 'BTC-USDT'
 * @param {string} bar     e.g. '1D'
 * @param {number} limit
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
async function _fetchCandlesForInst(instId, bar, limit) {
  const url = `${BASE}/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${Math.min(limit, 300)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    // Only 451 triggers global block (definitive geo-block signal).
    // 403/429/5xx are NOT geo-blocks — could be rate limit, WAF, or transient.
    if (res.status === 451) markGloballyBlocked(SOURCE_ID);
    return null;
  }
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
}

/**
 * Fetch OHLC candles for a crypto symbol on OKX.
 *
 * Strategy: try SWAP (perps) first, fall back to SPOT if SWAP returns nothing.
 * Sequential — ~90% of symbols are on SWAP, so SPOT is only tried when needed.
 *
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
export async function fetchCandles(symbol, timeframe = '4H', limit = 300) {
  const s = symbol.toUpperCase();
  if (TRADFI_TICKERS.has(s)) return null;  // delegate to okxTradfi

  const bar = TIMEFRAME_BAR[timeframe] || '4H';

  // Quick universe check — skip both SWAP and SPOT requests if OKX doesn't
  // have this symbol at all. Saves ~600ms per missing symbol (2 HTTP 200s
  // with error code in body).
  const universe = await loadUniverse();
  if (universe && !universe.has(s)) return null;

  // Try SWAP first (covers ~90% of symbols)
  const perps = await _fetchCandlesForInst(`${s}-USDT-SWAP`, bar, limit);
  if (perps && perps.length > 0) return perps;

  // Fall back to SPOT for tokens not listed as perps
  const spot = await _fetchCandlesForInst(`${s}-USDT`, bar, limit);
  if (spot && spot.length > 0) return spot;

  return null;
}

/**
 * Fetch 24h ticker for one OKX crypto symbol (tries SWAP then SPOT).
 */
export async function fetchTicker(symbol) {
  const s = symbol.toUpperCase();
  for (const instId of [`${s}-USDT-SWAP`, `${s}-USDT`]) {
    const url = `${BASE}/market/ticker?instId=${encodeURIComponent(instId)}`;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const d = await res.json();
      if (d.code !== '0' || !d.data?.length) continue;
      const t = d.data[0];
      const last = parseFloat(t.last);
      const open24h = parseFloat(t.open24h);
      return {
        price: last,
        change24hPct: open24h ? ((last - open24h) / open24h) * 100 : 0,
        high24h: parseFloat(t.high24h),
        low24h: parseFloat(t.low24h),
        volume24hBase: parseFloat(t.vol24h),
        volume24hUsd: parseFloat(t.volCcy24h),
      };
    } catch {
      // try next instrument type
    }
  }
  return null;
}

export const sourceMeta = {
  id: 'okx_perps',  // keep ID for backwards compatibility (UI dropdowns)
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w', '1W'],
  rateLimitPerMin: 20,  // per-IP, generous
  requiresApiKey: false,
  maxCandlesPerCall: 300,
  geographicalLimits: 'none',
  notes: 'Tries SWAP (perps) first, falls back to SPOT for tokens not listed as perps. Universe cache enables instant supports() check.',
};
