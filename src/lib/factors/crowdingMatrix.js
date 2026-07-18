/**
 * Crowding Matrix — pairwise correlation of factor spread series.
 *
 * This is the direct equivalent of factorwatch's correlation/crowding tool.
 * It answers: "are these five factor readings five independent bets, or
 * are they all one bet wearing different hats?"
 *
 * If momentum and high-beta have a 0.95 correlation, they're effectively
 * the same signal — stacking both doesn't diversify. The crowding score
 * caps confidence in the composite engine (crowded → SELECTIVE, not CONSTRUCTIVE).
 *
 * Requires a daily spread return series per factor. In Phase 1, this is
 * computed from the live candle data the Factor Monitor already fetches.
 * In Phase 3, it will use server-side persisted history.
 */

import { mean, stddev } from '../regime/regimeCalculations.js';

/**
 * Compute Pearson correlation between two series.
 *
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} correlation (-1 to 1), or 0 if insufficient data
 */
function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;  // need at least 10 overlapping data points

  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  const sx = stddev(x.slice(0, n));
  const sy = stddev(y.slice(0, n));

  if (sx === 0 || sy === 0) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += ((x[i] - mx) / sx) * ((y[i] - my) / sy);
  }

  return sum / n;
}

/**
 * Build a crowding matrix from daily spread series.
 *
 * @param {object} spreadSeriesByFactor - { momentum: number[], size: number[], ... }
 *   (daily Q5-Q1 spread values, same series computeSpreadMonitor builds)
 * @param {number} [window=90] - trailing window size (days)
 * @returns {{
 *   matrix: object,           // {factorA: {factorB: number, ...}, ...}
 *   maxCorrelation: function, // (factor) => max |corr| vs other factors
 *   avgCorrelation: function, // (factor) => avg |corr| vs other factors
 * }}
 */
export function buildCrowdingMatrix(spreadSeriesByFactor, window = 90) {
  const factors = Object.keys(spreadSeriesByFactor);
  const matrix = {};

  for (const fA of factors) {
    matrix[fA] = {};
    for (const fB of factors) {
      if (fA === fB) {
        matrix[fA][fB] = 1.0;
        continue;
      }

      const seriesA = spreadSeriesByFactor[fA] || [];
      const seriesB = spreadSeriesByFactor[fB] || [];

      // Use trailing window
      const a = seriesA.slice(-window);
      const b = seriesB.slice(-window);

      matrix[fA][fB] = pearsonCorrelation(a, b);
    }
  }

  return {
    matrix,

    /**
     * Get the maximum |correlation| of a factor vs all other factors.
     * This is the "crowding score" used by compositeEngine.
     */
    maxCorrelation(factor) {
      const row = matrix[factor];
      if (!row) return 0;

      let maxAbs = 0;
      for (const [other, corr] of Object.entries(row)) {
        if (other === factor) continue;
        maxAbs = Math.max(maxAbs, Math.abs(corr));
      }
      return maxAbs;
    },

    /**
     * Get the average |correlation| of a factor vs all other factors.
     */
    avgCorrelation(factor) {
      const row = matrix[factor];
      if (!row) return 0;

      let sum = 0;
      let count = 0;
      for (const [other, corr] of Object.entries(row)) {
        if (other === factor) continue;
        sum += Math.abs(corr);
        count++;
      }
      return count > 0 ? sum / count : 0;
    },
  };
}

/**
 * Extract daily spread series from the Factor Monitor's candle data.
 *
 * For each factor, builds a daily Q5-Q1 spread return series by:
 *   1. Computing the equal-weighted Q5 portfolio value series
 *   2. Computing the equal-weighted Q1 portfolio value series
 *   3. Taking the daily return difference (Q5_ret - Q1_ret)
 *
 * This is the same data computeSpreadMonitor uses, just extracted as a
 * time series instead of a single snapshot.
 *
 * @param {object} portfoliosByFactor - {factor: {longOnly: [...], shortOnly: [...]}}
 * @param {object} candlesBySymbol - {symbol: [{ts, open, high, low, close, vol}]}
 * @param {number} [window=90] - max days to extract
 * @returns {object} {factor: number[]} daily spread returns
 */
export function extractSpreadSeries(portfoliosByFactor, candlesBySymbol, window = 90) {
  const series = {};

  for (const [factor, portfolios] of Object.entries(portfoliosByFactor)) {
    const { longOnly, shortOnly } = portfolios;
    if (!longOnly || !shortOnly) continue;

    // Build equal-weighted price series for Q5 and Q1
    const q5Series = buildEqualWeightSeries(longOnly, candlesBySymbol);
    const q1Series = buildEqualWeightSeries(shortOnly, candlesBySymbol);

    if (q5Series.length < 2 || q1Series.length < 2) continue;

    // Compute daily returns
    const q5Returns = computeDailyReturns(q5Series);
    const q1Returns = computeDailyReturns(q1Series);

    // Spread return = Q5 return - Q1 return
    const n = Math.min(q5Returns.length, q1Returns.length, window);
    const spreadReturns = [];
    for (let i = 0; i < n; i++) {
      spreadReturns.push(q5Returns[q5Returns.length - n + i] - q1Returns[q1Returns.length - n + i]);
    }

    series[factor] = spreadReturns;
  }

  return series;
}

/**
 * Build an equal-weighted price series from a list of symbols.
 * Each symbol's closes are normalized to start at 1.0, then averaged.
 */
function buildEqualWeightSeries(symbols, candlesBySymbol) {
  if (!symbols || symbols.length === 0) return [];

  const allCloses = [];
  let maxLen = 0;

  for (const sym of symbols) {
    const candles = candlesBySymbol[sym];
    if (!candles || candles.length === 0) continue;
    const closes = candles.map(c => c.close).filter(c => c != null && c > 0);
    if (closes.length === 0) continue;
    // Normalize to start at 1.0
    const base = closes[0];
    const normalized = closes.map(c => c / base);
    allCloses.push(normalized);
    maxLen = Math.max(maxLen, normalized.length);
  }

  if (allCloses.length === 0) return [];

  // Average across all symbols (equal-weighted)
  const series = [];
  for (let i = 0; i < maxLen; i++) {
    let sum = 0;
    let count = 0;
    for (const closes of allCloses) {
      if (i < closes.length) {
        sum += closes[i];
        count++;
      }
    }
    series.push(count > 0 ? sum / count : series[series.length - 1] || 1);
  }

  return series;
}

/**
 * Compute daily returns from a price series.
 */
function computeDailyReturns(prices) {
  if (!prices || prices.length < 2) return [];
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push(prices[i] / prices[i - 1] - 1);
    }
  }
  return returns;
}
