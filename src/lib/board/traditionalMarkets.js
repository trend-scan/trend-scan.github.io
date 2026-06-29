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
  AUDUSD:102, NZDUSD:103, USDKRW:101, USDHKD:104,
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
  // Try Lighter first (full OHLC history)
  let candles = await fetchLighterCandles(symbol, limit);
  if (candles && candles.length >= 5) return candles;
  
  // Try OKX SWAP perps for 7 major tickers
  candles = await fetchOkxTradfiCandles(symbol, limit);
  if (candles && candles.length >= 5) return candles;
  
  // Try Massive /prev (price only — single candle, no history)
  // This gives us at least a price for tickers not on any exchange
  candles = await fetchMassivePrev(symbol);
  return candles;  // May be null or single-candle
}

// ── Massive/Polygon /prev — price-only for tickers not on Lighter ─────────────
// Free tier allows /prev (previous close) but NOT /range (historical OHLC)
// Rate limit: ~5 req/min on free tier
const MASSIVE_KEY = import.meta.env?.VITE_MASSIVE_API_KEY || '';
const MASSIVE_BASE = 'https://api.polygon.io';

async function fetchMassivePrev(symbol) {
  if (!MASSIVE_KEY) return null;
  try {
    const url = `${MASSIVE_BASE}/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?apiKey=${MASSIVE_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.status !== 'OK' || !d.results?.length) return null;
    const r = d.results[0];
    // Return a single-candle "OHLC" from the prev close data
    // c = close, o = open, h = high, l = low, v = volume
    return [{
      ts: r.t || Date.now(),
      open: r.o || r.c,
      high: r.h || r.c,
      low: r.l || r.c,
      close: r.c,
      vol: r.v || 0,
    }];
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
]];


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
  if (!candles || candles.length < 1) return null;
  // If only 1 candle (from Massive /prev), return limited metrics
  if (candles.length < 5) {
    const price = candles[candles.length - 1].close;
    return {
      price, ma20: null, ma50: null, ma200: null,
      ret1d: null, ret5d: null, ret20d: null, ret60d: null,
      above20: null, above50: null, above200: null,
      distMa20: null, distMa50: null, distMa200: null,
      atr14: null, atrExt50ma: null, volRatio: null,
      high52w: null, low52w: null, pctFrom52wHigh: null,
      rsi14: null,
      sparkline: [price],
    };
  }
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
    sourceCounts,
    fetchedAt: new Date().toISOString(),
  };
}
