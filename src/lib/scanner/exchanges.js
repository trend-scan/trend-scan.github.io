import { fetchWithTimeout } from './fetchWithTimeout';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Geo-blocked error ───────────────────────────────────────────────────────
// Custom Error subclass for HTTP 451 (geo-block) responses. Using a subclass
// instead of attaching properties to a plain Error keeps TypeScript happy
// (TS's built-in Error type doesn't allow arbitrary properties) and gives
// callers a clean way to distinguish geo-blocks from other failures.
export class GeoBlockedError extends Error {
  constructor(message, sourceId) {
    super(message);
    this.name = 'GeoBlockedError';
    this.code = 'GEO_BLOCKED';
    this.sourceId = sourceId;
  }
}

// How many candles make up one "day" for each timeframe
export const CANDLES_PER_DAY = {
  '15m': 96,
  '30m': 48,
  '1H': 24,
  '4H': 6,
  '12H': 2,
  '1D': 1,
  '1W': 1 / 7,
};

// ── OKX SPOT ──────────────────────────────────
const OKX_INTERVAL_MAP = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1H',
  '4H': '4H',
  '12H': '12H',
  '1D': '1D',
};

let _okxSpotInstruments = null;

async function loadOKXSpotInstruments() {
  if (_okxSpotInstruments) return _okxSpotInstruments;
  const res = await fetchWithTimeout('https://www.okx.com/api/v5/public/instruments?instType=SPOT');
  if (!res.ok) throw new Error(`OKX instruments HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== '0') throw new Error(`OKX: ${json.msg || 'Unknown error'}`);
  _okxSpotInstruments = new Set((json.data || []).map(i => i.instId));
  return _okxSpotInstruments;
}

async function fetchOKXSpotCandles(symbol, timeframe = '4H', limit = 300) {
  const instId = `${symbol}-USDT`;
  const instruments = await loadOKXSpotInstruments();
  if (!instruments.has(instId)) return null;

  const bar = OKX_INTERVAL_MAP[timeframe] || '4H';
  // OKX /market/candles limit max is 300 — clamp for deep VWAP lookbacks
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${Math.min(limit, 300)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.code !== '0' || !json.data?.length) return null;

  return json.data.slice().reverse().map(c => ({
    ts: parseInt(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    vol: parseFloat(c[5])
  }));
}

// ── OKX PERPETUALS ──────────────────────────────────────
let _okxPerpsInstruments = null;

async function loadOKXPerpsInstruments() {
  if (_okxPerpsInstruments) return _okxPerpsInstruments;
  const res = await fetchWithTimeout('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
  if (!res.ok) throw new Error(`OKX Perps instruments HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== '0') throw new Error(`OKX Perps: ${json.msg || 'Unknown error'}`);
  // Filter USDT-margined perpetuals only
  _okxPerpsInstruments = new Set(
    (json.data || [])
      .filter(i => i.settleCcy === 'USDT')
      .map(i => i.instId)
  );
  return _okxPerpsInstruments;
}

async function fetchOKXPerpsCandles(symbol, timeframe = '4H', limit = 300) {
  const instId = `${symbol}-USDT-SWAP`;
  const instruments = await loadOKXPerpsInstruments();
  if (!instruments.has(instId)) return null;

  const bar = OKX_INTERVAL_MAP[timeframe] || '4H';
  // OKX /market/candles limit max is 300 — clamp for deep VWAP lookbacks
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${Math.min(limit, 300)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.code !== '0' || !json.data?.length) return null;

  return json.data.slice().reverse().map(c => ({
    ts: parseInt(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    vol: parseFloat(c[5])
  }));
}

// Fetch 24h volume for OKX Perps
async function fetchOKXPerps24hVolume(symbol) {
  const instId = `${symbol}-USDT-SWAP`;
  const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.code !== '0' || !json.data?.length) return null;
  const d = json.data[0];
  return {
    vol24h: parseFloat(d.vol24h || 0),
    quoteVol24h: parseFloat(d.volCcy24h || 0),
  };
}

// ── KRAKEN ───────────────────────────────
const KRAKEN_INTERVAL_MAP = {
  '15m': 15,
  '30m': 30,
  '1H': 60,
  '4H': 240,
  '12H': 720,
  '1D': 1440,
};

let _krakenPairMap = null;

async function loadKrakenPairs() {
  if (_krakenPairMap) return _krakenPairMap;
  const res = await fetchWithTimeout('https://api.kraken.com/0/public/AssetPairs');
  if (!res.ok) throw new Error(`Kraken AssetPairs HTTP ${res.status}`);
  const json = await res.json();
  if (json.error?.length) throw new Error(`Kraken: ${json.error[0]}`);

  _krakenPairMap = {};

  function normalizeBase(base) {
    if (/^[XZ][A-Z0-9]{3}$/.test(base)) base = base.slice(1);
    if (base === 'XBT') base = 'BTC';
    return base;
  }

  const pairs = json.result;
  for (const pass of ['USDT', 'USD']) {
    for (const [name, info] of Object.entries(pairs)) {
      if (!info.base || !info.quote) continue;
      const q = info.quote.replace(/^[XZ]/, '');
      if (q === pass) {
        const base = normalizeBase(info.base);
        if (!_krakenPairMap[base]) _krakenPairMap[base] = { name, quote: pass };
      }
    }
  }
  return _krakenPairMap;
}

async function fetchKrakenCandles(symbol, timeframe = '4H', limit = 300) {
  const pairMap = await loadKrakenPairs();
  const entry = pairMap[symbol];
  if (!entry) return null;

  const interval = KRAKEN_INTERVAL_MAP[timeframe] || 240;
  // Kraken's `since` param is in seconds; returns up to 720 candles per call.
  // Bar count driven by `limit` (deep VWAP support, 2026-09-08) — 720 is the
  // API ceiling, requesting more just returns the max.
  const bars = Math.max(1, limit);
  const since = Math.floor(Date.now() / 1000) - (bars * interval * 60);
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(entry.name)}&interval=${interval}&since=${since}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.error?.length) return null;

  const key = Object.keys(json.result || {}).find(k => k !== 'last');
  if (!key) return null;
  const candles = json.result[key];
  if (!candles?.length) return null;

  return candles.map(c => ({
    ts: c[0] * 1000,
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    vol: parseFloat(c[6])
  }));
}

// ── BINANCE SPOT ─────────────────────────
const BINANCE_INTERVAL_MAP = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1h',
  '4H': '4h',
  '12H': '12h',
  '1D': '1d',
};

async function fetchBinanceCandles(symbol, timeframe = '4H', limit = 500) {
  const interval = BINANCE_INTERVAL_MAP[timeframe] || '4h';
  // Spot klines API max is 1000 (400 beyond) — clamp for deep VWAP lookbacks
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=${interval}&limit=${Math.min(limit, 1000)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    // Surface a clear error for geo-block (HTTP 451) so the UI can show
    // "Binance is geo-blocked in your region — use Auto or pick another source"
    // instead of silently returning null and looking like a fetch failure.
    if (res.status === 451) {
      throw new GeoBlockedError(
        `Binance is geo-blocked in your region (HTTP 451). Use Auto mode or pick another source.`,
        'binance'
      );
    }
    return null;
  }
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;

  return data.map(c => ({
    ts: parseInt(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    vol: parseFloat(c[5])
  }));
}

// ── BINANCE PERPS ─────────────────────────
async function fetchBinancePerpsCandles(symbol, timeframe = '4H', limit = 500) {
  const interval = BINANCE_INTERVAL_MAP[timeframe] || '4h';
  // Futures klines API max is 1500 (400 beyond) — clamp for deep VWAP lookbacks
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=${interval}&limit=${Math.min(limit, 1500)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    if (res.status === 451) {
      throw new GeoBlockedError(
        `Binance Perps is geo-blocked in your region (HTTP 451). Use Auto mode or pick another source.`,
        'binance_perps'
      );
    }
    return null;
  }
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;

  return data.map(c => ({
    ts: parseInt(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    vol: parseFloat(c[5])
  }));
}

// ── KRAKEN xStocks (Traditional Markets) ─────────────────────────────────────
// Kraken xStocks are tokenized stocks/ETFs traded on Kraken
// Format: XXBT (Bitcoin), XETH (Ethereum), etc. - xStocks use different format

const XSTOCKS_PAIR_MAP = {
  // Majors
  'SPY':  'SPYUSD',
  'QQQ':  'QQQUSD',
  'DIA':  'DIAUSD',
  'IWM':  'IWMUSD',
  'VTI':  'VTIUSD',
  'VEA':  'VEAUSD',
  'VWO':  'VWOUSD',
  'EEM':  'EEMUSD',
  // Sectors
  'XLK':  'XLKUSD',
  'XLF':  'XLFUSD',
  'XLV':  'XLVUSD',
  'XLY':  'XLYUSD',
  'XLP':  'XLPUSD',
  'XLE':  'XLEUSD',
  'XLI':  'XLIUSD',
  'XLRE': 'XLREUSD',
  'XLU':  'XLUUSD',
  'XLC':  'XLCUSD',
  'XLB':  'XLBUSD',
  // Styles
  'VUG':  'VUGUSD',
  'VTV':  'VTVUSD',
  'VO':   'VOUSD',
  'VB':   'VBUSD',
  'MTUM': 'MTUMUSD',
  'QUAL': 'QUALUSD',
  'VLUE': 'VLUEUSD',
  // Bonds
  'TLT':  'TLTUSD',
  'IEF':  'IEFUSD',
  'SHY':  'SHYUSD',
  'BND':  'BNDUSD',
  'AGG':  'AGGUSD',
  'LQD':  'LQDUSD',
  'HYG':  'HYGUSD',
  'MUB':  'MUBUSD',
  // Commodities
  'GLD':  'GLDUSD',
  'SLV':  'SLVUSD',
  'USO':  'USOUSD',
  'UNG':  'UNGUSD',
  'DBA':  'DBAUSD',
  // Risk
  'VIXY': 'VIXYUSD',
  'UVXY': 'UVXYUSD',
  'SPLV': 'SPLVUSD',
  'USMV': 'USMVUSD',
  // Crypto-related
  'GBTC': 'GBTCUSD',
  'ETHE': 'ETHEUSD',
  'COIN': 'COINUSD',
  'MSTR': 'MSTRUSD',
  'IBIT': 'IBITUSD',
  'FBTC': 'FBTCUSD',
  // Thematic
  'ARKK': 'ARKKUSD',
  'SOXX': 'SOXXUSD',
  'SMH':  'SMHUSD',
  'ICLN': 'ICLNUSD',
};

async function fetchXStocksCandles(symbol, timeframe = '1D', limit = 300) {
  const pair = XSTOCKS_PAIR_MAP[symbol];
  if (!pair) {
    // Try common Kraken format
    const altPair = `${symbol}USD`;
    const url = `https://api.kraken.com/0/public/OHLC?pair=${altPair}&interval=1440&since=${Math.floor(Date.now() / 1000) - limit * 86400}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error?.length) return null;
    const key = Object.keys(json.result || {}).find(k => k !== 'last');
    if (!key) return null;
    const candles = json.result[key];
    if (!candles?.length) return null;
    return candles.map(c => ({
      ts: c[0] * 1000,
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol: parseFloat(c[6])
    }));
  }

  const interval = KRAKEN_INTERVAL_MAP[timeframe] || 1440;
  const since = Math.floor(Date.now() / 1000) - (limit * interval * 60);
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}&since=${since}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error?.length) {
      console.warn(`xStocks error for ${symbol}:`, json.error);
      return null;
    }
    const key = Object.keys(json.result || {}).find(k => k !== 'last');
    if (!key) return null;
    const candles = json.result[key];
    if (!candles?.length) return null;
    return candles.map(c => ({
      ts: c[0] * 1000,
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol: parseFloat(c[6])
    }));
  } catch (e) {
    console.warn(`xStocks fetch error for ${symbol}:`, e.message);
    return null;
  }
}

// Audit F-14-e-10 (2026-08-26): the MASSIVE (Polygon) block —
// `MASSIVE_INTERVAL_MAP`, `toMassiveTicker`, `fetchMassiveCandles` —
// was dead code (zero callers across src/). The canonical Polygon path now
// lives in `src/lib/scanner/sources/massive.js` (exported via sourceResolver).

function getIntervalMs(timeframe) {
  const map = {
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1H': 60 * 60 * 1000,
    '4H': 4 * 60 * 60 * 1000,
    '12H': 12 * 60 * 60 * 1000,
    '1D': 24 * 60 * 60 * 1000,
  };
  return map[timeframe] || 4 * 60 * 60 * 1000;
}

// ── 24H CHANGE ───────────────────────────
export async function fetch24hChange(symbol, exchange, candles) {
  try {
    // For 'auto' or resolver-based sources, derive 24h change from fetched candles
    // NOTE: 'binance_perps' is intentionally NOT in this list — it has a dedicated
    // ticker endpoint below that returns the precise rolling 24h change (audit F-14-e-4).
    if (!exchange || exchange === 'auto' || exchange === 'massive' ||
        ['hyperliquid', 'bybit', 'coingecko', 'lighter'].includes(exchange)) {
      if (candles && candles.length >= 2) {
        const now = Date.now();
        const target = now - 24 * 60 * 60 * 1000;
        let best = candles[0];
        for (const c of candles) {
          if (Math.abs(c.ts - target) < Math.abs(best.ts - target)) best = c;
        }
        const open24h = best.open;
        const lastClose = candles[candles.length - 1].close;
        return ((lastClose - open24h) / open24h) * 100;
      }
      return null;
    }
    if (exchange === 'binance_perps') {
      const res = await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}USDT`);
      if (!res.ok) return null;
      const d = await res.json();
      return parseFloat(d.priceChangePercent);
    } else if (exchange === 'binance') {
      const res = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`);
      if (!res.ok) return null;
      const d = await res.json();
      return parseFloat(d.priceChangePercent);
    } else if (exchange === 'okx_perps') {
      const res = await fetchWithTimeout(`https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT-SWAP`);
      if (!res.ok) return null;
      const json = await res.json();
      const d = json.data?.[0];
      if (!d) return null;
      return ((parseFloat(d.last) - parseFloat(d.open24h)) / parseFloat(d.open24h)) * 100;
    } else if (exchange === 'okx') {
      const res = await fetchWithTimeout(`https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT`);
      if (!res.ok) return null;
      const json = await res.json();
      const d = json.data?.[0];
      if (!d) return null;
      return ((parseFloat(d.last) - parseFloat(d.open24h)) / parseFloat(d.open24h)) * 100;
    } else if (exchange === 'kraken') {
      // Derive 24h change from candles already fetched (avoid extra API call)
      // Kraken's Ticker endpoint gives today's open vs last price
      if (candles && candles.length >= 2) {
        // Find the candle closest to 24h ago
        const now = Date.now();
        const target = now - 24 * 60 * 60 * 1000;
        let best = candles[0];
        for (const c of candles) {
          if (Math.abs(c.ts - target) < Math.abs(best.ts - target)) best = c;
        }
        const open24h = best.open;
        const lastClose = candles[candles.length - 1].close;
        return ((lastClose - open24h) / open24h) * 100;
      }
      // Fallback: Kraken ticker
      try {
        const pairMap = await loadKrakenPairs();
        const entry = pairMap[symbol];
        if (!entry) return null;
        const res = await fetchWithTimeout(`https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(entry.name)}`);
        if (!res.ok) return null;
        const json = await res.json();
        if (json.error?.length) return null;
        const key = Object.keys(json.result || {})[0];
        const d = json.result?.[key];
        if (!d) return null;
        // d.o = today's opening price, d.c[0] = last trade price
        const openPrice = parseFloat(d.o);
        const lastPrice = parseFloat(d.c?.[0]);
        return ((lastPrice - openPrice) / openPrice) * 100;
      } catch { return null; }
    }
  } catch {
    return null;
  }
  return null;
}

// ── DISPATCHER ───────────────────────────
//
// Two modes:
//
// 1. EXPLICIT mode (legacy): pass exchange='okx_perps' etc. — uses that single source.
//    Backward-compatible with existing Scanner/Board UIs.
//
// 2. AUTO mode (new): pass exchange='auto' (or omit) — delegates to sourceResolver
//    which tries multiple sources in priority order with automatic fallback.
//    This is the new default; no API key required.
//
export async function fetchCandles(symbol, exchange, timeframe = '4H', limit = 300, minCandles) {
  // AUTO mode — delegate to resolver
  if (!exchange || exchange === 'auto' || exchange === 'massive') {
    // 'massive' is now an alias for AUTO — Massive key is broken per diagnosis;
    // resolver routes to working free sources instead.
    const opts = { timeframe, limit };
    if (minCandles != null) opts.minCandles = minCandles;
    const { candles } = await resolveCandles(symbol, opts);
    return candles;
  }

  // Explicit mode — single source (legacy behavior preserved).
  // `limit` is optional and defaults to 300 (previous hard ceiling), so all
  // pre-existing callers are unaffected. Deep VWAP lookbacks (up to 365d,
  // 2026-09-08) pass a larger limit; each source clamps to its own API max.
  if (exchange === 'okx') return await fetchOKXSpotCandles(symbol, timeframe, limit);
  if (exchange === 'okx_perps') return await fetchOKXPerpsCandles(symbol, timeframe, limit);
  if (exchange === 'kraken') return await fetchKrakenCandles(symbol, timeframe, limit);
  if (exchange === 'binance') return await fetchBinanceCandles(symbol, timeframe, limit);
  // binance_perps now routes through the resolver — the new binancePerps.js
  // source handles 1000x/1000000x prefix normalization (XEC→1000XEC, etc.)
  // which the legacy fetchBinancePerpsCandles didn't, causing silent failures
  // for low-priced tokens. Legacy function kept for fallback in case the
  // resolver is unavailable, but not used in the normal flow.
  // New resolver-based sources — route through resolver with preferredSource
  // (gate and kucoin were removed: their public APIs are CORS-blocked for
  // browser-side fetches. The sourceResolver no longer imports them.)
  if (['hyperliquid', 'bybit', 'coingecko', 'binance_perps'].includes(exchange)) {
    const opts = { timeframe, limit, preferredSource: exchange };
    if (minCandles != null) opts.minCandles = minCandles;
    const { candles } = await resolveCandles(symbol, opts);
    return candles;
  }
  return null;
}

// Lazy import to avoid circular dependency
let _resolveCandles = null;
async function resolveCandles(symbol, opts) {
  if (!_resolveCandles) {
    const mod = await import('./sourceResolver.js');
    _resolveCandles = mod.fetchCandles;
  }
  const { candles } = await _resolveCandles(symbol, opts);
  return { candles };
}
// Export xStocks fetcher for traditional market data
export async function fetchXStocksCandlesExport(symbol, timeframe = '1D', limit = 300) {
  return await fetchXStocksCandles(symbol, timeframe, limit);
}

export async function preloadExchange(exchange) {
  if (exchange === 'okx') await loadOKXSpotInstruments();
  if (exchange === 'okx_perps') await loadOKXPerpsInstruments();
  if (exchange === 'kraken') await loadKrakenPairs();
}

// ── TOP 500 ──────────────────────────────────────────────────────────────────
// Snapshot-first: reads `crypto_universe` from /snapshot.json (built server-side
// by build_snapshot.js using CMC_API_KEY, refreshed 4× daily via Cloudflare
// Worker cron). Live fallbacks (CMC → CoinGecko → CoinCap → Binance) only fire
// when snapshot is missing or stale. This avoids CoinGecko 429s on every scan.
import { STABLECOINS, WRAPPED, TOKENIZED_TAGS, NON_CRYPTO_NAME_KEYWORDS } from './constants';

/**
 * Heuristic filter for USD-pegged tokens not in the hardcoded STABLECOINS set.
 * Catches new stablecoins (RLUSD, USDG, USAT, etc.) by checking symbol pattern
 * + name keywords. Extracted to a named function so it's reusable across
 * snapshot + live fetch paths.
 */
function isUsdPeggedHeuristic(symbol, name) {
  const sym = symbol.toUpperCase();
  if (/^USD[A-Z]?$/.test(sym) || /^[A-Z]USD$/.test(sym) || sym.includes('USD')) {
    const nameLower = (name || '').toLowerCase();
    if (nameLower.includes('dollar') || nameLower.includes('stable') ||
        nameLower.includes('usd') || nameLower.includes('peg')) {
      return true;
    }
  }
  return false;
}

/**
 * Heuristic filter for non-crypto / wrapped / tokenized assets that slip into
 * the universe from CMC's "cryptocurrency_type=all" parameter or from live
 * fallback sources (CoinCap, Binance 24hr ticker).
 *
 * Catches:
 *   - Tokenized stocks (NVDAON, NVDAX, TSLAX, bNVDA, etc.)
 *   - Wrapped Beacon ETH (WBETH) and other wrapped variants not in WRAPPED set
 *   - Synthetic assets
 *
 * Used as a fallback when the asset has no CMC tags (live sources don't
 * supply them). The snapshot-first path uses the more reliable tag-based
 * filter in `hasTokenizedTags` below.
 */
function isNonCryptoHeuristic(symbol, name) {
  const nameLower = (name || '').toLowerCase();
  return NON_CRYPTO_NAME_KEYWORDS.some(kw => nameLower.includes(kw));
}

/**
 * Tag-based filter for tokenized / synthetic assets. Snapshot path supplies
 * CMC tags so this is more reliable than the name heuristic — it catches
 * xStocks even when the name doesn't include "xstock" or "tokenized".
 */
function hasTokenizedTags(tags) {
  if (!Array.isArray(tags)) return false;
  return tags.some(t => TOKENIZED_TAGS.has(t));
}

/**
 * Apply the standard universe filters: stablecoins, wrapped tokens, USD-pegged
 * heuristic, tokenized-stock tags, and non-crypto name heuristic. Returns the
 * filtered array (caller decides on .slice cap).
 *
 * Each asset may optionally carry `tags` (array of CMC tag slugs) and `name`.
 * Live fallback sources that don't supply tags fall back to the name-based
 * heuristic for tokenized-stock detection.
 */
function filterUniverse(assets) {
  return assets.filter(a => {
    if (STABLECOINS.has(a.symbol) || WRAPPED.has(a.symbol)) return false;
    if (isUsdPeggedHeuristic(a.symbol, a.name)) return false;
    if (hasTokenizedTags(a.tags)) return false;
    if (isNonCryptoHeuristic(a.symbol, a.name)) return false;
    return true;
  });
}

export async function fetchTop500(cgKey) {
  // ── 1. Snapshot-first (instant, no rate limit) ──────────────────────────
  // The snapshot's crypto_universe is built server-side by build_snapshot.js
  // using CMC (preferred) or CoinGecko, refreshed 4× daily. Reading from
  // snapshot avoids hammering CoinGecko from every browser session.
  try {
    const res = await fetchWithTimeout('/snapshot.json');
    if (res.ok) {
      const snap = await res.json();
      const universe = snap?.crypto_universe;
      if (universe && typeof universe === 'object') {
        const assets = Object.values(universe)
          .filter(c => c && c.symbol)
          .sort((a, b) => (a.marketCapRank || 999) - (b.marketCapRank || 999))
          .map(c => ({
            symbol: c.symbol,
            name: c.name,
            rank: c.marketCapRank || 999,
            // Preserve CMC tags so filterUniverse can exclude tokenized stocks
            // (NVDAON, NVDAX, TSLAX, etc.) by their `tokenized-stock` /
            // `xstocks-ecosystem` / `bstocks` tags. Without tags, the name-based
            // heuristic is the only fallback and it can't catch every case.
            tags: Array.isArray(c.tags) ? c.tags : [],
          }));
        const filtered = filterUniverse(assets).slice(0, 500);
        if (filtered.length >= 400) {
          console.info(`Snapshot supplied ${filtered.length} assets (crypto_universe)`);
          return filtered;
        }
        console.warn(`Snapshot universe too small (${filtered.length} < 400), falling back to live`);
      }
    }
  } catch (e) {
    console.warn('Snapshot universe fetch failed, falling back to live:', e.message);
  }

  let assets = [];

  // ── 2. CoinMarketCap (if user has CMC_API_KEY in localStorage) ──────────
  // Best live option — 1 credit for 500 coins, industry-standard rankings.
  const cmcKey = typeof window !== 'undefined' && localStorage.getItem('CMC_API_KEY');
  if (cmcKey) {
    try {
      const res = await fetchWithTimeout(
        'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=500&sort=market_cap_strict&sort_dir=desc&cryptocurrency_type=all',
        { headers: { 'X-CMC_PRO_API_KEY': cmcKey } }
      );
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          json.data.forEach(c => {
            assets.push({
              symbol: c.symbol.toUpperCase(),
              name: c.name,
              rank: c.cmc_rank || assets.length + 1,
              // Preserve CMC tags so tokenized stocks (NVDAON, NVDAX, etc.)
              // can be filtered out by filterUniverse. CMC's listings endpoint
              // returns tags as an array of slug strings.
              tags: Array.isArray(c.tags) ? c.tags : [],
            });
          });
          console.info(`CMC supplied ${assets.length} assets`);
        }
      }
    } catch (e) {
      console.warn('CMC failed, trying CoinGecko...', e.message);
    }
  }

  // ── 3. CoinGecko (free, 2 pages × 250 = 500 raw) ────────────────────────
  if (assets.length < 400) {
    try {
      const fresh = [];
      for (let page = 1; page <= 2; page++) {
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`;
        const headers = cgKey ? { 'x-cg-demo-api-key': cgKey } : {};
        const res = await fetchWithTimeout(url, { headers });
        if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('Unexpected response');
        data.forEach(coin => fresh.push({
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          rank: fresh.length + 1,
        }));
        if (page < 2) await sleep(1300);
      }
      if (fresh.length > assets.length) assets = fresh;
    } catch (e) {
      console.warn('CoinGecko failed, trying CoinCap...', e.message);
    }
  }

  // ── 4. CoinCap backup (limit=500, free, no key) ─────────────────────────
  if (assets.length < 400) {
    try {
      const res = await fetchWithTimeout('https://api.coincap.io/v2/assets?limit=500');
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          assets = json.data.map((coin, i) => ({
            symbol: coin.symbol.toUpperCase(),
            name: coin.name,
            rank: i + 1,
          }));
          console.info(`CoinCap supplied ${assets.length} assets`);
        }
      }
    } catch (e) {
      console.warn('CoinCap backup failed, trying Binance...', e.message);
    }
  }

  // ── 5. Binance volume fallback (last resort) ────────────────────────────
  if (assets.length < 400) {
    try {
      const res = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/24hr');
      if (res.ok) {
        const data = await res.json();
        const tickers = data
          .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1000000)
          .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
          .slice(0, 500);

        tickers.forEach((t) => {
          const sym = t.symbol.replace('USDT', '');
          if (!assets.some(a => a.symbol === sym)) {
            assets.push({ symbol: sym, name: sym, rank: assets.length + 1 });
          }
        });
      }
    } catch (e) {
      console.warn('Binance backup also failed', e);
    }
  }

  return filterUniverse(assets).slice(0, 500);
}

// Audit F-14-e-10 (2026-08-26): `export const fetchTop300 = fetchTop500;`
// removed — zero callers. Use `fetchTop500` directly.