/**
 * Bybit v5 — free, no API key, CORS-enabled
 * Strong crypto OHLC source with deep liquidity. Spot + linear perps.
 *
 * Strategy: try linear perps first (higher liquidity for major tokens),
 * fall back to spot for tokens not listed as perps.
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
  '1W': 'W',
};

/**
 * Internal: fetch candles from Bybit for a specific category.
 * @param {string} symbol
 * @param {string} interval
 * @param {number} limit
 * @param {string} category  'linear' (perps) or 'spot'
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
async function _fetchCandlesForCategory(symbol, interval, limit, category) {
  const sym = `${symbol.toUpperCase()}USDT`;
  const url = `${BASE}/kline?category=${category}&symbol=${sym}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
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
}

/**
 * Fetch OHLC candles. Tries linear perps first, then spot.
 *
 * @param {string} symbol
 * @param {string} [timeframe='4H']
 * @param {number} [limit=300]
 * @param {string} [category]  Optional: force 'linear' or 'spot'. If
 *                              omitted, tries linear first then spot.
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
export async function fetchCandles(symbol, timeframe = '4H', limit = 300, category) {
  const interval = TIMEFRAME_INTERVAL[timeframe] || '240';

  // If caller specified a category, use only that
  if (category) {
    try {
      const result = await _fetchCandlesForCategory(symbol, interval, limit, category);
      if (result && result.length > 0) return result;
    } catch (e) {
      console.warn(`[bybit] ${symbol} (${category}) failed: ${e.message}`);
    }
    return null;
  }

  // Try linear (perps) first — higher liquidity for major tokens
  try {
    const perps = await _fetchCandlesForCategory(symbol, interval, limit, 'linear');
    if (perps && perps.length > 0) return perps;
  } catch {
    // Fall through to spot
  }

  // Fall back to spot for tokens not listed as perps
  try {
    const spot = await _fetchCandlesForCategory(symbol, interval, limit, 'spot');
    if (spot && spot.length > 0) return spot;
  } catch (e) {
    console.warn(`[bybit] ${symbol} failed on both linear and spot: ${e.message}`);
  }

  return null;
}

export const sourceMeta = {
  id: 'bybit',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w', '1W'],
  rateLimitPerMin: 120,
  requiresApiKey: false,
  maxCandlesPerCall: 1000,
  notes: 'Tries linear perps first, falls back to spot for tokens not listed as perps.',
};
