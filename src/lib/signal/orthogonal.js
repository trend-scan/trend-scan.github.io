/**
 * orthogonal.js — JS port of "Orthogonal Trading System v6.1" (Pine Script)
 *
 * Original: Orthogonal Trading System v6.1 [BTCUSDT 4H]
 * Source:   Pine Script v5 (provided by user, 2026-07-21)
 * License:  Mozilla Public License 2.0
 *
 * Design:
 *   9 raw signals → sign-corrected → rolling z-score (80-bar) →
 *   SMA smoothing (5-bar) → weighted composite → ±τ threshold →
 *   optional pivot 7L/1R filter → position {+1, 0, -1}
 *
 * Pine → JS translation notes:
 *   - Pine's `close[6]` is `closes[i - 6]` (6 bars ago).
 *   - Pine's `ta.sma(src, n)` returns NaN until n bars; we return null and
 *     callers must skip. Same for `ta.stdev`, `ta.rsi`, `ta.ema`.
 *   - Pine's `ta.pivothigh(high, 7, 1)` returns a value 1 bar after the
 *     pivot confirmed (no look-ahead). We replicate this: only emit a pivot
 *     when 7 left bars + 1 right bar have elapsed.
 *   - Pine's `var float last_ph = na` is module-level mutable state. We
 *     avoid stateful globals — instead compute per-bar by carrying `last_ph`
 *     / `last_pl` through the iteration in the caller. Each public function
 *     is pure: takes the full series, returns a parallel-length array.
 *
 * Sign conventions (from Pine header comment):
 *   Signal        Formula                  Sign   Net
 *   zscore_20     -(c-μ)/σ                 -1     -Z    ×(-1) → -Z
 *   rsi_signal    -(rsi-50)/50             -1     +R    ×(+1) → +R
 *   bb_width      -(2σ/μ)                  -1     +B    ×(+1) → +B
 *   vol_ratio     dir×v/v̄                  -1     -V    ×(-1) → -V
 *   mom_6         (c-c[6])/c[6]            -1     -M    ×(-1) → -M
 *   mom_18        (c-c[18])/c[18]          -1     -M    ×(-1) → -M
 *   ema_cross     (f-s)/c                  +1     +E    ×(+1) → +E
 *   hl_mom        (c-l)/(h-l)-0.5          -1     -H    ×(-1) → -H
 *   taker_ratio   (proxy)                  -1     -T    ×(-1) → -T
 *
 * Per the Pine comment: "Python bakes a leading '-' into zscore_20, rsi_signal,
 * bb_width formulas, THEN multiplies by the signs dict." The net signs above
 * are AFTER both the formula negation AND the dict multiplication. We replicate
 * the net sign directly.
 */

// ─── Statistical primitives ─────────────────────────────────────────────────

export function sma(src, n) {
  const out = new Array(src.length).fill(null);
  if (n <= 0) return out;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= n) sum -= src[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function stdev(src, n) {
  // Population stdev (matches Pine ta.stdev default — uses biased / N divisor)
  const out = new Array(src.length).fill(null);
  if (n <= 1) return out;
  for (let i = n - 1; i < src.length; i++) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += src[j];
    const mu = sum / n;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (src[j] - mu) ** 2;
    out[i] = Math.sqrt(sq / n);
  }
  return out;
}

export function ema(src, n) {
  const out = new Array(src.length).fill(null);
  if (n <= 0 || src.length === 0) return out;
  const k = 2 / (n + 1);
  out[0] = src[0];
  for (let i = 1; i < src.length; i++) {
    out[i] = src[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function rsi(src, n) {
  // Pine ta.rsi — Wilder's smoothing
  const out = new Array(src.length).fill(null);
  if (src.length < n + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const diff = src[i] - src[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = n + 1; i < src.length; i++) {
    const diff = src[i] - src[i - 1];
    const g = diff >= 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (n - 1) + g) / n;
    avgLoss = (avgLoss * (n - 1) + l) / n;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * Rolling z-score: (x - SMA(x,n)) / StDev(x,n), 0 when StDev=0.
 * Matches Pine roll_zscore helper.
 */
export function rollZscore(src, n) {
  const mu = sma(src, n);
  const sd = stdev(src, n);
  const out = new Array(src.length).fill(0);
  for (let i = 0; i < src.length; i++) {
    if (mu[i] == null || sd[i] == null) { out[i] = 0; continue; }
    out[i] = sd[i] !== 0 ? (src[i] - mu[i]) / sd[i] : 0;
  }
  return out;
}

// ─── Pivot detection (no look-ahead) ────────────────────────────────────────

/**
 * Pivot high: returns the high at index i-pivotRight-1 if it's strictly
 * greater than the `leftBars` bars before it and `rightBars` bars after it.
 * Confirmation arrives `rightBars` bars after the pivot itself (no look-ahead).
 *
 * Returns array of { idx, value } for each confirmed pivot.
 */
function findPivotHighs(highs, leftBars, rightBars) {
  const pivots = [];
  for (let i = leftBars + rightBars; i < highs.length - rightBars; i++) {
    // Pivot candidate is at i - rightBars (the bar `rightBars` ago)
    const pivotIdx = i - rightBars;
    const pivotVal = highs[pivotIdx];
    let isPivot = true;
    for (let j = pivotIdx - leftBars; j < pivotIdx; j++) {
      if (highs[j] >= pivotVal) { isPivot = false; break; }
    }
    if (isPivot) {
      for (let j = pivotIdx + 1; j <= pivotIdx + rightBars; j++) {
        if (highs[j] >= pivotVal) { isPivot = false; break; }
      }
    }
    if (isPivot) pivots.push({ idx: pivotIdx, value: pivotVal });
  }
  return pivots;
}

function findPivotLows(lows, leftBars, rightBars) {
  const pivots = [];
  for (let i = leftBars + rightBars; i < lows.length - rightBars; i++) {
    const pivotIdx = i - rightBars;
    const pivotVal = lows[pivotIdx];
    let isPivot = true;
    for (let j = pivotIdx - leftBars; j < pivotIdx; j++) {
      if (lows[j] <= pivotVal) { isPivot = false; break; }
    }
    if (isPivot) {
      for (let j = pivotIdx + 1; j <= pivotIdx + rightBars; j++) {
        if (lows[j] <= pivotVal) { isPivot = false; break; }
      }
    }
    if (isPivot) pivots.push({ idx: pivotIdx, value: pivotVal });
  }
  return pivots;
}

/**
 * Compute pivot_sig series — position-within-last-pivot-range signal.
 * For each bar, finds the most recent confirmed pivot high and pivot low,
 * then computes -(pos - 0.5) where pos = (close - lastPL) / (lastPH - lastPL).
 *
 * This replicates Pine's `var float last_ph = na` state machine.
 */
export function computePivotSignal(highs, lows, closes, leftBars = 7, rightBars = 1) {
  const phs = findPivotHighs(highs, leftBars, rightBars);
  const pls = findPivotLows(lows, leftBars, rightBars);
  const out = new Array(closes.length).fill(0);

  let phIdx = 0, plIdx = 0;
  let lastPH = null, lastPL = null;
  for (let i = 0; i < closes.length; i++) {
    // Advance through pivots confirmed by bar i (pivot idx + rightBars <= i)
    while (phIdx < phs.length && phs[phIdx].idx + rightBars <= i) {
      lastPH = phs[phIdx].value; phIdx++;
    }
    while (plIdx < pls.length && pls[plIdx].idx + rightBars <= i) {
      lastPL = pls[plIdx].value; plIdx++;
    }
    if (lastPH != null && lastPL != null && lastPH > lastPL) {
      const range = lastPH - lastPL;
      const pos = (closes[i] - lastPL) / range;
      out[i] = -(pos - 0.5);
    } else {
      out[i] = 0;
    }
  }
  return out;
}

// ─── Raw signal computation (matches Pine §3) ───────────────────────────────

/**
 * @param {Array<{open:number, high:number, low:number, close:number, volume:number}>} candles
 * @returns {object} parallel arrays for each raw signal
 */
export function computeRawSignals(candles) {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const opens  = candles.map(c => c.open);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const vols   = candles.map(c => c.volume);

  // 3.1 vol_ratio — vol_dir × (v / sma(v,20)) × -1
  const volSma20 = sma(vols, 20);
  const volRatio = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i < 19 || volSma20[i] == null || volSma20[i] === 0) { volRatio[i] = 0; continue; }
    const dir = closes[i] > opens[i] ? 1 : -1;
    volRatio[i] = dir * vols[i] / volSma20[i] * -1;
  }

  // 3.2 bb_width — (2σ/μ) × +1   (Pine: bb_dev*2/bb_basis * 1)
  const bbBasis = sma(closes, 20);
  const bbDev   = stdev(closes, 20);
  const bbWidth = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (bbBasis[i] == null || bbDev[i] == null || bbBasis[i] === 0) { bbWidth[i] = 0; continue; }
    bbWidth[i] = (bbDev[i] * 2) / bbBasis[i];
  }

  // 3.3 rsi_signal — (rsi-50)/50 × +1
  const rsiArr = rsi(closes, 14);
  const rsiSignal = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (rsiArr[i] == null) { rsiSignal[i] = 0; continue; }
    rsiSignal[i] = (rsiArr[i] - 50) / 50;
  }

  // 3.4 zscore_20 — (c-μ)/σ × -1
  const zMu = sma(closes, 20);
  const zSd = stdev(closes, 20);
  const zscore20 = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (zMu[i] == null || zSd[i] == null || zSd[i] === 0) { zscore20[i] = 0; continue; }
    zscore20[i] = (closes[i] - zMu[i]) / zSd[i] * -1;
  }

  // 3.5 mom_6 — (c - c[6])/c[6] × -1
  const mom6 = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i < 6 || closes[i - 6] === 0) { mom6[i] = 0; continue; }
    mom6[i] = (closes[i] - closes[i - 6]) / closes[i - 6] * -1;
  }

  // 3.6 mom_18 — (c - c[18])/c[18] × -1
  const mom18 = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i < 18 || closes[i - 18] === 0) { mom18[i] = 0; continue; }
    mom18[i] = (closes[i] - closes[i - 18]) / closes[i - 18] * -1;
  }

  // 3.7 ema_cross — (ema12 - ema26)/close × +1
  const emaFast = ema(closes, 12);
  const emaSlow = ema(closes, 26);
  const emaCross = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (emaFast[i] == null || emaSlow[i] == null || closes[i] === 0) { emaCross[i] = 0; continue; }
    emaCross[i] = (emaFast[i] - emaSlow[i]) / closes[i];
  }

  // 3.8 hl_mom — ((c-l)/(h-l) - 0.5) × -1   (single-bar high-low)
  const hlMom = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const range = highs[i] - lows[i];
    if (range === 0) { hlMom[i] = 0; continue; }
    const pos = (closes[i] - lows[i]) / range;
    hlMom[i] = (pos - 0.5) * -1;
  }

  // 3.9 taker_ratio — proxy: (up_vol - dn_vol)/(up_vol + dn_vol) × -1, rolling 20
  const takerRatio = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i < 19) { takerRatio[i] = 0; continue; }
    let up = 0, dn = 0;
    for (let j = i - 19; j <= i; j++) {
      if (closes[j] > opens[j]) up += vols[j];
      else if (closes[j] < opens[j]) dn += vols[j];
    }
    const total = up + dn;
    takerRatio[i] = total !== 0 ? (up - dn) / total * -1 : 0;
  }

  return {
    vol_ratio: volRatio,
    bb_width: bbWidth,
    rsi_signal: rsiSignal,
    zscore_20: zscore20,
    mom_6: mom6,
    mom_18: mom18,
    ema_cross: emaCross,
    hl_mom: hlMom,
    taker_ratio: takerRatio,
  };
}

// ─── Composite engine ───────────────────────────────────────────────────────

export const DEFAULT_PARAMS = {
  lb: 5,           // Smoothing lookback
  zsc_len: 80,     // Standardisation window
  thresh: 0.5,     // ±τ position threshold
  use_pivot: true,
  pivot_tau: 0.0,
  weights: {
    vol_ratio: 1.0,
    bb_width: 1.0,
    rsi_signal: 1.0,
    zscore_20: 1.0,
    mom_6: 1.0,
    mom_18: 1.0,
    ema_cross: 1.0,
    hl_mom: 1.0,
    taker_ratio: 1.0,
  },
};

export const SIGNAL_NAMES = [
  'vol_ratio', 'bb_width', 'rsi_signal', 'zscore_20',
  'mom_6', 'mom_18', 'ema_cross', 'hl_mom', 'taker_ratio',
];

/**
 * Run the full OrthoSys v6.1 pipeline on a candle series.
 *
 * @param {Array} candles array of {open, high, low, close, volume}
 * @param {object} [params] overrides for DEFAULT_PARAMS
 * @returns {{
 *   composite: number[],         // raw composite z-score
 *   pivot_sig: number[],         // pivot filter signal
 *   position: number[],          // +1, 0, -1
 *   raw: object,                 // per-signal raw arrays
 *   z: object,                   // per-signal z-scored arrays
 *   smoothed: object,            // per-signal smoothed arrays
 *   threshold: number,
 *   weights: object,
 * }}
 */
export function computeOrthoS(candles, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  p.weights = { ...DEFAULT_PARAMS.weights, ...(params.weights || {}) };

  const raw = computeRawSignals(candles);

  // §4 per-signal z-score
  const z = {};
  for (const name of SIGNAL_NAMES) {
    z[name] = rollZscore(raw[name], p.zsc_len);
  }

  // §5 smoothing
  const smoothed = {};
  for (const name of SIGNAL_NAMES) {
    smoothed[name] = sma(z[name], p.lb);
  }

  // §6 composite (weighted avg of smoothed)
  const composite = new Array(candles.length).fill(0);
  let wtSum = 0;
  for (const name of SIGNAL_NAMES) wtSum += p.weights[name];

  if (wtSum > 0) {
    for (let i = 0; i < candles.length; i++) {
      let acc = 0;
      for (const name of SIGNAL_NAMES) {
        const v = smoothed[name][i];
        if (v != null) acc += p.weights[name] * v;
      }
      composite[i] = acc / wtSum;
    }
  }

  // §7 pivot signal
  const pivotSig = computePivotSignal(
    candles.map(c => c.high),
    candles.map(c => c.low),
    candles.map(c => c.close),
    7, 1,
  );

  // §8 position
  const position = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const rawLong  = composite[i] >  p.thresh;
    const rawShort = composite[i] < -p.thresh;
    const pivotLongOk  = !p.use_pivot || pivotSig[i] >  p.pivot_tau;
    const pivotShortOk = !p.use_pivot || pivotSig[i] < -p.pivot_tau;
    const posLong  = rawLong  && pivotLongOk  ? 1 : 0;
    const posShort = rawShort && pivotShortOk ? -1 : 0;
    position[i] = posLong + posShort;
  }

  return {
    composite,
    pivot_sig: pivotSig,
    position,
    raw,
    z,
    smoothed,
    threshold: p.thresh,
    weights: p.weights,
  };
}
