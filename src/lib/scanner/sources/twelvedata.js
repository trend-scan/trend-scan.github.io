/**
 * Twelve Data — free tier 800 req/day, CORS-enabled (Access-Control-Allow-Origin: *)
 *
 * Coverage: US stocks, ETFs, forex, crypto — all in one API
 * Free tier: 800 requests/day, 8 requests/min
 * History: 1 year of daily candles on free tier
 *
 * Docs: https://twelvedata.com/docs#time-series
 * Endpoint: GET /time_series?symbol={sym}&interval=1day&outputsize={limit}&apikey={key}
 *
 * The API key is baked into the bundle at build time by Vite:
 *   - deploy.yml passes VITE_TWELVEDATA_KEY as env var to `npm run build`
 *   - Vite's loadEnv() picks it up and inlines as import.meta.env.VITE_TWELVEDATA_KEY
 */

const BASE = 'https://api.twelvedata.com';

// Twelve Data uses different symbol formats:
//   US Stocks/ETFs: AAPL, SPY, LLY (no suffix needed)
//   Forex: EUR/USD
//   Crypto: BTC/USD
function formatSymbol(symbol, type) {
  const s = symbol.toUpperCase();
  
  // Forex pairs (already contain /)
  if (s.includes('/')) return s;
  
  // Known forex pairs (6-char combinations)
  const forexPairs = ['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDKRW','USDHKD'];
  if (forexPairs.includes(s)) {
    return `${s.slice(0,3)}/${s.slice(3)}`;
  }
  
  // Crypto symbols
  const cryptoSymbols = ['BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOT','LINK','UNI','DOGE','SHIB','PEPE','HYPE','TON','TRX','LTC','BCH','ATOM','ETC','FIL','NEAR','APT','SUI','SEI','TIA','INJ','AAVE','MKR','CRV','LDO','SNX','GMX','COMP','DYDX','PENDLE','JUP','WLD','EIGEN','TAO','RENDER','FET','AKT','IO','ENA','ONDO','WIF','BONK','FLOKI','POPCAT','TRUMP','PUMP','ARB','OP','STRK','ZK','POL','MNT','MORPHO','CAKE','AERO','JTO','ETHFI','SKY','DEXE','QNT','JST','GRAM','KAS','ICP','FLR','XDC','HBAR','XLM','ALGO','XMR','ZEC','DASH','MINA','KSM','ZEN','XNO','XEC','QTUM','ZIL','RVN','DGB','FLOW','THETA','EGLD','KAVA','ROSE','CFX','ELF','CKB','ZETA','METAL','BERA'];
  if (cryptoSymbols.includes(s)) {
    return `${s}/USD`;
  }
  
  // Commodities and indices — try as-is
  const commodities = ['XAU','XAG','XCU','XPD','XPT','WTI','BRENTOIL','NATGAS','WHEAT'];
  if (commodities.includes(s)) {
    // Twelve Data uses XAU/USD format for metals
    if (s.startsWith('X')) return `${s}/USD`;
    return s; // WTI, BRENTOIL, NATGAS, WHEAT — may need special handling
  }
  
  // Indices
  const indices = ['US500','US100','DIA','IWM','SPY','QQQ','EWY','MAGS','BOTZ','ROBO','URA','SOXL','SOXX','VUG','VTV','QTUM'];
  if (indices.includes(s)) {
    return s;
  }
  
  // Default: US stock/ETF (no suffix needed on Twelve Data)
  return s;
}

function getApiKey() {
  if (typeof window !== 'undefined') {
    const local = localStorage.getItem('TWELVEDATA_KEY');
    if (local) return local;
  }
  return import.meta.env?.VITE_TWELVEDATA_KEY || '';
}

export function isConfigured() {
  return !!getApiKey();
}

/**
 * Fetch daily OHLC candles from Twelve Data.
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>>} or null
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  
  // Twelve Data interval mapping
  const intervalMap = {
    '1D': '1day',
    '1H': '1h',
    '4H': '4h',
    '15m': '15min',
    '30m': '30min',
    '1w': '1week',
  };
  const interval = intervalMap[timeframe] || '1day';
  
  // Format symbol for Twelve Data
  const tdSymbol = formatSymbol(symbol);
  
  // Free tier: max 500 outputsize, 1 year history
  const outputsize = Math.min(limit, 365);
  
  const params = new URLSearchParams({
    symbol: tdSymbol,
    interval,
    outputsize: outputsize.toString(),
    apikey: apiKey,
    format: 'JSON',
  });
  
  const url = `${BASE}/time_series?${params}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    
    if (d.status === 'error' || !d.values) {
      // Rate limit or invalid symbol
      return null;
    }
    
    // Twelve Data returns newest-first; reverse for chronological
    return d.values.slice().reverse().map(c => ({
      ts: new Date(c.datetime).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      vol: parseFloat(c.volume) || 0,
    }));
  } catch (e) {
    console.warn(`[twelvedata] ${symbol} (${tdSymbol}) failed: ${e.message}`);
    return null;
  }
}

export const sourceMeta = {
  id: 'twelvedata',
  type: 'multi',  // stocks + crypto + forex
  supportsTimeframes: ['15m', '30m', '1H', '4H', '1D', '1w'],
  rateLimitPerDay: 800,
  rateLimitPerMin: 8,
  requiresApiKey: true,
  maxCandlesPerCall: 365,  // 1 year on free tier
  corsEnabled: true,
};
