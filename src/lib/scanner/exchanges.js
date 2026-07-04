const sleep = ms => new Promise(r => setTimeout(r, ms));

// How many candles make up one "day" for each timeframe
export const CANDLES_PER_DAY = {
  '15m': 96,
  '30m': 48,
  '1H': 24,
  '4H': 6,
  '12H': 2,
  '1D': 1,
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
  const res = await fetch('https://www.okx.com/api/v5/public/instruments?instType=SPOT');
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
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${limit}`;
  const res = await fetch(url);
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

// ── OKX PERPETUALS ──────────────────────────────────
let _okxPerpsInstruments = null;

async function loadOKXPerpsInstruments() {
  if (_okxPerpsInstruments) return _okxPerpsInstruments;
  const res = await fetch('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
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
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${limit}`;
  const res = await fetch(url);
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
  const res = await fetch(url);
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
  const res = await fetch('https://api.kraken.com/0/public/AssetPairs');
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

async function fetchKrakenCandles(symbol, timeframe = '4H') {
  const pairMap = await loadKrakenPairs();
  const entry = pairMap[symbol];
  if (!entry) return null;

  const interval = KRAKEN_INTERVAL_MAP[timeframe] || 240;
  // fetch enough history: 300 bars
  const since = Math.floor(Date.now() / 1000) - (300 * interval * 60);
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(entry.name)}&interval=${interval}&since=${since}`;
  const res = await fetch(url);
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
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return null;
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
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return null;
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
    const res = await fetch(url);
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
    const res = await fetch(url);
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

// ── MASSIVE (POLYGON) ─────────────────────
const MASSIVE_INTERVAL_MAP = {
  '15m': { multiplier: 15, timespan: 'minute' },
  '30m': { multiplier: 30, timespan: 'minute' },
  '1H': { multiplier: 1, timespan: 'hour' },
  '4H': { multiplier: 4, timespan: 'hour' },
  '12H': { multiplier: 12, timespan: 'hour' },
  '1D': { multiplier: 1, timespan: 'day' },
};

function toMassiveTicker(symbol) {
  return `X:${symbol}USD`;
}

async function fetchMassiveCandles(symbol, timeframe = '4H', limit = 300) {
  // Check localStorage first (runtime), then environment variable (build-time fallback)
  const apiKey = typeof window !== 'undefined'
    ? (localStorage.getItem('MASSIVE_API_KEY') || import.meta.env?.VITE_MASSIVE_API_KEY)
    : import.meta.env?.VITE_MASSIVE_API_KEY;

  if (!apiKey) {
    console.warn('Massive API key not configured. Set MASSIVE_API_KEY in localStorage or VITE_MASSIVE_API_KEY in .env');
    return null;
  }

  const tf = MASSIVE_INTERVAL_MAP[timeframe] || MASSIVE_INTERVAL_MAP['4H'];
  const ticker = toMassiveTicker(symbol);

  // Calculate date range
  const to = new Date();
  const from = new Date(to.getTime() - (limit * getIntervalMs(timeframe)));

  const url = `https://api.massive.com/v2/aggs/ticker/${ticker}/range/${tf.multiplier}/${tf.timespan}/${from.toISOString()}/${to.toISOString()}?adjusted=false&sort=asc&limit=${limit}&apiKey=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Massive API error ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();
    if (data.status !== 'OK' || !data.results) {
      return null;
    }

    return data.results.map(candle => ({
      ts: candle.t,
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
      vol: candle.v,
      vwap: candle.vw,
    }));
  } catch (error) {
    console.warn(`Massive fetch error for ${symbol}:`, error.message);
    return null;
  }
}

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
      const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}USDT`);
      if (!res.ok) return null;
      const d = await res.json();
      return parseFloat(d.priceChangePercent);
    } else if (exchange === 'binance') {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`);
      if (!res.ok) return null;
      const d = await res.json();
      return parseFloat(d.priceChangePercent);
    } else if (exchange === 'okx_perps') {
      const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT-SWAP`);
      if (!res.ok) return null;
      const json = await res.json();
      const d = json.data?.[0];
      if (!d) return null;
      return ((parseFloat(d.last) - parseFloat(d.open24h)) / parseFloat(d.open24h)) * 100;
    } else if (exchange === 'okx') {
      const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT`);
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
        const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(entry.name)}`);
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
export async function fetchCandles(symbol, exchange, timeframe = '4H') {
  // AUTO mode — delegate to resolver
  if (!exchange || exchange === 'auto' || exchange === 'massive') {
    // 'massive' is now an alias for AUTO — Massive key is broken per diagnosis;
    // resolver routes to working free sources instead.
    const { candles } = await resolveCandles(symbol, { timeframe });
    return candles;
  }

  // Explicit mode — single source (legacy behavior preserved)
  if (exchange === 'okx') return await fetchOKXSpotCandles(symbol, timeframe);
  if (exchange === 'okx_perps') return await fetchOKXPerpsCandles(symbol, timeframe);
  if (exchange === 'kraken') return await fetchKrakenCandles(symbol, timeframe);
  if (exchange === 'binance') return await fetchBinanceCandles(symbol, timeframe);
  if (exchange === 'binance_perps') return await fetchBinancePerpsCandles(symbol, timeframe);
  // New resolver-based sources — route through resolver with preferredSource
  // (gate and kucoin were removed: their public APIs are CORS-blocked for
  // browser-side fetches. The sourceResolver no longer imports them.)
  if (['hyperliquid', 'bybit', 'coingecko'].includes(exchange)) {
    const { candles } = await resolveCandles(symbol, { timeframe, preferredSource: exchange });
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

// ── TOP 300 ──────────────────────────────
import { STABLECOINS, WRAPPED } from './constants';

export async function fetchTop300(cgKey) {
  let assets = [];

  // 1. Try CoinGecko
  try {
    for (let page = 1; page <= 2; page++) {
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`;
      const headers = cgKey ? { 'x-cg-demo-api-key': cgKey } : {};
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected response');
      data.forEach(coin => assets.push({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        rank: assets.length + 1
      }));
      if (page < 2) await sleep(1300);
    }
  } catch (e) {
    console.warn('CoinGecko failed, trying CoinCap...', e.message);
    assets = [];
  }

  // 2. CoinCap backup
  if (assets.length < 50) {
    try {
      const res = await fetch('https://api.coincap.io/v2/assets?limit=300');
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          json.data.forEach((coin, i) => {
            assets.push({
              symbol: coin.symbol.toUpperCase(),
              name: coin.name,
              rank: i + 1
            });
          });
          console.info(`CoinCap supplied ${assets.length} assets`);
        }
      }
    } catch (e) {
      console.warn('CoinCap backup failed, trying Binance...', e.message);
    }
  }

  // 3. Binance volume fallback
  if (assets.length < 50) {
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      if (res.ok) {
        const data = await res.json();
        const tickers = data
          .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1000000)
          .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
          .slice(0, 350);

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

  return assets
    .slice(0, 300)
    .filter(a => {
      // Filter out known stablecoins and wrapped tokens
      if (STABLECOINS.has(a.symbol) || WRAPPED.has(a.symbol)) return false;
      // Heuristic: also filter USD-pegged tokens not in the hardcoded list
      // (catches new stablecoins like RLUSD, USDG, USAT, etc.)
      const sym = a.symbol.toUpperCase();
      if (/^USD[A-Z]?$/.test(sym) || /^[A-Z]USD$/.test(sym) || sym.includes('USD')) {
        // If the name contains 'dollar', 'stable', or it's priced near $1.00, filter it
        const nameLower = (a.name || '').toLowerCase();
        if (nameLower.includes('dollar') || nameLower.includes('stable') ||
            nameLower.includes('usd') || nameLower.includes('peg')) {
          return false;
        }
      }
      return true;
    });
}