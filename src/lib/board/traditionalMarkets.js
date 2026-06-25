// Traditional market data — multi-source via sourceResolver
// Replaces the old Kraken-xStocks-only fetcher with the resolver chain:
//   OKX SWAP perps (SPY, QQQ, NVDA, TSLA, AAPL, XAU, XAG) →
//   Lighter (214 markets) →
//   Binance xStocks (NVDA, TSLA) →
//   Massive/Polygon (all US stocks/ETFs — if key configured)
//
// Kraken xStocks is kept as a final fallback (many pairs have been delisted).

import { fetchCandles } from '../scanner/sourceResolver';

// ── Universe ──────────────────────────────────────────────────────────────────
// symbol: the resolver uses this to classify + fetch from the right exchange
// (no more krakenPair — the resolver handles ticker format internally)
export const TRAD_UNIVERSE = [
  // Broad Market ETFs
  { symbol: 'SPY',  name: 'S&P 500 ETF',        category: 'Broad Market', type: 'ETF'   },
  { symbol: 'QQQ',  name: 'Nasdaq 100 ETF',     category: 'Broad Market', type: 'ETF'   },
  { symbol: 'IWM',  name: 'Russell 2000 ETF',   category: 'Broad Market', type: 'ETF'   },
  { symbol: 'VTI',  name: 'Total Market ETF',   category: 'Broad Market', type: 'ETF'   },
  { symbol: 'VUG',  name: 'Vanguard Growth ETF',category: 'Broad Market', type: 'ETF'   },
  { symbol: 'DIA',  name: 'Dow Jones ETF',      category: 'Broad Market', type: 'ETF'   },

  // Gold & Precious Metals
  { symbol: 'XAU',  name: 'Gold (spot)',        category: 'Commodities',  type: 'Spot'  },
  { symbol: 'XAG',  name: 'Silver (spot)',      category: 'Commodities',  type: 'Spot'  },

  // Energy & Materials
  { symbol: 'XLE',  name: 'Energy Sector ETF',  category: 'Sector ETFs',  type: 'ETF'   },
  { symbol: 'XOP',  name: 'Oil & Gas E&P ETF',  category: 'Sector ETFs',  type: 'ETF'   },
  { symbol: 'URA',  name: 'Uranium ETF',        category: 'Sector ETFs',  type: 'ETF'   },
  { symbol: 'XLF',  name: 'Financials ETF',     category: 'Sector ETFs',  type: 'ETF'   },
  { symbol: 'XLK',  name: 'Tech Sector ETF',    category: 'Sector ETFs',  type: 'ETF'   },
  { symbol: 'XLV',  name: 'Healthcare ETF',     category: 'Sector ETFs',  type: 'ETF'   },
  { symbol: 'XLY',  name: 'Consumer Disc ETF',  category: 'Sector ETFs',  type: 'ETF'   },
  { symbol: 'XLP',  name: 'Consumer Stap ETF',  category: 'Sector ETFs',  type: 'ETF'   },

  // Tech Mega Cap
  { symbol: 'NVDA', name: 'NVIDIA',             category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'AAPL', name: 'Apple',              category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'MSFT', name: 'Microsoft',          category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'GOOGL',name: 'Alphabet',           category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'META', name: 'Meta',               category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'AMZN', name: 'Amazon',             category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'TSLA', name: 'Tesla',              category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'TSM',  name: 'TSMC',               category: 'Tech Mega Cap', type: 'Stock' },
  { symbol: 'AVGO', name: 'Broadcom',           category: 'Tech Mega Cap', type: 'Stock' },

  // AI / Semiconductor
  { symbol: 'AMD',  name: 'AMD',                category: 'Semiconductors', type: 'Stock' },
  { symbol: 'SMH',  name: 'VanEck Semis ETF',   category: 'Semiconductors', type: 'ETF'   },
  { symbol: 'ASML', name: 'ASML',               category: 'Semiconductors', type: 'Stock' },
  { symbol: 'MRVL', name: 'Marvell Tech',       category: 'Semiconductors', type: 'Stock' },

  // Finance
  { symbol: 'JPM',  name: 'JPMorgan',           category: 'Financials', type: 'Stock' },
  { symbol: 'GS',   name: 'Goldman Sachs',      category: 'Financials', type: 'Stock' },
  { symbol: 'BAC',  name: 'Bank of America',    category: 'Financials', type: 'Stock' },
  { symbol: 'MA',   name: 'Mastercard',         category: 'Financials', type: 'Stock' },
  { symbol: 'COIN', name: 'Coinbase',           category: 'Financials', type: 'Stock' },

  // Healthcare
  { symbol: 'LLY',  name: 'Eli Lilly',          category: 'Healthcare', type: 'Stock' },
  { symbol: 'JNJ',  name: 'J&J',               category: 'Healthcare', type: 'Stock' },

  // Crypto proxies / TradFi-crypto bridge
  { symbol: 'MSTR', name: 'MicroStrategy',      category: 'Crypto Bridge', type: 'Stock' },
  { symbol: 'HOOD', name: 'Robinhood',          category: 'Crypto Bridge', type: 'Stock' },
  { symbol: 'PLTR', name: 'Palantir',           category: 'Crypto Bridge', type: 'Stock' },
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
  if (!candles || candles.length < 10) return null;
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
      const { source, candles } = await fetchCandles(asset.symbol, {
        timeframe: '1D',
        limit: 300,
        type: 'tradfi',
      });
      done++;
      onProgress?.({ done, total: assets.length });
      if (source) sourceTracker[asset.symbol] = source;
      if (!candles || candles.length < 10) return { asset, metrics: null, source: source || 'none' };
      return { asset, metrics: computeTradMetrics(candles), source: source || 'none' };
    } catch (e) {
      done++;
      onProgress?.({ done, total: assets.length });
      console.warn(`[tradData] ${asset.symbol} failed:`, e.message);
      return { asset, metrics: null, source: 'error' };
    }
  });

  const rawResults = await fetchWithPool(tasks, 5);

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
