/**
 * Lighter (zkLighter / Elliot) — free, no API key, CORS-enabled
 * 214 markets: crypto + ~150 tradfi (stocks, ETFs, indices, commodities, FX, pre-IPO).
 *
 * Docs: https://apidocs.lighter.xyz/llms.txt
 * Base: https://mainnet.zklighter.elliot.ai/api/v1
 * Explorer: https://explorer.elliot.ai/api/markets
 *
 * Limits: 60 req/min unauthenticated (IP-based). Cache aggressively.
 *
 * NOTE: requires market_id (int) instead of symbol. Resolution uses lowercase.
 * NOTE: All 5 query params are REQUIRED: market_id, resolution, start_timestamp,
 *       end_timestamp, count_back. Missing any → "code":20001 invalid param.
 */

const API = 'https://mainnet.zklighter.elliot.ai/api/v1';
const EXPLORER = 'https://explorer.elliot.ai/api';

const TIMEFRAME_RESOLUTION = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1h',
  '4H': '4h',
  '12H': '12h',
  '1D': '1d',
};

const RESOLUTION_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
};

// Market catalog cache: { SYMBOL: market_index }
let _marketMap = null;
let _marketMapTime = 0;
const MARKET_MAP_TTL_MS = 24 * 60 * 60 * 1000;  // 24h

async function loadMarketMap() {
  const now = Date.now();
  if (_marketMap && now - _marketMapTime < MARKET_MAP_TTL_MS) return _marketMap;
  try {
    const res = await fetch(`${EXPLORER}/markets`);
    if (!res.ok) return _marketMap || {};
    const arr = await res.json();
    _marketMap = {};
    for (const m of arr) {
      const sym = (m.symbol || m.ticker || '').toUpperCase();
      if (sym) _marketMap[sym] = m.market_index;
    }
    _marketMapTime = now;
    return _marketMap;
  } catch (e) {
    console.warn(`[lighter] market map fetch failed: ${e.message}`);
    return _marketMap || {};
  }
}

export async function getMarketId(symbol) {
  const map = await loadMarketMap();
  const s = symbol.toUpperCase();
  // Check API-fetched map first, then fall back to hardcoded known IDs
  if (map[s]) return map[s];
  if (KNOWN_MARKET_IDS[s]) return KNOWN_MARKET_IDS[s];
  return null;
}

export async function isSupported(symbol) {
  const map = await loadMarketMap();
  return symbol.toUpperCase() in map;
}

/**
 * Fetch OHLC candles from Lighter.
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>>} or null
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const marketId = await getMarketId(symbol);
  if (marketId == null) return null;

  const resolution = TIMEFRAME_RESOLUTION[timeframe] || '1d';
  const resMs = RESOLUTION_MS[resolution] || 86_400_000;
  const end = Date.now();
  const start = end - limit * resMs;

  // All 5 params required by Lighter API
  const url = `${API}/candles?market_id=${marketId}&resolution=${resolution}` +
              `&start_timestamp=${start}&end_timestamp=${end}` +
              `&count_back=${limit}&set_timestamp_to_end=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code !== 200 || !Array.isArray(d.c)) return null;

    return d.c.map(c => ({
      ts: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      vol: c.v,
      // Lighter also returns V (quote volume) and i (sequence id) — vol above is base volume
    }));
  } catch (e) {
    console.warn(`[lighter] ${symbol} (id=${marketId}) failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch 24h ticker for a single market.
 * Note: Lighter's bulk orderBookDetails endpoint requires a market_id (no "all markets" call),
 * so this is per-symbol. Cache results for 60s to stay within the 60 req/min limit.
 */
let _tickerCache = new Map();
const TICKER_TTL_MS = 60 * 1000;

export async function fetchTicker(symbol) {
  const marketId = await getMarketId(symbol);
  if (marketId == null) return null;

  const now = Date.now();
  const cached = _tickerCache.get(symbol);
  if (cached && now - cached.ts < TICKER_TTL_MS) return cached.data;

  try {
    const res = await fetch(`${API}/orderBookDetails?market_id=${marketId}`);
    if (!res.ok) return null;
    const d = await res.json();
    const m = Array.isArray(d) ? d[0] : (d.data || d);
    if (!m) return null;

    const ticker = {
      price: m.last_trade_price,
      change24hPct: m.daily_price_change,
      high24h: m.daily_price_high,
      low24h: m.daily_price_low,
      volume24hUsd: m.daily_quote_token_volume,
      volume24hBase: m.daily_base_token_volume,
      openInterest: m.open_interest,
      trades24h: m.daily_trades_count,
    };
    _tickerCache.set(symbol, { ts: now, data: ticker });
    return ticker;
  } catch (e) {
    console.warn(`[lighter] ticker ${symbol} failed: ${e.message}`);
    return null;
  }
}

// Pre-known market IDs for common tradfi tickers (saves a /markets call at startup)
export const KNOWN_MARKET_IDS = {
  // Crypto
  BTC: 1, ETH: 0, SOL: 2, GRAM: 12, ICP: 102, MNT: 63, MORPHO: 68,
  WIF: 5, POPCAT: 23, DOLO: 184,
  // Benchmark ETFs & Indices
  SPY: 128, QQQ: 129, DIA: 152, IWM: 153, US500: 180, US100: 181,
  // AI Infrastructure
  NVDA: 110, AAPL: 113, MSFT: 115, GOOGL: 116, META: 117, AMZN: 114,
  AMD: 138, AVGO: 210, MRVL: 174, DELL: 187, ARM: 206, TSM: 168,
  CRWV: 167, NBIS: 189, ORCL: 165, IBM: 188, NOW: 191, S: 40,
  // Semiconductors
  ASML: 151, INTC: 137, QCOM: 209, SOXL: 197, SOXX: 169,
  // Memory & Optics
  MU: 164, SNDK: 139, LITE: 178, AAOI: 207,
  // Crypto Equities
  COIN: 109, MSTR: 122, HOOD: 108, CRCL: 121,
  // Robotics & Defense
  TSLA: 112, ROBO: 149, RKLB: 186, URA: 150,
  // Energy
  WTI: 145, BRENTOIL: 159, NATGAS: 158,
  // Metals
  XAU: 92, XAG: 93, XCU: 136, XPD: 146, XPT: 147, XPL: 71, PAXG: 48,
  // Agriculture
  WHEAT: 170, MAGS: 155,
  // ETFs
  EWY: 166, BOTZ: 154,
  // International
  BABA: 177, TENCENT: 201, XIAOMI: 203, POPMART: 204,
  SAMSUNG: 140, SAMSUNGUSD: 162, SKHYNIX: 143, SKHYNIXUSD: 161,
  HYUNDAI: 141, HYUNDAIUSD: 160, KRCOMP: 142, BYD: 205,
  // Pre-IPO
  OPENAI: 192, ANTHROPIC: 193, SPACEX: 173, MINIMAX: 199,
  // Consumer
  GME: 176, TTWO: 179, IP: 34, NOK: 208,
  // Other
  CTR: 183, H100: 182, AVNT: 82, RESOLV: 51,
  QNT: 190, NMR: 74, CRO: 73, SKY: 79,
  STABLE: 118, PIPPIN: 135, LAUNCHCOIN: 54,
};

export const sourceMeta = {
  id: 'lighter',
  type: 'tradfi',  // also serves crypto; resolver tags both
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D'],
  rateLimitPerMin: 60,
  requiresApiKey: false,
  maxCandlesPerCall: 500,
};
