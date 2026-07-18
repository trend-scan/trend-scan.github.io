/**
 * OKX SWAP perps + SPOT (crypto) — free, no API key, CORS-enabled
 * HIGH liquidity, no geographical restrictions, no rate limit issues.
 *
 * This module handles crypto perps (BTC, ETH, SOL, etc.) with automatic
 * fallback to OKX spot for tokens that aren't listed as perps (e.g.
 * LEO, KCS, NEXO, ZIG, etc. — exchange tokens and smaller caps that
 * are only on spot markets).
 *
 * Tradfi perps (SPY, QQQ, XAU, etc.) are in okxTradfi.js.
 *
 * Docs: https://www.okx.com/docs-v5/en/#rest-api-market-data-get-candlesticks
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

// Tradfi tickers handled by okxTradfi.js — exclude them here to avoid duplicate attempts
const TRADFI_TICKERS = new Set(['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'XAU', 'XAG']);

export function isCryptoSymbol(symbol) {
  const s = symbol.toUpperCase();
  return !TRADFI_TICKERS.has(s);
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
}

/**
 * Fetch OHLC candles for a crypto symbol on OKX.
 *
 * Strategy: race SWAP (perps) and SPOT in parallel, take whichever returns
 * valid data first. Many smaller-cap tokens (LEO, KCS, NEXO, ZIG, etc.) are
 * only on spot — racing avoids waiting for SWAP to fail before trying SPOT.
 *
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
export async function fetchCandles(symbol, timeframe = '4H', limit = 300) {
  const s = symbol.toUpperCase();
  if (TRADFI_TICKERS.has(s)) return null;  // delegate to okxTradfi

  const bar = TIMEFRAME_BAR[timeframe] || '4H';

  // Race SWAP and SPOT in parallel — whichever returns valid data first wins
  const [perps, spot] = await Promise.all([
    _fetchCandlesForInst(`${s}-USDT-SWAP`, bar, limit).catch(() => null),
    _fetchCandlesForInst(`${s}-USDT`, bar, limit).catch(() => null),
  ]);

  // Prefer perps (higher liquidity) if both returned
  if (perps && perps.length > 0) return perps;
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
  notes: 'Tries SWAP (perps) first, falls back to SPOT for tokens not listed as perps.',
};
