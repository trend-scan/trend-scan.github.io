/**
 * Seasonality Baselines — borrows factorwatch.ai's methodology:
 *
 *   "Our own series is too short for seasonality — 2 years gives n=2 per
 *    calendar month, which is astrology. So seasonality.py uses the Ken French
 *    library monthly factor returns (momentum to 1927, HML/SMB to 1963), free."
 *
 * For each calendar month (Jan-Dec), compute:
 *   - mean return
 *   - median return
 *   - hit rate (% of years with positive return)
 *   - n (sample size)
 *
 * For both "full history" and "trailing 30 years" windows.
 *
 * Mappings (Ken French → our factors):
 *   market (Mkt-RF + RF)   → US equity market baseline
 *   SMB (small minus big)  → Size factor
 *   HML (high minus low)   → Value factor
 *   UMD (up minus down)    → Momentum factor (separate Ken French file, not included here)
 *
 * Data source: /snapshot.json → ken_french field (populated by build_snapshot.js)
 */

import { mean } from './regimeCalculations';

/**
 * Compute seasonality baselines from Ken French monthly data.
 *
 * @param {Array<{year, month, mktRf, smb, hml, rf, market}>} kenFrench
 * @returns {object} baselines keyed by factor + month
 *   {
 *     market: [{ month: 1, mean_pct: 0.56, median_pct: 0.72, hit_rate: 0.581, n: 62, window: 'full' }, ...],
 *     smb:    [...],
 *     hml:    [...],
 *   }
 */
export function computeSeasonality(kenFrench) {
  if (!kenFrench || kenFrench.length === 0) return null;

  const factors = ['market', 'smb', 'hml'];
  const out = {};

  for (const factor of factors) {
    const fullHistory = computeFactorMonthly(kenFrench, factor);
    const trailing30y = computeFactorMonthly(
      kenFrench.filter(d => d.year >= new Date().getFullYear() - 30),
      factor
    );

    out[factor] = [];
    for (let month = 1; month <= 12; month++) {
      const full = fullHistory[month] || { mean: 0, median: 0, hitRate: 0, n: 0 };
      const trail = trailing30y[month] || { mean: 0, median: 0, hitRate: 0, n: 0 };

      out[factor].push({
        month,
        full: {
          mean_pct: full.mean * 100,
          median_pct: full.median * 100,
          hit_rate: full.hitRate,
          n: full.n,
        },
        trailing_30y: {
          mean_pct: trail.mean * 100,
          median_pct: trail.median * 100,
          hit_rate: trail.hitRate,
          n: trail.n,
        },
      });
    }
  }

  return out;
}

function computeFactorMonthly(data, factor) {
  const byMonth = {};  // 1-12 → number[]
  for (const d of data) {
    if (!byMonth[d.month]) byMonth[d.month] = [];
    byMonth[d.month].push(d[factor]);
  }

  const out = {};
  for (const [m, returns] of Object.entries(byMonth)) {
    const n = returns.length;
    if (n === 0) continue;
    const sorted = [...returns].sort((a, b) => a - b);
    const meanVal = mean(returns);
    const medianVal = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    const hits = returns.filter(r => r > 0).length;
    out[parseInt(m, 10)] = {
      mean: meanVal,
      median: medianVal,
      hitRate: hits / n,
      n,
    };
  }
  return out;
}

/**
 * Format a seasonality baseline for display.
 * @returns {string} e.g. "June: +1.0% mean / 70% hit rate (n=30, 30y)"
 */
export function formatSeasonalityBaseline(baseline, windowKey = 'trailing_30y') {
  if (!baseline) return '—';
  const w = baseline[windowKey];
  if (!w || w.n === 0) return '—';
  const monthName = new Date(2026, baseline.month - 1, 1).toLocaleString('en-US', { month: 'long' });
  const sign = w.mean_pct >= 0 ? '+' : '';
  return `${monthName}: ${sign}${w.mean_pct.toFixed(2)}% mean / ${(w.hit_rate * 100).toFixed(0)}% hit rate (n=${w.n}, ${windowKey === 'trailing_30y' ? '30y' : 'full'})`;
}

/**
 * Get the current month's baseline for a given factor.
 */
export function getCurrentMonthBaseline(seasonality, factor) {
  if (!seasonality?.[factor]) return null;
  const currentMonth = new Date().getMonth() + 1;  // 1-12
  return seasonality[factor].find(b => b.month === currentMonth) || null;
}
