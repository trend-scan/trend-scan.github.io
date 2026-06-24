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
  return map[symbol.toUpperCase()];
}

export async function isSupported(symbol) {
  const map = await loadMarketMap();
  return symbol.toUpperCase() in map;
}

/**
 * Fetch OHLC candles from Lighter.
 * @returns {Array<{ts,open,high,low,close,vol}>} or null
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
  BTC: 1, ETH: 0, SOL: 2,
  SPY: 128, QQQ: 129, DIA: 152, IWM: 153,
  TSLA: 112, NVDA: 110, AAPL: 113, AMZN: 114, MSFT: 115, GOOGL: 116, META: 117,
  HOOD: 108, COIN: 109, MSTR: 122, PLTR: 137, INTC: 138, AMD: 138, MU: 164,
  ORCL: 165, GME: 176, BABA: 177, TSM: 168, RKLB: 186, DELL: 187,
  US500: 180, US100: 181,  // S&P 500 + Nasdaq 100 indices
  XAU: 92, XAG: 93, XCU: 136, XPT: 147, XPD: 146,  // gold, silver, copper, platinum, palladium
  WTI: 145, BRENTOIL: 159, NATGAS: 158,  // energy
  WHEAT: 170,  // agriculture
  EURUSD: 96, GBPUSD: 97, USDJPY: 98, USDCHF: 99, USDCAD: 100,
  USDKRW: 101, AUDUSD: 102, NZDUSD: 103, USDHKD: 104,
  PAXG: 48,  // tokenized gold
  OPENAI: 192, ANTHROPIC: 193, SPACEX: 173,  // pre-IPO
};

export const sourceMeta = {
  id: 'lighter',
  type: 'tradfi',  // also serves crypto; resolver tags both
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D'],
  rateLimitPerMin: 60,
  requiresApiKey: false,
  maxCandlesPerCall: 500,
};
