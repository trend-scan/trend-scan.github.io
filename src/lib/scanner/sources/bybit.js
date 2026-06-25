/**
 * Bybit v5 — free, no API key, CORS-enabled
 * Strong crypto OHLC source with high liquidity. Spot + perps.
 *
 * Docs: https://bybit-exchange.github.io/docs/v5/market/kline
 */

const BASE = 'https://api.bybit.com/v5/market';

const TIMEFRAME_INTERVAL = {
  '15m': '15',
  '30m': '30',
  '1H': '60',
  '4H': '240',
  '12H': '720',
  '1D': 'D',
  '1w': 'W',
};

/**
 * Fetch OHLC candles.
 * @returns {Array<{ts,open,high,low,close,vol}>} or null
 */
export async function fetchCandles(symbol, timeframe = '4H', limit = 300, category = 'spot') {
  const interval = TIMEFRAME_INTERVAL[timeframe] || '240';
  // Bybit uses USDT suffix; spot vs linear perps differ in category
  const sym = `${symbol.toUpperCase()}USDT`;
  const url = `${BASE}/kline?category=${category}&symbol=${sym}&interval=${interval}&limit=${Math.min(limit, 1000)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.retCode !== 0 || !d.result?.list?.length) return null;

    // Bybit returns newest-first strings; reverse + convert
    return d.result.list.slice().reverse().map(c => ({
      ts: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol: parseFloat(c[5]),
    }));
  } catch (e) {
    console.warn(`[bybit] ${symbol} failed: ${e.message}`);
    return null;
  }
}

export const sourceMeta = {
  id: 'bybit',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w'],
  rateLimitPerMin: 120,
  requiresApiKey: false,
  maxCandlesPerCall: 1000,
};
