/**
 * Binance xStocks — free, no API key, CORS-enabled (when called from browser)
 * Very limited tradfi coverage: NVDABUSDT, TSLABUSDT (verified Jun 2026).
 *
 * Docs: https://developers.binance.com/docs/binance-spot-api-api
 */

const BASE = 'https://api.binance.com/api/v3';

const TIMEFRAME_INTERVAL = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1h',
  '4H': '4h',
  '12H': '12h',
  '1D': '1d',
  '1w': '1w',
};

// Binance xStocks symbols (verified active Jun 2026)
export const TRADFI_SYMBOLS = new Set(['NVDA', 'TSLA']);

export function isTradfi(symbol) {
  return TRADFI_SYMBOLS.has(symbol.toUpperCase());
}

export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const interval = TIMEFRAME_INTERVAL[timeframe] || '1d';
  // xStocks on Binance use BUSDT suffix (not USDT)
  const sym = `${symbol.toUpperCase()}BUSDT`;
  const url = `${BASE}/klines?symbol=${sym}&interval=${interval}&limit=${Math.min(limit, 1000)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;

    return arr.map(c => ({
      ts: parseInt(c[0]),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol: parseFloat(c[5]),
    }));
  } catch (e) {
    console.warn(`[binanceXStocks] ${symbol} failed: ${e.message}`);
    return null;
  }
}

export const sourceMeta = {
  id: 'binance_xstocks',
  type: 'tradfi',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w'],
  rateLimitPerMin: 1200,
  requiresApiKey: false,
  maxCandlesPerCall: 1000,
};
