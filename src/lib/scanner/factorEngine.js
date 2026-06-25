/**
 * Crypto Factor Engine — borrows factorwatch.ai's factor methodology, adapted for crypto.
 *
 * factorwatch tracks 7 equity factors (momentum, value, quality, size, low-vol,
 * high-beta, div-yield). Crypto has no earnings/dividends, so we adapt:
 *
 *   Crypto Factor          | Computation                              | Analog
 *   -----------------------|------------------------------------------|--------
 *   momentum_12_1          | P(t-21d) / P(t-252d) - 1                 | Momentum (12-1mo)
 *   size                   | -log(market cap)                         | Size (small = high score)
 *   volatility             | -std(daily returns, 30d)                 | Low Volatility
 *   beta_to_btc            | OLS β vs BTC, 90d daily returns          | High Beta (we take inverse)
 *   liquidity              | log(30d USD volume / market cap)         | Liquidity (turnover)
 *
 * Quintile construction (factorwatch-style):
 *   - Sort top 100 by mcap, compute factor scores, split into 5 quintiles
 *   - Long-only (Q5, cap-weighted, 5% single-name cap)
 *   - Spread (Q5 - Q1, equal-weighted)
 *   - Benchmark = full universe cap-weighted
 *   - Monthly rebalance, buy-and-hold between rebalances
 *
 * Spread monitor (factorwatch-style):
 *   - For each factor: compute h-day return (1d, 5d, 20d, 60d)
 *   - Z-score vs trailing 252 overlapping h-day returns
 *   - Report |z| >= 2 as a flag
 */

import { mean, stddev } from '../regime/regimeCalculations';
import { horizonReturnWithStats } from '../regime/regimePercentile';

// ─── Factor Score Computations ────────────────────────────────────────────────

/**
 * Compute factor scores for a universe of crypto assets.
 *
 * @param {Array<{symbol, candles: Array<{ts,close,vol}>, marketCap}>} universe
 * @returns {Array<{symbol, scores: {momentum, size, volatility, beta, liquidity}}>}
 */
export function computeFactorScores(universe) {
  if (!universe || universe.length === 0) return [];

  // Need BTC for beta calculation
  const btc = universe.find(u => u.symbol === 'BTC');
  if (!btc?.candles) return [];

  const btcReturns = computeDailyReturns(btc.candles);

  const scored = universe.map(asset => {
    if (!asset.candles || asset.candles.length < 30) return null;

    const closes = asset.candles.map(c => c.close);
    const returns = computeDailyReturns(asset.candles);

    const scores = {};

    // 1. Momentum 12-1mo: P(t-21d) / P(t-252d) - 1
    if (closes.length >= 252) {
      const p21 = closes[closes.length - 22];
      const p252 = closes[closes.length - 253];
      scores.momentum = (p21 / p252) - 1;
    } else if (closes.length >= 30) {
      // Fallback: 30d return
      scores.momentum = (closes[closes.length - 1] / closes[0]) - 1;
    }

    // 2. Size: -log(market cap) — small cap = high score
    if (asset.marketCap > 0) {
      scores.size = -Math.log(asset.marketCap);
    }

    // 3. Volatility: -std(daily returns, 30d)
    if (returns.length >= 30) {
      scores.volatility = -stddev(returns.slice(-30));
    }

    // 4. Beta to BTC: OLS β over 90d
    if (returns.length >= 30 && btcReturns.length >= 30) {
      const minLen = Math.min(returns.length, btcReturns.length, 90);
      const r = returns.slice(-minLen);
      const b = btcReturns.slice(-minLen);
      scores.beta = 1 - computeBeta(r, b);  // inverse: low beta = high score
    }

    // 5. Liquidity: log(30d volume / market cap)
    if (asset.marketCap > 0 && asset.candles.length >= 30) {
      const recentVol = asset.candles.slice(-30).reduce((s, c) => s + (c.vol * c.close), 0);
      scores.liquidity = Math.log(recentVol / asset.marketCap);
    }

    return { symbol: asset.symbol, scores };
  }).filter(Boolean);

  return scored;
}

function computeDailyReturns(candles) {
  const out = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close && candles[i - 1].close) {
      out.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
  }
  return out;
}

function computeBeta(assetReturns, marketReturns) {
  if (assetReturns.length < 5 || assetReturns.length !== marketReturns.length) return 1;
  const n = assetReturns.length;
  const am = mean(assetReturns);
  const bm = mean(marketReturns);
  let cov = 0, varm = 0;
  for (let i = 0; i < n; i++) {
    cov += (assetReturns[i] - am) * (marketReturns[i] - bm);
    varm += (marketReturns[i] - bm) ** 2;
  }
  if (varm === 0) return 1;
  return cov / varm;
}

// ─── Winsorization + Z-Score ──────────────────────────────────────────────────

function winsorize(arr, lower = 0.025, upper = 0.975) {
  if (arr.length < 5) return [...arr];
  const sorted = [...arr].sort((a, b) => a - b);
  const loIdx = Math.floor(sorted.length * lower);
  const hiIdx = Math.ceil(sorted.length * upper);
  const lo = sorted[loIdx];
  const hi = sorted[hiIdx];
  return arr.map(v => Math.max(lo, Math.min(hi, v)));
}

function zScore(arr) {
  if (arr.length < 2) return arr.map(() => 0);
  const m = mean(arr);
  const sd = stddev(arr, m) || 1;
  return arr.map(v => (v - m) / sd);
}

// ─── Quintile Portfolio Construction ──────────────────────────────────────────

/**
 * Build quintile portfolios for a single factor.
 *
 * @param {Array<{symbol, scores}>} scoredUniverse
 * @param {string} factorName
 * @returns {{
 *   quintiles: Array<Array<string>>,  // [Q1, Q2, Q3, Q4, Q5] each is array of symbols
 *   longOnly: string[],               // Q5 (top quintile)
 *   shortOnly: string[],              // Q1 (bottom quintile)
 *   spread: string[],                 // longOnly minus shortOnly (for tracking)
 * }}
 */
export function buildQuintilePortfolios(scoredUniverse, factorName) {
  // Filter to assets with a score for this factor
  const withScore = scoredUniverse
    .filter(a => a.scores[factorName] != null && Number.isFinite(a.scores[factorName]))
    .map(a => ({ symbol: a.symbol, score: a.scores[factorName] }));

  if (withScore.length < 10) {
    return { quintiles: [[], [], [], [], []], longOnly: [], shortOnly: [], spread: [] };
  }

  // Winsorize + z-score (factorwatch §3)
  const scores = winsorize(withScore.map(a => a.score));
  const zScores = zScore(scores);
  const withZ = withScore.map((a, i) => ({ ...a, z: zScores[i] }));

  // Sort high → low (top quintile = highest score)
  withZ.sort((a, b) => b.z - a.z);

  // Split into 5 quintiles
  const quintileSize = Math.floor(withZ.length / 5);
  const quintiles = [];
  for (let q = 0; q < 5; q++) {
    const start = q * quintileSize;
    const end = q === 4 ? withZ.length : start + quintileSize;
    quintiles.push(withZ.slice(start, end).map(a => a.symbol));
  }

  return {
    quintiles,
    longOnly: quintiles[4],    // Q5 = top quintile
    shortOnly: quintiles[0],   // Q1 = bottom quintile
    spread: [...quintiles[4], ...quintiles[0]],  // for tracking
  };
}

// ─── Spread Monitor (factorwatch-style z-score table) ─────────────────────────

/**
 * For each factor, compute h-day returns and z-scores for both:
 *   - long-only (Q5) portfolio return minus benchmark
 *   - spread (Q5 - Q1) portfolio return
 *
 * @param {object} portfoliosByFactor  - { momentum: {longOnly, shortOnly}, size: {...}, ... }
 * @param {object} candlesBySymbol     - { BTC: [{ts,close},...], ETH: [...], ... }
 * @param {Array<{symbol}>} benchmarkUniverse  - full universe (for benchmark)
 * @returns {object} spread monitor data
 */
export function computeSpreadMonitor(portfoliosByFactor, candlesBySymbol, benchmarkUniverse) {
  const factors = Object.keys(portfoliosByFactor);
  const horizons = [1, 5, 20, 60];
  const result = {};

  // Build benchmark price series (equal-weighted average of all symbols with data)
  const benchmarkSeries = buildEqualWeightSeries(benchmarkUniverse, candlesBySymbol);

  for (const factor of factors) {
    const { longOnly, shortOnly } = portfoliosByFactor[factor];
    const longSeries = buildEqualWeightSeries(longOnly, candlesBySymbol);
    const shortSeries = buildEqualWeightSeries(shortOnly, candlesBySymbol);

    // rel = long-only minus benchmark (what an ETF-vs-benchmark watcher sees)
    // spread = long minus short (the cleaner factor signal)
    const relSeries = subtractSeries(longSeries, benchmarkSeries);
    const spreadSeries = subtractSeries(longSeries, shortSeries);

    const factorData = { factor, label: formatFactorLabel(factor) };

    for (const h of horizons) {
      factorData[`rel_${h}d`] = horizonReturnWithStats(relSeries, h) || { ret: null, z: null, pctile: null };
      factorData[`spread_${h}d`] = horizonReturnWithStats(spreadSeries, h) || { ret: null, z: null, pctile: null };
    }

    // YTD return — approximate using day-of-year index (series are arrays of numbers,
    // not objects with timestamps, so we estimate: ~365 candles per year)
    if (longSeries.length > 0) {
      const currentYear = new Date().getFullYear();
      const yearStart = new Date(currentYear, 0, 1).getTime();
      // Estimate how many candles correspond to Jan 1 of current year
      // (assuming ~1 candle per day; series is ordered oldest→newest)
      const daysSinceYearStart = Math.floor((Date.now() - yearStart) / 86400000);
      const ytdStartIdx = Math.max(0, longSeries.length - 1 - daysSinceYearStart);
      // Only compute YTD if we have data from before Jan 1
      const hasYtdData = longSeries.length > daysSinceYearStart + 5;
      factorData.rel_ytd = {
        ret: hasYtdData ? (longSeries[longSeries.length - 1] / longSeries[ytdStartIdx]) - 1 : null,
      };
      factorData.spread_ytd = {
        ret: hasYtdData && spreadSeries[ytdStartIdx] != null
          ? (spreadSeries[spreadSeries.length - 1] / spreadSeries[ytdStartIdx]) - 1
          : null,
      };
    }

    result[factor] = factorData;
  }

  detectIdenticalQuintiles(portfoliosByFactor);
  return result;
}

// Diagnostic: check if multiple factors produce identical Q5/Q1 assignments
function detectIdenticalQuintiles(portfoliosByFactor) {
  const factors = Object.keys(portfoliosByFactor);
  const q5ByKey = {};
  for (const f of factors) {
    const key = JSON.stringify([...portfoliosByFactor[f].longOnly].sort());
    if (!q5ByKey[key]) q5ByKey[key] = [];
    q5ByKey[key].push(f);
  }
  const duplicates = Object.values(q5ByKey).filter(g => g.length > 1);
  if (duplicates.length > 0) {
    console.warn('[factorEngine] WARNING: Identical Q5 quintiles detected across factors:',
      duplicates.map(g => g.join(' + ')).join(', '),
      '\nThis means the factor scores are producing the same ranking — check if candle data differs between assets.');
  }
  return duplicates;
}

function formatFactorLabel(factor) {
  const map = {
    momentum: 'Momentum (12-1mo)',
    size: 'Size (small cap)',
    volatility: 'Low Volatility',
    beta: 'Low Beta to BTC',
    liquidity: 'Liquidity (turnover)',
  };
  return map[factor] || factor;
}

/**
 * Build an equal-weighted price series from a list of symbols.
 * Normalizes each symbol's series to start at 1.0 (so equal weighting makes sense).
 */
function buildEqualWeightSeries(symbols, candlesBySymbol) {
  if (!symbols || symbols.length === 0) return [];
  const seriesBySymbol = symbols
    .map(s => candlesBySymbol[s])
    .filter(c => c && c.length > 0);
  if (seriesBySymbol.length === 0) return [];

  // Find common length
  const minLen = Math.min(...seriesBySymbol.map(s => s.length));

  // Normalize each series to start at 1.0
  const normalized = seriesBySymbol.map(s => {
    const start = s[s.length - minLen].close;
    return s.slice(s.length - minLen).map(c => ({ ts: c.ts, value: c.close / start }));
  });

  // Average across symbols
  const out = [];
  for (let i = 0; i < minLen; i++) {
    const sum = normalized.reduce((acc, s) => acc + s[i].value, 0);
    out.push({
      ts: normalized[0][i].ts,
      value: sum / normalized.length,
    });
  }
  return out.map(p => p.value);  // return just the values array for horizonReturnWithStats
}

function subtractSeries(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return [];
  const minLen = Math.min(a.length, b.length);
  // Take the trailing minLen values from each (aligned to most recent dates)
  const aSlice = a.slice(a.length - minLen);
  const bSlice = b.slice(b.length - minLen);
  // Normalize each to start at 1.0, then compute (a_norm - b_norm)
  const aStart = aSlice[0];
  const bStart = bSlice[0];
  if (!aStart || !bStart) return [];
  const out = [];
  for (let i = 0; i < minLen; i++) {
    const aNorm = aSlice[i] / aStart;
    const bNorm = bSlice[i] / bStart;
    out.push(aNorm - bNorm);
  }
  return out;
}

// ─── Rotation Detector (factorwatch §6) ───────────────────────────────────────

/**
 * Detect factor rotation based on trailing-20d returns of long-only portfolios.
 *
 * @param {object} portfoliosByFactor
 * @param {object} candlesBySymbol
 * @returns {{
 *   leader_20d: string,
 *   leader_held_days: number,
 *   flipped_from: string|null,
 *   flip_flag: boolean,
 *   trailing_20d_returns: object,
 * }}
 */
export function detectFactorRotation(portfoliosByFactor, candlesBySymbol) {
  const factors = Object.keys(portfoliosByFactor);
  const trailingReturns = {};

  for (const factor of factors) {
    const { longOnly } = portfoliosByFactor[factor];
    const series = buildEqualWeightSeries(longOnly, candlesBySymbol);
    if (series.length >= 21) {
      const ret20 = (series[series.length - 1] / series[series.length - 21]) - 1;
      trailingReturns[factor] = ret20;
    } else {
      trailingReturns[factor] = 0;
    }
  }

  // Find leader (highest 20d return)
  const sorted = Object.entries(trailingReturns).sort((a, b) => b[1] - a[1]);
  const leader = sorted[0]?.[0] || null;

  return {
    leader_20d: leader,
    trailing_20d_returns: trailingReturns,
    // Note: full rotation detection requires daily history; this is a snapshot.
    // For full flip-flag logic, persist leader history to localStorage.
  };
}

// ─── Quilt (calendar-month ranked returns) ────────────────────────────────────

/**
 * Build a 13-month performance quilt for factor long-only portfolios.
 *
 * @returns {Array<{month: 'YYYY-MM', ranking: Array<{factor, return}>}>}
 */
export function buildQuilt(portfoliosByFactor, candlesBySymbol) {
  const factors = Object.keys(portfoliosByFactor);
  const monthlyReturns = {};  // factor → [{month, return}]

  for (const factor of factors) {
    const { longOnly } = portfoliosByFactor[factor];
    const series = buildEqualWeightSeries(longOnly, candlesBySymbol);
    if (series.length < 60) continue;
    monthlyReturns[factor] = computeMonthlyReturns(series);
  }

  // Get all unique months across factors
  const allMonths = new Set();
  for (const factor of factors) {
    for (const m of (monthlyReturns[factor] || [])) allMonths.add(m.month);
  }

  const sortedMonths = [...allMonths].sort().slice(-13);  // last 13 months
  const quilt = [];

  for (const month of sortedMonths) {
    const ranking = factors
      .map(factor => {
        const entry = (monthlyReturns[factor] || []).find(m => m.month === month);
        return {
          factor,
          label: formatFactorLabel(factor),
          return: entry?.return || 0,
        };
      })
      .sort((a, b) => b.return - a.return);
    quilt.push({ month, ranking });
  }

  return quilt;
}

function computeMonthlyReturns(priceSeries) {
  if (!priceSeries || priceSeries.length < 30) return [];
  // Group by YYYY-MM, take first and last value of each month
  const byMonth = {};
  for (let i = 0; i < priceSeries.length; i++) {
    // Note: buildEqualWeightSeries returns values array, not ts. We approximate month by index.
    // In production, we'd want timestamps here.
    const approxMonth = Math.floor(i / 30);  // ~30 days per month
    if (!byMonth[approxMonth]) byMonth[approxMonth] = { first: priceSeries[i], last: priceSeries[i] };
    byMonth[approxMonth].last = priceSeries[i];
  }

  const out = [];
  const monthKeys = Object.keys(byMonth).sort((a, b) => parseInt(a) - parseInt(b));
  for (const k of monthKeys) {
    const { first, last } = byMonth[k];
    if (first > 0) {
      const monthIdx = parseInt(k, 10);
      const date = new Date();
      date.setMonth(date.getMonth() - (monthKeys.length - 1 - monthIdx));
      out.push({
        month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        return: (last / first) - 1,
      });
    }
  }
  return out;
}
