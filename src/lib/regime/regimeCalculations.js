/**
 * Regime Calculations - Core Calculation Functions for MMM Suite
 * Adaptive Z-Score, Nowcast, Classification
 */

// ─── Statistical Helpers ────────────────────────────────────────────────────────

export function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function stddev(arr, mu) {
  if (!arr || arr.length < 2) return 1;
  if (mu === undefined) mu = mean(arr);
  return Math.sqrt(
    arr.reduce((a, b) => a + (b - mu) ** 2, 0) / arr.length
  ) || 1;
}

// ─── Adaptive Z-Score ──────────────────────────────────────────────────────────

/**
 * Adaptive Z-Score: blends short-term (responsive) and long-term (structural) z-scores.
 * @param {number[]} series - Array of values, oldest first
 * @param {number} shortLen - Short lookback (default: 90 for daily)
 * @param {number} longLen - Long lookback (default: 365 for daily)
 * @param {number} shortWeight - Weight on short z (default: 0.60)
 * @returns {number} adaptive z-score
 */
export function adaptiveZ(series, shortLen = 90, longLen = 365, shortWeight = 0.60) {
  if (!series || series.length < shortLen) return 0;

  const recentSlice = series.slice(-shortLen);
  const longSlice  = series.slice(-Math.min(longLen, series.length));

  const shortMean = mean(recentSlice);
  const shortStd  = stddev(recentSlice, shortMean) || 1;
  const longMean  = mean(longSlice);
  const longStd   = stddev(longSlice, longMean) || 1;

  const lastVal = series[series.length - 1];
  const shortZ  = (lastVal - shortMean) / shortStd;
  const longZ   = (lastVal - longMean)  / longStd;

  return shortWeight * shortZ + (1 - shortWeight) * longZ;
}

// ─── Rolling Statistics ────────────────────────────────────────────────────────

export function sma(series, period) {
  if (!series || series.length === 0) return 0;
  if (series.length < period) {
    return mean(series);
  }
  return mean(series.slice(-period));
}

export function rollingStd(series, period) {
  if (!series || series.length < period) return 1;
  const slice = series.slice(-period);
  return stddev(slice);
}

export function ema(series, period) {
  if (!series || series.length === 0) return [];
  const k = 2 / (period + 1);
  const result = [series[0]];
  for (let i = 1; i < series.length; i++) {
    result.push(series[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function currentEMA(series, period) {
  return ema(series, period).at(-1) ?? 0;
}

// ─── Rate of Change ───────────────────────────────────────────────────────────

export function pctROC(series, n = 13) {
  if (!series || series.length < n + 1) return 0;
  const curr = series[series.length - 1];
  const prev = series[series.length - 1 - n];
  if (!prev || prev === 0) return 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

export function yoyROC(series, n = 365) {
  return pctROC(series, n);
}

export function pointChange(series, n = 13) {
  if (!series || series.length < n + 1) return 0;
  return series[series.length - 1] - series[series.length - 1 - n];
}

// ─── Z-Score to 0-100 ─────────────────────────────────────────────────────────

export function zToScore(z) {
  // Linear mapping: z=0 → 50, z=+2 → 70, z=-2 → 30
  return Math.min(100, Math.max(0, 50 + z * 10));
}

// ─── Impulse Z ────────────────────────────────────────────────────────────────

/**
 * Measures how fast the composite is changing relative to its own history.
 * @param {number[]} compositeSeries - Historical composite z-score values
 * @param {number} deltaPeriod - lookback for change (default: 13)
 * @param {number} normPeriod - normalization window (default: 52)
 */
export function impulseZ(compositeSeries, deltaPeriod = 13, normPeriod = 52) {
  if (!compositeSeries || compositeSeries.length < deltaPeriod + normPeriod) return 0;

  const deltas = [];
  for (let i = deltaPeriod; i < compositeSeries.length; i++) {
    deltas.push(compositeSeries[i] - compositeSeries[i - deltaPeriod]);
  }

  const currDelta = deltas.at(-1);
  const recentDeltas = deltas.slice(-normPeriod);
  const m = mean(recentDeltas);
  const s = rollingStd(recentDeltas, normPeriod) || 1;

  return Math.min(3, Math.max(-3, (currDelta - m) / s));
}

// ─── Weighted Composite ───────────────────────────────────────────────────────

/**
 * Compute a weighted composite z-score from multiple signal inputs.
 * @param {Array<{value: number, weight: number}>} signals
 * @returns {number} normalized composite z-score
 */
export function weightedComposite(signals) {
  const active = signals.filter(s => s.value !== null && !isNaN(s.value));
  if (active.length === 0) return 0;

  const totalWeight = active.reduce((a, s) => a + s.weight, 0);
  const clippedSum = active.reduce((a, s) =>
    a + s.weight * Math.min(3, Math.max(-3, s.value)), 0
  );

  return clippedSum / totalWeight;
}

// ─── Nowcast Computation ───────────────────────────────────────────────────────

/**
 * Compute nowcast for one composite.
 * @param {number[]} compositeHistory - historical composite z values
 * @returns {{ meZ, impulseZ, nowcast, score }}
 */
export function computeNowcast(compositeHistory) {
  if (!compositeHistory || compositeHistory.length === 0) {
    return { meZ: 0, impulseZ: 0, nowcast: 50, score: 50 };
  }

  const meZ   = compositeHistory.at(-1) ?? 0;
  const impZ  = impulseZ(compositeHistory, 13, 52);
  const meScore = zToScore(meZ);
  const impScore = zToScore(impZ);
  const nowcast = 0.5 * meScore + 0.5 * impScore;

  return {
    meZ: parseFloat(meZ.toFixed(2)),
    impulseZ: parseFloat(impZ.toFixed(2)),
    nowcast: parseFloat(nowcast.toFixed(1)),
    score: parseFloat(meScore.toFixed(1)),
  };
}

// ─── Quadrant Classification ───────────────────────────────────────────────────

const MIDLINE = 50;
const BAND = 5;

export function classifyQuadrant(growNowcast, inflNowcast) {
  const gUp   = growNowcast > MIDLINE + BAND;
  const gDown = growNowcast < MIDLINE - BAND;
  const iUp   = inflNowcast > MIDLINE + BAND;
  const iDown = inflNowcast < MIDLINE - BAND;

  if (gUp && iDown) return 'GOLDILOCKS';
  if (gUp && iUp)   return 'OVERHEAT';
  if (gDown && iUp) return 'STAGFLATION';
  if (gDown && iDown) return 'CONTRACTION';
  return 'TRANSITIONAL';
}

export function classifyLiquidity(liqNowcast) {
  if (liqNowcast > MIDLINE + BAND) return 'LOOSE';
  if (liqNowcast < MIDLINE - BAND) return 'TIGHT';
  return 'NEUTRAL';
}

export function classifyRegime(growNowcast, inflNowcast, liqNowcast) {
  const quadrant = classifyQuadrant(growNowcast, inflNowcast);
  const liq     = classifyLiquidity(liqNowcast);
  return {
    quadrant,
    liquidity: liq,
    label: `${quadrant} + ${liq}`,
    key: `${quadrant}_${liq}`,
  };
}

// ─── Season Labels ────────────────────────────────────────────────────────────

export const SEASON_LABELS = {
  GOLDILOCKS:   { season: 'SPRING', color: 'var(--scanner-green)' },
  OVERHEAT:     { season: 'SUMMER', color: 'var(--scanner-red)' },
  STAGFLATION:  { season: 'FALL',   color: '#f5c842' },
  CONTRACTION:  { season: 'WINTER', color: 'var(--scanner-blue)' },
  TRANSITIONAL: { season: 'FLUX',   color: 'var(--scanner-text3)' },
};

export const REGIME_COLORS = {
  GOLDILOCKS:   'var(--scanner-green)',
  OVERHEAT:     'var(--scanner-red)',
  STAGFLATION:  '#f5c842',
  CONTRACTION:  'var(--scanner-blue)',
  TRANSITIONAL: 'var(--scanner-text3)',
};

export const REGIME_BG_OPACITY = {
  LOOSE:   0.15,
  NEUTRAL: 0.08,
  TIGHT:   0.04,
};

// ─── Grand Composite ─────────────────────────────────────────────────────────

export function computeGrandComposite(growNowcast, inflNowcast, liqNowcast) {
  const G_WEIGHT = 0.33;
  const I_WEIGHT = 0.33;
  const L_WEIGHT = 0.34;
  return G_WEIGHT * growNowcast + I_WEIGHT * inflNowcast + L_WEIGHT * liqNowcast;
}

// ─── RSI ──────────────────────────────────────────────────────────────────────

export function computeRSI(series, period = 14) {
  if (!series || series.length < period + 1) return 50;

  let gains = 0, losses = 0;
  for (let i = series.length - period; i < series.length; i++) {
    const diff = series[i] - series[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─── OBV ─────────────────────────────────────────────────────────────────────

export function computeOBV(prices, volumes) {
  if (!prices || prices.length === 0) return [];
  const obv = [0];
  for (let i = 1; i < prices.length; i++) {
    const prevPrice = prices[i - 1];
    const currPrice = prices[i];
    const vol = volumes[i] ?? 0;
    if (currPrice > prevPrice) {
      obv.push(obv[i - 1] + vol);
    } else if (currPrice < prevPrice) {
      obv.push(obv[i - 1] - vol);
    } else {
      obv.push(obv[i - 1]);
    }
  }
  return obv;
}

// ─── Next Execution Date ──────────────────────────────────────────────────────

export function getNextExecutionDate() {
  const now = new Date();
  const firstOfNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  let dayOfWeek = firstOfNext.getDay();
  let daysToFriday = dayOfWeek <= 5 ? (5 - dayOfWeek) : (12 - dayOfWeek);
  firstOfNext.setDate(firstOfNext.getDate() + daysToFriday);
  return firstOfNext;
}
