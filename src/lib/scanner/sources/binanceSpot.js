/**
 * Binance Spot — free, no API key, CORS-enabled
 *
 * Binance spot has broader coin coverage than Binance perps — many smaller-cap
 * tokens (GNO, XNO, TFUEL, AMP, DCR, etc.) are listed on spot but not perps.
 * This source sits between bybit and binance_perps in the resolver chain.
 *
 * Docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api
 * Endpoint: https://api.binance.com/api/v3/klines
 *
 * NOTE: Geo-restricted in some regions (US, UK, etc.). The resolver handles
 * this gracefully — if Binance returns 451 (geo-blocked) or 403, the source
 * returns null and the resolver moves on to the next source.
 */

import { fetchWithTimeout } from '../fetchWithTimeout';

const BASE = 'https://api.binance.com/api/v3';

const TIMEFRAME_INTERVAL = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1h',
  '4H': '4h',
  '12H': '12h',
  '1D': '1d',
  '1w': '1w',
  '1W': '1w',
};

// Cache of universe: set of valid baseAssets
let _universe = null;
let _universeTime = 0;
const UNIVERSE_TTL_MS = 10 * 60 * 1000;

async function loadUniverse() {
  const now = Date.now();
  if (_universe && now - _universeTime < UNIVERSE_TTL_MS) return _universe;
  try {
    const res = await fetchWithTimeout(`${BASE}/exchangeInfo`);
    if (!res.ok) return _universe || null;
    const d = await res.json();
    _universe = new Set();
    for (const inst of d.symbols || []) {
      if (inst.quoteAsset !== 'USDT') continue;
      if (inst.status !== 'TRADING') continue;
      if (inst.baseAsset) _universe.add(inst.baseAsset);
    }
    _universeTime = now;
    return _universe;
  } catch {
    return _universe || null;
  }
}

/**
 * Check if Binance spot supports this symbol.
 * Used by the resolver's `supports` check to quickly filter.
 */
export async function isSupported(symbol) {
  const universe = await loadUniverse();
  if (!universe) return true;  // optimistic if universe fetch failed
  return universe.has(symbol.toUpperCase());
}

/**
 * Fetch OHLC candles for a symbol from Binance spot.
 * @param {string} symbol - bare symbol, e.g. 'BTC', 'GNO', 'TFUEL'
 * @param {string} [timeframe='1D']
 * @param {number} [limit=300]
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const interval = TIMEFRAME_INTERVAL[timeframe] || '1d';
  const sym = symbol.toUpperCase();

  // Quick-check the universe cache to avoid a 400 from Binance
  // (which would still be fast, but this saves a round-trip)
  const universe = await loadUniverse();
  if (universe && !universe.has(sym)) return null;

  const url = `${BASE}/klines?symbol=${encodeURIComponent(sym)}USDT&interval=${interval}&limit=${limit}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;

    return arr.map(k => ({
      ts: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      vol: parseFloat(k[5]),
    }));
  } catch {
    return null;
  }
}

export const sourceMeta = {
  id: 'binance_spot',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w', '1W'],
  rateLimitPerMin: 1200,  // very generous
  requiresApiKey: false,
  maxCandlesPerCall: 1000,
  geographicalLimits: 'US/UK blocked (451)',
  notes: 'Binance spot market. Broader coin coverage than perps (GNO, XNO, TFUEL, etc.). Geo-restricted in some regions — resolver falls through gracefully.',
};
