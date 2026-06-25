/**
 * Massive (Polygon.io) — paid API key required, CORS-enabled
 *
 * Massive and Polygon.io are the same service (api.massive.com and
 * api.polygon.io return identical responses). One key works for both.
 *
 * Coverage:
 *   - Crypto: X:{SYMBOL}USD (BTC, ETH, SOL, etc.)
 *   - Forex:  C:{PAIR}      (EURUSD, GBPUSD, USDJPY, etc.)
 *   - Stocks: {TICKER}      (AAPL, MSFT, NVDA, SPY, QQQ, etc.)
 *   - Indices: I:{SYMBOL}   (SPX, NDX, etc.)
 *
 * Auth: ?apiKey=KEY query param (works for both GET endpoints)
 *
 * Endpoint: /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
 *   Returns: { results: [{ t, o, h, l, c, v, vw, n }, ...], status: "OK" }
 *
 * Limits: paid plan — no rate limit issues. Free tier (NOT_AUTHORIZED for
 * /range on most assets) is why this was originally deprioritized.
 *
 * The API key is baked into the bundle at build time by Vite:
 *   - deploy.yml passes VITE_MASSIVE_API_KEY as env var to `npm run build`
 *   - Vite's loadEnv() picks it up and inlines as import.meta.env.VITE_MASSIVE_API_KEY
 *   - At runtime, the bundle contains the literal string key
 *
 * For local dev: create .env with VITE_MASSIVE_API_KEY=your_key
 */

const BASE_URL = 'https://api.polygon.io';  // polygon.io is the canonical URL

// Timeframe → Polygon multiplier + timespan
const TIMEFRAME_MAP = {
  '1m':  { multiplier: 1,  timespan: 'minute' },
  '5m':  { multiplier: 5,  timespan: 'minute' },
  '15m': { multiplier: 15, timespan: 'minute' },
  '30m': { multiplier: 30, timespan: 'minute' },
  '1H':  { multiplier: 1,  timespan: 'hour' },
  '4H':  { multiplier: 4,  timespan: 'hour' },
  '12H': { multiplier: 12, timespan: 'hour' },
  '1D':  { multiplier: 1,  timespan: 'day' },
  '1w':  { multiplier: 1,  timespan: 'week' },
};

const INTERVAL_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

/**
 * Get the API key. Checks:
 *   1. localStorage (runtime override — user can paste a different key via UI)
 *   2. import.meta.env.VITE_MASSIVE_API_KEY (baked at build time by Vite/CI)
 */
function getApiKey() {
  if (typeof window !== 'undefined') {
    const local = localStorage.getItem('MASSIVE_API_KEY');
    if (local) return local;
  }
  return import.meta.env?.VITE_MASSIVE_API_KEY || '';
}

/**
 * Classify a symbol and convert to Polygon ticker format.
 *   - Crypto: BTC → X:BTCUSD
 *   - Forex:  EURUSD → C:EURUSD
 *   - Stocks: AAPL → AAPL (no prefix)
 *   - Indices: SPX → I:SPX
 */
function toPolygonTicker(symbol) {
  const s = symbol.toUpperCase();

  // Known crypto symbols → X: prefix
  // (We use a broad heuristic: 3-5 char alphanumerics that aren't known tradfi tickers)
  const KNOWN_CRYPTO = new Set([
    'BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOT','MATIC','LINK','UNI',
    'ATOM','LTC','BCH','ETC','FIL','ARB','OP','APT','NEAR','SUI','SEI','TIA',
    'INJ','RUNE','AAVE','MKR','CRV','SNX','GMX','COMP','BAL','DYDX','LDO',
    'PEPE','SHIB','DOGE','WIF','BONK','JUP','PYTH','RNDR','FET','IMX','STX',
    'FLOW','THETA','HBAR','EGLD','XLM','ALGO','XMR','ZEC','DASH','NEO','EOS',
    'MIOTA','CHZ','ENJ','BAT','ZIL','ICX','KSM','WAVES','OCEAN','RSR','BTT',
    'HOT','ORN','UMA','BNT','BAND','RLC','KNC','LRC','SNT','MANA','TON','TRX',
    'HYPE','ENA','ONDO','PENDLE','JTO','ETHFI','MORPHO','CAKE','AERO','MNT',
    'SKY','WLD','EIGEN','TAO','VIRTUAL','AKT','IO','GRASS','LIT','KAS','MET',
    'BIO','VVV','W','TRUMP','PUMP','FARTCOON','SPX','MOG','USELESS','PENGU',
    'BGB','GT','LEO','HNT','IOT','MOBILE','USDT','USDC','DAI','USDS','USDE',
    'PYUSD','FDUSD','RLUSD','USD1','MAGIC','ILV','GALA','AXS','SAND','RON',
    'BEAM','YGG','STRK','ZK','MANTA','BLAST','SCROLL','POL','RENDER','RNDR',
    'AGIX','NMR','GRT','AR','XDC','CELO','ROSE','SCRT','STRAX','FTT','OKB',
    'CRO','KCS','XAUT',
  ]);

  if (KNOWN_CRYPTO.has(s)) return `X:${s}USD`;

  // Forex pairs (6 chars, contains USD/eur/gbp/etc)
  if (/^(EUR|GBP|JPY|CHF|CAD|AUD|NZD|KRW|HKD|SGD|INR|CNY|MXN|BRL|ZAR|TRY|SEK|NOK|DKK|PLN|CZK|HUF|ILS|PHP|THB|IDR|MYR|VND|RUB).{3}$/.test(s) ||
      /^.{3}(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD)$/.test(s)) {
    return `C:${s}`;
  }

  // Indices (SPX, NDX, VIX, etc.)
  const KNOWN_INDICES = new Set(['SPX','NDX','VIX','DJI','RTY','RUI','RUA','NDX','OEX','XMI','XAU','XAG']);
  if (KNOWN_INDICES.has(s)) {
    // XAU/XAG are forex-style on Polygon (C: prefix)
    if (s === 'XAU' || s === 'XAG') return `C:${s}USD`;
    return `I:${s}`;
  }

  // Default: treat as US stock/ETF (no prefix)
  return s;
}

/**
 * Fetch OHLC candles from Polygon/Massive.
 * @returns {Array<{ts,open,high,low,close,vol,vwap}>} or null
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const apiKey = getApiKey();
  if (!apiKey) return null;  // No key configured — let resolver fall back

  const tf = TIMEFRAME_MAP[timeframe] || TIMEFRAME_MAP['1D'];
  const intervalMs = INTERVAL_MS[tf.timespan === 'minute' ? `${tf.multiplier}m`
                          : tf.timespan === 'hour' ? `${tf.multiplier}h`
                          : tf.timespan === 'day' ? '1d'
                          : '1w'] || 86_400_000;

  const ticker = toPolygonTicker(symbol);
  const to = new Date();
  const from = new Date(to.getTime() - limit * intervalMs);

  // Polygon wants dates in YYYY-MM-DD format
  const fromDate = from.toISOString().split('T')[0];
  const toDate = to.toISOString().split('T')[0];

  const url = `${BASE_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}` +
              `/range/${tf.multiplier}/${tf.timespan}/${fromDate}/${toDate}` +
              `?adjusted=false&sort=asc&limit=${Math.min(limit, 50000)}&apiKey=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        // NOT_AUTHORIZED or rate-limited — don't log spam, just return null
        return null;
      }
      return null;
    }
    const data = await res.json();
    if (data.status !== 'OK' || !Array.isArray(data.results)) return null;

    return data.results.map(c => ({
      ts: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      vol: c.v,
      vwap: c.vw,
      tradeCount: c.n,
    }));
  } catch (e) {
    console.warn(`[massive] ${symbol} (${ticker}) failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch the latest quote/snapshot for a ticker (single API call).
 * Useful for getting current price + 24h change without fetching full candles.
 */
export async function fetchSnapshot(symbol) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const ticker = toPolygonTicker(symbol);
  try {
    const url = `${BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}?apiKey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    return d.ticker ? {
      price: d.ticker.lastTrade?.p || d.ticker.day?.c,
      dayHigh: d.ticker.day?.h,
      dayLow: d.ticker.day?.l,
      dayOpen: d.ticker.day?.o,
      volume24h: d.ticker.day?.v,
      change24hPct: d.ticker.todaysChangePerc,
    } : null;
  } catch {
    return null;
  }
}

/**
 * Fetch previous day's OHLC (works on free tier — useful for daily chart fallback).
 */
export async function fetchPrevClose(symbol) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  const ticker = toPolygonTicker(symbol);
  try {
    const url = `${BASE_URL}/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=false&apiKey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.status !== 'OK' || !d.results?.length) return null;
    const c = d.results[0];
    return {
      ts: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      vol: c.v,
      vwap: c.vw,
    };
  } catch {
    return null;
  }
}

/**
 * Check if the Massive API key is configured (for UI display).
 */
export function isConfigured() {
  return !!getApiKey();
}

export const sourceMeta = {
  id: 'massive',
  type: 'multi',  // crypto + tradfi + forex + indices
  supportsTimeframes: ['1m', '5m', '15m', '30m', '1H', '4H', '12H', '1D', '1w'],
  rateLimitPerMin: 'unlimited (paid)',
  requiresApiKey: true,
  maxCandlesPerCall: 50000,
};
