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

const OKX_TRADFI = new Set(['SPY','QQQ','NVDA','TSLA','AAPL','XAU','XAG']);
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

async function fetchTradfiCandles(symbol, limit = 300) {
  // Try Lighter first (full OHLC history — 300 daily candles)
  let candles = await fetchLighterCandles(symbol, limit);
  if (candles && candles.length >= 5) return candles;
  
  // Try OKX SWAP perps for 7 major tickers
  candles = await fetchOkxTradfiCandles(symbol, limit);
  if (candles && candles.length >= 5) return candles;
  
  // Try Twelve Data ONLY for tickers not on Lighter (saves API credits)
  // Lighter covers 85 tickers; Twelve Data handles the remaining ~35
  if (!LIGHTER_MARKET_IDS[symbol.toUpperCase()]) {
    candles = await fetchTwelveDataCandles(symbol, limit);
    if (candles && candles.length >= 5) return candles;
  }
  return null;  // All sources failed
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

async function fetchTwelveDataCandles(symbol, limit = 300) {
  if (!TWELVEDATA_KEY) return null;
  
  // Check cache first
  const cacheKey = symbol.toUpperCase();
  const cached = _tdCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TD_CACHE_TTL) {
    return cached.data;
  }
  
  const tdSymbol = formatTdSymbol(symbol);
  const outputsize = Math.min(limit, 365);  // Free tier: 1 year max
  const url = `${TWELVEDATA_BASE}/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=1day&outputsize=${outputsize}&apikey=${TWELVEDATA_KEY}&format=JSON`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.status === 'error' || !d.values) return null;
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
// Updated: June 2026 — 82 assets across 19 sector baskets
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
  { symbol: 'SPCX',     name: 'SpaceX (Lighter)',                      category: 'Pre-IPO',                       subtheme: 'Space',                     tier: 'Core',         type: 'Private' },
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
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Main Entry Point ──────────────────────────────────────────────────────────
export async function fetchTradMarketData(onProgress) {
  const assets = TRAD_UNIVERSE;
  onProgress?.({ done: 0, total: assets.length });

  let done = 0;
  const sourceTracker = {};  // symbol → source id (for UI display)

  const tasks = assets.map(asset => async () => {
    try {
      const candles = await fetchTradfiCandles(asset.symbol, 300);
      const source = candles ? 'lighter' : 'none';
      done++;
      onProgress?.({ done, total: assets.length });
      if (source) sourceTracker[asset.symbol] = source;
      if (!candles || candles.length < 5) return { asset, metrics: null, source: 'none' };
      return { asset, metrics: computeTradMetrics(candles), source };
    } catch (e) {
      done++;
      onProgress?.({ done, total: assets.length });
      console.warn(`[tradData] ${asset.symbol} failed:`, e.message);
      return { asset, metrics: null, source: 'error' };
    }
  });

  const rawResults = await fetchWithPool(tasks, 3);

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
  // Same concept as crypto: above 50MA but not extended, sorted by RS vs QQQ.
  // Note: tradfi doesn't store candles in rawResults (only metrics), so we
  // can't compute a 20-day-prior RS delta. Instead we sort by current RS vs QQQ.
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
      rsDelta: null, // not available without historical candles
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
    // Average returns across all assets
    avgRet1d:  valid.length ? valid.reduce((s, r) => s + (r.metrics.ret1d  ?? 0), 0) / valid.length : 0,
    avgRet5d:  valid.length ? valid.reduce((s, r) => s + (r.metrics.ret5d  ?? 0), 0) / valid.length : 0,
    avgRet20d: valid.length ? valid.reduce((s, r) => s + (r.metrics.ret20d ?? 0), 0) / valid.length : 0,
  };

  // Count sources used (for UI display)
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
