/**
 * Bybit v5 — free, no API key, CORS-enabled
 * Strong crypto OHLC source with deep liquidity. Spot + linear perps.
 *
 * Strategy: try linear perps first (higher liquidity for major tokens),
 * fall back to spot for tokens not listed as perps.
 *
 * Docs: https://bybit-exchange.github.io/docs/v5/market/kline
 */

import { fetchWithTimeout } from '../fetchWithTimeout';
import { markGloballyBlocked } from '../sourceHealth';

const SOURCE_ID = 'bybit';
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
  // Bybit uses 1000x/1000000x prefixes for low-priced tokens (same as Binance).
  // Try the bare symbol first; only fall back to prefixed variants if bare fails.
  // Sequential — not parallel — to minimize connection usage. The bare symbol
  // works for ~95% of tokens, so we usually make just 1 request.
  const symUpper = symbol.toUpperCase();
  const variants = [`${symUpper}USDT`];
  if (symUpper.length <= 6) {
    variants.push(`1000${symUpper}USDT`);
    variants.push(`1000000${symUpper}USDT`);
  }

  for (const sym of variants) {
    const url = `${BASE}/kline?category=${category}&symbol=${sym}&interval=${interval}&limit=${Math.min(limit, 1000)}`;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        // Only 451 triggers global block (definitive geo-block signal).
        // On 451, don't try other variants — the whole source is blocked.
        if (res.status === 451) {
          markGloballyBlocked(SOURCE_ID);
          return null;
        }
        continue;
      }
      const d = await res.json();
      if (d.retCode !== 0 || !d.result?.list?.length) continue;

      // Determine price multiplier if this is a 1000x/1000000x symbol
      let priceMultiplier = 1;
      if (sym.startsWith('1000000')) priceMultiplier = 1000000;
      else if (sym.startsWith('1000')) priceMultiplier = 1000;

      // Bybit returns newest-first strings; reverse + convert.
      // For 1000x/1000000x symbols, divide OHLC by multiplier to get
      // per-token prices. Multiply volume by multiplier for actual token count.
      return d.result.list.slice().reverse().map(c => ({
        ts: parseInt(c[0]),
        open: parseFloat(c[1]) / priceMultiplier,
        high: parseFloat(c[2]) / priceMultiplier,
        low: parseFloat(c[3]) / priceMultiplier,
        close: parseFloat(c[4]) / priceMultiplier,
        vol: parseFloat(c[5]) * priceMultiplier,
      }));
    } catch {
      // Network error — try next variant
    }
  }
  return null;
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
