/**
 * Regime Percentile — extends z-scores with rolling-window percentiles.
 *
 * Why percentiles?
 *   Z-scores assume normality. Financial returns are fat-tailed — a z=2.0 in a
 *   calm regime (low vol) is much rarer than z=2.0 in a volatile regime.
 *   Percentiles are non-parametric: "current value exceeds 98% of historical
 *   observations" is true regardless of distribution shape.
 *
 * Borrowed from factorwatch.ai's spread_monitor methodology:
 *   "Report z-score and percentile (returns are fat-tailed; the percentile
 *    keeps the z honest)."
 *   — https://factorwatch.ai/methodology.html §5
 *
 * Usage:
 *   const { z, pctile } = adaptiveZWithPctile(btcPriceSeries, 90, 365);
 *   // z = 1.8σ, pctile = 96.4 → "above 96.4% of historical 90d windows"
 */

import { adaptiveZ, mean, stddev } from './regimeCalculations.js';

/**
 * Compute adaptive z-score AND its percentile against trailing overlapping windows.
 *
 * For each of the trailing N windows of length `shortLen`, compute what the
 * adaptive z-score would have been at that point. Then count what fraction of
 * those historical z-scores are below the current z.
 *
 * @param {number[]} series - values, oldest first
 * @param {number} shortLen - short lookback window (e.g. 90 for daily)
 * @param {number} longLen - long lookback window (e.g. 365 for daily)
 * @param {number} [lookback=252] - how many historical windows to compare against (~1 trading year)
 * @returns {{z: number, pctile: number}} - z-score and percentile (0-100)
 */
export function adaptiveZWithPctile(series, shortLen = 90, longLen = 365, lookback = 252) {
  if (!series || series.length < shortLen + lookback) {
    return { z: adaptiveZ(series, shortLen, longLen), pctile: 50 };
  }

  // Current z
  const currentZ = adaptiveZ(series, shortLen, longLen);

  // Build baseline of historical z-scores from trailing windows
  const baseline = [];
  // Walk back through history; for each anchor point, compute what adaptiveZ would have been
  for (let i = series.length - lookback; i < series.length - 1; i++) {
    if (i < longLen) continue;  // not enough history
    const sliceUpTo = series.slice(0, i + 1);
    if (sliceUpTo.length < longLen) continue;
    const historicalZ = adaptiveZ(sliceUpTo, shortLen, longLen);
    if (Number.isFinite(historicalZ)) baseline.push(historicalZ);
  }

  if (baseline.length === 0) {
    return { z: currentZ, pctile: 50 };
  }

  // Percentile: what fraction of baseline is below currentZ
  const below = baseline.filter(b => b < currentZ).length;
  const pctile = (below / baseline.length) * 100;

  return { z: currentZ, pctile };
}

/**
 * Simple percentile of a value against an array of historical values.
 * Used for non-z-score series (e.g. "current return vs trailing 252 daily returns").
 *
 * @param {number} current - the value to rank
 * @param {number[]} history - array of historical values
 * @returns {number} percentile 0-100 (50 = median)
 */
export function percentileOf(current, history) {
  if (!history || history.length === 0) return 50;
  const below = history.filter(h => h < current).length;
  return (below / history.length) * 100;
}

/**
 * Compute h-day compounded return for a price series.
 * Used by factorwatch-style spread monitors (1d, 5d, 20d, 60d horizons).
 *
 * @param {number[]} prices - oldest first
 * @param {number} horizonDays - 1, 5, 20, 60
 * @returns {number|null} - decimal return (0.05 = +5%) or null if insufficient data
 */
export function horizonReturn(prices, horizonDays) {
  if (!prices || prices.length < horizonDays + 1) return null;
  const end = prices[prices.length - 1];
  const start = prices[prices.length - 1 - horizonDays];
  if (!start || !end) return null;
  return (end - start) / start;
}

/**
 * Compute h-day return AND its z-score + percentile vs trailing 252 overlapping windows.
 * Mirrors factorwatch's spread_monitor calculation exactly.
 *
 * @returns {{ret: number, z: number, pctile: number}|null}
 */
export function horizonReturnWithStats(prices, horizonDays, lookback = 252) {
  if (!prices || prices.length < horizonDays + 1) return null;

  const currentRet = Math.max(-0.95, Math.min(10.0, horizonReturn(prices, horizonDays)));
  if (currentRet == null) return null;

  // Build baseline of overlapping h-day returns
  const baseline = [];
  for (let i = prices.length - 1; i >= horizonDays; i--) {
    const end = prices[i];
    const start = prices[i - horizonDays];
    if (start && end) baseline.push((end - start) / start);
    if (baseline.length >= lookback) break;
  }

  if (baseline.length < 10) {
    return { ret: currentRet, z: 0, pctile: 50 };
  }

  const mu = mean(baseline);
  const sd = stddev(baseline, mu) || 1;
  const z = (currentRet - mu) / sd;
  const pctile = percentileOf(currentRet, baseline);

  return { ret: currentRet, z, pctile };
}
