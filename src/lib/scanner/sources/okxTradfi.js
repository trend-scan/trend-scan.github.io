/**
 * OKX SWAP perps — free, no API key, CORS-enabled
 * Limited tradfi coverage (7 tokenized US equities + gold + silver) but HIGH liquidity.
 *
 * Available tradfi tickers (verified Jun 2026):
 *   SPY-USDT-SWAP, QQQ-USDT-SWAP, NVDA-USDT-SWAP, TSLA-USDT-SWAP,
 *   AAPL-USDT-SWAP, XAU-USDT-SWAP (gold), XAG-USDT-SWAP (silver)
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
};

// OKX SWAP perps that are tradfi (not crypto)
export const TRADFI_TICKERS = new Set([
  'SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'XAU', 'XAG',
]);

export function isTradfi(symbol) {
  return TRADFI_TICKERS.has(symbol.toUpperCase());
}

/**
 * Fetch OHLC candles for an OKX SWAP perp.
 * @param {string} symbol — base ticker, e.g. "SPY", "BTC"
 * @returns {Array<{ts,open,high,low,close,vol}>} or null
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const instId = `${symbol.toUpperCase()}-USDT-SWAP`;
  const bar = TIMEFRAME_BAR[timeframe] || '1D';
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
    console.warn(`[okxTradfi] ${symbol} failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch 24h ticker for one OKX SWAP perp.
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
  id: 'okx_swap',
  type: 'tradfi',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D'],
  rateLimitPerMin: 20,  // per-IP
  requiresApiKey: false,
  maxCandlesPerCall: 300,
};
