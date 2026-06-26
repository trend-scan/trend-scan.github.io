// Market Board computation engine
// Uses the same exchange candle data as the Trend Strength Screener

import { fetchCandles, preloadExchange } from '../scanner/exchanges';
import { CRYPTO_UNIVERSE, BENCHMARKS, ROTATION_PAIRS } from './cryptoUniverse';

const TIMEFRAME = '1D';

// ── MA Calculations ──────────────────────────────────────────────────────────

function sma(arr, period) {
  if (!arr || arr.length < period) return null;
  const slice = arr.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function computeMetrics(candles) {
  if (!candles || candles.length < 20) return null;
  const closes = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const vols    = candles.map(c => c.vol);
  const n = closes.length;

  const price = closes[n - 1];

  const ma20  = sma(closes, 20);
  const ma50  = sma(closes, 50);
  const ma200 = sma(closes, 200);

  const ret1d  = n >= 2  ? (closes[n-1] / closes[n-2]  - 1) : null;
  const ret5d  = n >= 6  ? (closes[n-1] / closes[n-6]  - 1) : null;
  const ret20d = n >= 21 ? (closes[n-1] / closes[n-21] - 1) : null;
  const ret60d = n >= 61 ? (closes[n-1] / closes[n-61] - 1) : null;

  const above20  = ma20  != null ? (price > ma20  ? 1 : 0) : null;
  const above50  = ma50  != null ? (price > ma50  ? 1 : 0) : null;
  const above200 = ma200 != null ? (price > ma200 ? 1 : 0) : null;

  // 14-period ATR (Wilder)
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i]  - closes[i-1])
    );
    trueRanges.push(tr);
  }
  let atr14 = null;
  if (trueRanges.length >= 14) {
    atr14 = trueRanges.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
    const alpha = 1 / 14;
    for (let i = 14; i < trueRanges.length; i++) {
      atr14 = trueRanges[i] * alpha + atr14 * (1 - alpha);
    }
  }

  const atrExt50ma = (ma50 != null && atr14 != null && atr14 > 0) ? (price - ma50) / atr14 : null;

  const volMa20 = sma(vols, 20);
  const volRatio = (volMa20 && volMa20 > 0) ? vols[n-1] / volMa20 : null;

  // Rolling 20-day high
  const high20d = Math.max(...highs.slice(-20));
  const newHigh20d = highs[n-1] >= high20d ? 1 : 0;

  // 52-week new high
  const high52w = Math.max(...highs.slice(-252));
  const newHigh52w = highs[n-1] >= high52w ? 1 : 0;

  // Absolute momentum
  const momData = {
    abs1w:  closes.length >= 5   ? (closes[n-1] / Math.min(...closes.slice(-5))   - 1) * 100 : null,
    abs1m:  closes.length >= 21  ? (closes[n-1] / Math.min(...closes.slice(-21))  - 1) * 100 : null,
    abs3m:  closes.length >= 63  ? (closes[n-1] / Math.min(...closes.slice(-63))  - 1) * 100 : null,
    abs6m:  closes.length >= 126 ? (closes[n-1] / Math.min(...closes.slice(-126)) - 1) * 100 : null,
    rel1w:  closes.length >= 5   ? (closes[n-1] / (closes.slice(-5).reduce((a,b)=>a+b,0)/5)   - 1) * 100 : null,
    rel1m:  closes.length >= 21  ? (closes[n-1] / (closes.slice(-21).reduce((a,b)=>a+b,0)/21)  - 1) * 100 : null,
    rel3m:  closes.length >= 63  ? (closes[n-1] / (closes.slice(-63).reduce((a,b)=>a+b,0)/63)  - 1) * 100 : null,
    rel6m:  closes.length >= 126 ? (closes[n-1] / (closes.slice(-126).reduce((a,b)=>a+b,0)/126) - 1) * 100 : null,
  };

  // Average dollar volume
  const dollarVols = candles.slice(-20).map(c => c.close * c.vol);
  const avgDollarVol20d = dollarVols.reduce((a,b)=>a+b,0) / dollarVols.length;

  const distMa20  = ma20  != null ? (price / ma20  - 1) * 100 : null;
  const distMa50  = ma50  != null ? (price / ma50  - 1) * 100 : null;
  const distMa200 = ma200 != null ? (price / ma200 - 1) * 100 : null;

  const sparkline = closes.slice(-30);

  return {
    price, ma20, ma50, ma200,
    ret1d, ret5d, ret20d, ret60d,
    above20, above50, above200,
    atr14, atrExt50ma, volRatio,
    newHigh20d, newHigh52w, distMa20, distMa50, distMa200,
    sparkline,
    ...momData,
    avgDollarVol20d,
  };
}

// ── Theme Scoring ────────────────────────────────────────────────────────────

function scaleTo100(v, low, high) {
  return Math.max(0, Math.min(100, ((v - low) / (high - low)) * 100));
}

function scoreTheme(metrics, themeName) {
  const valid = metrics.filter(m => m != null && m.above20 != null && m.above50 != null);
  if (valid.length < 2) return null;

  const pctAbove20    = valid.reduce((s, m) => s + (m.above20   ?? 0), 0) / valid.length * 100;
  const pctAbove50    = valid.reduce((s, m) => s + (m.above50   ?? 0), 0) / valid.length * 100;
  const pctAbove200   = valid.reduce((s, m) => s + (m.above200  ?? 0), 0) / valid.length * 100;
  const pctNewHigh20  = valid.reduce((s, m) => s + (m.newHigh20d ?? 0), 0) / valid.length * 100;
  const pctNewHigh52  = valid.reduce((s, m) => s + (m.newHigh52w ?? 0), 0) / valid.length * 100;
  const avgRet20      = valid.reduce((s, m) => s + (m.ret20d    ?? 0), 0) / valid.length;
  const avgRet5       = valid.reduce((s, m) => s + (m.ret5d     ?? 0), 0) / valid.length;
  const avgAtrExt     = valid.reduce((s, m) => s + (m.atrExt50ma ?? 0), 0) / valid.length;

  const avg_rs_btc_20d = valid
    .filter(m => m.rs_btc_20d != null)
    .reduce((s, m) => s + m.rs_btc_20d, 0) / Math.max(valid.filter(m => m.rs_btc_20d != null).length, 1);

  const breadth    = (pctAbove20 + pctAbove50) / 2;
  const leadership = pctNewHigh20 * 0.6 + pctAbove200 * 0.4;
  const momentum   = scaleTo100(avgRet20, -0.10, 0.15);
  const rsComponent = Math.max(0, Math.min(100, 50 + avg_rs_btc_20d * 500));

  const score = Math.max(0, Math.min(100,
    0.30 * breadth + 0.25 * leadership + 0.30 * momentum + 0.15 * rsComponent
  ));

  return {
    score, pctAbove20, pctAbove50, pctAbove200,
    pctNewHigh: pctNewHigh20, pctNewHigh52w: pctNewHigh52,
    avgRet20, avgRet5d: avgRet5, avgAtrExt, memberCount: valid.length,
    avg_rs_btc_20d, breadth, leadership, momentum
  };
}

function themeStatus(score, delta, avgAtrExt) {
  if (score >= 75 && avgAtrExt > 6)           return 'STRONG / HOT';
  if (score >= 75)                             return 'DOMINANT';
  if (score >= 60 && delta > 2)               return 'EMERGING';
  if (score >= 60)                             return 'STRONG';
  if (score <= 35 && delta < -2)              return 'FADING';
  if (score <= 35)                            return 'WEAK';
  if (delta > 3)                              return 'IMPROVING';
  if (delta < -3)                             return 'DETERIORATING';
  return 'NEUTRAL';
}

// ── Compute Theme Score at Offset ─────────────────────────────────────────────

function computeThemeScoreAtOffset(rawResults, offset) {
  const snapshot = {};
  const btcResult = rawResults.find(r => r.asset.symbol === 'BTC');
  const btcRet20dPrior = btcResult?.candles
    ? (() => {
        const c = btcResult.candles.slice(0, -offset);
        const n = c.length;
        return n >= 21 ? (c[n-1].close / c[n-21].close - 1) : 0;
      })()
    : 0;

  for (const r of rawResults) {
    if (!r.candles || r.candles.length <= offset + 20) continue;
    const c = r.candles.slice(0, -offset);
    const closes = c.map(x => x.close);
    const n = closes.length;
    const ma20 = closes.slice(-20).reduce((a,b)=>a+b,0)/20;
    const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((a,b)=>a+b,0)/50 : null;
    const price = closes[n-1];
    const ret20d = n >= 21 ? (closes[n-1]/closes[n-21] - 1) : null;
    snapshot[r.asset.symbol] = {
      theme: r.asset.theme,
      above_ma20: price > ma20 ? 1 : 0,
      above_ma50: ma50 != null ? (price > ma50 ? 1 : 0) : null,
      ret20d,
      rs_btc_20d: ret20d != null ? ret20d - btcRet20dPrior : null,
    };
  }

  const themeGroups = {};
  for (const [sym, m] of Object.entries(snapshot)) {
    if (!themeGroups[m.theme]) themeGroups[m.theme] = [];
    themeGroups[m.theme].push(m);
  }

  const scores = {};
  for (const [theme, members] of Object.entries(themeGroups)) {
    const valid = members.filter(m => m.above_ma20 != null);
    if (valid.length < 2) continue;
    const pctAbove20 = valid.reduce((s,m)=>s+(m.above_ma20??0),0)/valid.length*100;
    const pctAbove50 = valid.filter(m=>m.above_ma50!=null).reduce((s,m)=>s+(m.above_ma50??0),0)/Math.max(valid.filter(m=>m.above_ma50!=null).length,1)*100;
    const breadth = (pctAbove20 + pctAbove50) / 2;
    const avgRet20 = valid.reduce((s,m)=>s+(m.ret20d??0),0)/valid.length;
    const momentum = scaleTo100(avgRet20, -0.10, 0.15);
    const avgRsBtc = valid.reduce((s,m)=>s+(m.rs_btc_20d??0),0)/valid.length;
    const rsComponent = Math.max(0, Math.min(100, 50 + avgRsBtc * 500));
    const score = Math.max(0, Math.min(100, 0.30 * breadth + 0.20 * momentum + 0.50 * rsComponent));
    scores[theme] = Math.round(score * 10) / 10;
  }
  return scores;
}

// ── Build Theme Rotation ──────────────────────────────────────────────────────

function buildThemeRotation(rawResults, themes) {
  const lookback = 5;
  const priorScores = computeThemeScoreAtOffset(rawResults, lookback);

  const rows = themes
    .filter(t => priorScores[t.name] != null)
    .map(t => ({
      theme: t.name,
      scoreThen: priorScores[t.name],
      scoreNow: t.score,
      scoreDelta: t.score - priorScores[t.name],
      status: t.status,
    }))
    .filter(r => Math.abs(r.scoreDelta) > 0.3);

  const climbers = [...rows].sort((a,b) => b.scoreDelta - a.scoreDelta).slice(0, 5);
  const fallers  = [...rows].sort((a,b) => a.scoreDelta - b.scoreDelta).slice(0, 5);

  return { climbers, fallers, lookbackDays: lookback };
}

// ── Build Momentum Scan ──────────────────────────────────────────────────────

function buildMomentumScan(rawResults) {
  const eligible = rawResults.filter(r => r.metrics != null && r.metrics.avgDollarVol20d != null);

  function rankWindow(key, minCandles) {
    return eligible
      .filter(r => r.metrics[key] != null && r.candles?.length >= minCandles)
      .sort((a,b) => (b.metrics[key]??-999) - (a.metrics[key]??-999))
      .slice(0, 25)
      .map((r, i) => ({
        rank: i + 1,
        symbol: r.asset.symbol,
        name: r.asset.name,
        theme: r.asset.theme,
        subtheme: r.asset.subtheme,
        tier: r.asset.tier,
        price: r.metrics.price,
        avgDollarVol20d: r.metrics.avgDollarVol20d,
        abs1w: r.metrics.abs1w,
        abs1m: r.metrics.abs1m,
        abs3m: r.metrics.abs3m,
        abs6m: r.metrics.abs6m,
        rel1w: r.metrics.rel1w,
        rel1m: r.metrics.rel1m,
        rel3m: r.metrics.rel3m,
        rel6m: r.metrics.rel6m,
        ret1d: r.metrics.ret1d,
        distMa50: r.metrics.distMa50,
        atrExt50ma: r.metrics.atrExt50ma,
        volRatio: r.metrics.volRatio,
        above20: r.metrics.above20,
        above50: r.metrics.above50,
      }));
  }

  return {
    '1W': rankWindow('abs1w', 5),
    '1M': rankWindow('abs1m', 21),
    '3M': rankWindow('abs3m', 63),
    '6M': rankWindow('abs6m', 126),
  };
}

// ── Build Style Rotation ──────────────────────────────────────────────────────

function buildStyleRotation(rawResults) {
  const metricsMap = {};
  for (const r of rawResults) {
    if (r.metrics) metricsMap[r.asset.symbol] = r.metrics;
  }

  return ROTATION_PAIRS.map(p => {
    const am = metricsMap[p.a];
    const bm = metricsMap[p.b];
    const diff = (a, b) => (a != null && b != null) ? a - b : null;
    return {
      label: p.label,
      desc: p.desc,
      ret1d:  diff(am?.ret1d,  bm?.ret1d),
      ret5d:  diff(am?.ret5d,  bm?.ret5d),
      ret20d: diff(am?.ret20d, bm?.ret20d),
    };
  });
}

// ── Build Risk Pulse ─────────────────────────────────────────────────────────

function buildRiskPulse(rawResults) {
  const metricsMap = {};
  for (const r of rawResults) {
    if (r.metrics) metricsMap[r.asset.symbol] = r.metrics;
  }

  const pulse = [
    { label: 'ETH / BTC',  context: 'alt vs defensive',   a: 'ETH',  b: 'BTC'  },
    { label: 'DOGE / BTC', context: 'speculation signal',  a: 'DOGE', b: 'BTC'  },
    { label: 'BTC',        context: 'market anchor',       a: 'BTC',  b: null   },
    { label: 'SOL',        context: 'high-beta L1',        a: 'SOL',  b: null   },
    { label: 'LINK',       context: 'defensive infra',     a: 'LINK', b: null   },
  ];

  return pulse.map(p => {
    const am = metricsMap[p.a];
    const bm = p.b ? metricsMap[p.b] : null;
    const diff = (a, b) => (a != null && b != null) ? a - b : a ?? null;
    return {
      label: p.label,
      context: p.context,
      ret1d:  bm ? diff(am?.ret1d,  bm?.ret1d)  : am?.ret1d  ?? null,
      ret5d:  bm ? diff(am?.ret5d,  bm?.ret5d)  : am?.ret5d  ?? null,
      ret20d: bm ? diff(am?.ret20d, bm?.ret20d) : am?.ret20d ?? null,
      distMa50: am?.distMa50 ?? null,
    };
  });
}

// ── Build Theme Sector Rotation ───────────────────────────────────────────────

function buildThemeSectorRotation(themes) {
  return [...themes]
    .filter(t => t.avg_rs_btc_20d != null)
    .sort((a, b) => (b.avg_rs_btc_20d ?? -99) - (a.avg_rs_btc_20d ?? -99))
    .map(t => ({
      theme: t.name,
      rs_btc_20d: t.avg_rs_btc_20d,
      ret5d: t.avgRet5d,
      ret20d: t.avgRet20,
      score: t.score,
      status: t.status,
    }));
}

// ── Build Breadth Series ─────────────────────────────────────────────────────

function buildBreadthSeries(rawResults) {
  const themeMap = {};
  for (const r of rawResults) {
    if (!r.metrics) continue;
    const t = r.asset.theme;
    if (!themeMap[t]) themeMap[t] = { above20: 0, above50: 0, above200: 0, total: 0 };
    themeMap[t].total++;
    if (r.metrics.above20  === 1) themeMap[t].above20++;
    if (r.metrics.above50  === 1) themeMap[t].above50++;
    if (r.metrics.above200 === 1) themeMap[t].above200++;
  }

  const themeBreadth = Object.entries(themeMap).map(([name, d]) => ({
    name,
    pctAbove20:  d.total ? Math.round(d.above20  / d.total * 100) : 0,
    pctAbove50:  d.total ? Math.round(d.above50  / d.total * 100) : 0,
    pctAbove200: d.total ? Math.round(d.above200 / d.total * 100) : 0,
    total: d.total,
  }));

  const btcResult = rawResults.find(r => r.asset.symbol === 'BTC');
  const dates = btcResult?.candles
    ?.slice(-30)
    .map(c => {
      const d = new Date(c.ts);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }) ?? [];

  const btcResult2 = rawResults.find(r => r.asset.symbol === 'BTC');
  const days = btcResult2?.metrics?.sparkline?.length ?? 30;

  const dailySeries = [];
  for (let i = 0; i < days; i++) {
    let advancers = 0, decliners = 0, total = 0;
    for (const r of rawResults) {
      if (!r.metrics?.sparkline || r.metrics.sparkline.length < days) continue;
      total++;
      const sl = r.metrics.sparkline;
      const todayClose = sl[i];
      const prevClose  = i > 0 ? sl[i-1] : null;
      if (prevClose != null) {
        if (todayClose > prevClose) advancers++;
        else if (todayClose < prevClose) decliners++;
      }
    }
    dailySeries.push({ day: i - days + 1, advancers, decliners, adDiff: advancers - decliners, total });
  }

  const newHigh20dSeries = [];
  for (let i = 0; i < days; i++) {
    let nhCount = 0;
    for (const r of rawResults) {
      if (!r.metrics?.sparkline || r.metrics.sparkline.length < days) continue;
      const sl = r.metrics.sparkline;
      const window = sl.slice(Math.max(0, i - 19), i + 1);
      if (sl[i] >= Math.max(...window)) nhCount++;
    }
    newHigh20dSeries.push(nhCount);
  }

  return { themeBreadth, dailySeries, dates, newHigh20dSeries };
}

// ── Build Regime Label ────────────────────────────────────────────────────────

function buildRegimeLabel(regime) {
  const pct50  = regime.pctAbove50  ?? 0;
  const pct200 = regime.pctAbove200 ?? 0;

  if (pct50 >= 60 && pct200 >= 55) return { label: 'RISK-ON',        color: 'green'  };
  if (pct50 >= 50)                  return { label: 'RISK-ON/NARROW', color: 'blue'   };
  if (pct50 <= 35)                  return { label: 'RISK-OFF',       color: 'red'    };
  return                                   { label: 'MIXED',          color: 'neutral' };
}

// ── Main Engine ──────────────────────────────────────────────────────────────

async function fetchWithPool(tasks, concurrency = 8) {
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

// ── Traditional Market Analysis ──────────────────────────────────────────────
// Fetch and compute metrics for traditional market assets (ETFs, stocks via xStocks)

function computeTradMetrics(candles) {
  if (!candles || candles.length < 20) return null;
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const vols   = candles.map(c => c.vol);
  const n = closes.length;

  const price = closes[n - 1];
  const ma20  = sma(closes, 20);
  const ma50  = sma(closes, 50);
  const ma200 = sma(closes, 200);

  const ret1d  = n >= 2  ? (closes[n-1] / closes[n-2]  - 1) : null;
  const ret5d  = n >= 6  ? (closes[n-1] / closes[n-6]  - 1) : null;
  const ret20d = n >= 21 ? (closes[n-1] / closes[n-21] - 1) : null;
  const ret60d = n >= 61 ? (closes[n-1] / closes[n-61] - 1) : null;

  const above20  = ma20  != null ? (price > ma20  ? 1 : 0) : null;
  const above50  = ma50  != null ? (price > ma50  ? 1 : 0) : null;
  const above200 = ma200 != null ? (price > ma200 ? 1 : 0) : null;

  // ATR
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
    trueRanges.push(tr);
  }
  let atr14 = null;
  if (trueRanges.length >= 14) {
    atr14 = trueRanges.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
    const alpha = 1 / 14;
    for (let i = 14; i < trueRanges.length; i++) {
      atr14 = trueRanges[i] * alpha + atr14 * (1 - alpha);
    }
  }

  const atrExt50ma = (ma50 != null && atr14 != null && atr14 > 0) ? (price - ma50) / atr14 : null;

  const volMa20 = sma(vols, 20);
  const volRatio = (volMa20 && volMa20 > 0) ? vols[n-1] / volMa20 : null;

  const distMa20  = ma20  != null ? (price / ma20  - 1) * 100 : null;
  const distMa50  = ma50  != null ? (price / ma50  - 1) * 100 : null;
  const distMa200 = ma200 != null ? (price / ma200 - 1) * 100 : null;

  const sparkline = closes.slice(-30);

  return {
    price, ma20, ma50, ma200,
    ret1d, ret5d, ret20d, ret60d,
    above20, above50, above200,
    atr14, atrExt50ma, volRatio,
    distMa20, distMa50, distMa200,
    sparkline,
  };
}

export async function runBoardAnalysis(exchange, onProgress) {
  onProgress({ phase: 'preloading', message: 'Loading exchange instruments…' });
  await preloadExchange(exchange);

  const allAssets = CRYPTO_UNIVERSE;
  onProgress({ phase: 'fetching', message: `Fetching candles for ${allAssets.length} assets…`, done: 0, total: allAssets.length });

  let done = 0;
  const tasks = allAssets.map(asset => async () => {
    const candles = await fetchCandles(asset.symbol, exchange, TIMEFRAME);
    done++;
    onProgress({ phase: 'fetching', done, total: allAssets.length, message: `${done}/${allAssets.length} fetched…` });
    if (!candles || candles.length < 20) return { asset, metrics: null, candles: null };
    const metrics = computeMetrics(candles);
    return { asset, metrics, candles };
  });

  const rawResults = await fetchWithPool(tasks, 8);

  onProgress({ phase: 'computing', message: 'Computing metrics & scores…' });

  // Compute RS vs BTC for each asset
  const btcRet20d = rawResults.find(r => r.asset.symbol === 'BTC')?.metrics?.ret20d ?? 0;
  for (const r of rawResults) {
    if (r.metrics) {
      r.metrics.rs_btc_20d = r.metrics.ret20d != null
        ? r.metrics.ret20d - btcRet20d
        : null;
    }
  }

  // Regime / Breadth
  const allMetrics = rawResults.filter(r => r.metrics != null);
  const total = allMetrics.length;

  const universeAbove20    = allMetrics.filter(r => r.metrics.above20  === 1).length;
  const universeAbove50    = allMetrics.filter(r => r.metrics.above50  === 1).length;
  const universeAbove200   = allMetrics.filter(r => r.metrics.above200 === 1).length;
  const universeNewHigh    = allMetrics.filter(r => r.metrics.newHigh20d === 1).length;
  const universeNewHigh52w  = allMetrics.filter(r => r.metrics.newHigh52w === 1).length;
  const upBig   = allMetrics.filter(r => r.metrics.ret1d != null && r.metrics.ret1d > 0.04).length;
  const downBig = allMetrics.filter(r => r.metrics.ret1d != null && r.metrics.ret1d < -0.04).length;

  const regime = {
    total,
    pctAbove20:  total ? Math.round(universeAbove20  / total * 100) : 0,
    pctAbove50:  total ? Math.round(universeAbove50  / total * 100) : 0,
    pctAbove200: total ? Math.round(universeAbove200 / total * 100) : 0,
    newHigh20d:  universeNewHigh,
    newHigh52w:  universeNewHigh52w,
    upBig, downBig,
  };

  const regimeLabel = buildRegimeLabel(regime);

  // Benchmark snapshot
  const benchmarks = BENCHMARKS.map(b => {
    const found = rawResults.find(r => r.asset.symbol === b.symbol);
    return { ...b, metrics: found?.metrics ?? null };
  });

  // Theme Scores
  const themeMap = {};
  for (const r of rawResults) {
    const theme = r.asset.theme;
    if (!themeMap[theme]) themeMap[theme] = [];
    themeMap[theme].push({ ...r.metrics, rs_btc_20d: r.metrics?.rs_btc_20d });
  }

  const themes = Object.entries(themeMap).map(([name, metrics]) => {
    const scored = scoreTheme(metrics, name);
    if (!scored) return null;
    const delta = (scored.pctAbove20 - 50) / 10;
    const status = themeStatus(scored.score, delta, scored.avgAtrExt);
    return { name, ...scored, delta, status };
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  // Theme constituents
  const constituents = {};
  for (const r of rawResults) {
    const theme = r.asset.theme;
    if (!constituents[theme]) constituents[theme] = [];
    if (r.metrics) {
      constituents[theme].push({
        ...r.asset,
        ...r.metrics,
        rs_btc_20d: r.metrics.rs_btc_20d,
        newHigh20d: r.metrics.newHigh20d,
        newHigh52w: r.metrics.newHigh52w,
      });
    }
  }

  // Theme Rotation
  const themeRotation = buildThemeRotation(rawResults, themes);

  // Style Rotation
  const styleRotation = buildStyleRotation(rawResults);

  // Risk Pulse
  const riskPulse = buildRiskPulse(rawResults);

  // Theme Sector Rotation
  const themeSectorRotation = buildThemeSectorRotation(themes);

  // Extension Lists
  const coreTier = rawResults.filter(r => r.metrics && (r.asset.tier === 'Core' || r.asset.tier === 'Active'));

  const tooHot = coreTier
    .filter(r => r.metrics.atrExt50ma != null && r.metrics.atrExt50ma >= 4)
    .sort((a, b) => b.metrics.atrExt50ma - a.metrics.atrExt50ma)
    .slice(0, 20)
    .map(r => ({ ...r.asset, ...r.metrics }));

  // Clean Momentum - sorted by rs_btc_20d
  const cleanMomentum = coreTier
    .filter(r => {
      const m = r.metrics;
      return m.above20 === 1 && m.above50 === 1 &&
             m.ret5d > 0 &&
             m.atrExt50ma != null && m.atrExt50ma >= 1 && m.atrExt50ma <= 5 &&
             m.volRatio != null && m.volRatio > 1;
    })
    .sort((a, b) => (b.metrics.rs_btc_20d ?? 0) - (a.metrics.rs_btc_20d ?? 0))
    .slice(0, 25)
    .map(r => ({ ...r.asset, ...r.metrics }));

  const fading = coreTier
    .filter(r => {
      const m = r.metrics;
      return m.above20 === 0 && m.ret5d != null && m.ret5d < -0.03;
    })
    .sort((a, b) => (a.metrics.ret5d ?? 0) - (b.metrics.ret5d ?? 0))
    .slice(0, 20)
    .map(r => ({ ...r.asset, ...r.metrics }));

  // Momentum Scan
  const momentumScan = buildMomentumScan(rawResults);

  // Breadth Series
  const breadthSeries = buildBreadthSeries(rawResults);

  onProgress({ phase: 'complete', message: 'Done' });

  return {
    regime,
    regimeLabel,
    benchmarks,
    themes,
    constituents,
    themeRotation,
    styleRotation,
    riskPulse,
    themeSectorRotation,
    tooHot,
    cleanMomentum,
    fading,
    momentumScan,
    breadthSeries,
    updatedAt: new Date().toLocaleTimeString(),
    assetCount: total,
  };
}