/**
 * OKX SWAP perps (crypto) — free, no API key, CORS-enabled
 * HIGH liquidity, no geographical restrictions, no rate limit issues.
 *
 * This module handles crypto perps (BTC, ETH, SOL, etc.).
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
 * Fetch OHLC candles for a crypto perp on OKX.
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>>} or null
 */
export async function fetchCandles(symbol, timeframe = '4H', limit = 300) {
  const s = symbol.toUpperCase();
  if (TRADFI_TICKERS.has(s)) return null;  // delegate to okxTradfi

  const instId = `${s}-USDT-SWAP`;
  const bar = TIMEFRAME_BAR[timeframe] || '4H';
  const url = `${BASE}/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${Math.min(limit, 300)}`;

  try {
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
  } catch (e) {
    console.warn(`[okxCrypto] ${symbol} failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch 24h ticker for one OKX crypto perp.
 */
export async function fetchTicker(symbol) {
  const instId = `${symbol.toUpperCase()}-USDT-SWAP`;
  const url = `${BASE}/market/ticker?instId=${encodeURIComponent(instId)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code !== '0' || !d.data?.length) return null;
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
    return null;
  }
}

export const sourceMeta = {
  id: 'okx_perps',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w'],
  rateLimitPerMin: 20,  // per-IP, generous
  requiresApiKey: false,
  maxCandlesPerCall: 300,
  geographicalLimits: 'none',
};
