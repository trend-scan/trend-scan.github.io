/**
 * Kucoin v1 — free, no API key, CORS-enabled (Cloudflare-fronted)
 * Backup crypto spot source.
 *
 * Docs: https://www.kucoin.com/docs/rest/spot-market/market-data/get-klines
 */

const BASE = 'https://api.kucoin.com/api/v1/market';

const TIMEFRAME_TYPE = {
  '15m': '15min',
  '30m': '30min',
  '1H': '1hour',
  '4H': '4hour',
  '12H': '12hour',
  '1D': '1day',
  '1w': '1week',
};

export async function fetchCandles(symbol, timeframe = '4H', limit = 300) {
  const type = TIMEFRAME_TYPE[timeframe] || '4hour';
  const sym = `${symbol.toUpperCase()}-USDT`;
  const url = `${BASE}/candles?symbol=${sym}&type=${type}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code !== '200000' || !Array.isArray(d.data) || d.data.length === 0) return null;

    // Kucoin returns newest-first strings; reverse + convert
    return d.data.slice().reverse().map(c => {
      const parts = c.split(',');
      return {
        ts: parseInt(parts[0]),
        open: parseFloat(parts[1]),
        close: parseFloat(parts[2]),
        high: parseFloat(parts[3]),
        low: parseFloat(parts[4]),
        vol: parseFloat(parts[5]),
      };
    }).slice(-limit);
  } catch (e) {
    console.warn(`[kucoin] ${symbol} failed: ${e.message}`);
    return null;
  }
}

export const sourceMeta = {
  id: 'kucoin',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w'],
  rateLimitPerMin: 100,
  requiresApiKey: false,
};
