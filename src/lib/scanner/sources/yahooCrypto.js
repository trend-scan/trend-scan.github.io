/**
 * Yahoo Finance Crypto Source — uses Cloudflare Worker proxy
 *
 * Yahoo Finance covers most major cryptocurrencies with -USD suffix.
 * No rate limits (via the Worker proxy). CORS-enabled by the proxy.
 *
 * Symbol format: BTC → BTC-USD, ETH → ETH-USD
 * Some symbols have conflicts with stocks (A, S, AI, MET, etc.) —
 * this source is placed LOW in the resolver chain so exchange sources
 * are tried first. Only used as a fallback.
 *
 * Data: daily OHLCV, up to 1 year history.
 */

const PROXY_URL = (typeof window !== 'undefined' && localStorage.getItem('YAHOO_PROXY_URL'))
  || import.meta.env?.VITE_YAHOO_PROXY_URL
  || 'https://trendscan-yahoo-proxy.drew-724.workers.dev';

const INTERVAL_MAP = {
  '15m': '15m',
  '30m': '30m',
  '1H':  '60m',
  '4H':  '240m',
  '12H': '1h',   // Yahoo doesn't have 12h — use hourly and let caller handle
  '1D':  '1d',
  '1w':  '1wk',
  '1W':  '1wk',
};

const RANGE_MAP = {
  '15m': '5d',
  '30m': '5d',
  '1H':  '1mo',
  '4H':  '3mo',
  '12H': '1mo',
  '1D':  '1y',
  '1w':  '5y',
  '1W':  '5y',
};

/**
 * Fetch OHLC candles from Yahoo Finance via the Cloudflare Worker proxy.
 * @param {string} symbol - bare crypto symbol, e.g. "BTC"
 * @param {string} timeframe - e.g. "1D", "4H"
 * @param {number} limit - max candles (not used by Yahoo, range controls this)
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const ySymbol = `${symbol.toUpperCase()}-USD`;
  const interval = INTERVAL_MAP[timeframe] || '1d';
  const range = RANGE_MAP[timeframe] || '1y';
  const url = `${PROXY_URL}/chart/${encodeURIComponent(ySymbol)}?range=${range}&interval=${interval}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    const result = d?.chart?.result?.[0];
    if (!result?.timestamp) return null;
    const q = result.indicators?.quote?.[0];
    if (!q) return null;

    const candles = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      if (q.close?.[i] == null) continue;
      candles.push({
        ts: result.timestamp[i] * 1000,
        open: q.open?.[i] ?? q.close[i],
        high: q.high?.[i] ?? q.close[i],
        low: q.low?.[i] ?? q.close[i],
        close: q.close[i],
        vol: q.volume?.[i] ?? 0,
      });
    }
    return candles.length >= 5 ? candles : null;
  } catch {
    return null;
  }
}

/**
 * Check if Yahoo Finance has data for this symbol.
 * We don't pre-check (no universe endpoint) — just let the resolver try it.
 */
export async function isSupported(symbol) {
  return true;  // optimistic — Yahoo has most major cryptos
}

export const sourceMeta = {
  id: 'yahoo_crypto',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '1D', '1w', '1W'],
  rateLimitPerMin: 100,  // effectively unlimited via Worker
  requiresApiKey: false,
  maxCandlesPerCall: 500,
  notes: 'Yahoo Finance via Cloudflare Worker proxy. Covers ~75% of crypto universe. Some symbols conflict with stocks (A, S, AI, MET, etc.) — placed low in resolver chain as fallback.',
};
