/**
 * Gate.io v4 — free, no API key, CORS-enabled
 * Backup crypto spot source.
 *
 * Docs: https://www.gate.io/docs/developers/apiv4/en/#get-candlestick-data
 */

const BASE = 'https://api.gateio.ws/api/v4/spot';

const TIMEFRAME_INTERVAL = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1h',
  '4H': '4h',
  '12H': '12h',
  '1D': '1d',
  '1w': '7d',
};

export async function fetchCandles(symbol, timeframe = '4H', limit = 300) {
  const interval = TIMEFRAME_INTERVAL[timeframe] || '4h';
  const pair = `${symbol.toUpperCase()}_USDT`;
  const url = `${BASE}/candlesticks?currency_pair=${pair}&interval=${interval}&limit=${Math.min(limit, 1000)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;

    // Gate returns newest-first; reverse for chronological
    return arr.slice().reverse().map(c => ({
      ts: parseInt(c.t) * 1000,
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      vol: parseFloat(c.v),
    }));
  } catch (e) {
    console.warn(`[gate] ${symbol} failed: ${e.message}`);
    return null;
  }
}

export const sourceMeta = {
  id: 'gate',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w'],
  rateLimitPerMin: 200,
  requiresApiKey: false,
  maxCandlesPerCall: 1000,
};
