// Traditional market data via Kraken xStocks (tokenized, 24/5 via Backed Assets)
// Pair format: {TICKER}xUSD — fetched via Kraken OHLC + asset_class=tokenized_asset
// Weekends/holidays produce zero-volume candles with the last price carried forward — we strip these.

// ── Universe ──────────────────────────────────────────────────────────────────
// Grouped by macro category for the Market Board macro tab
export const TRAD_UNIVERSE = [
  // Broad Market ETFs
  { symbol: 'SPYx', krakenPair: 'SPYxUSD', name: 'S&P 500 ETF',        category: 'Broad Market', type: 'ETF'   },
  { symbol: 'QQQx', krakenPair: 'QQQxUSD', name: 'Nasdaq 100 ETF',      category: 'Broad Market', type: 'ETF'   },
  { symbol: 'IWMx', krakenPair: 'IWMxUSD', name: 'Russell 2000 ETF',    category: 'Broad Market', type: 'ETF'   },
  { symbol: 'VTIx', krakenPair: 'VTIxUSD', name: 'Total Market ETF',    category: 'Broad Market', type: 'ETF'   },
  { symbol: 'VUGx', krakenPair: 'VUGxUSD', name: 'Vanguard Growth ETF', category: 'Broad Market', type: 'ETF'   },

  // Gold & Precious Metals
  { symbol: 'GLDx', krakenPair: 'GLDxUSD', name: 'Gold ETF',           category: 'Commodities',  type: 'ETF'   },
  { symbol: 'SLVx', krakenPair: 'SLVxUSD', name: 'Silver ETF',         category: 'Commodities',  type: 'ETF'   },

  // Energy & Materials
  { symbol: 'XLEx', krakenPair: 'XLExUSD', name: 'Energy Sector ETF',  category: 'Sector ETFs',  type: 'ETF'   },
  { symbol: 'XOPx', krakenPair: 'XOPxUSD', name: 'Oil & Gas E&P ETF',  category: 'Sector ETFs',  type: 'ETF'   },
  { symbol: 'URAx', krakenPair: 'URAxUSD', name: 'Uranium ETF',        category: 'Sector ETFs',  type: 'ETF'   },

  // Tech Mega Cap
  { symbol: 'NVDAx', krakenPair: 'NVDAxUSD', name: 'NVIDIA',           category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'AAPLx', krakenPair: 'AAPLxUSD', name: 'Apple',            category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'MSFTx', krakenPair: 'MSFTxUSD', name: 'Microsoft',        category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'GOOGLx',krakenPair: 'GOOGLxUSD',name: 'Alphabet',         category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'METAx', krakenPair: 'METAxUSD', name: 'Meta',             category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'AMZNx', krakenPair: 'AMZNxUSD', name: 'Amazon',           category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'TSLAx', krakenPair: 'TSLAxUSD', name: 'Tesla',            category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'TSMx',  krakenPair: 'TSMxUSD',  name: 'TSMC',             category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'AVGOx', krakenPair: 'AVGOxUSD', name: 'Broadcom',         category: 'Tech Mega Cap', type: 'Stock' },

  // AI / Semiconductor
  { symbol: 'AMDx',  krakenPair: 'AMDxUSD',  name: 'AMD',              category: 'Semiconductors', type: 'Stock' },
  { symbol: 'SMHx',  krakenPair: 'SMHxUSD',  name: 'VanEck Semis ETF', category: 'Semiconductors', type: 'ETF'   },
  { symbol: 'ASMLx', krakenPair: 'ASMLxUSD', name: 'ASML',             category: 'Semiconductors', type: 'Stock' },
  { symbol: 'MRVLx', krakenPair: 'MRVLxUSD', name: 'Marvell Tech',    category: 'Semiconductors', type: 'Stock' },

  // Finance
  { symbol: 'JPMx',  krakenPair: 'JPMxUSD',  name: 'JPMorgan',         category: 'Financials', type: 'Stock' },
  { symbol: 'GSx',   krakenPair: 'GSxUSD',   name: 'Goldman Sachs',    category: 'Financials', type: 'Stock' },
  { symbol: 'BACx',  krakenPair: 'BACxUSD',  name: 'Bank of America',  category: 'Financials', type: 'Stock' },
  { symbol: 'MAx',   krakenPair: 'MAxUSD',   name: 'Mastercard',       category: 'Financials', type: 'Stock' },
  { symbol: 'COINx', krakenPair: 'COINxUSD', name: 'Coinbase',         category: 'Financials', type: 'Stock' },

  // Healthcare
  { symbol: 'LLYx',  krakenPair: 'LLYxUSD',  name: 'Eli Lilly',       category: 'Healthcare', type: 'Stock' },
  { symbol: 'JNJx',  krakenPair: 'JNJxUSD',  name: 'J&J',             category: 'Healthcare', type: 'Stock' },

  // Crypto proxies / TradFi-crypto bridge
  { symbol: 'MSTRx', krakenPair: 'MSTRxUSD', name: 'MicroStrategy',    category: 'Crypto Bridge', type: 'Stock' },
  { symbol: 'HOODx', krakenPair: 'HOODxUSD', name: 'Robinhood',        category: 'Crypto Bridge', type: 'Stock' },
  { symbol: 'PLTRx', krakenPair: 'PLTRxUSD', name: 'Palantir',         category: 'Crypto Bridge', type: 'Stock' },
  { symbol: 'CRCLx', krakenPair: 'CRCLxUSD', name: 'Circle',           category: 'Crypto Bridge', type: 'Stock' },
];

// ── Candle Fetching ────────────────────────────────────────────────────────────
const INTERVAL_MAP = { '1D': 1440, '4H': 240, '1H': 60, '30m': 30, '15m': 15 };

// Kraken returns carried-forward candles with 0 volume on weekends/holidays.
// Filter them out so we get only real trading-day candles.
function filterTradingDays(candles) {
  return candles.filter(c => c.vol > 0);
}

async function fetchKrakenXStockCandles(krakenPair, interval = 1440, limit = 300) {
  const since = Math.floor(Date.now() / 1000) - limit * interval * 60;
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(krakenPair)}&interval=${interval}&since=${since}&asset_class=tokenized_asset`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  if (json.error?.length || !json.result) return null;

  const key = Object.keys(json.result).find(k => k !== 'last');
  if (!key) return null;
  const raw = json.result[key];
  if (!raw?.length) return null;

  const candles = raw.map(c => ({
    ts:    c[0] * 1000,
    open:  parseFloat(c[1]),
    high:  parseFloat(c[2]),
    low:   parseFloat(c[3]),
    close: parseFloat(c[4]),
    vwap:  parseFloat(c[5]),
    vol:   parseFloat(c[6]),
  }));

  return filterTradingDays(candles);
}

// ── Metrics ───────────────────────────────────────────────────────────────────
function sma(arr, period) {
  if (!arr || arr.length < period) return null;
  const slice = arr.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function computeTradMetrics(candles) {
  if (!candles || candles.length < 10) return null;
  const closes = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const vols    = candles.map(c => c.vol);
  const n = closes.length;

  const price = closes[n - 1];
  const ma20  = sma(closes, Math.min(20, n));
  const ma50  = sma(closes, Math.min(50, n));
  const ma200 = closes.length >= 200 ? sma(closes, 200) : null;

  const ret1d  = n >= 2  ? (closes[n-1] / closes[n-2]  - 1) : null;
  const ret5d  = n >= 6  ? (closes[n-1] / closes[n-6]  - 1) : null;
  const ret20d = n >= 21 ? (closes[n-1] / closes[n-21] - 1) : null;

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

  const sparkline = closes.slice(-30);

  return {
    price, ma20, ma50, ma200,
    ret1d, ret5d, ret20d,
    above20, above50, above200,
    distMa20, distMa50, distMa200,
    atr14, atrExt50ma, volRatio,
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
  const tasks = assets.map(asset => async () => {
    const candles = await fetchKrakenXStockCandles(asset.krakenPair, 1440, 300);
    done++;
    onProgress?.({ done, total: assets.length });
    if (!candles) return { asset, metrics: null };
    return { asset, metrics: computeTradMetrics(candles) };
  });

  const rawResults = await fetchWithPool(tasks, 5);

  // Compute RS vs QQQ for each asset
  const qqqResult = rawResults.find(r => r.asset.symbol === 'QQQx');
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
    const avgRet5d    = valid.length ? valid.reduce((s, i) => s + (i.metrics.ret5d  ?? 0), 0) / valid.length : 0;
    const avgRet20d   = valid.length ? valid.reduce((s, i) => s + (i.metrics.ret20d ?? 0), 0) / valid.length : 0;
    return { name, pctAbove20, pctAbove50, avgRet5d, avgRet20d, count: valid.length };
  }).sort((a, b) => b.pctAbove50 - a.pctAbove50);

  // ── Individual assets enriched ─────────────────────────────────────────────
  const assets2 = rawResults
    .filter(r => r.metrics)
    .map(r => ({ ...r.asset, ...r.metrics }))
    .sort((a, b) => (b.ret20d ?? -99) - (a.ret20d ?? -99));

  // Regime breadth across all trad assets
  const valid = rawResults.filter(r => r.metrics);
  const tradRegime = {
    total:       valid.length,
    pctAbove20:  valid.length ? Math.round(valid.filter(r => r.metrics.above20  === 1).length / valid.length * 100) : 0,
    pctAbove50:  valid.length ? Math.round(valid.filter(r => r.metrics.above50  === 1).length / valid.length * 100) : 0,
    pctAbove200: valid.length ? Math.round(valid.filter(r => r.metrics.above200 === 1).length / valid.length * 100) : 0,
  };

  return { assets: assets2, categories, tradRegime };
}