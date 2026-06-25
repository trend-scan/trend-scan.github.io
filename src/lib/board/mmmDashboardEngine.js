/**
 * MMM Macro Regime Suite - Core Dashboard Engine
 *
 * Uses Massive API (crypto) and Kraken xStocks (traditional markets) with fallback proxies.
 * Implements:
 *   - Adaptive Z-Score Framework
 *   - Growth Dashboard (15 proxy inputs)
 *   - Inflation Dashboard (13 proxy inputs)
 *   - Liquidity Dashboard (7 proxy inputs)
 *   - 8-Regime Classifier
 *   - TOTAL3ES Signal Architecture (Ultra6/Core8/Core9/OB1)
 *
 * NO FRED data integration - market-implied signals only
 */

// ─── Data Sources ─────────────────────────────────────────────────────────────

// Kraken xStocks universe (tokenized ETFs)
export const MMM_TRAD_UNIVERSE = [
  // Equity Broad Market
  { symbol: 'SPYx',  krakenPair: 'SPYxUSD',  name: 'S&P 500',      category: 'Equity Broad',    signal: 'SPY'  },
  { symbol: 'QQQx',  krakenPair: 'QQQxUSD',  name: 'Nasdaq 100',   category: 'Equity Broad',    signal: 'QQQ'  },
  { symbol: 'IWMx',  krakenPair: 'IWMxUSD',  name: 'Russell 2000', category: 'Equity Broad',    signal: 'IWM'  },
  { symbol: 'VTIx',  krakenPair: 'VTIxUSD',  name: 'Total Market', category: 'Equity Broad',    signal: 'VTI'  },

  // Sector Rotation
  { symbol: 'XLKx',  krakenPair: 'XLKxUSD',  name: 'Technology',   category: 'Sectors',        signal: 'XLK'  },
  { symbol: 'XLFx',  krakenPair: 'XLFxUSD',  name: 'Financials',   category: 'Sectors',        signal: 'XLF'  },
  { symbol: 'XLYx',  krakenPair: 'XLYxUSD',  name: 'Cons. Disc.',  category: 'Sectors',        signal: 'XLY'  },
  { symbol: 'XLPx',  krakenPair: 'XLPxUSD',  name: 'Cons. Stap.',  category: 'Sectors',        signal: 'XLP'  },
  { symbol: 'XLEx',  krakenPair: 'XLExUSD',  name: 'Energy',       category: 'Sectors',        signal: 'XLE'  },
    { symbol: 'XLVx',  krakenPair: 'XLVxUSD',  name: 'Healthcare',    category: 'Sectors',        signal: 'XLV'  },
  { symbol: 'XLIx',  krakenPair: 'XLIxUSD',  name: 'Industrials',  category: 'Sectors',        signal: 'XLI'  },
  { symbol: 'XLB',  name: 'Materials',       category: 'Sectors',        signal: 'XLB'  },
  { symbol: 'XLRE', name: 'Real Estate',     category: 'Sectors',        signal: 'XLRE' },
  { symbol: 'XLCx',  krakenPair: 'XLCxUSD',  name: 'Comm. Svcs',   category: 'Sectors',        signal: 'XLC'  },
  { symbol: 'XLUx',  krakenPair: 'XLUxUSD',  name: 'Utilities',     category: 'Sectors',        signal: 'XLU'  },

  // Style Rotation
  { symbol: 'VUGx',  krakenPair: 'VUGxUSD',  name: 'US Growth',     category: 'Styles',          signal: 'VUG'  },
  { symbol: 'VTVx',  krakenPair: 'VTVxUSD',  name: 'US Value',     category: 'Styles',          signal: 'VTV'  },
  { symbol: 'MTUMx', krakenPair: 'MTUMxUSD', name: 'Momentum',     category: 'Styles',          signal: 'MTUM' },
  { symbol: 'QUALx', krakenPair: 'QUALxUSD', name: 'Quality',      category: 'Styles',          signal: 'QUAL' },
  { symbol: 'SIZE',  name: 'Size Factor',    category: 'Styles',          signal: 'SIZE'  },

  // Bonds / Rates
  { symbol: 'TLTx',  krakenPair: 'TLTxUSD',  name: '20+ Yr Treas', category: 'Bonds',          signal: 'TLT'  },
  { symbol: 'IEFx',  krakenPair: 'IEFxUSD',  name: '7-10 Yr Trs', category: 'Bonds',          signal: 'IEF'  },
  { symbol: 'LQDx',  krakenPair: 'LQDxUSD',  name: 'Inv. Grade',  category: 'Bonds',          signal: 'LQD'  },
  { symbol: 'HYGx',  krakenPair: 'HYGxUSD',  name: 'High Yield',  category: 'Bonds',          signal: 'HYG'  },
  { symbol: 'BNDx',  krakenPair: 'BNDxUSD',  name: 'Total Bond',   category: 'Bonds',          signal: 'BND'  },

  // Commodities
  { symbol: 'GLDx',  krakenPair: 'GLDxUSD',  name: 'Gold',         category: 'Commodities',    signal: 'GLD'  },
  { symbol: 'SLVx',  krakenPair: 'SLVxUSD',  name: 'Silver',        category: 'Commodities',    signal: 'SLV'  },
  { symbol: 'USOx',  krakenPair: 'USOxUSD',  name: 'Crude Oil',    category: 'Commodities',    signal: 'USO'  },

  // Crypto Proxies
  { symbol: 'MSTRx', krakenPair: 'MSTRxUSD', name: 'MicroStrategy', category: 'Crypto',         signal: 'MSTR' },
  { symbol: 'COINx', krakenPair: 'COINxUSD', name: 'Coinbase',      category: 'Crypto',         signal: 'COIN' },
];

// Crypto universe for Massive API
export const MMM_CRYPTO_UNIVERSE = [
  { symbol: 'BTC',  name: 'Bitcoin',      category: 'Crypto',      signal: 'BTC'   },
  { symbol: 'ETH',  name: 'Ethereum',     category: 'Crypto',      signal: 'ETH'   },
  { symbol: 'SOL',  name: 'Solana',       category: 'Altcoins',     signal: 'SOL'   },
  { symbol: 'BNB',  name: 'BNB',          category: 'Altcoins',     signal: 'BNB'   },
  { symbol: 'XRP',  name: 'Ripple',       category: 'Altcoins',     signal: 'XRP'   },
  { symbol: 'ADA',  name: 'Cardano',      category: 'Altcoins',     signal: 'ADA'   },
  { symbol: 'AVAX', name: 'Avalanche',   category: 'Altcoins',     signal: 'AVAX'  },
  { symbol: 'LINK', name: 'Chainlink',    category: 'DeFi',         signal: 'LINK'  },
  { symbol: 'UNI',  name: 'Uniswap',      category: 'DeFi',         signal: 'UNI'   },
];

// ─── Adaptive Z-Score Framework ─────────────────────────────────────────────

const SHORT_LOOKBACK = 104;  // ~20 trading weeks
const LONG_LOOKBACK  = 260;  // ~52 trading weeks

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr, mu) {
  if (!mu) mu = mean(arr);
  const sq = arr.map(v => (v - mu) ** 2);
  return Math.sqrt(sq.reduce((a, b) => a + b, 0) / arr.length);
}

function adaptiveZscore(shortArr, longArr) {
  const shortMu = mean(shortArr);
  const longMu  = mean(longArr);
  const shortSd = stddev(shortArr, shortMu);
  const longSd  = stddev(longArr, longMu);

  // Avoid division by zero
  if (shortSd === 0 || longSd === 0) return 0;

  const shortZ = (shortArr[shortArr.length - 1] - shortMu) / shortSd;
  const longZ  = (longArr[longArr.length - 1] - longMu) / longSd;

  // Adaptive weighting: 60% short-term, 40% long-term
  return (0.60 * shortZ) + (0.40 * longZ);
}

function zscoreToScore(z) {
  // Convert z-score to 0-100 scale: z=0 → 50, z=±1 → ±10
  return Math.max(0, Math.min(100, 50 + (z * 10)));
}

// ─── Metrics Computation ──────────────────────────────────────────────────────

function computeMetric(candles, period = 20) {
  if (!candles || candles.length < period) return null;
  const closes = candles.map(c => c.close);
  const current = closes[closes.length - 1];
  const ma = mean(closes.slice(-period));
  const ret = candles.length >= 2
    ? (closes[closes.length - 1] / closes[closes.length - 2]) - 1
    : null;
  const ret20d = candles.length >= 21
    ? (closes[closes.length - 1] / closes[closes.length - 21]) - 1
    : null;
  return { current, ma, ret, ret20d, closes };
}

function computeAssetMetrics(asset, candles) {
  if (!candles || candles.length < 5) return null;
  const closes = candles.map(c => c.close);
  const n = closes.length;

  const price = closes[n - 1];
  const ma20  = mean(closes.slice(-Math.min(20, n)));
  const ma50  = mean(closes.slice(-Math.min(50, n)));
  const ma104 = mean(closes.slice(-Math.min(SHORT_LOOKBACK, n)));
  const ma200 = n >= 200 ? mean(closes.slice(-200)) : null;
  const ma260 = mean(closes.slice(-Math.min(LONG_LOOKBACK, n)));

  const ret1d  = n >= 2  ? (closes[n-1] / closes[n-2]  - 1) : null;
  const ret5d  = n >= 6  ? (closes[n-1] / closes[n-6]  - 1) : null;
  const ret20d = n >= 21 ? (closes[n-1] / closes[n-21] - 1) : null;

  // Adaptive z-score
  const shortPeriod = closes.slice(-SHORT_LOOKBACK);
  const longPeriod  = closes.slice(-LONG_LOOKBACK);
  const adaptiveZ   = adaptiveZscore(shortPeriod, longPeriod);
  const score       = zscoreToScore(adaptiveZ);

  // Distance from MAs (ATR normalized)
  const highs = candles.map(c => c.high);
  const lows  = candles.map(c => c.low);
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  }
  const atr14 = trs.length >= 14 ? mean(trs.slice(-14)) : (trs.length > 0 ? mean(trs) : 1);

  const distMa20 = (price - ma20) / atr14;
  const distMa50 = (price - ma50) / atr14;

  return {
    price, ma20, ma50, ma104, ma200, ma260,
    ret1d, ret5d, ret20d,
    adaptiveZ, score,
    distMa20, distMa50,
    aboveMa20: price > ma20 ? 1 : 0,
    aboveMa50: price > ma50 ? 1 : 0,
    aboveMa200: ma200 ? (price > ma200 ? 1 : 0) : null,
  };
}

// ─── Data Fetching ───────────────────────────────────────────────────────────

async function fetchKrakenCandles(krakenPair, interval = 1440, limit = 300) {
  try {
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

    // Filter zero-volume candles
    const candles = raw.filter(c => parseFloat(c[6]) > 0).map(c => ({
      ts:    c[0] * 1000,
      open:  parseFloat(c[1]),
      high:  parseFloat(c[2]),
      low:   parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol:   parseFloat(c[6]),
    }));

    return candles.length > 0 ? candles : null;
  } catch (e) {
    console.warn(`Failed to fetch ${krakenPair}:`, e.message);
    return null;
  }
}

// Replaced the malformed Massive fetcher with the multi-source resolver.
// The old implementation had:
//   1. URL missing /range/{multiplier}/{timespan}/{from}/{to} path segments
//   2. Bogus 'mmapitoken' auth header (Polygon doesn't recognize this)
//   3. No localStorage fallback (only env var, which doesn't work for runtime keys)
// The resolver handles all of this correctly and falls back across CoinGecko,
// Hyperliquid, Bybit, OKX SWAP perps, Lighter, etc.
async function fetchMassiveCandles(symbol, range = '1/day', limit = 300) {
  try {
    // Lazy import to avoid circular dependency
    const { fetchCandles } = await import('../scanner/sourceResolver.js');
    // Map Massive-style range ('1/day') to our timeframe ('1D')
    const tf = range.includes('day') ? '1D' :
               range.includes('hour') ? '1H' :
               range.includes('week') ? '1w' : '1D';
    const { candles } = await fetchCandles(symbol, { timeframe: tf, limit });
    if (!candles) return null;
    return candles.map(c => ({
      ts:    c.ts,
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
      vol:   c.vol,
    }));
  } catch (e) {
    console.warn(`Failed to fetch ${symbol} via resolver:`, e.message);
    return null;
  }
}

// ─── MMM Dashboard Computations ──────────────────────────────────────────────

/**
 * Growth Dashboard - 15 proxy inputs
 * Uses market-implied signals instead of economic data
 */
function computeGrowthDashboard(assetMetrics) {
  const signals = [];

  // Equity Broad (4 signals)
  const spy = assetMetrics['SPYx'] || assetMetrics['SPY'];
  const qqq = assetMetrics['QQQx'] || assetMetrics['QQQ'];
  const iwm = assetMetrics['IWMx'] || assetMetrics['IWM'];
  const vti = assetMetrics['VTIx'] || assetMetrics['VTI'];

  if (qqq?.aboveMa50) signals.push({ name: 'QQQ > 50MA', on: qqq.aboveMa50, score: qqq.score });
  if (spy?.aboveMa50) signals.push({ name: 'SPY > 50MA', on: spy.aboveMa50, score: spy.score });
  if (qqq?.ret20d != null && spy?.ret20d != null) signals.push({ name: 'QQQ > SPY 20D', on: qqq.ret20d > spy.ret20d ? 1 : 0, score: Math.round(50 + ((qqq.ret20d - spy.ret20d) * 500)) });
  if (iwm?.aboveMa50) signals.push({ name: 'IWM > 50MA', on: iwm.aboveMa50, score: iwm.score });

  // Sector Rotation (4 signals)
  const xlk = assetMetrics['XLKx'] || assetMetrics['XLK'];
  const xlf = assetMetrics['XLFx'] || assetMetrics['XLF'];
  const xly = assetMetrics['XLYx'] || assetMetrics['XLY'];
  const xlp = assetMetrics['XLPx'] || assetMetrics['XLP'];

  if (xlk?.aboveMa50 && xlf?.aboveMa50) signals.push({ name: 'Tech Lead', on: xlk.ret20d > xlf.ret20d ? 1 : 0, score: Math.round(50 + ((xlk.ret20d - xlf.ret20d) * 500)) });
  if (xly?.aboveMa50 && xlp?.aboveMa50) signals.push({ name: 'Disc > Stap', on: xly.ret20d > xlp.ret20d ? 1 : 0, score: Math.round(50 + ((xly.ret20d - xlp.ret20d) * 500)) });
  if (xly?.aboveMa50) signals.push({ name: 'XLY > 50MA', on: xly.aboveMa50, score: xly.score });
  if (xlp?.aboveMa50) signals.push({ name: 'XLP > 50MA', on: xlp.aboveMa50, score: xlp.score });

  // Style Rotation (3 signals)
  const vug = assetMetrics['VUGx'] || assetMetrics['VUG'];
  const vtv = assetMetrics['VTVx'] || assetMetrics['VTV'];
  const mtum = assetMetrics['MTUMx'] || assetMetrics['MTUM'];

  if (vug?.aboveMa50 && vtv?.aboveMa50) signals.push({ name: 'Growth > Value', on: vug.ret20d > vtv.ret20d ? 1 : 0, score: Math.round(50 + ((vug.ret20d - vtv.ret20d) * 500)) });
  if (mtum?.aboveMa50) signals.push({ name: 'MTUM > 50MA', on: mtum.aboveMa50, score: mtum.score });
  if (vug?.ret20d != null && spy?.ret20d != null) signals.push({ name: 'VUG > SPY 20D', on: vug.ret20d > spy.ret20d ? 1 : 0, score: Math.round(50 + ((vug.ret20d - spy.ret20d) * 500)) });

  // Breadth (4 signals - estimated from multiple assets)
  const aboveCount = [qqq, spy, iwm, vti, xlk, xlf, xly, xlp, vug, vtv].filter(a => a?.aboveMa50 === 1).length;
  const totalCount = [qqq, spy, iwm, vti, xlk, xlf, xly, xlp, vug, vtv].filter(a => a != null).length;
  const breadthPct = totalCount > 0 ? (aboveCount / totalCount) * 100 : 50;

  signals.push({ name: 'Breadth > 60%', on: breadthPct >= 60 ? 1 : 0, score: Math.round(breadthPct) });
  signals.push({ name: 'Breadth > 40%', on: breadthPct >= 40 ? 1 : 0, score: Math.round(breadthPct) });
  signals.push({ name: 'All Majors > MA50', on: [qqq, spy, iwm].filter(a => a?.aboveMa50 === 1).length >= 2 ? 1 : 0, score: Math.round(([qqq, spy, iwm].filter(a => a?.aboveMa50 === 1).length / 3) * 100) });
  signals.push({ name: 'Sector Breadth > 50%', on: [xlk, xlf, xly, xlp, xlv, xle].filter(a => a?.aboveMa50 === 1).length >= 3 ? 1 : 0, score: Math.round(([xlk, xlf, xly, xlp].filter(a => a?.aboveMa50 === 1).length / 4) * 100) });

  // Composite score
  const onCount = signals.filter(s => s.on === 1).length;
  const avgScore = signals.length > 0 ? signals.reduce((a, s) => a + s.score, 0) / signals.length : 50;

  return {
    signals,
    onCount,
    totalSignals: signals.length,
    compositeScore: Math.round(avgScore),
    regime: avgScore >= 65 ? 'Expansion' : avgScore >= 45 ? 'Neutral' : 'Contraction',
  };
}

/**
 * Inflation Dashboard - 13 proxy inputs
 * Uses bond/commodity signals instead of CPI data
 */
function computeInflationDashboard(assetMetrics) {
  const signals = [];

  // Bond Signals (4 signals)
  const tlt = assetMetrics['TLTx'] || assetMetrics['TLT'];
  const ief = assetMetrics['IEFx'] || assetMetrics['IEF'];
  const lqd = assetMetrics['LQDx'] || assetMetrics['LQD'];
  const hyg = assetMetrics['HYGx'] || assetMetrics['HYG'];

  // Rising yields = inflation pressure, falling yields = deflation
  if (tlt?.ret20d != null) {
    const treasSignal = tlt.ret20d < -0.05 ? 1 : 0; // TLT down >5% = yields up
    signals.push({ name: 'TLT < -5% 20D', on: treasSignal, score: Math.round(50 - (tlt.ret20d * 200)) });
  }
  if (ief?.aboveMa50) signals.push({ name: 'IEF > 50MA', on: ief.aboveMa50 ? 0 : 1, score: 50 }); // Inverse for inflation
  if (lqd?.aboveMa50) signals.push({ name: 'LQD > 50MA', on: lqd.aboveMa50, score: lqd.score });
  if (hyg?.aboveMa50) signals.push({ name: 'HYG > 50MA', on: hyg.aboveMa50, score: hyg.score });

  // Credit Spreads (2 signals)
  // Tight spreads = benign, Wide spreads = stress/inflation
  if (lqd?.aboveMa50 && hyg?.aboveMa50) {
    const spreadSignal = (hyg.ret20d - lqd.ret20d) > -0.02 ? 1 : 0;
    signals.push({ name: 'Credit Spreads Tight', on: spreadSignal, score: Math.round(50 + ((hyg.ret20d - lqd.ret20d) * 1000)) });
  }
  signals.push({ name: 'HYG > LQD 20D', on: hyg?.ret20d > lqd?.ret20d ? 1 : 0, score: Math.round(50 + ((hyg.ret20d - lqd.ret20d) * 500)) });

  // Commodity Signals (4 signals)
  const gld = assetMetrics['GLDx'] || assetMetrics['GLD'];
  const slv = assetMetrics['SLVx'] || assetMetrics['SLV'];
  const uso = assetMetrics['USOx'] || assetMetrics['USO'];

  if (gld?.aboveMa50) signals.push({ name: 'GLD > 50MA', on: gld.aboveMa50, score: gld.score });
  if (slv?.aboveMa50) signals.push({ name: 'SLV > 50MA', on: slv.aboveMa50, score: slv.score });
  if (uso?.aboveMa50) signals.push({ name: 'USO > 50MA', on: uso.aboveMa50, score: uso.score });
  if (gld?.ret20d != null && slv?.ret20d != null) {
    const metalsUp = gld.ret20d > 0 && slv.ret20d > 0 ? 1 : 0;
    signals.push({ name: 'Metals Rising', on: metalsUp, score: Math.round(50 + ((gld.ret20d + slv.ret20d) * 250)) });
  }

  // Growth Proxy (3 signals - inverse for inflation)
  const qqq = assetMetrics['QQQx'] || assetMetrics['QQQ'];
  const spy = assetMetrics['SPYx'] || assetMetrics['SPY'];

  // Strong growth = inflation pressure; Weak growth = deflation
  if (qqq?.aboveMa50) signals.push({ name: 'QQQ Growth Signal', on: qqq.ret20d > 0 ? 1 : 0, score: qqq.score });
  if (spy?.aboveMa50) signals.push({ name: 'SPY Growth Signal', on: spy.ret20d > 0 ? 1 : 0, score: spy.score });
  if (qqq?.ret20d != null && tlt?.ret20d != null) {
    // Equities up + Bonds down = reflation; Both down = stagflation
    const stagflation = qqq.ret20d < 0 && tlt.ret20d < 0 ? 1 : 0;
    signals.push({ name: 'Stagflation Risk', on: stagflation, score: Math.round(50 + (stagflation * 30)) });
  }

  const onCount = signals.filter(s => s.on === 1).length;
  const avgScore = signals.length > 0 ? signals.reduce((a, s) => a + s.score, 0) / signals.length : 50;

  return {
    signals,
    onCount,
    totalSignals: signals.length,
    compositeScore: Math.round(avgScore),
    regime: avgScore >= 60 ? 'Hot' : avgScore >= 45 ? 'Reflation' : 'Disinflation',
  };
}

/**
 * Liquidity Dashboard - 7 proxy inputs
 * Uses market-based liquidity signals
 */
function computeLiquidityDashboard(assetMetrics) {
  const signals = [];

  // Risk-On/Risk-Off (3 signals)
  const spy = assetMetrics['SPYx'] || assetMetrics['SPY'];
  const tlt = assetMetrics['TLTx'] || assetMetrics['TLT'];
  const gld = assetMetrics['GLDx'] || assetMetrics['GLD'];
  const hyg = assetMetrics['HYGx'] || assetMetrics['HYG'];
    const lqd = assetMetrics['LQDx'] || assetMetrics['LQD'];

  // Risk-On: Equities up, Bonds down, High Yield up
  if (spy?.aboveMa50) signals.push({ name: 'Risk-On: SPY > MA50', on: spy.aboveMa50, score: spy.score });
  if (tlt?.ret20d != null) signals.push({ name: 'Tight: TLT < 0 20D', on: tlt.ret20d < 0 ? 1 : 0, score: Math.round(50 - (tlt.ret20d * 200)) });
  if (hyg?.aboveMa50) signals.push({ name: 'Risk-On: HYG > MA50', on: hyg.aboveMa50, score: hyg.score });

  // Credit Quality (2 signals)
  if (hyg?.ret20d != null && spy?.ret20d != null) {
    const creditOk = hyg.ret20d > -0.05 && spy.ret20d > -0.05 ? 1 : 0;
    signals.push({ name: 'Credit Quality OK', on: creditOk, score: Math.round(50 + ((hyg.ret20d + spy.ret20d) * 250)) });
  }
  if (lqd?.aboveMa50) signals.push({ name: 'LQD > 50MA', on: lqd.aboveMa50, score: lqd.score });

  // Safe Haven Demand (2 signals)
  if (gld?.aboveMa50) signals.push({ name: 'Gold Signal', on: gld.aboveMa50, score: gld.score });
  if (tlt?.ret20d != null && spy?.ret20d != null) {
    // Flight to safety: Bonds up + Stocks down
    const flightToSafety = tlt.ret20d > 0 && spy.ret20d < 0 ? 1 : 0;
    signals.push({ name: 'Flight to Safety', on: flightToSafety, score: Math.round(50 - flightToSafety * 30) });
  }

  const onCount = signals.filter(s => s.on === 1).length;
  const avgScore = signals.length > 0 ? signals.reduce((a, s) => a + s.score, 0) / signals.length : 50;

  return {
    signals,
    onCount,
    totalSignals: signals.length,
    compositeScore: Math.round(avgScore),
    regime: avgScore >= 60 ? 'Loose' : avgScore >= 40 ? 'Neutral' : 'Tight',
  };
}

// ─── 8-Regime Classifier ──────────────────────────────────────────────────────

function classifyRegime(growth, inflation, liquidity) {
  // Map dashboard scores to regime dimensions
  const growthScore = growth.compositeScore;
  const inflScore   = inflation.compositeScore;
  const liqScore    = liquidity.compositeScore;

  // Growth regime
  let growthRegime;
  if (growthScore >= 60) growthRegime = 'Expansion';
  else if (growthScore >= 40) growthRegime = 'Neutral';
  else growthRegime = 'Recession';

  // Inflation regime
  let inflRegime;
  if (inflScore >= 65) inflRegime = 'Hot';
  else if (inflScore >= 45) inflRegime = 'Reflation';
  else inflRegime = 'Disinflation';

  // Liquidity regime
  let liqRegime;
  if (liqScore >= 60) liqRegime = 'Loose';
  else if (liqScore >= 40) liqRegime = 'Neutral';
  else liqRegime = 'Tight';

  // Combined regime label
  const regimeLabels = {
    'Expansion-Disinflation-Tight': 'Early Cycle',
    'Expansion-Disinflation-Neutral': 'Early Cycle',
    'Expansion-Disinflation-Loose': 'Mid Cycle',
    'Expansion-Reflation-Tight': 'Mid Cycle',
    'Expansion-Reflation-Neutral': 'Late Cycle',
    'Expansion-Reflation-Loose': 'Late Cycle',
    'Expansion-Hot-Tight': 'Late Cycle',
    'Expansion-Hot-Neutral': 'Late Cycle',
    'Expansion-Hot-Loose': 'Irrational Exuberance',
    'Neutral-Disinflation-Tight': 'Recession',
    'Neutral-Disinflation-Neutral': 'Early Cycle',
    'Neutral-Disinflation-Loose': 'Early Cycle',
    'Neutral-Reflation-Tight': 'Recession',
    'Neutral-Reflation-Neutral': 'Mid Cycle',
    'Neutral-Reflation-Loose': 'Mid Cycle',
    'Neutral-Hot-Tight': 'Stagflation',
    'Neutral-Hot-Neutral': 'Late Cycle',
    'Neutral-Hot-Loose': 'Late Cycle',
    'Recession-Disinflation-Tight': 'Deep Recession',
    'Recession-Disinflation-Neutral': 'Recession',
    'Recession-Disinflation-Loose': 'Recovery',
    'Recession-Reflation-Tight': 'Recession',
    'Recession-Reflation-Neutral': 'Recovery',
    'Recession-Reflation-Loose': 'Recovery',
    'Recession-Hot-Tight': 'Stagflation',
    'Recession-Hot-Neutral': 'Stagflation',
    'Recession-Hot-Loose': 'Late Cycle',
  };

  const key = `${growthRegime}-${inflRegime}-${liqRegime}`;
  const label = regimeLabels[key] || `${growthRegime} / ${liqRegime}`;

  return {
    growthRegime,
    inflRegime,
    liqRegime,
    label,
    confidence: Math.min(growth.onCount / growth.totalSignals, inflation.onCount / inflation.totalSignals, liquidity.onCount / liquidity.totalSignals),
  };
}

// ─── TOTAL3ES Signal Architecture ─────────────────────────────────────────────

function computeTOTAL3ESSignals(assetMetrics, cryptoMetrics) {
  // Ultra6: 6 signals, need >= 4 for ON
  const ultra6 = [];

  // 1. BTC above MA50
  const btc = cryptoMetrics?.['BTC'];
  ultra6.push({ name: 'BTC > MA50', on: btc?.aboveMa50 === 1 ? 1 : 0, score: btc?.score ?? 50 });

  // 2. ETH above MA50
  const eth = cryptoMetrics?.['ETH'];
  ultra6.push({ name: 'ETH > MA50', on: eth?.aboveMa50 === 1 ? 1 : 0, score: eth?.score ?? 50 });

  // 3. BTC RS vs QQQ positive
  const qqq = assetMetrics['QQQx'] || assetMetrics['QQQ'];
  const btcVsQqq = btc?.ret20d != null && qqq?.ret20d != null && btc.ret20d > qqq.ret20d ? 1 : 0;
  ultra6.push({ name: 'BTC RS > QQQ', on: btcVsQqq, score: Math.round(50 + ((btc?.ret20d - qqq?.ret20d) * 500)) });

  // 4. Altcoin strength (ETH BTC ratio)
  const ethBtcRatio = eth?.ret20d != null && btc?.ret20d != null ? eth.ret20d - btc.ret20d : 0;
  ultra6.push({ name: 'ETH > BTC 20D', on: ethBtcRatio > 0 ? 1 : 0, score: Math.round(50 + (ethBtcRatio * 500)) });

  // 5. Risk-on equities
  const spy = assetMetrics['SPYx'] || assetMetrics['SPY'];
  ultra6.push({ name: 'SPY > MA50', on: spy?.aboveMa50 === 1 ? 1 : 0, score: spy?.score ?? 50 });

  // 6. Gold as risk indicator
  const gld = assetMetrics['GLDx'] || assetMetrics['GLD'];
  ultra6.push({ name: 'Gold Stable', on: gld?.ret20d != null && Math.abs(gld.ret20d) < 0.05 ? 1 : 0, score: Math.round(50 + ((0.05 - Math.abs(gld?.ret20d ?? 0)) * 500)) });

  const u6On = ultra6.filter(s => s.on === 1).length;
  const u6Score = ultra6.reduce((a, s) => a + s.score, 0) / ultra6.length;
  const ultra6On = u6On >= 4;

  // Core8: 8 signals, need >= 5 for ON
  const core8 = [...ultra6];

  // 7. SOL strength
  const sol = cryptoMetrics?.['SOL'];
  core8.push({ name: 'SOL > MA50', on: sol?.aboveMa50 === 1 ? 1 : 0, score: sol?.score ?? 50 });

  // 8. Credit spreads
  const hyg = assetMetrics['HYGx'] || assetMetrics['HYG'];
  core8.push({ name: 'HYG > MA50', on: hyg?.aboveMa50 === 1 ? 1 : 0, score: hyg?.score ?? 50 });

  const c8On = core8.filter(s => s.on === 1).length;
  const c8Score = core8.reduce((a, s) => a + s.score, 0) / core8.length;
  const core8On = c8On >= 5;

  // Core9: 9 signals, need >= 6 for ON (includes LINK for DeFi)
  const core9 = [...core8];
  const link = cryptoMetrics?.['LINK'];
  core9.push({ name: 'LINK > MA50', on: link?.aboveMa50 === 1 ? 1 : 0, score: link?.score ?? 50 });

  const c9On = core9.filter(s => s.on === 1).length;
  const c9Score = core9.reduce((a, s) => a + s.score, 0) / core9.length;
  const core9On = c9On >= 6;

  // OB1: 6 signals, need >= 3 for ON (conservative)
  const ob1 = ultra6.slice(0, 6); // Same 6 as Ultra6
  const ob1On = ob1.filter(s => s.on === 1).length;
  const ob1Score = ob1.reduce((a, s) => a + s.score, 0) / ob1.length;
  const ob1Signal = ob1On >= 3;

  // Master signal: Ultra6 AND OB1 both ON
  const masterSignal = ultra6On && ob1Signal;

  // Allocation tier
  let tier;
  if (masterSignal) tier = 'FULL (100%)';
  else if (ultra6On) tier = 'MODERATE (75%)';
  else if (ob1Signal) tier = 'LIGHT (50%)';
  else tier = 'CASH (0%)';

  return {
    ultra6: { signals: ultra6, onCount: u6On, score: Math.round(u6Score), isOn: ultra6On },
    core8:  { signals: core8,  onCount: c8On,  score: Math.round(c8Score),  isOn: core8On  },
    core9:  { signals: core9,  onCount: c9On,  score: Math.round(c9Score),  isOn: core9On  },
    ob1:    { signals: ob1,    onCount: ob1On, score: Math.round(ob1Score),  isOn: ob1Signal },
    master: masterSignal,
    tier,
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function runMMMDashboard(onProgress) {
  const tradAssets = MMM_TRAD_UNIVERSE.filter(a => a.krakenPair);
  const cryptoAssets = MMM_CRYPTO_UNIVERSE;

  const totalTasks = tradAssets.length + cryptoAssets.length;
  let completed = 0;

  onProgress?.({ done: 0, total: totalTasks, stage: 'Fetching traditional markets...' });

  // Fetch traditional market data
  const tradMetrics = {};
  for (const asset of tradAssets) {
    const candles = await fetchKrakenCandles(asset.krakenPair);
    if (candles) {
      tradMetrics[asset.signal] = computeAssetMetrics(asset, candles);
    }
    completed++;
    onProgress?.({ done: completed, total: totalTasks, stage: `Fetching ${asset.signal}...` });
  }

  onProgress?.({ done: completed, total: totalTasks, stage: 'Fetching crypto data...' });

  // Fetch crypto data from Massive
  const cryptoMetrics = {};
  for (const asset of cryptoAssets) {
    const candles = await fetchMassiveCandles(asset.symbol);
    if (candles) {
      cryptoMetrics[asset.signal] = computeAssetMetrics(asset, candles);
    }
    completed++;
    onProgress?.({ done: completed, total: totalTasks, stage: `Fetching ${asset.signal}...` });
  }

  onProgress?.({ done: completed, total: totalTasks, stage: 'Computing regimes...' });

  // Compute dashboards
  const growth    = computeGrowthDashboard(tradMetrics);
  const inflation  = computeInflationDashboard(tradMetrics);
  const liquidity  = computeLiquidityDashboard(tradMetrics);
  const regime     = classifyRegime(growth, inflation, liquidity);
  const total3es   = computeTOTAL3ESSignals(tradMetrics, cryptoMetrics);

  return {
    growth,
    inflation,
    liquidity,
    regime,
    total3es,
    tradMetrics,
    cryptoMetrics,
    timestamp: new Date().toISOString(),
  };
}

// ─── Month-End Hold Logic ─────────────────────────────────────────────────────

export function isMonthEndHold() {
  const now = new Date();
  const day = now.getDate();
  const dow = now.getDay(); // 0=Sun, 6=Sat

  // Last 3 trading days of month
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const isLast3Days = day >= daysInMonth - 3;

  // Friday before month-end
  const isFridayBefore = dow === 5 && day >= daysInMonth - 5;

  return isLast3Days || isFridayBefore;
}

// ─── Utility: Get Regime Color ───────────────────────────────────────────────

export function getRegimeColor(label) {
  const colors = {
    'Early Cycle': '#00e676',
    'Mid Cycle': '#69f0ae',
    'Late Cycle': '#ffd54f',
    'Irrational Exuberance': '#ff5252',
    'Recession': '#ef5350',
    'Recovery': '#4caf50',
    'Deep Recession': '#c62828',
    'Stagflation': '#ff7043',
  };
  return colors[label] || '#90a4ae';
}
