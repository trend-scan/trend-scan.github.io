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

const BASE = 'https://www.okx.com/api/v5';

const TIMEFRAME_BAR = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1H',
  '4H': '4H',
  '12H': '12H',
  '1D': '1D',
  '1w': '1W',
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
  const res = await fetch(url);
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
 * Strategy: try SWAP (perps) first; if not listed, fall back to SPOT.
 * Many smaller-cap tokens (LEO, KCS, NEXO, ZIG, etc.) are only on spot.
 *
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
export async function fetchCandles(symbol, timeframe = '4H', limit = 300) {
  const s = symbol.toUpperCase();
  if (TRADFI_TICKERS.has(s)) return null;  // delegate to okxTradfi

  const bar = TIMEFRAME_BAR[timeframe] || '4H';

  // Try SWAP (perps) first — higher liquidity for major tokens
  try {
    const perps = await _fetchCandlesForInst(`${s}-USDT-SWAP`, bar, limit);
    if (perps && perps.length > 0) return perps;
  } catch {
    // Don't warn yet — we'll try spot next
  }

  // Fall back to SPOT for tokens not listed as perps
  try {
    const spot = await _fetchCandlesForInst(`${s}-USDT`, bar, limit);
    if (spot && spot.length > 0) return spot;
  } catch (e) {
    console.warn(`[okxCrypto] ${symbol} failed on both SWAP and SPOT: ${e.message}`);
  }

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
      const res = await fetch(url);
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
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w'],
  rateLimitPerMin: 20,  // per-IP, generous
  requiresApiKey: false,
  maxCandlesPerCall: 300,
  geographicalLimits: 'none',
  notes: 'Tries SWAP (perps) first, falls back to SPOT for tokens not listed as perps.',
};
