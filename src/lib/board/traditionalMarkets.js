// ── Snapshot data — instant first paint from pre-built Yahoo Finance data ────
// The daily build_snapshot.js fetches all tradfi OHLCV from Yahoo Finance
// (server-side, no CORS) and stores it in snapshot.tradfi.json (sharded
// out of the main snapshot.json to keep first paint lean — tradfi_ohlcv
// alone is ~13 MB). This function reads that data and builds a complete
// tradData result instantly — no API calls, no rate limits, no waiting.
// The live fetchTradMarketData() can then refresh with fresh data in the
// background.

let _snapshotCache = null;
async function loadSnapshotTradfi() {
  if (_snapshotCache) return _snapshotCache;
  try {
    const res = await fetch('/snapshot.tradfi.json');
    if (!res.ok) return null;
    const snap = await res.json();
    _snapshotCache = snap?.tradfi_ohlcv || null;
    return _snapshotCache;
  } catch {
    return null;
  }
}

function candlesFromSnapshot(snapData) {
  // Convert compact {t,o,h,l,c,v} to {ts,open,high,low,close,vol}
  if (!snapData || !Array.isArray(snapData)) return null;
  return snapData.map(c => ({
    ts: c.t, open: c.o, high: c.h, low: c.l, close: c.c, vol: c.v,
  }));
}

// Build a complete tradData result from snapshot data — instant, no API calls
export async function buildTradDataFromSnapshot() {
  const snapOHLCV = await loadSnapshotTradfi();
  if (!snapOHLCV || Object.keys(snapOHLCV).length === 0) return null;

  const rawResults = [];
  for (const asset of TRAD_UNIVERSE) {
    const snapCandles = snapOHLCV[asset.symbol];
    if (!snapCandles || snapCandles.length < 5) {
      rawResults.push({ asset, metrics: null, source: 'none' });
      continue;
    }
    const candles = candlesFromSnapshot(snapCandles);
    rawResults.push({ asset, metrics: computeTradMetrics(candles), source: 'snapshot' });
  }

  return buildTradResult(rawResults, {});
}

// ── Yahoo Finance via Cloudflare Worker proxy (live data, no rate limit) ─────
// When deployed, this provides unlimited live tradfi OHLCV from Yahoo Finance.
// The proxy is needed because Yahoo doesn't send CORS headers.
// Configure: localStorage.setItem('YAHOO_PROXY_URL', 'https://your-worker.workers.dev')
// Or: VITE_YAHOO_PROXY_URL in GitHub Actions secrets
function getYahooProxyUrl() {
  if (typeof window !== 'undefined') {
    const local = localStorage.getItem('YAHOO_PROXY_URL');
    if (local) return local;
  }
  return import.meta.env?.VITE_YAHOO_PROXY_URL || 'https://trendscan-yahoo-proxy.drew-724.workers.dev';
}

// Yahoo symbol formatting (BRK.B → BRK-B, forex, metals, indices)
const YAHOO_FOREX_MAP = {
  'EURUSD':'EURUSD=X','GBPUSD':'GBPUSD=X','USDJPY':'JPY=X','USDCHF':'CHF=X',
  'USDCAD':'CAD=X','AUDUSD':'AUDUSD=X','NZDUSD':'NZDUSD=X','USDKRW':'KRW=X','USDHKD':'HKD=X',
};
function toYahooSymbol(symbol) {
  const s = symbol.toUpperCase();
  if (YAHOO_FOREX_MAP[s]) return YAHOO_FOREX_MAP[s];
  if (s === 'XAU') return 'GC=F';  // Gold futures
  if (s === 'XAG') return 'SI=F';  // Silver futures
  if (s.includes('.')) return s.replace('.', '-');  // BRK.B → BRK-B
  return s;
}

async function fetchYahooProxyCandles(symbol, limit = 300) {
  const proxyUrl = getYahooProxyUrl();
  if (!proxyUrl) return null;
  const ySymbol = toYahooSymbol(symbol);
  const url = `${proxyUrl}/chart/${encodeURIComponent(ySymbol)}?range=1y&interval=1d`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    const result = d?.chart?.result?.[0];
    if (!result?.timestamp) return null;
    const q = result.indicators?.quote?.[0];
    if (!q) return null;
    const candles = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      if (q.close?.[i] == null) continue;
      candles.push({
        ts: result.timestamp[i] * 1000,
        open: q.open?.[i] ?? q.close[i],
        high: q.high?.[i] ?? q.close[i],
        low: q.low?.[i] ?? q.close[i],
        close: q.close[i],
        vol: q.volume?.[i] ?? 0,
      });
    }
    return candles.slice(-limit);
  } catch { return null; }
}

// Direct Lighter API access (bypasses resolver for reliability)
const LIGHTER_API = 'https://mainnet.zklighter.elliot.ai/api/v1';
const LIGHTER_EXPLORER = 'https://explorer.elliot.ai/api';

// Known market IDs — used directly without API lookup
const LIGHTER_MARKET_IDS = {
  SPY:128, QQQ:129, DIA:152, IWM:153, US500:180, US100:181,
  NVDA:110, AAPL:113, MSFT:115, GOOGL:116, META:117, AMZN:114,
  AMD:138, AVGO:210, MRVL:174, DELL:187, ARM:206, TSM:168, CRWV:167, NBIS:189,
  ASML:151, INTC:137, QCOM:209, SOXL:197, SOXX:169,
  MU:164, SNDK:139, LITE:178, AAOI:207,
  S:40, NOW:191, ORCL:165, IBM:188,
  COIN:109, MSTR:122, HOOD:108, CRCL:121,
  TSLA:112, ROBO:149, RKLB:186, URA:150,
  WTI:145, BRENTOIL:159, NATGAS:158,
  XAU:92, XAG:93, XCU:136, XPD:146, XPT:147, XPL:71, PAXG:48,
  BABA:177, TENCENT:201, XIAOMI:203, POPMART:204,
  SAMSUNG:140, SAMSUNGUSD:162, SKHYNIX:143, SKHYNIXUSD:161,
  HYUNDAI:141, HYUNDAIUSD:160, KRCOMP:142, BYD:205, EWY:166,
  OPENAI:192, ANTHROPIC:193, SPACEX:173, MINIMAX:199,
  GME:176, TTWO:179, IP:34, NOK:208,
  WHEAT:170, MAGS:155, BOTZ:154,
  EURUSD:96, GBPUSD:97, USDJPY:98, USDCHF:99, USDCAD:100,
  AUDUSD:106, NZDUSD:103, USDKRW:101, USDHKD:104,
  // Additional tradfi markets on Lighter
  CC:101, NMR:74, QNT:190, SMIC:202, SPCX:194, SPX:42, STRC:156,
  STABLE:118, STBL:85, WLFI:72, YZY:70, ZHIPU:205, ADI:213,
};

let _lighterMarketMap = null;
async function getLighterMarketId(symbol) {
  const s = symbol.toUpperCase();
  if (LIGHTER_MARKET_IDS[s]) return LIGHTER_MARKET_IDS[s];
  if (!_lighterMarketMap) {
    try {
      const res = await fetch(`${LIGHTER_EXPLORER}/markets`);
      if (res.ok) {
        const arr = await res.json();
        _lighterMarketMap = {};
        for (const m of arr) {
          const sym = (m.symbol || '').toUpperCase();
          if (sym) _lighterMarketMap[sym] = m.market_index;
        }
      }
    } catch {}
  }
  return _lighterMarketMap?.[s] || null;
}

async function fetchLighterCandles(symbol, limit = 300) {
  const marketId = await getLighterMarketId(symbol);
  if (marketId == null) return null;
  const now = Date.now();
  const start = now - limit * 86400000;
  const url = `${LIGHTER_API}/candles?market_id=${marketId}&resolution=1d` +
              `&start_timestamp=${start}&end_timestamp=${now}` +
              `&count_back=${limit}&set_timestamp_to_end=true`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code !== 200 || !Array.isArray(d.c)) return null;
    return d.c.map(c => ({
      ts: c.t, open: c.o, high: c.h, low: c.l, close: c.c, vol: c.v,
    }));
  } catch { return null; }
}

// OKX SWAP perps — expanded from 7 to 16 tradfi tickers (verified Jul 2026)
const OKX_TRADFI = new Set([
  'SPY','QQQ','NVDA','TSLA','AAPL','XAU','XAG',   // original 7
  'COIN','MSTR','HOOD','GME','PLTR','IWM',         // stocks
  'XCU','XPD','XPT',                                // metals
]);
async function fetchOkxTradfiCandles(symbol, limit = 300) {
  if (!OKX_TRADFI.has(symbol.toUpperCase())) return null;
  const instId = `${symbol.toUpperCase()}-USDT-SWAP`;
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=1D&limit=${Math.min(limit, 300)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.code !== '0' || !Array.isArray(d.data)) return null;
    return d.data.slice().reverse().map(c => ({
      ts: parseInt(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), vol: parseFloat(c[5]),
    }));
  } catch { return null; }
}

// ── Massive / Polygon.io — broadest stock/ETF coverage ───────────────────────
// Free tier: ~5 req/min. Paid tier: unlimited.
// Rate limit detection: when 429 is received, sets a cooldown period.
const MASSIVE_KEY = import.meta.env?.VITE_MASSIVE_API_KEY || '';
let _massiveRateLimitedUntil = 0;  // timestamp when cooldown ends
const MASSIVE_COOLDOWN_MS = 12_000;  // 12s cooldown after 429 (allows ~5 req/min)

async function fetchMassiveTradCandles(symbol, limit = 300) {
  // Check cooldown — skip entirely if recently rate-limited
  if (Date.now() < _massiveRateLimitedUntil) return null;

  let apiKey = MASSIVE_KEY;
  if (!apiKey && typeof window !== 'undefined') {
    apiKey = localStorage.getItem('MASSIVE_API_KEY') || '';
  }
  if (!apiKey) return null;

  const s = symbol.toUpperCase();
  let ticker = s;
  // Forex
  const TD_FOREX_M = new Set(['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDKRW','USDHKD']);
  if (TD_FOREX_M.has(s)) ticker = `C:${s}`;
  // Metals
  else if (['XAU','XAG','XCU','XPD','XPT'].includes(s)) ticker = `C:${s}USD`;
  // Indices
  else if (['SPX','NDX','VIX','DJI'].includes(s)) ticker = `I:${s}`;

  const to = new Date();
  const from = new Date(to.getTime() - limit * 86_400_000);
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from.toISOString().slice(0,10)}/${to.toISOString().slice(0,10)}?adjusted=true&sort=asc&limit=${Math.min(limit, 500)}&apiKey=${apiKey}`;
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      // Rate limited — set cooldown
      _massiveRateLimitedUntil = Date.now() + MASSIVE_COOLDOWN_MS;
      return null;
    }
    if (!res.ok) return null;
    const d = await res.json();
    if (d.status !== 'OK' || !Array.isArray(d.results)) return null;
    return d.results.map(c => ({
      ts: c.t, open: c.o, high: c.h, low: c.l, close: c.c, vol: c.v || 0,
    }));
  } catch { return null; }
}

// ── Kraken — limited tradfi coverage but free, no key needed ─────────────────
// Kraken recently expanded stock listings. Uses OHLC endpoint with USD pairs.
const KRAKEN_TRADFI = new Set([
  // Verified USD pairs on Kraken (Jul 2026) — some overlap with crypto names
  'ADI','BAND','CAT','CORN','CVX','DASH','IP','QTUM','ROBO','S','STX',
]);

async function fetchKrakenTradCandles(symbol, limit = 300) {
  if (!KRAKEN_TRADFI.has(symbol.toUpperCase())) return null;
  const pair = `${symbol.toUpperCase()}USD`;
  const now = Math.floor(Date.now() / 1000);
  const since = now - limit * 86400;
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1440&since=${since}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.error?.length) return null;
    const key = Object.keys(d.result).find(k => k !== 'last');
    if (!key) return null;
    return d.result[key].map(c => ({
      ts: parseInt(c[0]) * 1000, open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), vol: parseFloat(c[6]),
    }));
  } catch { return null; }
}

async function fetchTradfiCandles(symbol, limit = 300) {
  // Fast path: Lighter (no rate limit, ~95 tickers)
  const s = symbol.toUpperCase();
  if (LIGHTER_MARKET_IDS[s]) {
    const candles = await fetchLighterCandles(symbol, limit);
    if (candles && candles.length >= 5) return candles;
  }

  // OKX (no rate limit, 16 tickers)
  let okxCandles = await fetchOkxTradfiCandles(symbol, limit);
  if (okxCandles && okxCandles.length >= 5) return okxCandles;

  // Kraken (no rate limit, 11 tickers)
  let krakenCandles = await fetchKrakenTradCandles(symbol, limit);
  if (krakenCandles && krakenCandles.length >= 5) return krakenCandles;

  // Yahoo Finance via Cloudflare Worker (no rate limit, ALL US stocks/ETFs)
  // Only available if the proxy URL is configured — see cloudflare/yahoo-proxy-worker.js
  let yahooCandles = await fetchYahooProxyCandles(symbol, limit);
  if (yahooCandles && yahooCandles.length >= 5) return yahooCandles;

  // Massive/Polygon (rate limited ~5 req/min on free tier — has cooldown)
  if (Date.now() >= _massiveRateLimitedUntil) {
    let massiveCandles = await fetchMassiveTradCandles(symbol, limit);
    if (massiveCandles && massiveCandles.length >= 5) return massiveCandles;
  }

  // Twelve Data (rate limited 8 req/min, 800/day — last resort)
  if (_tdCreditsUsed < _tdCreditsLimit) {
    let tdCandles = await fetchTwelveDataCandles(symbol, limit);
    if (tdCandles && tdCandles.length >= 5) return tdCandles;
  }

  return null;
}

// ── Twelve Data — full OHLC history for tickers not on Lighter ────────────────
// Free tier: 800 req/day, 8 req/min, 1 year daily history
// Covers US stocks, ETFs, forex, crypto — broader than Massive /prev
const TWELVEDATA_KEY = import.meta.env?.VITE_TWELVEDATA_KEY || '';
const TWELVEDATA_BASE = 'https://api.twelvedata.com';

// Twelve Data symbol formatting
const TD_FOREX = new Set(['EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDKRW','USDHKD']);
function formatTdSymbol(symbol) {
  const s = symbol.toUpperCase();
  if (s.includes('/')) return s;
  if (TD_FOREX.has(s)) return `${s.slice(0,3)}/${s.slice(3)}`;
  // Metals
  if (['XAU','XAG','XCU','XPD','XPT'].includes(s)) return `${s}/USD`;
  // Default: US stock/ETF (no suffix needed)
  return s;
}

// Twelve Data cache — 1 hour TTL (reduces API credit usage dramatically)
const _tdCache = new Map();
const TD_CACHE_TTL = 60 * 60 * 1000;  // 1 hour

// Rate limit tracking — Twelve Data free tier: 800 credits/day, 8 req/min
let _tdCreditsUsed = 0;
let _tdCreditsLimit = 800;
let _tdLastRequestTime = 0;
const TD_MIN_INTERVAL_MS = 7500;  // 8 req/min = 1 req per 7.5s

async function fetchTwelveDataCandles(symbol, limit = 300) {
  if (!TWELVEDATA_KEY) return null;

  // Check if we've exhausted daily credits
  if (_tdCreditsUsed >= _tdCreditsLimit) {
    console.warn('[twelvedata] Daily credit limit reached, skipping');
    return null;
  }

  // Check cache first
  const cacheKey = symbol.toUpperCase();
  const cached = _tdCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TD_CACHE_TTL) {
    return cached.data;
  }

  // Rate limit: enforce minimum interval between requests
  const now = Date.now();
  const elapsed = now - _tdLastRequestTime;
  if (elapsed < TD_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, TD_MIN_INTERVAL_MS - elapsed));
  }
  _tdLastRequestTime = Date.now();

  const tdSymbol = formatTdSymbol(symbol);
  const outputsize = Math.min(limit, 365);  // Free tier: 1 year max
  const url = `${TWELVEDATA_BASE}/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=1day&outputsize=${outputsize}&apikey=${TWELVEDATA_KEY}&format=JSON`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.status === 'error' || !d.values) {
      // Check for rate limit / credit exhaustion in error message
      const msg = d.message || '';
      if (msg.includes('run out of API credits') || msg.includes('limit')) {
        const match = msg.match(/(\d+) API credits were used.*?limit being (\d+)/);
        if (match) {
          _tdCreditsUsed = parseInt(match[1]);
          _tdCreditsLimit = parseInt(match[2]);
        } else {
          _tdCreditsUsed = _tdCreditsLimit;  // stop trying
        }
        console.warn(`[twelvedata] ${msg}`);
      }
      return null;
    }
    _tdCreditsUsed++;  // count successful request
    const candles = d.values.slice().reverse().map(c => ({
      ts: new Date(c.datetime).getTime(),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      vol: parseFloat(c.volume) || 0,
    }));
    // Cache the result
    _tdCache.set(cacheKey, { ts: Date.now(), data: candles });
    return candles;
  } catch { return null; }
}


// Comprehensive tradfi universe — ALL available tickers from Lighter + OKX SWAP perps
// Sources: Lighter (221 markets, ~97 tradfi) + OKX SWAP perps (7 tradfi)
// Updated: July 2026 — 374 assets across 19 sector baskets
// Macro tab uses this independent of cryptoUniverse

export const TRAD_UNIVERSE = [
  // Benchmark
  { symbol: 'SPY',      name: 'SPDR S&P 500 ETF',                       category: 'Benchmark',                    subtheme: 'S&P 500 Index',            tier: 'Core',         type: 'ETF' },
  { symbol: 'QQQ',      name: 'Invesco QQQ Trust',                      category: 'Benchmark',                    subtheme: 'Nasdaq 100 Index',         tier: 'Core',         type: 'ETF' },
  { symbol: 'IWM',      name: 'iShares Russell 2000 ETF',               category: 'Benchmark',                    subtheme: 'Small Cap Index',          tier: 'Core',         type: 'ETF' },
  { symbol: 'DIA',      name: 'SPDR Dow Jones ETF',                     category: 'Benchmark',                    subtheme: 'Dow Jones Index',          tier: 'Active',       type: 'ETF' },
  { symbol: 'US500',    name: 'S&P 500 Index',                          category: 'Benchmark',                    subtheme: 'S&P 500 Spot',             tier: 'Core',         type: 'Index' },
  { symbol: 'US100',    name: 'Nasdaq 100 Index',                       category: 'Benchmark',                    subtheme: 'Nasdaq 100 Spot',          tier: 'Core',         type: 'Index' },
  // AI Infrastructure
  { symbol: 'NVDA',     name: 'NVIDIA',                                 category: 'AI Infrastructure',            subtheme: 'GPU',                      tier: 'Core',         type: 'Stock' },
  { symbol: 'AMD',      name: 'Advanced Micro Devices',                 category: 'AI Infrastructure',            subtheme: 'GPU/CPU',                  tier: 'Core',         type: 'Stock' },
  { symbol: 'AVGO',     name: 'Broadcom',                               category: 'AI Infrastructure',            subtheme: 'Networking/ASIC',          tier: 'Core',         type: 'Stock' },
  { symbol: 'MRVL',     name: 'Marvell Technology',                     category: 'AI Infrastructure',            subtheme: 'Networking/ASIC',          tier: 'Core',         type: 'Stock' },
  { symbol: 'DELL',     name: 'Dell Technologies',                      category: 'AI Infrastructure',            subtheme: 'Servers',                  tier: 'Core',         type: 'Stock' },
  { symbol: 'ARM',      name: 'Arm Holdings',                           category: 'AI Infrastructure',            subtheme: 'IP/Architecture',          tier: 'Core',         type: 'Stock' },
  { symbol: 'TSM',      name: 'Taiwan Semiconductor',                   category: 'AI Infrastructure',            subtheme: 'Foundry',                  tier: 'Core',         type: 'Stock' },
  { symbol: 'CRWV',     name: 'CoreWeave',                              category: 'AI Infrastructure',            subtheme: 'GPU Cloud',                tier: 'Core',         type: 'Stock' },
  { symbol: 'NBIS',     name: 'Nebius Group',                           category: 'AI Infrastructure',            subtheme: 'GPU Cloud',                tier: 'Active',       type: 'Stock' },
  // AI Applications
  { symbol: 'MSFT',     name: 'Microsoft',                              category: 'AI Applications',              subtheme: 'Cloud/AI',                 tier: 'Core',         type: 'Stock' },
  { symbol: 'GOOGL',    name: 'Alphabet',                               category: 'AI Applications',              subtheme: 'Search/AI',                tier: 'Core',         type: 'Stock' },
  { symbol: 'META',     name: 'Meta Platforms',                         category: 'AI Applications',              subtheme: 'Social/AI',                tier: 'Core',         type: 'Stock' },
  { symbol: 'AMZN',     name: 'Amazon',                                 category: 'AI Applications',              subtheme: 'Cloud/AI',                 tier: 'Core',         type: 'Stock' },
  { symbol: 'AAPL',     name: 'Apple',                                  category: 'AI Applications',              subtheme: 'Devices/AI',               tier: 'Core',         type: 'Stock' },
  { symbol: 'ORCL',     name: 'Oracle',                                 category: 'AI Applications',              subtheme: 'Cloud/AI',                 tier: 'Core',         type: 'Stock' },
  { symbol: 'PLTR',     name: 'Palantir',                               category: 'AI Applications',              subtheme: 'Enterprise AI',            tier: 'Core',         type: 'Stock' },
  { symbol: 'IBM',      name: 'IBM',                                    category: 'AI Applications',              subtheme: 'Enterprise AI',            tier: 'Active',       type: 'Stock' },
  // Semiconductors
  { symbol: 'ASML',     name: 'ASML Holding',                           category: 'Semiconductors',               subtheme: 'Equipment',                tier: 'Core',         type: 'Stock' },
  { symbol: 'INTC',     name: 'Intel',                                  category: 'Semiconductors',               subtheme: 'CPU/Foundry',              tier: 'Core',         type: 'Stock' },
  { symbol: 'QCOM',     name: 'Qualcomm',                               category: 'Semiconductors',               subtheme: 'Mobile/Modem',             tier: 'Core',         type: 'Stock' },
  { symbol: 'SOXL',     name: 'Direxion Semis 3x Bull',                 category: 'Semiconductors',               subtheme: 'Leveraged ETF',            tier: 'Active',       type: 'ETF' },
  { symbol: 'SOXX',     name: 'iShares Semiconductor ETF',              category: 'Semiconductors',               subtheme: 'ETF',                      tier: 'Active',       type: 'ETF' },
  // Memory
  { symbol: 'MU',       name: 'Micron Technology',                      category: 'Memory',                       subtheme: 'DRAM/HBM',                 tier: 'Core',         type: 'Stock' },
  { symbol: 'SNDK',     name: 'SanDisk',                                category: 'Memory',                       subtheme: 'Flash/NAND',               tier: 'Active',       type: 'Stock' },
  { symbol: 'DRAM',     name: 'Roundhill Memory ETF',                   category: 'Memory',                       subtheme: 'Memory ETF',               tier: 'Active',       type: 'ETF' },
  // Optics
  { symbol: 'LITE',     name: 'Lumentum',                               category: 'Optics',                       subtheme: 'Optical Components',       tier: 'Core',         type: 'Stock' },
  { symbol: 'AAOI',     name: 'Applied Optoelectronics',                category: 'Optics',                       subtheme: 'Optical Modules',          tier: 'Active',       type: 'Stock' },
  // Software Infrastructure
  { symbol: 'S',        name: 'SentinelOne',                            category: 'Software Infrastructure',      subtheme: 'Security',                 tier: 'Active',       type: 'Stock' },
  { symbol: 'NOW',      name: 'ServiceNow',                             category: 'Software Infrastructure',      subtheme: 'Enterprise SaaS',          tier: 'Core',         type: 'Stock' },
  // Crypto Equities
  { symbol: 'COIN',     name: 'Coinbase',                               category: 'Crypto Equities',              subtheme: 'Exchange',                 tier: 'Core',         type: 'Stock' },
  { symbol: 'MSTR',     name: 'Strategy (MicroStrategy)',               category: 'Crypto Equities',              subtheme: 'BTC Treasury',             tier: 'Core',         type: 'Stock' },
  { symbol: 'HOOD',     name: 'Robinhood',                              category: 'Crypto Equities',              subtheme: 'Brokerage',                tier: 'Core',         type: 'Stock' },
  { symbol: 'CRCL',     name: 'Circle',                                 category: 'Crypto Equities',              subtheme: 'Stablecoin Issuer',        tier: 'Core',         type: 'Stock' },
  // Robotics
  { symbol: 'TSLA',     name: 'Tesla',                                  category: 'Robotics',                     subtheme: 'EV/Humanoid',              tier: 'Core',         type: 'Stock' },
  { symbol: 'ROBO',     name: 'ROBO Global Robotics ETF',               category: 'Robotics',                     subtheme: 'Robotics ETF',             tier: 'Active',       type: 'ETF' },
  // Defense
  { symbol: 'RKLB',     name: 'Rocket Lab',                             category: 'Defense',                      subtheme: 'Space',                    tier: 'Core',         type: 'Stock' },
  // Nuclear
  { symbol: 'URA',      name: 'Global X Uranium ETF',                   category: 'Nuclear',                      subtheme: 'Uranium ETF',              tier: 'Active',       type: 'ETF' },
  // Energy
  { symbol: 'WTI',      name: 'Crude Oil WTI',                          category: 'Energy',                       subtheme: 'Oil',                      tier: 'Core',         type: 'Spot' },
  { symbol: 'BRENTOIL', name: 'Brent Crude Oil',                        category: 'Energy',                       subtheme: 'Oil',                      tier: 'Core',         type: 'Spot' },
  { symbol: 'NATGAS',   name: 'Natural Gas',                            category: 'Energy',                       subtheme: 'Natural Gas',              tier: 'Active',       type: 'Spot' },
  // Metals
  { symbol: 'XAU',      name: 'Gold (Spot)',                            category: 'Metals',                       subtheme: 'Gold',                     tier: 'Core',         type: 'Spot' },
  { symbol: 'XAG',      name: 'Silver (Spot)',                          category: 'Metals',                       subtheme: 'Silver',                   tier: 'Core',         type: 'Spot' },
  { symbol: 'XCU',      name: 'Copper',                                 category: 'Metals',                       subtheme: 'Copper',                   tier: 'Core',         type: 'Spot' },
  { symbol: 'XPD',      name: 'Palladium',                              category: 'Metals',                       subtheme: 'Palladium',                tier: 'Active',       type: 'Spot' },
  { symbol: 'XPT',      name: 'Platinum',                               category: 'Metals',                       subtheme: 'Platinum',                 tier: 'Active',       type: 'Spot' },
  { symbol: 'XPL',      name: 'Platinum Spot',                          category: 'Metals',                       subtheme: 'Platinum',                 tier: 'Watch',        type: 'Spot' },
  { symbol: 'PAXG',     name: 'PAX Gold',                               category: 'Metals',                       subtheme: 'Tokenized Gold',           tier: 'Active',       type: 'Token' },
  // International
  { symbol: 'BABA',     name: 'Alibaba',                                category: 'International',                subtheme: 'China Internet',           tier: 'Core',         type: 'Stock' },
  { symbol: 'TENCENT',  name: 'Tencent',                                category: 'International',                subtheme: 'China Tech',               tier: 'Core',         type: 'Stock' },
  { symbol: 'XIAOMI',   name: 'Xiaomi',                                 category: 'International',                subtheme: 'China Tech',               tier: 'Active',       type: 'Stock' },
  { symbol: 'SAMSUNG',  name: 'Samsung',                                category: 'International',                subtheme: 'Korea Tech',               tier: 'Core',         type: 'Stock' },
  { symbol: 'SAMSUNGUSD',name: 'Samsung (USD)',                          category: 'International',                subtheme: 'Korea Tech',               tier: 'Watch',        type: 'Stock' },
  { symbol: 'SKHYNIX',  name: 'SK Hynix',                               category: 'International',                subtheme: 'Korea Memory',             tier: 'Core',         type: 'Stock' },
  { symbol: 'SKHYNIXUSD',name: 'SK Hynix (USD)',                         category: 'International',                subtheme: 'Korea Memory',             tier: 'Watch',        type: 'Stock' },
  { symbol: 'SKHY',     name: 'SK Hynix (Nasdaq ADR)',                  category: 'International',                subtheme: 'Korea Memory',             tier: 'Active',       type: 'Stock' },
  { symbol: 'HYUNDAI',  name: 'Hyundai',                                category: 'International',                subtheme: 'Korea Auto',               tier: 'Active',       type: 'Stock' },
  { symbol: 'HYUNDAIUSD',name: 'Hyundai (USD)',                          category: 'International',                subtheme: 'Korea Auto',               tier: 'Watch',        type: 'Stock' },
  { symbol: 'KRCOMP',   name: 'Korea Composite',                        category: 'International',                subtheme: 'Korea Index',              tier: 'Watch',        type: 'Index' },
  { symbol: 'POPMART',  name: 'Pop Mart',                               category: 'International',                subtheme: 'China Consumer',           tier: 'Active',       type: 'Stock' },
  { symbol: 'BYD',      name: 'BYD',                                    category: 'International',                subtheme: 'China EV',                 tier: 'Core',         type: 'Stock' },
  { symbol: 'EWY',      name: 'iShares MSCI South Korea ETF',           category: 'International',                subtheme: 'Korea ETF',                tier: 'Active',       type: 'ETF' },
  // Pre-IPO
  { symbol: 'OPENAI',   name: 'OpenAI',                                 category: 'Pre-IPO',                      subtheme: 'AI',                       tier: 'Core',         type: 'Private' },
  { symbol: 'ANTHROPIC',name: 'Anthropic',                              category: 'Pre-IPO',                      subtheme: 'AI',                       tier: 'Core',         type: 'Private' },
  { symbol: 'SPACEX',   name: 'SpaceX',                                 category: 'Pre-IPO',                      subtheme: 'Space',                    tier: 'Core',         type: 'Private' },
  { symbol: 'MINIMAX',  name: 'MiniMax',                                category: 'Pre-IPO',                      subtheme: 'AI',                       tier: 'Active',       type: 'Private' },
  // Consumer
  { symbol: 'GME',      name: 'GameStop',                               category: 'Consumer',                     subtheme: 'Meme Stock',               tier: 'Active',       type: 'Stock' },
  { symbol: 'TTWO',     name: 'Take-Two Interactive',                   category: 'Consumer',                     subtheme: 'Gaming',                   tier: 'Active',       type: 'Stock' },
  { symbol: 'IP',       name: 'International Paper',                    category: 'Consumer',                     subtheme: 'Packaging',                tier: 'Active',       type: 'Stock' },
  // Telecom
  { symbol: 'NOK',      name: 'Nokia',                                  category: 'Telecom',                      subtheme: '5G/Network',               tier: 'Active',       type: 'Stock' },
  // Agriculture
  { symbol: 'WHEAT',    name: 'Wheat',                                  category: 'Agriculture',                  subtheme: 'Wheat',                    tier: 'Active',       type: 'Spot' },
  { symbol: 'MAGS',     name: 'VanEck Agribusiness ETF',                category: 'Agriculture',                  subtheme: 'Agri ETF',                 tier: 'Active',       type: 'ETF' },
  // ETFs
  { symbol: 'BOTZ',     name: 'Global X Robotics & AI ETF',             category: 'ETFs',                         subtheme: 'Robotics/AI ETF',          tier: 'Active',       type: 'ETF' },
  // Forex
  { symbol: 'EURUSD',   name: 'EUR/USD',                                category: 'Forex',                        subtheme: 'EUR/USD',                  tier: 'Core',         type: 'Forex' },
  { symbol: 'GBPUSD',   name: 'GBP/USD',                                category: 'Forex',                        subtheme: 'GBP/USD',                  tier: 'Active',       type: 'Forex' },
  { symbol: 'USDJPY',   name: 'USD/JPY',                                category: 'Forex',                        subtheme: 'USD/JPY',                  tier: 'Core',         type: 'Forex' },
  { symbol: 'USDCHF',   name: 'USD/CHF',                                category: 'Forex',                        subtheme: 'USD/CHF',                  tier: 'Active',       type: 'Forex' },
  { symbol: 'USDCAD',   name: 'USD/CAD',                                category: 'Forex',                        subtheme: 'USD/CAD',                  tier: 'Active',       type: 'Forex' },
  { symbol: 'AUDUSD',   name: 'AUD/USD',                                category: 'Forex',                        subtheme: 'AUD/USD',                  tier: 'Active',       type: 'Forex' },
  { symbol: 'NZDUSD',   name: 'NZD/USD',                                category: 'Forex',                        subtheme: 'NZD/USD',                  tier: 'Watch',        type: 'Forex' },
  { symbol: 'USDKRW',   name: 'USD/KRW',                                category: 'Forex',                        subtheme: 'USD/KRW',                  tier: 'Watch',        type: 'Forex' },
  { symbol: 'USDHKD',   name: 'USD/HKD',                                category: 'Forex',                        subtheme: 'USD/HKD',                  tier: 'Watch',        type: 'Forex' },

  // ─── Additional tickers (fetched via Massive /prev — price only) ───
  // AI Applications (Massive /prev)
  { symbol: 'AI', name: 'C3.ai', category: 'AI Applications', subtheme: 'Enterprise AI', tier: 'Active', type: 'Stock', source: 'massive' },
  // AI Infrastructure (Massive /prev)
  { symbol: 'SMCI', name: 'Super Micro Computer', category: 'AI Infrastructure', subtheme: 'Servers', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'ANET', name: 'Arista Networks', category: 'AI Infrastructure', subtheme: 'Networking', tier: 'Core', type: 'Stock', source: 'massive' },
  { symbol: 'ALAB', name: 'Astera Labs', category: 'AI Infrastructure', subtheme: 'Connectivity', tier: 'Core', type: 'Stock', source: 'massive' },
  { symbol: 'CDNS', name: 'Cadence Design', category: 'AI Infrastructure', subtheme: 'EDA Tools', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'SNPS', name: 'Synopsys', category: 'AI Infrastructure', subtheme: 'EDA Tools', tier: 'Active', type: 'Stock', source: 'massive' },
  // Benchmark (Massive /prev)
  { symbol: 'VUG', name: 'Vanguard Growth ETF', category: 'Benchmark', subtheme: 'Growth ETF', tier: 'Active', type: 'ETF', source: 'massive' },
  { symbol: 'VTV', name: 'Vanguard Value ETF', category: 'Benchmark', subtheme: 'Value ETF', tier: 'Active', type: 'ETF', source: 'massive' },
  // Biotech (Massive /prev)
  { symbol: 'LLY', name: 'Eli Lilly', category: 'Biotech', subtheme: 'GLP-1 Leader', tier: 'Core', type: 'Stock', source: 'massive' },
  { symbol: 'MRNA', name: 'Moderna', category: 'Biotech', subtheme: 'mRNA/Vaccine', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'CRSP', name: 'CRISPR Therapeutics', category: 'Biotech', subtheme: 'Gene Editing', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'XBI', name: 'SPDR S&P Biotech ETF', category: 'Biotech', subtheme: 'ETF', tier: 'Core', type: 'ETF', source: 'massive' },
  { symbol: 'IBB', name: 'iShares Biotechnology ETF', category: 'Biotech', subtheme: 'ETF', tier: 'Active', type: 'ETF', source: 'massive' },
  { symbol: 'REGN', name: 'Regeneron', category: 'Biotech', subtheme: 'Large Cap Biotech', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'GILD', name: 'Gilead Sciences', category: 'Biotech', subtheme: 'Large Cap Biotech', tier: 'Watch', type: 'Stock', source: 'massive' },
  { symbol: 'AMGN', name: 'Amgen', category: 'Biotech', subtheme: 'Large Cap Biotech', tier: 'Watch', type: 'Stock', source: 'massive' },
  { symbol: 'VRTX', name: 'Vertex Pharmaceuticals', category: 'Biotech', subtheme: 'Large Cap Biotech', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'NVO', name: 'Novo Nordisk', category: 'Biotech', subtheme: 'GLP-1 Leader', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'VKTX', name: 'Viking Therapeutics', category: 'Biotech', subtheme: 'Obesity/GLP', tier: 'Active', type: 'Stock', source: 'massive' },
  // Defense (Massive /prev)
  { symbol: 'PL', name: 'Planet Labs', category: 'Defense', subtheme: 'Space', tier: 'Active', type: 'Stock', source: 'massive' },
  // Optics (Massive /prev)
  { symbol: 'CIEN', name: 'Ciena', category: 'Optics', subtheme: 'Optical Networking', tier: 'Core', type: 'Stock', source: 'massive' },
  { symbol: 'COHR', name: 'Coherent', category: 'Optics', subtheme: 'Optical/Photonics', tier: 'Core', type: 'Stock', source: 'massive' },
  { symbol: 'FN', name: 'Fabrinet', category: 'Optics', subtheme: 'Optical Manufacturing', tier: 'Core', type: 'Stock', source: 'massive' },
  // Power/Grid (Massive /prev)
  { symbol: 'VRT', name: 'Vertiv Holdings', category: 'Power/Grid', subtheme: 'Datacenter Power/Cooling', tier: 'Core', type: 'Stock', source: 'massive' },
  // Quantum (Massive /prev)
  { symbol: 'QTUM', name: 'Defiance Quantum ETF', category: 'Quantum', subtheme: 'ETF', tier: 'Active', type: 'ETF', source: 'massive' },
  // Robotics (Massive /prev)
  { symbol: 'TER', name: 'Teradyne', category: 'Robotics', subtheme: 'Test/Cobots', tier: 'Active', type: 'Stock', source: 'massive' },
  // Semiconductors (Massive /prev)
  { symbol: 'AMAT', name: 'Applied Materials', category: 'Semiconductors', subtheme: 'Equipment', tier: 'Core', type: 'Stock', source: 'massive' },
  { symbol: 'LRCX', name: 'Lam Research', category: 'Semiconductors', subtheme: 'Equipment', tier: 'Core', type: 'Stock', source: 'massive' },
  { symbol: 'KLAC', name: 'KLA Corporation', category: 'Semiconductors', subtheme: 'Equipment', tier: 'Core', type: 'Stock', source: 'massive' },
  { symbol: 'TXN', name: 'Texas Instruments', category: 'Semiconductors', subtheme: 'Analog', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'MCHP', name: 'Microchip Technology', category: 'Semiconductors', subtheme: 'Analog/MCU', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'ON', name: 'ON Semiconductor', category: 'Semiconductors', subtheme: 'Power/Auto', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'NXPI', name: 'NXP Semiconductors', category: 'Semiconductors', subtheme: 'Auto/Industrial', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'MPWR', name: 'Monolithic Power', category: 'Semiconductors', subtheme: 'Power', tier: 'Active', type: 'Stock', source: 'massive' },
  { symbol: 'ADI', name: 'Analog Devices', category: 'Semiconductors', subtheme: 'Analog', tier: 'Active', type: 'Stock', source: 'massive' },

  // ─── Additional Lighter tradfi markets ───
  { symbol: 'CC',       name: 'Canton Network',                        category: 'Blockchain Infrastructure',     subtheme: 'Blockchain',               tier: 'Active',       type: 'Stock' },
  { symbol: 'NMR',      name: 'Numeraire',                             category: 'AI Applications',               subtheme: 'AI / Quant',               tier: 'Active',       type: 'Stock' },
  { symbol: 'QNT',      name: 'Quant',                                 category: 'Interoperability',              subtheme: 'Enterprise',               tier: 'Active',       type: 'Stock' },
  { symbol: 'SMIC',     name: 'SMIC',                                  category: 'Semiconductors',                subtheme: 'Chinese Foundry',           tier: 'Core',         type: 'Stock' },
  { symbol: 'SPX',      name: 'S&P 500 Index (Spot)',                  category: 'Benchmark',                     subtheme: 'S&P 500 Spot',              tier: 'Active',       type: 'Index' },
  { symbol: 'SPCX',     name: 'SpaceX',                                category: 'Pre-IPO',                       subtheme: 'Space',                     tier: 'Core',         type: 'Stock' },
  { symbol: 'STRC',     name: 'Strategy',                              category: 'Crypto Equities',               subtheme: 'BTC Treasury',              tier: 'Active',       type: 'Stock' },
  { symbol: 'WLFI',     name: 'World Liberty Financial',               category: 'Crypto Equities',               subtheme: 'DeFi Protocol',             tier: 'Active',       type: 'Stock' },
  { symbol: 'YZY',      name: 'Yeezy',                                 category: 'Consumer',                      subtheme: 'Apparel/Brand',             tier: 'Watch',        type: 'Stock' },
  { symbol: 'ZHIPU',    name: 'Zhipu AI',                              category: 'Pre-IPO',                       subtheme: 'AI',                        tier: 'Active',       type: 'Private' },

  // ─── Twelve Data additions (fetched via TD API — requires VITE_TWELVEDATA_KEY) ───
  // Financials
  { symbol: 'JPM',      name: 'JPMorgan Chase',                        category: 'Financials',                    subtheme: 'Banking',                   tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'BAC',      name: 'Bank of America',                       category: 'Financials',                    subtheme: 'Banking',                   tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'GS',       name: 'Goldman Sachs',                         category: 'Financials',                    subtheme: 'Banking',                   tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'MS',       name: 'Morgan Stanley',                        category: 'Financials',                    subtheme: 'Banking',                   tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'V',        name: 'Visa',                                  category: 'Financials',                    subtheme: 'Payments',                  tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'MA',       name: 'Mastercard',                            category: 'Financials',                    subtheme: 'Payments',                  tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'BRK.B',    name: 'Berkshire Hathaway',                    category: 'Financials',                    subtheme: 'Conglomerate',              tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'XLF',      name: 'Financial Select Sector ETF',           category: 'Financials',                    subtheme: 'ETF',                       tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  // Consumer
  { symbol: 'WMT',      name: 'Walmart',                               category: 'Consumer',                      subtheme: 'Retail',                    tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'COST',     name: 'Costco',                                category: 'Consumer',                      subtheme: 'Retail',                    tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'HD',       name: 'Home Depot',                            category: 'Consumer',                      subtheme: 'Retail',                    tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'NKE',      name: 'Nike',                                  category: 'Consumer',                      subtheme: 'Apparel',                   tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'SBUX',     name: 'Starbucks',                             category: 'Consumer',                      subtheme: 'Restaurants',               tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'MCD',      name: 'McDonalds',                             category: 'Consumer',                      subtheme: 'Restaurants',               tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'DIS',      name: 'Disney',                                category: 'Consumer',                      subtheme: 'Media',                     tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'NFLX',     name: 'Netflix',                               category: 'Consumer',                      subtheme: 'Streaming',                 tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'ABNB',     name: 'Airbnb',                                category: 'Consumer',                      subtheme: 'Travel',                    tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'UBER',     name: 'Uber',                                  category: 'Consumer',                      subtheme: 'Ride-share',                tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'XLY',      name: 'Consumer Discretionary ETF',            category: 'Consumer',                      subtheme: 'ETF',                       tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  { symbol: 'XLP',      name: 'Consumer Staples ETF',                  category: 'Consumer',                      subtheme: 'ETF',                       tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  // Energy
  { symbol: 'XOM',      name: 'Exxon Mobil',                           category: 'Energy',                        subtheme: 'Oil & Gas',                 tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'CVX',      name: 'Chevron',                               category: 'Energy',                        subtheme: 'Oil & Gas',                 tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'XLE',      name: 'Energy Select Sector ETF',              category: 'Energy',                        subtheme: 'ETF',                       tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  // Healthcare
  { symbol: 'UNH',      name: 'UnitedHealth',                          category: 'Healthcare',                    subtheme: 'Insurance',                 tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'JNJ',      name: 'Johnson & Johnson',                     category: 'Healthcare',                    subtheme: 'Diversified',               tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'PFE',      name: 'Pfizer',                                category: 'Healthcare',                    subtheme: 'Pharma',                    tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'XLV',      name: 'Health Care Select Sector ETF',         category: 'Healthcare',                    subtheme: 'ETF',                       tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  // Industrials
  { symbol: 'BA',       name: 'Boeing',                                category: 'Industrials',                   subtheme: 'Aerospace',                 tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'CAT',      name: 'Caterpillar',                           category: 'Industrials',                   subtheme: 'Heavy Equipment',           tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'GE',       name: 'GE Aerospace',                          category: 'Industrials',                   subtheme: 'Aerospace',                 tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'UPS',      name: 'UPS',                                   category: 'Industrials',                   subtheme: 'Logistics',                 tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'XLI',      name: 'Industrial ETF',                        category: 'Industrials',                   subtheme: 'ETF',                       tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  // Utilities / Power
  { symbol: 'NEE',      name: 'NextEra Energy',                        category: 'Utilities',                     subtheme: 'Renewable Energy',          tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'CEG',      name: 'Constellation Energy',                  category: 'Utilities',                     subtheme: 'Nuclear Power',             tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'VST',      name: 'Vistra Corp',                           category: 'Utilities',                     subtheme: 'Power Generation',          tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'XLU',      name: 'Utilities ETF',                         category: 'Utilities',                     subtheme: 'ETF',                       tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  // Real Estate
  { symbol: 'PLD',      name: 'Prologis',                              category: 'Real Estate',                   subtheme: 'Industrial REIT',           tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'VNQ',      name: 'Vanguard Real Estate ETF',              category: 'Real Estate',                   subtheme: 'REIT ETF',                  tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  { symbol: 'XLRE',     name: 'Real Estate ETF',                       category: 'Real Estate',                   subtheme: 'ETF',                       tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  // Bonds / Rates
  { symbol: 'TLT',      name: '20+ Year Treasury Bond ETF',            category: 'Bonds',                         subtheme: 'Long Treasury',             tier: 'Core',         type: 'ETF', source: 'twelvedata' },
  { symbol: 'IEF',      name: '7-10 Year Treasury ETF',                category: 'Bonds',                         subtheme: 'Intermediate Treasury',     tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  { symbol: 'HYG',      name: 'High Yield Corp Bond ETF',              category: 'Bonds',                         subtheme: 'High Yield',                tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  { symbol: 'LQD',      name: 'Investment Grade Corp Bond ETF',        category: 'Bonds',                         subtheme: 'Investment Grade',          tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  // Defense
  { symbol: 'LMT',      name: 'Lockheed Martin',                       category: 'Defense',                       subtheme: 'Aerospace/Defense',         tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'RTX',      name: 'RTX Corporation',                       category: 'Defense',                       subtheme: 'Aerospace/Defense',         tier: 'Core',         type: 'Stock', source: 'twelvedata' },
  { symbol: 'NOC',      name: 'Northrop Grumman',                      category: 'Defense',                       subtheme: 'Aerospace/Defense',         tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  // Software / Fintech
  { symbol: 'SHOP',     name: 'Shopify',                               category: 'Software Infrastructure',       subtheme: 'E-commerce SaaS',           tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'SQ',       name: 'Block',                                 category: 'Crypto Equities',               subtheme: 'Fintech',                   tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  { symbol: 'PYPL',     name: 'PayPal',                                category: 'Crypto Equities',               subtheme: 'Fintech',                   tier: 'Active',       type: 'Stock', source: 'twelvedata' },
  // Broad ETFs
  { symbol: 'VOO',      name: 'Vanguard S&P 500 ETF',                  category: 'Benchmark',                     subtheme: 'S&P 500',                   tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  { symbol: 'VTI',      name: 'Vanguard Total Market ETF',             category: 'Benchmark',                     subtheme: 'Total Market',              tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  { symbol: 'XLK',      name: 'Technology Select Sector ETF',          category: 'Benchmark',                     subtheme: 'Tech ETF',                  tier: 'Active',       type: 'ETF', source: 'twelvedata' },
  // Agriculture
  { symbol: 'CORN',     name: 'Teucrium Corn Fund',                    category: 'Agriculture',                   subtheme: 'Corn',                      tier: 'Watch',        type: 'ETF', source: 'twelvedata' },
  { symbol: 'SOYB',     name: 'Teucrium Soybean Fund',                 category: 'Agriculture',                   subtheme: 'Soybeans',                  tier: 'Watch',        type: 'ETF', source: 'twelvedata' },
  { symbol: 'DBA',      name: 'Invesco DB Agriculture Fund',           category: 'Agriculture',                   subtheme: 'Agri ETF',                  tier: 'Active',       type: 'ETF', source: 'twelvedata' },

  // ─── Reference dashboard additions (from stable_market_board_v1 universe.csv) ───
  { symbol: 'ABB', name: 'ABB Ltd', category: 'Robotics', subtheme: 'Industrial Automation', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ACHR', name: 'Archer Aviation', category: 'Defense', subtheme: 'eVTOL', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ACLS', name: 'Axcelis Technologies', category: 'Semiconductors', subtheme: 'Equipment', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ADBE', name: 'Adobe', category: 'AI Applications', subtheme: 'Creative AI', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'AEM', name: 'Agnico Eagle Mines', category: 'Metals', subtheme: 'Gold Miner', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'AEVA', name: 'Aeva Technologies', category: 'Robotics', subtheme: 'Lidar/Sensing', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'AMBA', name: 'Ambarella', category: 'Semiconductors', subtheme: 'Vision/Auto', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'APLD', name: 'Applied Digital', category: 'Crypto Equities', subtheme: 'HPC/Datacenter', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'APP', name: 'AppLovin', category: 'AI Applications', subtheme: 'AdTech AI', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'AROC', name: 'Archrock', category: 'Power/Grid', subtheme: 'Gas Compression', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ARQQ', name: 'Arqit Quantum', category: 'Quantum', subtheme: 'Quantum Security', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ASTS', name: 'AST SpaceMobile', category: 'Defense', subtheme: 'Space', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ATKR', name: 'Atkore', category: 'Power/Grid', subtheme: 'Electrical Products', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'AVAV', name: 'AeroVironment', category: 'Defense', subtheme: 'Drones', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'BAND', name: 'Bandwidth', category: 'Optics', subtheme: 'Communications', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'BBAI', name: 'BigBear.ai', category: 'AI Applications', subtheme: 'Defense AI', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'BE', name: 'Bloom Energy', category: 'Power/Grid', subtheme: 'Fuel Cells', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'BIDU', name: 'Baidu', category: 'China Tech', subtheme: 'China Internet', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'BWXT', name: 'BWX Technologies', category: 'Power/Grid', subtheme: 'Naval/Defense Nuclear', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'BX', name: 'Blackstone', category: 'Financials', subtheme: 'Alt Asset Manager', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CCJ', name: 'Cameco', category: 'Nuclear', subtheme: 'Uranium Mining', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CFLT', name: 'Confluent', category: 'Software Infrastructure', subtheme: 'Data Platform', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CGNX', name: 'Cognex', category: 'Robotics', subtheme: 'Machine Vision', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CLSK', name: 'CleanSpark', category: 'Crypto Equities', subtheme: 'Miner', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'COPX', name: 'Global X Copper Miners ETF', category: 'Metals', subtheme: 'Copper Miners ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CORZ', name: 'Core Scientific', category: 'Crypto Equities', subtheme: 'Miner/HPC', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CRDO', name: 'Credo Technology', category: 'AI Infrastructure', subtheme: 'Connectivity', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CRM', name: 'Salesforce', category: 'AI Applications', subtheme: 'Enterprise AI', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CRNC', name: 'Cerence', category: 'AI Applications', subtheme: 'Voice AI', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CRWD', name: 'CrowdStrike', category: 'Software Infrastructure', subtheme: 'Security', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CVNA', name: 'Carvana', category: 'Consumer Momentum', subtheme: 'E-commerce', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'CW', name: 'Curtiss-Wright', category: 'Defense', subtheme: 'Defense Components', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'DASH', name: 'DoorDash', category: 'Consumer Momentum', subtheme: 'Delivery', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'DKNG', name: 'DraftKings', category: 'Consumer Momentum', subtheme: 'Gaming', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'DLR', name: 'Digital Realty Trust', category: 'Datacenter REITs', subtheme: 'Datacenter REIT', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'DT', name: 'Dynatrace', category: 'Software Infrastructure', subtheme: 'Observability', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'DUOL', name: 'Duolingo', category: 'AI Applications', subtheme: 'EdTech AI', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'EEM', name: 'iShares MSCI Emerging Markets ETF', category: 'Benchmark', subtheme: 'Emerging Mkts', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'EFA', name: 'iShares MSCI EAFE ETF', category: 'Benchmark', subtheme: 'Intl Developed', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'EMR', name: 'Emerson Electric', category: 'Robotics', subtheme: 'Industrial Automation', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ENTG', name: 'Entegris', category: 'Semiconductors', subtheme: 'Materials', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'EQIX', name: 'Equinix', category: 'Datacenter REITs', subtheme: 'Datacenter REIT', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ESTC', name: 'Elastic', category: 'Software Infrastructure', subtheme: 'Search/Observability', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ETHA', name: 'iShares Ethereum Trust', category: 'Crypto Equities', subtheme: 'ETH ETF', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ETN', name: 'Eaton', category: 'Power/Grid', subtheme: 'Electrical Equipment', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'FANG', name: 'Diamondback Energy', category: 'Energy', subtheme: 'E&P', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'FANUY', name: 'Fanuc Corporation', category: 'Robotics', subtheme: 'Industrial Robots', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'FARO', name: 'FARO Technologies', category: 'Robotics', subtheme: '3D Measurement', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'FCX', name: 'Freeport-McMoRan', category: 'Metals', subtheme: 'Copper', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'FLNC', name: 'Fluence Energy', category: 'Power/Grid', subtheme: 'Battery Storage', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'FROG', name: 'JFrog', category: 'Software Infrastructure', subtheme: 'DevOps', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'FTNT', name: 'Fortinet', category: 'Software Infrastructure', subtheme: 'Security', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'FXI', name: 'iShares China Large-Cap ETF', category: 'China Tech', subtheme: 'ETF', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'GD', name: 'General Dynamics', category: 'Defense', subtheme: 'Defense Prime', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'GDX', name: 'VanEck Gold Miners ETF', category: 'Metals', subtheme: 'Gold Miners ETF', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'GDXJ', name: 'VanEck Junior Gold Miners ETF', category: 'Metals', subtheme: 'Junior Gold Miners ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'GEV', name: 'GE Vernova', category: 'Power/Grid', subtheme: 'Power Equipment', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'GFS', name: 'GlobalFoundries', category: 'AI Infrastructure', subtheme: 'Foundry', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', category: 'Metals', subtheme: 'Gold ETF', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'GTLB', name: 'GitLab', category: 'Software Infrastructure', subtheme: 'DevOps', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'HII', name: 'Huntington Ingalls', category: 'Defense', subtheme: 'Naval', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'HIMS', name: 'Hims & Hers Health', category: 'Consumer Momentum', subtheme: 'Telehealth', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'HIMX', name: 'Himax Technologies', category: 'Memory', subtheme: 'Display/Memory', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'HPE', name: 'Hewlett Packard Enterprise', category: 'AI Infrastructure', subtheme: 'Servers', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'HUBB', name: 'Hubbell', category: 'Power/Grid', subtheme: 'Electrical Equipment', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'HUBS', name: 'HubSpot', category: 'Software Infrastructure', subtheme: 'CRM', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'IBIT', name: 'iShares Bitcoin Trust', category: 'Crypto Equities', subtheme: 'BTC ETF', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'IJR', name: 'iShares Core S&P Small-Cap ETF', category: 'Benchmark', subtheme: 'SmallCap', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'INDI', name: 'indie Semiconductor', category: 'Semiconductors', subtheme: 'Auto', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'INFN', name: 'Infinera', category: 'Optics', subtheme: 'Optical Networking', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'INTU', name: 'Intuit', category: 'Software Infrastructure', subtheme: 'Vertical SaaS', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'INVZ', name: 'Innoviz Technologies', category: 'Robotics', subtheme: 'Lidar/Sensing', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'IONQ', name: 'IonQ', category: 'Quantum', subtheme: 'Trapped Ion', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'IPGP', name: 'IPG Photonics', category: 'Robotics', subtheme: 'Industrial Lasers', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'IREN', name: 'IREN Limited', category: 'Crypto Equities', subtheme: 'Miner/HPC', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'IRM', name: 'Iron Mountain', category: 'Datacenter REITs', subtheme: 'Datacenter/Storage REIT', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ISRG', name: 'Intuitive Surgical', category: 'Robotics', subtheme: 'Surgical Robotics', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ITA', name: 'iShares Aerospace & Defense ETF', category: 'Defense', subtheme: 'ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ITRI', name: 'Itron', category: 'Optics', subtheme: 'Sensing/IoT', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'IWD', name: 'iShares Russell 1000 Value ETF', category: 'Benchmark', subtheme: 'Large Value', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'IWF', name: 'iShares Russell 1000 Growth ETF', category: 'Benchmark', subtheme: 'Large Growth', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'JD', name: 'JD.com', category: 'China Tech', subtheme: 'China Internet', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'JOBY', name: 'Joby Aviation', category: 'Defense', subtheme: 'eVTOL', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'KRE', name: 'SPDR S&P Regional Banking ETF', category: 'Financials', subtheme: 'Regional Banks ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'KSCP', name: 'Knightscope', category: 'Robotics', subtheme: 'Security Robotics', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'KTOS', name: 'Kratos Defense', category: 'Defense', subtheme: 'Drones/Hypersonics', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'KWEB', name: 'KraneShares CSI China Internet ETF', category: 'China Tech', subtheme: 'ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LAES', name: 'SEALSQ', category: 'Quantum', subtheme: 'Quantum Security', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LAZR', name: 'Luminar Technologies', category: 'Robotics', subtheme: 'Lidar/Sensing', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LCID', name: 'Lucid Group', category: 'EV/Autonomy', subtheme: 'EV', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LDOS', name: 'Leidos', category: 'Defense', subtheme: 'Defense IT', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LEU', name: 'Centrus Energy', category: 'Nuclear', subtheme: 'Enrichment', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LHX', name: 'L3Harris', category: 'Defense', subtheme: 'Defense Prime', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LI', name: 'Li Auto', category: 'EV/Autonomy', subtheme: 'China EV', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LNG', name: 'Cheniere Energy', category: 'Energy', subtheme: 'LNG', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LSCC', name: 'Lattice Semiconductor', category: 'Semiconductors', subtheme: 'FPGA', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'LUNR', name: 'Intuitive Machines', category: 'Defense', subtheme: 'Space', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MARA', name: 'Mara Holdings', category: 'Crypto Equities', subtheme: 'Miner', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MBLY', name: 'Mobileye', category: 'Robotics', subtheme: 'Autonomy', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MDB', name: 'MongoDB', category: 'Software Infrastructure', subtheme: 'Database', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MDY', name: 'SPDR S&P MidCap 400 ETF', category: 'Benchmark', subtheme: 'MidCap', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MELI', name: 'MercadoLibre', category: 'Consumer Momentum', subtheme: 'LatAm E-commerce', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MOD', name: 'Modine Manufacturing', category: 'AI Infrastructure', subtheme: 'Datacenter Cooling', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MP', name: 'MP Materials', category: 'Rare Earths', subtheme: 'Rare Earths', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MRAM', name: 'Everspin Technologies', category: 'Memory', subtheme: 'MRAM', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MTZ', name: 'MasTec', category: 'Power/Grid', subtheme: 'Infrastructure', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MXL', name: 'MaxLinear', category: 'Semiconductors', subtheme: 'Connectivity', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'MYRG', name: 'MYR Group', category: 'Power/Grid', subtheme: 'Grid Buildout', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'NDSN', name: 'Nordson', category: 'Robotics', subtheme: 'Precision Dispensing', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'NEM', name: 'Newmont', category: 'Metals', subtheme: 'Gold Miner', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'NET', name: 'Cloudflare', category: 'Software Infrastructure', subtheme: 'Edge/Security', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'NIO', name: 'NIO', category: 'EV/Autonomy', subtheme: 'China EV', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'NNE', name: 'Nano Nuclear Energy', category: 'Nuclear', subtheme: 'SMR', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'NRG', name: 'NRG Energy', category: 'Power/Grid', subtheme: 'IPP', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'NTAP', name: 'NetApp', category: 'Memory', subtheme: 'Enterprise Storage', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'NVT', name: 'nVent Electric', category: 'AI Infrastructure', subtheme: 'Datacenter Electrical', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'OKLO', name: 'Oklo', category: 'Nuclear', subtheme: 'SMR', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'OKTA', name: 'Okta', category: 'Software Infrastructure', subtheme: 'Security', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ONTO', name: 'Onto Innovation', category: 'Semiconductors', subtheme: 'Equipment', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'OUST', name: 'Ouster', category: 'Robotics', subtheme: 'Lidar/Sensing', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'OXY', name: 'Occidental Petroleum', category: 'Energy', subtheme: 'E&P', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'PANW', name: 'Palo Alto Networks', category: 'Software Infrastructure', subtheme: 'Security', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'PATH', name: 'UiPath', category: 'AI Applications', subtheme: 'Automation', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'PDD', name: 'PDD Holdings', category: 'China Tech', subtheme: 'China Internet', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'PLUG', name: 'Plug Power', category: 'Power/Grid', subtheme: 'Hydrogen', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'PNR', name: 'Pentair', category: 'Power/Grid', subtheme: 'Cooling/Water', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'POWL', name: 'Powell Industries', category: 'Power/Grid', subtheme: 'Power Distribution', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'PRIM', name: 'Primoris Services', category: 'Power/Grid', subtheme: 'Grid Buildout', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'PSTG', name: 'Pure Storage', category: 'Memory', subtheme: 'Enterprise Storage', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'PTC', name: 'PTC Inc', category: 'Robotics', subtheme: 'Industrial Software', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'PWR', name: 'Quanta Services', category: 'Power/Grid', subtheme: 'Grid Buildout', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'QBTS', name: 'D-Wave Quantum', category: 'Quantum', subtheme: 'Annealing', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'QSI', name: 'Quantum-Si', category: 'Quantum', subtheme: 'Quantum Sequencing', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'QUBT', name: 'Quantum Computing Inc', category: 'Quantum', subtheme: 'Photonic', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'RBLX', name: 'Roblox', category: 'Consumer Momentum', subtheme: 'Gaming', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'RDDT', name: 'Reddit', category: 'Consumer Momentum', subtheme: 'Social', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'RDW', name: 'Redwire', category: 'Defense', subtheme: 'Space', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'REMX', name: 'VanEck Rare Earth/Strategic Metals ETF', category: 'Rare Earths', subtheme: 'ETF', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'RGTI', name: 'Rigetti Computing', category: 'Quantum', subtheme: 'Superconducting', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'RIVN', name: 'Rivian', category: 'EV/Autonomy', subtheme: 'EV', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'RMBS', name: 'Rambus', category: 'Memory', subtheme: 'Memory IP/HBM', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ROK', name: 'Rockwell Automation', category: 'Robotics', subtheme: 'Industrial Automation', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'RR', name: 'Richtech Robotics', category: 'AI Infrastructure', subtheme: 'Service Robotics', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'RSP', name: 'Invesco S&P 500 Equal Weight', category: 'Benchmark', subtheme: 'Equal Weight SPX', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'RXRX', name: 'Recursion Pharmaceuticals', category: 'AI Applications', subtheme: 'AI Drug Discovery', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SCCO', name: 'Southern Copper', category: 'Metals', subtheme: 'Copper', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SDGR', name: 'Schrodinger', category: 'AI Applications', subtheme: 'AI Drug Discovery', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SERV', name: 'Serve Robotics', category: 'Robotics', subtheme: 'Delivery Robotics', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SHLD', name: 'Global X Defense Tech ETF', category: 'Defense', subtheme: 'ETF', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SIL', name: 'Global X Silver Miners ETF', category: 'Metals', subtheme: 'Silver Miners ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SLAB', name: 'Silicon Labs', category: 'Semiconductors', subtheme: 'IoT/MCU', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SLB', name: 'Schlumberger', category: 'Energy', subtheme: 'Oil Services', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SLV', name: 'iShares Silver Trust', category: 'Metals', subtheme: 'Silver ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SMH', name: 'VanEck Semiconductor ETF', category: 'Semiconductors', subtheme: 'ETF', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SMR', name: 'NuScale Power', category: 'Nuclear', subtheme: 'SMR', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SNOW', name: 'Snowflake', category: 'Software Infrastructure', subtheme: 'Data Platform', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SOUN', name: 'SoundHound AI', category: 'AI Applications', subtheme: 'Voice AI', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SPOT', name: 'Spotify', category: 'Consumer Momentum', subtheme: 'Streaming', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'STRL', name: 'Sterling Infrastructure', category: 'Power/Grid', subtheme: 'Datacenter Build', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'STX', name: 'Seagate Technology', category: 'Memory', subtheme: 'HDD/Storage', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'SYM', name: 'Symbotic', category: 'Robotics', subtheme: 'Warehouse Automation', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'TEAM', name: 'Atlassian', category: 'Software Infrastructure', subtheme: 'Collaboration', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'TEM', name: 'Tempus AI', category: 'AI Applications', subtheme: 'Healthcare AI', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'TLN', name: 'Talen Energy', category: 'Power/Grid', subtheme: 'IPP/Nuclear', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'TTD', name: 'The Trade Desk', category: 'Consumer Momentum', subtheme: 'AdTech', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'TWLO', name: 'Twilio', category: 'Software Infrastructure', subtheme: 'Communications', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'UEC', name: 'Uranium Energy', category: 'Nuclear', subtheme: 'Uranium Mining', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'UMC', name: 'United Microelectronics', category: 'Semiconductors', subtheme: 'Foundry', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'URNM', name: 'Sprott Uranium Miners ETF', category: 'Nuclear', subtheme: 'ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'USAR', name: 'USA Rare Earth', category: 'Rare Earths', subtheme: 'Rare Earths', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'UUP', name: 'Invesco DB US Dollar Index Bullish', category: 'Benchmark', subtheme: 'USD', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'UUUU', name: 'Energy Fuels', category: 'Nuclear', subtheme: 'Uranium Mining', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'UVXY', name: 'ProShares Ultra VIX Short-Term Futures', category: 'Benchmark', subtheme: 'VIX ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'VEEV', name: 'Veeva Systems', category: 'Software Infrastructure', subtheme: 'Vertical SaaS', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'VIAV', name: 'Viavi Solutions', category: 'Optics', subtheme: 'Optical Test/Measurement', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'VXX', name: 'iPath Series B S&P 500 VIX Short-Term Futures ETN', category: 'Benchmark', subtheme: 'VIX Short-Term', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'VXZ', name: 'iPath Series B S&P 500 VIX Mid-Term Futures ETN', category: 'Benchmark', subtheme: 'VIX Mid-Term', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'WDAY', name: 'Workday', category: 'Software Infrastructure', subtheme: 'Enterprise SaaS', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'WDC', name: 'Western Digital', category: 'Memory', subtheme: 'HDD/Storage', tier: 'Core', type: 'Stock', source: 'twelvedata' },
  { symbol: 'WOLF', name: 'Wolfspeed', category: 'Semiconductors', subtheme: 'SiC/Power', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'WULF', name: 'TeraWulf', category: 'Crypto Equities', subtheme: 'Miner/HPC', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'XLB', name: 'Materials Select Sector SPDR', category: 'Benchmark', subtheme: 'Materials ETF', tier: 'Watch', type: 'Stock', source: 'twelvedata' },
  { symbol: 'XLC', name: 'Communication Services Select SPDR', category: 'Benchmark', subtheme: 'Comm Services ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'XOP', name: 'SPDR S&P Oil & Gas E&P ETF', category: 'Energy', subtheme: 'E&P ETF', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'XPEV', name: 'XPeng', category: 'EV/Autonomy', subtheme: 'China EV', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ZBRA', name: 'Zebra Technologies', category: 'Robotics', subtheme: 'Warehouse/Logistics', tier: 'Active', type: 'Stock', source: 'twelvedata' },
  { symbol: 'ZS', name: 'Zscaler', category: 'Software Infrastructure', subtheme: 'Security', tier: 'Active', type: 'Stock', source: 'twelvedata' },
];


// ── Metrics ───────────────────────────────────────────────────────────────────
function sma(arr, period) {
  if (!arr || arr.length < period) return null;
  const slice = arr.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function computeRsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  // Initial average
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change; else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // Wilder's smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeTradMetrics(candles) {
  if (!candles || candles.length < 5) return null;
  const closes = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const vols    = candles.map(c => c.vol || 0);
  const n = closes.length;

  const price = closes[n - 1];
  const ma20  = sma(closes, Math.min(20, n));
  const ma50  = sma(closes, Math.min(50, n));
  const ma200 = closes.length >= 200 ? sma(closes, 200) : null;

  const ret1d  = n >= 2  ? (closes[n-1] / closes[n-2]  - 1) : null;
  const ret5d  = n >= 6  ? (closes[n-1] / closes[n-6]  - 1) : null;
  const ret20d = n >= 21 ? (closes[n-1] / closes[n-21] - 1) : null;
  const ret60d = n >= 61 ? (closes[n-1] / closes[n-61] - 1) : null;

  const above20  = ma20  != null ? (price > ma20  ? 1 : 0) : null;
  const above50  = ma50  != null ? (price > ma50  ? 1 : 0) : null;
  const above200 = ma200 != null ? (price > ma200 ? 1 : 0) : null;

  const distMa20  = ma20  != null ? (price / ma20  - 1) * 100 : null;
  const distMa50  = ma50  != null ? (price / ma50  - 1) * 100 : null;
  const distMa200 = ma200 != null ? (price / ma200 - 1) * 100 : null;

  // 14-day ATR (Wilder)
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i]  - closes[i-1])
    ));
  }
  let atr14 = null;
  if (trs.length >= 14) {
    atr14 = trs.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
    const k = 1 / 14;
    for (let i = 14; i < trs.length; i++) atr14 = trs[i] * k + atr14 * (1 - k);
  }

  const atrExt50ma = (ma50 && atr14) ? (price - ma50) / atr14 : null;

  // Average Daily Range % — mean of (high/low - 1) over 20 days
  const rangePct = candles.slice(-20)
    .map(c => c.low > 0 ? (c.high / c.low - 1) * 100 : null)
    .filter(v => v != null);
  const adrPct = rangePct.length >= 10 ? rangePct.reduce((a, b) => a + b, 0) / rangePct.length : null;

  // Trend Tenure — consecutive days closing above the 50MA
  let trendTenure = null;
  if (closes.length >= 51) {
    const ma50Series = [];
    let sum = closes.slice(0, 50).reduce((a, b) => a + b, 0);
    ma50Series[49] = sum / 50;
    for (let i = 50; i < closes.length; i++) {
      sum += closes[i] - closes[i - 50];
      ma50Series[i] = sum / 50;
    }
    trendTenure = 0;
    for (let i = closes.length - 1; i >= 49; i--) {
      if (closes[i] > ma50Series[i]) trendTenure++;
      else break;
    }
  }

  const volMa20  = sma(vols, Math.min(20, n));
  const volRatio = volMa20 && volMa20 > 0 ? vols[n-1] / volMa20 : null;

  // 52-week high/low
  const yearAgo = Math.max(0, n - 252);
  const yearCloses = closes.slice(yearAgo);
  const high52w = yearCloses.length > 0 ? Math.max(...yearCloses) : null;
  const low52w  = yearCloses.length > 0 ? Math.min(...yearCloses) : null;
  const pctFrom52wHigh = high52w ? (price / high52w - 1) * 100 : null;

  // RSI 14
  const rsi14 = computeRsi(closes, 14);

  const sparkline = closes.slice(-30);

  return {
    price, ma20, ma50, ma200,
    ret1d, ret5d, ret20d, ret60d,
    above20, above50, above200,
    distMa20, distMa50, distMa200,
    atr14, atrExt50ma, volRatio,
    adrPct, trendTenure,
    high52w, low52w, pctFrom52wHigh,
    rsi14,
    sparkline,
  };
}

// ── Pool Fetcher ──────────────────────────────────────────────────────────────
async function fetchWithPool(tasks, concurrency = 5) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        results[i] = { asset: { symbol: 'UNKNOWN' }, metrics: null, source: 'error' };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Main Entry Point ──────────────────────────────────────────────────────────
export async function fetchTradMarketData(onProgress, onPartialResults) {
  const assets = TRAD_UNIVERSE;
  onProgress?.({ done: 0, total: assets.length });

  let done = 0;
  const sourceTracker = {};  // symbol → source id (for UI display)
  const rawResults = [];

  // Sort assets: Lighter tickers first (fastest), then non-Lighter (slower)
  const sortedAssets = [...assets].sort((a, b) => {
    const aLighter = !!LIGHTER_MARKET_IDS[a.symbol.toUpperCase()];
    const bLighter = !!LIGHTER_MARKET_IDS[b.symbol.toUpperCase()];
    if (aLighter && !bLighter) return -1;
    if (!aLighter && bLighter) return 1;
    return 0;
  });

  const tasks = sortedAssets.map(asset => async () => {
    try {
      const candles = await fetchTradfiCandles(asset.symbol, 300);
      const source = candles ? (LIGHTER_MARKET_IDS[asset.symbol.toUpperCase()] ? 'lighter' : 'polygon') : 'none';
      done++;
      onProgress?.({ done, total: assets.length });
      if (source !== 'none') sourceTracker[asset.symbol] = source;
      if (!candles || candles.length < 5) {
        rawResults.push({ asset, metrics: null, source: 'none' });
        return;
      }
      rawResults.push({ asset, metrics: computeTradMetrics(candles), source });
      // Deliver partial results every 10 completed assets so the UI can update
      if (onPartialResults && done % 10 === 0) {
        onPartialResults(buildTradResult(rawResults, sourceTracker));
      }
    } catch (e) {
      done++;
      onProgress?.({ done, total: assets.length });
      console.warn(`[tradData] ${asset.symbol} failed:`, e.message);
      rawResults.push({ asset, metrics: null, source: 'error' });
    }
  });

  // Concurrency: 8 workers. Rate-limited sources (Massive ~5/min, TD ~8/min)
  // handle their own throttling via cooldown checks. Free sources (Lighter,
  // OKX, Kraken) have no limits and will resolve instantly.
  await fetchWithPool(tasks, 8);

  return buildTradResult(rawResults, sourceTracker);
}

// ── Build final/partial result from rawResults ───────────────────────────────
function buildTradResult(rawResults, sourceTracker) {
  // Compute RS vs QQQ for each asset
  const qqqResult = rawResults.find(r => r.asset.symbol === 'QQQ');
  const qqqRet20d = qqqResult?.metrics?.ret20d ?? 0;
  for (const r of rawResults) {
    if (r.metrics) {
      r.metrics.rs_qqq_20d = r.metrics.ret20d != null
        ? r.metrics.ret20d - qqqRet20d
        : null;
    }
  }

  // ── Category summary ──────────────────────────────────────────────────────
  const categoryMap = {};
  for (const r of rawResults) {
    if (!r.metrics) continue;
    const cat = r.asset.category;
    if (!categoryMap[cat]) categoryMap[cat] = [];
    categoryMap[cat].push(r);
  }

  const categories = Object.entries(categoryMap).map(([name, items]) => {
    const valid = items.filter(i => i.metrics);
    const pctAbove20  = valid.length ? valid.filter(i => i.metrics.above20  === 1).length / valid.length * 100 : 0;
    const pctAbove50  = valid.length ? valid.filter(i => i.metrics.above50  === 1).length / valid.length * 100 : 0;
    const pctAbove200 = valid.length ? valid.filter(i => i.metrics.above200 === 1).length / valid.length * 100 : 0;
    const avgRet5d    = valid.length ? valid.reduce((s, i) => s + (i.metrics.ret5d  ?? 0), 0) / valid.length : 0;
    const avgRet20d   = valid.length ? valid.reduce((s, i) => s + (i.metrics.ret20d ?? 0), 0) / valid.length : 0;
    const avgRet60d   = valid.length ? valid.reduce((s, i) => s + (i.metrics.ret60d ?? 0), 0) / valid.length : 0;
    return { name, pctAbove20, pctAbove50, pctAbove200, avgRet5d, avgRet20d, avgRet60d, count: valid.length };
  }).sort((a, b) => b.pctAbove50 - a.pctAbove50);

  // ── Individual assets enriched ─────────────────────────────────────────────
  const assets2 = rawResults
    .filter(r => r.metrics)
    .map(r => ({ ...r.asset, ...r.metrics, source: r.source }))
    .sort((a, b) => (b.ret20d ?? -99) - (a.ret20d ?? -99));

  // ── Starting to Move (tradfi) ──────────────────────────────────────────────
  const startingToMove = assets2
    .filter(a => a.distMa50 != null && a.distMa50 > 0 && a.distMa50 < 15)
    .filter(a => a.rs_qqq_20d != null && a.rs_qqq_20d > 0)
    .sort((a, b) => (b.rs_qqq_20d ?? -99) - (a.rs_qqq_20d ?? -99))
    .slice(0, 15)
    .map(a => ({
      symbol: a.symbol,
      name: a.name,
      category: a.category,
      rsNow: a.rs_qqq_20d,
      rsDelta: null,
      distMa50: a.distMa50,
      ret20d: a.ret20d,
      volRatio: a.volRatio,
      adrPct: a.adrPct,
      trendTenure: a.trendTenure,
      price: a.price,
    }));

  // Regime breadth across all trad assets
  const valid = rawResults.filter(r => r.metrics);
  const tradRegime = {
    total:       valid.length,
    pctAbove20:  valid.length ? Math.round(valid.filter(r => r.metrics.above20  === 1).length / valid.length * 100) : 0,
    pctAbove50:  valid.length ? Math.round(valid.filter(r => r.metrics.above50  === 1).length / valid.length * 100) : 0,
    pctAbove200: valid.length ? Math.round(valid.filter(r => r.metrics.above200 === 1).length / valid.length * 100) : 0,
    avgRet1d:  valid.length ? valid.reduce((s, r) => s + (r.metrics.ret1d  ?? 0), 0) / valid.length : 0,
    avgRet5d:  valid.length ? valid.reduce((s, r) => s + (r.metrics.ret5d  ?? 0), 0) / valid.length : 0,
    avgRet20d: valid.length ? valid.reduce((s, r) => s + (r.metrics.ret20d ?? 0), 0) / valid.length : 0,
  };

  // Count sources used
  const sourceCounts = {};
  for (const s of Object.values(sourceTracker)) {
    sourceCounts[s] = (sourceCounts[s] || 0) + 1;
  }

  return {
    assets: assets2,
    categories,
    tradRegime,
    startingToMove,
    sourceCounts,
    fetchedAt: new Date().toISOString(),
  };
}
