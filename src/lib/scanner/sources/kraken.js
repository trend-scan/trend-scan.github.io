/**
 * Kraken spot — free, no API key, CORS-enabled, NO geo-blocks.
 * Reliable crypto spot source with ~300+ USDT/USD pairs.
 *
 * Dynamically loads the AssetPairs universe on first use (cached 10 min),
 * building a complete map of bare symbol → Kraken pair name. This handles
 * Kraken's quirks:
 *   - BTC → XBT (Kraken uses XBT for Bitcoin)
 *   - DOGE → XDG (Kraken uses XDG for Dogecoin)
 *   - Some pairs use USDT, others use USD (prefers USDT when both exist)
 *   - Some pairs have special names (e.g. "XXBTZUSD" for BTC/USD)
 *
 * The hardcoded SYMBOL_TO_PAIR map is kept as a fallback for when the
 * AssetPairs endpoint is temporarily unavailable.
 *
 * Docs: https://docs.kraken.com/rest/#tag/Market-Data/operation/getOHLCData
 */

import { fetchWithTimeout } from '../fetchWithTimeout';

const BASE = 'https://api.kraken.com/0/public';

const TIMEFRAME_MINUTES = {
  '15m': 15,
  '30m': 30,
  '1H': 60,
  '4H': 240,
  '12H': 720,
  '1D': 1440,
  '1w': 10080,
  '1W': 10080,
};

// Fallback hardcoded map for known special cases.
// Used only if the AssetPairs endpoint fails to load.
const SYMBOL_TO_PAIR_FALLBACK = {
  BTC: 'XBTUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  ADA: 'ADAUSDT',
  DOGE: 'XDGUSDT',
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
  SCRT: 'SCRTUSD',
  ROSE: 'ROSEUSD',
};

// ─── Universe cache: bare symbol → Kraken pair name ──────────────────────────
// Built by fetching /public/AssetPairs once, then served from memory.
// Handles Kraken's naming quirks (XBT, XDG, USDT vs USD, etc.)

let _pairMap = null;           // { BTC: 'XBTUSDT', ETH: 'ETHUSDT', ... }
let _pairMapTime = 0;
let _pairMapPromise = null;    // deduplicates concurrent loads
const PAIR_MAP_TTL_MS = 10 * 60 * 1000;

function normalizeBase(base) {
  // Kraken uses XBT for BTC, XDG for DOGE
  if (/^[XZ][A-Z0-9]{3}$/.test(base)) base = base.slice(1);
  if (base === 'XBT') base = 'BTC';
  if (base === 'XDG') base = 'DOGE';
  return base;
}

async function loadPairMap() {
  const now = Date.now();
  if (_pairMap && now - _pairMapTime < PAIR_MAP_TTL_MS) return _pairMap;
  if (_pairMapPromise) return _pairMapPromise;

  _pairMapPromise = (async () => {
    try {
      const res = await fetchWithTimeout(`${BASE}/AssetPairs`);
      if (!res.ok) return _pairMap || null;
      const json = await res.json();
      if (json.error?.length) return _pairMap || null;

      const pairs = json.result || {};
      const map = {};

      // First pass: collect all USDT and USD pairs for each base
      for (const [name, info] of Object.entries(pairs)) {
        if (!info.base || !info.quote) continue;
        const q = info.quote.replace(/^[XZ]/, '');  // ZUSD → USD, USDT stays
        const base = normalizeBase(info.base);
        if (!base) continue;

        // Prefer USDT over USD. Only store if we don't already have a USDT pair.
        if (q === 'USDT') {
          map[base] = name;
        } else if (q === 'USD' && !map[base]) {
          map[base] = name;
        }
      }

      if (Object.keys(map).length > 0) {
        _pairMap = map;
        _pairMapTime = Date.now();
      }
      return _pairMap;
    } catch {
      return _pairMap || null;
    } finally {
      _pairMapPromise = null;
    }
  })();

  return _pairMapPromise;
}

/**
 * Resolve a bare symbol to its Kraken pair name.
 * Uses the dynamic pair map (preferred) or falls back to the hardcoded map.
 * @param {string} symbol  e.g. 'BTC', 'ETH', 'DOGE'
 * @returns {Promise<string|null>}  e.g. 'XBTUSDT', 'ETHUSDT', 'XDGUSDT'
 */
async function resolvePair(symbol) {
  const s = symbol.toUpperCase();
  const pairMap = await loadPairMap();
  if (pairMap && pairMap[s]) return pairMap[s];
  // Fallback to hardcoded map
  if (SYMBOL_TO_PAIR_FALLBACK[s]) return SYMBOL_TO_PAIR_FALLBACK[s];
  // Last resort: try {SYMBOL}USDT (works for most USDT-quoted tokens)
  return `${s}USDT`;
}

/**
 * Check if Kraken supports this symbol.
 * Uses the cached pair map — instant after first load.
 * @param {string} symbol
 * @returns {Promise<boolean>}
 */
export async function isSupported(symbol) {
  const pairMap = await loadPairMap();
  if (!pairMap) return true;  // optimistic if universe fetch failed
  const s = symbol.toUpperCase();
  return s in pairMap || s in SYMBOL_TO_PAIR_FALLBACK;
}

/**
 * Fetch OHLC candles from Kraken.
 * @param {string} symbol  bare symbol, e.g. 'BTC', 'ETH'
 * @param {string} [timeframe='1D']
 * @param {number} [limit=300]
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const interval = TIMEFRAME_MINUTES[timeframe] || 1440;
  const pair = await resolvePair(symbol);
  if (!pair) return null;

  // Quick universe check — skip the HTTP request if Kraken doesn't have this symbol
  const pairMap = await loadPairMap();
  if (pairMap) {
    const s = symbol.toUpperCase();
    if (!(s in pairMap) && !(s in SYMBOL_TO_PAIR_FALLBACK)) return null;
  }

  // Kraken's `since` param is in seconds; returns up to 720 candles per call
  const since = Math.floor(Date.now() / 1000) - (limit * interval * 60);
  const url = `${BASE}/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}&since=${since}`;

  try {
    const res = await fetchWithTimeout(url);
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
  } catch {
    return null;
  }
}

export const sourceMeta = {
  id: 'kraken',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w', '1W'],
  rateLimitPerMin: 60,  // generous, no hard limit
  requiresApiKey: false,
  maxCandlesPerCall: 720,
  geographicalLimits: 'none',
  notes: 'Dynamically loads AssetPairs for complete symbol coverage. Prefers USDT pairs, falls back to USD.',
};
