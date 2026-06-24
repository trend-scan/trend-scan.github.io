/**
 * CoinGecko — free, no API key, CORS-enabled (Access-Control-Allow-Origin: *)
 * Primary daily-OHLC source for crypto. Also provides market cap + 24h volume.
 *
 * Docs: https://docs.coingecko.com/reference/coins-id-ohlc
 * Limits: ~30 req/min on free tier (no key); 100-500/min with demo key.
 */

const BASE = 'https://api.coingecko.com/api/v3';

// Timeframe → CoinGecko OHLC `days` param
// CoinGecko returns: 1d-2d → 30min candles; 7-30d → 4h candles; >30d → 4d candles
// For our scanner (which expects 1d+ candles), we map app timeframes to days.
const TIMEFRAME_DAYS = {
  '1D': 365,    // daily candles for 1y
  '4H': 90,     // 4h candles for 90d
  '1H': 30,     // 30min candles for 30d (CoinGecko doesn't have 1h directly)
  '12H': 180,
  '15m': 1,
  '30m': 1,
  '1w': 365,
};

// Map symbol → CoinGecko coin id (the OHLC endpoint requires the id, not the ticker)
// Extend this map as needed; for unknown symbols, the caller should fall back to another source.
const SYMBOL_TO_ID = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LTC: 'litecoin',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  XLM: 'stellar',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  FIL: 'filecoin',
  ICP: 'internet-computer',
  VET: 'vechain',
  ALGO: 'algorand',
  FTM: 'fantom',
  SAND: 'the-sandbox',
  MANA: 'decentraland',
  AXS: 'axie-infinity',
  GRT: 'the-graph',
  ETC: 'ethereum-classic',
  BCH: 'bitcoin-cash',
  SHIB: 'shiba-inu',
  PEPE: 'pepe',
  WIF: 'dogwifcoin',
  BONK: 'bonk',
  JUP: 'jupiter-exchange-solana',
  PYTH: 'pyth-network',
  TIA: 'celestia',
  SEI: 'sei-network',
  SUI: 'sui',
  RUNE: 'thorchain',
  FET: 'fetch-ai',
  RNDR: 'render-token',
  IMX: 'immutable-x',
  LDO: 'lido-dao',
  MKR: 'maker',
  AAVE: 'aave',
  CRV: 'curve-dao-token',
  SUSHI: 'sushi',
  COMP: 'compound-governance-token',
  SNX: 'havven',
  DYDX: 'dydx-chain',
  GMX: 'gmx',
  INJ: 'injective-protocol',
  STX: 'blockstack',
  FLOW: 'flow',
  THETA: 'theta-token',
  HBAR: 'hedera-hashgraph',
  EGLD: 'elrond-erd-2',
  HT: 'huobi-token',
  KAVA: 'kava',
  ZEC: 'zcash',
  DASH: 'dash',
  NEO: 'neo',
  EOS: 'eos',
  MIOTA: 'iota',
  CHZ: 'chiliz',
  ENJ: 'enjincoin',
  BAT: 'basic-attention-token',
  ZIL: 'zilliqa',
  ICX: 'icon',
  KSM: 'kusama',
  WAVES: 'waves',
  OCEAN: 'ocean-protocol',
  RSR: 'reserve-rights-token',
  BTT: 'bittorrent',
  WIN: 'wink',
  HOT: 'holotoken',
  ORN: 'orion-protocol',
  UMA: 'uma',
  BNT: 'bancor',
  BAND: 'band-protocol',
  RLC: 'iexec-rlc',
  KNC: 'kyber-network-crystal',
  LRC: 'loopring',
  BAL: 'balancer',
  SNT: 'status',
  MANA: 'decentraland',
  OCEAN: 'ocean-protocol',
};

let _idCache = null;

async function loadIdMap() {
  if (_idCache) return _idCache;
  try {
    const res = await fetch(`${BASE}/coins/list`);
    if (!res.ok) return SYMBOL_TO_ID;
    const list = await res.json();
    _idCache = {};
    // Pick the first match per symbol (CoinGecko lists multiple per symbol)
    for (const c of list) {
      const sym = c.symbol.toUpperCase();
      if (!_idCache[sym]) _idCache[sym] = c.id;
    }
    // Merge with hard-coded overrides (which take precedence for accuracy)
    return { ..._idCache, ...SYMBOL_TO_ID };
  } catch {
    return SYMBOL_TO_ID;
  }
}

/**
 * Fetch OHLC candles for a crypto symbol.
 * @returns {Array<{ts,open,high,low,close,vol}>} or null on failure
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const idMap = await loadIdMap();
  const coinId = idMap[symbol.toUpperCase()];
  if (!coinId) return null;

  const days = TIMEFRAME_DAYS[timeframe] || 365;
  const url = `${BASE}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;

    // CoinGecko returns [[timestamp_ms, o, h, l, c], ...]
    // No volume in OHLC endpoint — caller can fetch from /markets if needed
    let candles = arr.map(c => ({
      ts: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      vol: 0,  // not provided by OHLC endpoint
    }));

    // Trim to requested limit (most recent)
    if (candles.length > limit) candles = candles.slice(-limit);
    return candles;
  } catch (e) {
    console.warn(`[coingecko] ${symbol} failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch current market data (price, market cap, 24h volume) for many symbols in 1-2 calls.
 * Used by the scanner as a parallel data source alongside OHLC.
 */
let _marketCache = null;
let _marketCacheTime = 0;
const MARKET_TTL_MS = 60 * 1000;

export async function fetchMarketData(symbols = []) {
  const now = Date.now();
  if (_marketCache && now - _marketCacheTime < MARKET_TTL_MS) {
    return filterBySymbols(_marketCache, symbols);
  }
  try {
    // Fetch top 250 by market cap
    const url = `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`;
    const res = await fetch(url);
    if (!res.ok) return _marketCache ? filterBySymbols(_marketCache, symbols) : {};
    const arr = await res.json();
    _marketCache = {};
    for (const c of arr) {
      _marketCache[c.symbol.toUpperCase()] = {
        price: c.current_price,
        marketCap: c.market_cap || 0,
        volume24h: c.total_volume || 0,
        marketCapRank: c.market_cap_rank || 999999,
        change24h: c.price_change_percentage_24h || 0,
      };
    }
    _marketCacheTime = now;
    return filterBySymbols(_marketCache, symbols);
  } catch {
    return _marketCache ? filterBySymbols(_marketCache, symbols) : {};
  }
}

function filterBySymbols(map, symbols) {
  if (!symbols.length) return map;
  const out = {};
  for (const s of symbols) {
    if (map[s.toUpperCase()]) out[s.toUpperCase()] = map[s.toUpperCase()];
  }
  return out;
}

export const sourceMeta = {
  id: 'coingecko',
  type: 'crypto',
  supportsTimeframes: ['1D', '4H', '1H', '15m', '30m', '1w'],
  rateLimitPerMin: 30,
  requiresApiKey: false,
};
