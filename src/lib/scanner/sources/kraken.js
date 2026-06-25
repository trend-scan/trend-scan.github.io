/**
 * Kraken spot — free, no API key, CORS-enabled
 * Solid crypto spot source, no geographical restrictions.
 *
 * Used as a backup in the resolver chain. Kraken's instrument universe is
 * smaller than OKX/Bybit but very reliable.
 *
 * Docs: https://docs.kraken.com/rest/#tag/Market-Data/operation/getOHLCData
 */

const BASE = 'https://api.kraken.com/0/public';

const TIMEFRAME_MINUTES = {
  '15m': 15,
  '30m': 30,
  '1H': 60,
  '4H': 240,
  '12H': 720,
  '1D': 1440,
  '1w': 10080,
};

// Kraken uses special pair names for some assets
const SYMBOL_TO_PAIR = {
  BTC: 'XBTUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  ADA: 'ADAUSDT',
  DOGE: 'XDGUSDT',  // Kraken uses XDG for DOGE
  DOT: 'DOTUSDT',
  LINK: 'LINKUSDT',
  MATIC: 'MATICUSDT',
  AVAX: 'AVAXUSDT',
  UNI: 'UNIUSDT',
  ATOM: 'ATOMUSDT',
  LTC: 'LTCUSDT',
  XLM: 'XLMUSDT',
  NEAR: 'NEARUSDT',
  APT: 'APTUSDT',
  ARB: 'ARBUSDT',
  OP: 'OPUSDT',
  SUI: 'SUIUSDT',
  SEI: 'SEIUSDT',
  TIA: 'TIAUSDT',
  INJ: 'INJUSDT',
  RUNE: 'RUNEUSDT',
  FET: 'FETUSDT',
  RNDR: 'RNDRUSDT',
  IMX: 'IMXUSDT',
  LDO: 'LDOUSDT',
  MKR: 'MKRUSDT',
  AAVE: 'AAVEUSDT',
  CRV: 'CRVUSDT',
  SNX: 'SNXUSDT',
  GMX: 'GMXUSDT',
  DYDX: 'DYDXUSDT',
  COMP: 'COMPUSDT',
  // Some Kraken pairs use USD instead of USDT
  TRX: 'TRXUSD',
  TON: 'TONUSD',
  XMR: 'XMRUSD',
  ZEC: 'ZECUSD',
  HBAR: 'HBARUSD',
  ALGO: 'ALGOUSD',
  FIL: 'FILUSD',
  EGLD: 'EGLDUSD',
  AXS: 'AXSUSD',
  SAND: 'SANDUSD',
  MANA: 'MANAUSD',
  GRT: 'GRTUSD',
  OCEAN: 'OCEANUSD',
  NMR: 'NMRUSD',
  BAND: 'BANDUSD',
  RLC: 'RLCUSDT',
  KNC: 'KNCUSDT',
  LRC: 'LRCUSDT',
  BAL: 'BALUSDT',
  SNT: 'SNTUSD',
  UMA: 'UMAUSD',
  BNT: 'BNTUSD',
  ENJ: 'ENJUSD',
  CHZ: 'CHZUSD',
  ZIL: 'ZILUSD',
  ICX: 'ICXUSD',
  KSM: 'KSMUSD',
  WAVES: 'WAVESUSD',
  FTT: 'FTTUSD',
  SCRT: 'SCRTUSD',
  ROSE: 'ROSEUSD',
};

let _pairCache = null;

async function resolvePair(symbol) {
  const s = symbol.toUpperCase();
  // Check hardcoded map first
  if (SYMBOL_TO_PAIR[s]) return SYMBOL_TO_PAIR[s];
  // Default: try {SYMBOL}USDT, then {SYMBOL}USD
  // We could query AssetPairs but that's an extra call; just try both
  return `${s}USDT`;
}

/**
 * Fetch OHLC candles from Kraken.
 * @returns {Array<{ts,open,high,low,close,vol}>} or null
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const interval = TIMEFRAME_MINUTES[timeframe] || 1440;
  const pair = await resolvePair(symbol);
  if (!pair) return null;

  // Kraken's `since` param is in seconds; returns up to 720 candles per call
  const since = Math.floor(Date.now() / 1000) - (limit * interval * 60);
  const url = `${BASE}/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}&since=${since}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error?.length) return null;

    const key = Object.keys(json.result || {}).find(k => k !== 'last');
    if (!key) return null;
    const raw = json.result[key];
    if (!raw?.length) return null;

    return raw.map(c => ({
      ts: c[0] * 1000,
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vwap: parseFloat(c[5]),
      vol: parseFloat(c[6]),
    }));
  } catch (e) {
    console.warn(`[kraken] ${symbol} (${pair}) failed: ${e.message}`);
    return null;
  }
}

export const sourceMeta = {
  id: 'kraken',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w'],
  rateLimitPerMin: 60,  // generous, no hard limit
  requiresApiKey: false,
  maxCandlesPerCall: 720,
  geographicalLimits: 'none',
};
