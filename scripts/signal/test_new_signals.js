/**
 * test_new_signals.js — Walk-forward validation of TWO candidate signals:
 *
 *   1. VWAP Extension
 *      vwap = sum(typical_price * volume) / sum(volume) over N periods
 *      vwap_extension = (close - vwap) / atr14
 *      Signal: |vwap_extension| > threshold  (default 1.0 ATR)
 *      Direction: sign(vwap_extension)  (positive = above VWAP = bullish momentum)
 *
 *   2. OBV Divergence
 *      obv = cumulative sum(direction * volume)  where direction = sign(close - prev_close)
 *      obv_slope  = linear regression slope of OBV over last N periods (normalized)
 *      price_slope= linear regression slope of close over last N periods (normalized)
 *      Bullish divergence: price_slope < 0 AND obv_slope > 0  (price down, OBV up = accumulation)
 *      Bearish divergence: price_slope > 0 AND obv_slope < 0  (price up, OBV down = distribution)
 *
 * Both signals are tested INDIVIDUALLY (not integrated into compute.js).
 * For each signal:
 *   - Compute the signal for every (symbol, day) in the dataset.
 *   - Bucket by TRAIN / VAL / OOS using the same date boundaries as walk_forward_backtest.js.
 *   - For directional triggers, compute hit rate (signed forward return matches signal direction)
 *     at 1d / 5d / 10d / 20d forward windows.
 *   - For VWAP: sweep threshold ∈ {0.5, 0.75, 1.0, 1.5, 2.0} and N ∈ {20, 30}, pick best by
 *     TRAIN hit rate (with >= 50 signals), apply unchanged to VAL/OOS.
 *   - For OBV:  sweep N ∈ {10, 15, 20, 30} and min |price_slope_norm| ∈ {0.02, 0.05, 0.10},
 *     pick best by TRAIN hit rate (with >= 50 signals), apply unchanged to VAL/OOS.
 *   - Report per-period hit rates, per-direction breakdown, per-symbol OOS breakdown.
 *
 * Decision criterion: OOS hit rate > 50% with > 100 OOS signals → predictive value.
 *
 * Usage:
 *   node scripts/signal/test_new_signals.js
 *
 * Output:
 *   scripts/signal/test_new_signals_results.json  (full results)
 *   console summary
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data', 'historical');
const OUT_JSON = path.join(__dirname, 'test_new_signals_results.json');

// ─── Configuration ───────────────────────────────────────────────────────────

const SYMBOLS = [
  'BTC', 'ETH', 'SOL',
  'AVAX', 'LINK', 'DOGE',
  'ARB', 'OP',
  'INJ', 'SUI', 'NEAR', 'APT', 'TIA',
];

// Same date boundaries as walk_forward_backtest.js
const PERIODS = {
  TRAIN:       { start: '2022-01-01', end: '2023-06-30', label: 'TRAIN (tune)'       },
  VALIDATION:  { start: '2023-07-01', end: '2024-06-30', label: 'VALIDATION (hold)'  },
  OOS:         { start: '2024-07-01', end: '2025-07-31', label: 'OOS (untouched)'    },
};

const FORWARD_WINDOWS = [1, 5, 10, 20];
const DEFAULT_FORWARD = 10;

const MIN_SIGNALS_TRAIN = 50;   // min signal count on TRAIN to consider a config valid
const MIN_SIGNALS_OOS   = 100;  // min OOS signal count to declare "predictive value"
const OOS_HIT_THRESHOLD = 0.50; // hit-rate threshold for "predictive value"

// VWAP sweep grid
const VWAP_THRESHOLDS = [0.5, 0.75, 1.0, 1.5, 2.0];
const VWAP_PERIODS    = [20, 30];

// OBV sweep grid
const OBV_PERIODS     = [10, 15, 20, 30];
const OBV_SLOPE_CUTS  = [0.02, 0.05, 0.10];   // min |price_slope_norm| to count as divergence

// ─── Date helpers ───────────────────────────────────────────────────────────

const tsOf = (yyyyMmDd) => Date.UTC(+yyyyMmDd.slice(0,4), +yyyyMmDd.slice(5,7)-1, +yyyyMmDd.slice(8,10));
const TRAIN_START_TS = tsOf(PERIODS.TRAIN.start);
const TRAIN_END_TS   = tsOf(PERIODS.TRAIN.end);
const VAL_START_TS   = tsOf(PERIODS.VALIDATION.start);
const VAL_END_TS     = tsOf(PERIODS.VALIDATION.end);
const OOS_START_TS   = tsOf(PERIODS.OOS.start);
const OOS_END_TS     = tsOf(PERIODS.OOS.end);

function periodForTs(ts) {
  if (ts >= TRAIN_START_TS && ts <= TRAIN_END_TS) return 'TRAIN';
  if (ts >= VAL_START_TS   && ts <= VAL_END_TS)   return 'VALIDATION';
  if (ts >= OOS_START_TS   && ts <= OOS_END_TS)   return 'OOS';
  return null;
}
const ymd = (ts) => new Date(ts).toISOString().slice(0, 10);

// ─── Data loading (mirrors walk_forward_backtest.js) ────────────────────────

function loadSymbol(symbol) {
  const kPath = path.join(DATA_DIR, symbol, 'klines_1d.json');
  const fPath = path.join(DATA_DIR, symbol, 'funding.json');
  if (!fs.existsSync(kPath)) return null;
  const kRaw = JSON.parse(fs.readFileSync(kPath, 'utf8'));
  const candles = kRaw
    .map(r => ({ ts: r.t, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }))
    .filter(c => c.ts != null && c.close != null)
    .sort((a, b) => a.ts - b.ts);
  return { symbol, candles };
}

// ─── Math primitives ────────────────────────────────────────────────────────

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  let s = 0; for (const v of arr) s += v; return s / arr.length;
}

/**
 * Compute ATR (Wilder's smoothing) over the entire candle series, returning
 * an array aligned with `candles` (first valid index = period).
 */
function computeAtrSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close)
    ));
  }
  let atr = mean(trs.slice(0, period));
  out[period] = atr;   // ATR first available at index = period (covers TRs 1..period)
  const alpha = 1 / period;
  for (let i = period + 1; i < candles.length; i++) {
    atr = trs[i - 1] * alpha + atr * (1 - alpha);
    out[i] = atr;
  }
  return out;
}

/**
 * Linear regression slope of `series` (last N points), normalized by the mean
 * of the series so it's a fractional change per bar (dimensionless).
 * Returns 0 if mean is 0 or N < 2.
 */
function normLinearSlope(series, N) {
  if (!series || series.length < N || N < 2) return 0;
  const slice = series.slice(-N);
  const n = slice.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(slice);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (slice[i] - yMean);
    den += (i - xMean) ** 2;
  }
  if (den === 0) return 0;
  const slope = num / den;
  if (yMean === 0) return 0;
  // Normalize: slope is per-bar; multiply by N to get total fractional move over window.
  return (slope * n) / yMean;
}

// ─── Signal 1: VWAP Extension ───────────────────────────────────────────────

/**
 * Compute VWAP extension series for a symbol.
 *   vwap[i] = sum(tp[i-N+1..i] * v) / sum(v) over window N
 *   vwap_ext[i] = (close[i] - vwap[i]) / atr14[i]
 *
 * Returns array aligned with candles: null until both N-period VWAP and 14-period ATR
 * are available.
 */
function computeVwapExtensionSeries(candles, N = 20, atrPeriod = 14) {
  const atrSeries = computeAtrSeries(candles, atrPeriod);
  const out = new Array(candles.length).fill(null);
  if (candles.length < N) return out;

  // Rolling VWAP via running sums
  let sumPV = 0; // sum of typical_price * volume
  let sumV  = 0; // sum of volume
  for (let i = 0; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const v  = candles[i].volume;
    sumPV += tp * v;
    sumV  += v;
    if (i >= N) {
      const oldTp = (candles[i - N].high + candles[i - N].low + candles[i - N].close) / 3;
      const oldV  = candles[i - N].volume;
      sumPV -= oldTp * oldV;
      sumV  -= oldV;
    }
    // First valid VWAP is at i = N - 1 (window fully populated)
    if (i >= N - 1 && sumV > 0 && atrSeries[i] != null && atrSeries[i] > 0) {
      const vwap = sumPV / sumV;
      out[i] = (candles[i].close - vwap) / atrSeries[i];
    }
  }
  return out;
}

// ─── Signal 2: OBV Divergence ───────────────────────────────────────────────

/**
 * Compute OBV series (cumulative sum of direction * volume).
 *   direction = +1 if close > prev_close, -1 if <, 0 if =
 */
function computeObvSeries(candles) {
  const obv = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const dir = candles[i].close > candles[i - 1].close ? 1 :
                candles[i].close < candles[i - 1].close ? -1 : 0;
    obv[i] = obv[i - 1] + dir * candles[i].volume;
  }
  return obv;
}

/**
 * Compute OBV divergence signal per bar.
 *   price_slope_norm = normalized linear slope of close over last N bars
 *   obv_slope_norm   = normalized linear slope of OBV over last N bars
 *   bullish_div = price_slope_norm < 0 AND obv_slope_norm > 0  (price down, OBV up)
 *   bearish_div = price_slope_norm > 0 AND obv_slope_norm < 0  (price up, OBV down)
 *
 * Returns array aligned with candles: null until enough data for an N-bar regression.
 */
function computeObvDivergenceSeries(candles, N = 20) {
  const closes = candles.map(c => c.close);
  const obv    = computeObvSeries(candles);
  const out = new Array(candles.length).fill(null);
  for (let i = N - 1; i < candles.length; i++) {
    const priceSlope = normLinearSlope(closes.slice(0, i + 1), N);
    const obvSlope   = normLinearSlope(obv.slice(0, i + 1),    N);
    out[i] = {
      price_slope_norm: priceSlope,
      obv_slope_norm:   obvSlope,
      bullish_div: priceSlope < 0 && obvSlope > 0,
      bearish_div: priceSlope > 0 && obvSlope < 0,
    };
  }
  return out;
}

// ─── Forward returns pre-computation ────────────────────────────────────────

function precomputeForwardReturns(candles) {
  const out = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const entry = { ts: candles[i].ts, close: candles[i].close, idx: i, fwd: {} };
    for (const w of FORWARD_WINDOWS) {
      if (i + w < candles.length) {
        entry.fwd[w] = (candles[i + w].close / candles[i].close - 1);  // fraction
      }
    }
    out[i] = entry;
  }
  return out;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

/**
 * Build per-(symbol, day) records for a signal.
 *
 * A "signal record" = a bar where the signal fired (directional trigger).
 *   direction = +1 (bullish) or -1 (bearish)
 *   For VWAP: bullish if vwap_ext > +threshold, bearish if vwap_ext < -threshold.
 *   For OBV:  bullish if bullish_div AND |price_slope_norm| >= slopeCut,
 *             bearish if bearish_div AND |price_slope_norm| >= slopeCut.
 *
 * Each record: {symbol, ts, period, direction, fwd: {1,5,10,20}, signal_value}
 */
function buildSignalRecords(symbol, candles, signalSeries, fwdData, triggerFn) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    const sig = signalSeries[i];
    if (sig == null) continue;
    const trigger = triggerFn(sig);
    if (!trigger) continue;
    const period = periodForTs(candles[i].ts);
    if (!period) continue;
    out.push({
      symbol,
      ts: candles[i].ts,
      period,
      direction: trigger.direction,    // +1 bullish, -1 bearish
      signal_value: trigger.value,     // for reporting
      fwd: fwdData[i].fwd,
    });
  }
  return out;
}

/**
 * Hit rate: forward return sign matches signal direction.
 *   For bullish (dir=+1): hit = fwd_return > 0
 *   For bearish (dir=-1): hit = fwd_return < 0
 * Also computes avg forward return *signed* by direction (so +x% means the signal
 * was right on average).
 */
function aggregateHits(records, fwdWin) {
  const out = {
    total:    { count: 0, hits: 0, retSum: 0 },
    bullish:  { count: 0, hits: 0, retSum: 0 },
    bearish:  { count: 0, hits: 0, retSum: 0 },
  };
  for (const r of records) {
    const fwd = r.fwd[fwdWin];
    if (fwd == null) continue;
    const signedRet = fwd * r.direction;
    const isHit = signedRet > 0;
    out.total.count++;
    out.total.retSum += signedRet;
    if (isHit) out.total.hits++;
    if (r.direction > 0) {
      out.bullish.count++;
      out.bullish.retSum += signedRet;
      if (isHit) out.bullish.hits++;
    } else {
      out.bearish.count++;
      out.bearish.retSum += signedRet;
      if (isHit) out.bearish.hits++;
    }
  }
  for (const k of Object.keys(out)) {
    out[k].hitRate = out[k].count > 0 ? out[k].hits / out[k].count : null;
    out[k].avgSignedRet = out[k].count > 0 ? out[k].retSum / out[k].count : null;
  }
  return out;
}

/**
 * Test a "reverse" interpretation: signal direction is inverted (mean-reversion).
 * Used as a sanity check — e.g., does stretched VWAP actually predict reversal?
 */
function aggregateHitsReversed(records, fwdWin) {
  const out = { total: { count: 0, hits: 0, retSum: 0 } };
  for (const r of records) {
    const fwd = r.fwd[fwdWin];
    if (fwd == null) continue;
    const signedRet = fwd * (-r.direction);  // REVERSED
    out.total.count++;
    out.total.retSum += signedRet;
    if (signedRet > 0) out.total.hits++;
  }
  out.total.hitRate = out.total.count > 0 ? out.total.hits / out.total.count : null;
  out.total.avgSignedRet = out.total.count > 0 ? out.total.retSum / out.total.count : null;
  return out;
}

// ─── VWAP sweep ─────────────────────────────────────────────────────────────

function sweepVwapConfig(allCandles, allFwd) {
  // For each (N, threshold) config, build records for all symbols, then
  // evaluate TRAIN hit rate at the default forward window.
  // Pick best by TRAIN total hit rate (require >= MIN_SIGNALS_TRAIN total signals).
  const results = [];
  let best = null;
  for (const N of VWAP_PERIODS) {
    // Pre-compute the per-symbol VWAP series once per N.
    const seriesBySymbol = {};
    for (const sym of Object.keys(allCandles)) {
      seriesBySymbol[sym] = computeVwapExtensionSeries(allCandles[sym], N, 14);
    }
    for (const threshold of VWAP_THRESHOLDS) {
      const triggerFn = (val) => {
        if (val == null || !isFinite(val)) return null;
        if (val >  threshold) return { direction: +1, value: val };
        if (val < -threshold) return { direction: -1, value: val };
        return null;
      };
      const allRecords = [];
      for (const sym of Object.keys(allCandles)) {
        const recs = buildSignalRecords(
          sym, allCandles[sym], seriesBySymbol[sym], allFwd[sym], triggerFn
        );
        allRecords.push(...recs);
      }
      const trainRecs = allRecords.filter(r => r.period === 'TRAIN');
      const valRecs   = allRecords.filter(r => r.period === 'VALIDATION');
      const oosRecs   = allRecords.filter(r => r.period === 'OOS');
      const trainAgg  = aggregateHits(trainRecs, DEFAULT_FORWARD);
      const valAgg    = aggregateHits(valRecs,   DEFAULT_FORWARD);
      const oosAgg    = aggregateHits(oosRecs,   DEFAULT_FORWARD);
      // Also test reverse (mean-reversion) interpretation on TRAIN.
      const trainRev  = aggregateHitsReversed(trainRecs, DEFAULT_FORWARD);
      const oosRev    = aggregateHitsReversed(oosRecs,   DEFAULT_FORWARD);

      const cell = {
        config: { N, threshold },
        train:  { count: trainAgg.total.count, hitRate: trainAgg.total.hitRate, avgRet: trainAgg.total.avgSignedRet,
                  bull: { count: trainAgg.bullish.count, hitRate: trainAgg.bullish.hitRate },
                  bear: { count: trainAgg.bearish.count, hitRate: trainAgg.bearish.hitRate } },
        val:    { count: valAgg.total.count,   hitRate: valAgg.total.hitRate,   avgRet: valAgg.total.avgSignedRet },
        oos:    { count: oosAgg.total.count,   hitRate: oosAgg.total.hitRate,   avgRet: oosAgg.total.avgSignedRet,
                  bull: { count: oosAgg.bullish.count, hitRate: oosAgg.bullish.hitRate },
                  bear: { count: oosAgg.bearish.count, hitRate: oosAgg.bearish.hitRate } },
        train_reverse: { count: trainRev.total.count, hitRate: trainRev.total.hitRate, avgRet: trainRev.total.avgSignedRet },
        oos_reverse:   { count: oosRev.total.count,   hitRate: oosRev.total.hitRate,   avgRet: oosRev.total.avgSignedRet },
        // Stash records for the chosen config — we'll re-aggregate by window later
        _records: allRecords,
      };
      results.push(cell);
      if (
        trainAgg.total.count >= MIN_SIGNALS_TRAIN &&
        (best == null ||
          trainAgg.total.hitRate > best.train.hitRate ||
          (trainAgg.total.hitRate === best.train.hitRate && trainAgg.total.count > best.train.count))
      ) {
        best = cell;
      }
    }
  }
  return { grid: results, best };
}

// ─── OBV sweep ──────────────────────────────────────────────────────────────

function sweepObvConfig(allCandles, allFwd) {
  const results = [];
  let best = null;
  for (const N of OBV_PERIODS) {
    const seriesBySymbol = {};
    for (const sym of Object.keys(allCandles)) {
      seriesBySymbol[sym] = computeObvDivergenceSeries(allCandles[sym], N);
    }
    for (const slopeCut of OBV_SLOPE_CUTS) {
      const triggerFn = (sig) => {
        if (sig == null) return null;
        if (Math.abs(sig.price_slope_norm) < slopeCut) return null;
        if (sig.bullish_div) return { direction: +1, value: sig.price_slope_norm };
        if (sig.bearish_div) return { direction: -1, value: sig.price_slope_norm };
        return null;
      };
      const allRecords = [];
      for (const sym of Object.keys(allCandles)) {
        const recs = buildSignalRecords(
          sym, allCandles[sym], seriesBySymbol[sym], allFwd[sym], triggerFn
        );
        allRecords.push(...recs);
      }
      const trainRecs = allRecords.filter(r => r.period === 'TRAIN');
      const valRecs   = allRecords.filter(r => r.period === 'VALIDATION');
      const oosRecs   = allRecords.filter(r => r.period === 'OOS');
      const trainAgg  = aggregateHits(trainRecs, DEFAULT_FORWARD);
      const valAgg    = aggregateHits(valRecs,   DEFAULT_FORWARD);
      const oosAgg    = aggregateHits(oosRecs,   DEFAULT_FORWARD);

      const cell = {
        config: { N, slopeCut },
        train:  { count: trainAgg.total.count, hitRate: trainAgg.total.hitRate, avgRet: trainAgg.total.avgSignedRet,
                  bull: { count: trainAgg.bullish.count, hitRate: trainAgg.bullish.hitRate },
                  bear: { count: trainAgg.bearish.count, hitRate: trainAgg.bearish.hitRate } },
        val:    { count: valAgg.total.count,   hitRate: valAgg.total.hitRate,   avgRet: valAgg.total.avgSignedRet },
        oos:    { count: oosAgg.total.count,   hitRate: oosAgg.total.hitRate,   avgRet: oosAgg.total.avgSignedRet,
                  bull: { count: oosAgg.bullish.count, hitRate: oosAgg.bullish.hitRate },
                  bear: { count: oosAgg.bearish.count, hitRate: oosAgg.bearish.hitRate } },
        _records: allRecords,
      };
      results.push(cell);
      if (
        trainAgg.total.count >= MIN_SIGNALS_TRAIN &&
        (best == null ||
          trainAgg.total.hitRate > best.train.hitRate ||
          (trainAgg.total.hitRate === best.train.hitRate && trainAgg.total.count > best.train.count))
      ) {
        best = cell;
      }
    }
  }
  return { grid: results, best };
}

// ─── Per-window + per-symbol breakdown for the chosen config ───────────────

function breakdownByWindow(records) {
  const out = {};
  for (const w of FORWARD_WINDOWS) {
    const byPeriod = {};
    for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
      const recs = records.filter(r => r.period === period);
      byPeriod[period] = aggregateHits(recs, w);
    }
    out[w] = byPeriod;
  }
  return out;
}

function breakdownBySymbol(records, fwdWin) {
  const out = {};
  for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
    out[period] = {};
    for (const sym of SYMBOLS) {
      const recs = records.filter(r => r.period === period && r.symbol === sym);
      const agg = aggregateHits(recs, fwdWin);
      out[period][sym] = {
        total: { count: agg.total.count, hitRate: agg.total.hitRate, avgRet: agg.total.avgSignedRet },
        bull:  { count: agg.bullish.count, hitRate: agg.bullish.hitRate },
        bear:  { count: agg.bearish.count, hitRate: agg.bearish.hitRate },
      };
    }
  }
  return out;
}

// ─── Printing helpers ───────────────────────────────────────────────────────

function pct(x, digits = 1) {
  if (x == null || !isFinite(x)) return '   —  ';
  return (x * 100).toFixed(digits).padStart(5) + '%';
}
function num(x, digits = 2) {
  if (x == null || !isFinite(x)) return '   —  ';
  return (x >= 0 ? '+' : '') + (x * 100).toFixed(digits).padStart(6) + '%';
}
function pad(s, n) { return String(s).padEnd(n); }

function printVwapGrid(grid, best) {
  console.log('\n── VWAP Extension: TRAIN sweep (10d forward, total pre-cost hit rate) ──');
  console.log('  Config (N, thr)  │ TRAIN count  hit  avgRet │ VAL count  hit │ OOS count  hit │ TRAIN-rev hit');
  console.log('  ─────────────────┼──────────────────────────┼────────────────┼────────────────┼──────────────');
  for (const c of grid) {
    const mark = best && c.config.N === best.config.N && c.config.threshold === best.config.threshold ? '*' : ' ';
    console.log(
      `  N=${String(c.config.N).padStart(2)} thr=${c.config.threshold.toFixed(2).padStart(4)} ${mark}│ ` +
      `${String(c.train.count).padStart(5)}  ${pct(c.train.hitRate)} ${num(c.train.avgRet)} │ ` +
      `${String(c.val.count).padStart(5)}  ${pct(c.val.hitRate)} │ ` +
      `${String(c.oos.count).padStart(5)}  ${pct(c.oos.hitRate)} │ ` +
      `${pct(c.train_reverse.hitRate)}`
    );
  }
  if (best) {
    console.log(`\n  ✓ Best TRAIN config: N=${best.config.N}, threshold=${best.config.threshold}  (${pct(best.train.hitRate)} TRAIN hit, ${best.train.count} signals)`);
  }
}

function printObvGrid(grid, best) {
  console.log('\n── OBV Divergence: TRAIN sweep (10d forward, total pre-cost hit rate) ──');
  console.log('  Config (N, cut)  │ TRAIN count  hit  avgRet │ VAL count  hit │ OOS count  hit');
  console.log('  ─────────────────┼──────────────────────────┼────────────────┼───────────────');
  for (const c of grid) {
    const mark = best && c.config.N === best.config.N && c.config.slopeCut === best.config.slopeCut ? '*' : ' ';
    console.log(
      `  N=${String(c.config.N).padStart(2)} cut=${c.config.slopeCut.toFixed(2).padStart(4)} ${mark}│ ` +
      `${String(c.train.count).padStart(5)}  ${pct(c.train.hitRate)} ${num(c.train.avgRet)} │ ` +
      `${String(c.val.count).padStart(5)}  ${pct(c.val.hitRate)} │ ` +
      `${String(c.oos.count).padStart(5)}  ${pct(c.oos.hitRate)}`
    );
  }
  if (best) {
    console.log(`\n  ✓ Best TRAIN config: N=${best.config.N}, slopeCut=${best.config.slopeCut}  (${pct(best.train.hitRate)} TRAIN hit, ${best.train.count} signals)`);
  }
}

function printWindowBreakdown(windows, label) {
  console.log(`\n── ${label}: Forward window comparison (best config) ──`);
  console.log('  Window │ TRAIN count  hit  avgRet │ VAL count  hit  avgRet │ OOS count  hit  avgRet');
  console.log('  ───────┼───────────────────────────┼───────────────────────────┼───────────────────────────');
  for (const w of FORWARD_WINDOWS) {
    const t = windows[w].TRAIN, v = windows[w].VALIDATION, o = windows[w].OOS;
    console.log(
      `  ${String(w).padStart(4)}d  │ ` +
      `${String(t.total.count).padStart(5)}  ${pct(t.total.hitRate)} ${num(t.total.avgSignedRet)} │ ` +
      `${String(v.total.count).padStart(5)}  ${pct(v.total.hitRate)} ${num(v.total.avgSignedRet)} │ ` +
      `${String(o.total.count).padStart(5)}  ${pct(o.total.hitRate)} ${num(o.total.avgSignedRet)}`
    );
  }
}

function printDirectionBreakdown(records, label) {
  console.log(`\n── ${label}: Bullish vs Bearish breakdown (10d forward) ──`);
  for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
    const recs = records.filter(r => r.period === period);
    const agg = aggregateHits(recs, DEFAULT_FORWARD);
    console.log(
      `  ${pad(period, 12)} ` +
      `BULL ${String(agg.bullish.count).padStart(4)} sig | hit ${pct(agg.bullish.hitRate)} | avgRet ${num(agg.bullish.avgSignedRet)}   ` +
      `|| BEAR ${String(agg.bearish.count).padStart(4)} sig | hit ${pct(agg.bearish.hitRate)} | avgRet ${num(agg.bearish.avgSignedRet)}`
    );
  }
}

function printPerSymbol(records, label) {
  console.log(`\n── ${label}: Per-symbol OOS breakdown (10d forward) ──`);
  console.log('  Symbol  │ Total count  hit  avgRet │ Bull count  hit │ Bear count  hit');
  console.log('  ────────┼───────────────────────────┼────────────────┼────────────────');
  const perSym = breakdownBySymbol(records, DEFAULT_FORWARD);
  for (const sym of SYMBOLS) {
    const o = perSym.OOS[sym];
    if (!o) continue;
    const tStr = o.total.count > 0
      ? `${String(o.total.count).padStart(4)}  ${pct(o.total.hitRate)} ${num(o.total.avgRet)}`
      : '   0   —       —  ';
    const bStr = o.bull.count > 0  ? `${String(o.bull.count).padStart(4)}  ${pct(o.bull.hitRate)}`  : '   0   —  ';
    const rStr = o.bear.count > 0  ? `${String(o.bear.count).padStart(4)}  ${pct(o.bear.hitRate)}`  : '   0   —  ';
    console.log(`  ${pad(sym, 6)}  │ ${tStr} │ ${bStr} │ ${rStr}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━ TrendScan New Signal Tests: VWAP Extension + OBV Divergence ━━━');
  console.log(`  Symbols:     ${SYMBOLS.length}  (${SYMBOLS.join(', ')})`);
  console.log(`  Periods:     TRAIN ${PERIODS.TRAIN.start}→${PERIODS.TRAIN.end} | VAL ${PERIODS.VALIDATION.start}→${PERIODS.VALIDATION.end} | OOS ${PERIODS.OOS.start}→${PERIODS.OOS.end}`);
  console.log(`  Forward:     ${FORWARD_WINDOWS.join(', ')} days  (primary = ${DEFAULT_FORWARD}d)`);
  console.log(`  Decision:    OOS hit rate > ${(OOS_HIT_THRESHOLD*100).toFixed(0)}% AND > ${MIN_SIGNALS_OOS} OOS signals = predictive value`);
  console.log('');

  // 1. Load data
  console.log('━━━ Loading historical data ━━━');
  const allCandles = {};
  const allFwd = {};
  for (const s of SYMBOLS) {
    const d = loadSymbol(s);
    if (!d) { console.warn(`  ⚠ ${s}: no data found, skipping`); continue; }
    allCandles[s] = d.candles;
    allFwd[s]     = precomputeForwardReturns(d.candles);
    const first = d.candles[0]?.ts, last = d.candles[d.candles.length-1]?.ts;
    console.log(`  ${s.padEnd(5)} ${String(d.candles.length).padStart(4)} candles | ${ymd(first)} → ${ymd(last)}`);
  }

  // 2. VWAP Extension sweep
  console.log('\n━━━ VWAP Extension sweep ━━━');
  const vwapResult = sweepVwapConfig(allCandles, allFwd);
  printVwapGrid(vwapResult.grid, vwapResult.best);

  // 3. OBV Divergence sweep
  console.log('\n━━━ OBV Divergence sweep ━━━');
  const obvResult = sweepObvConfig(allCandles, allFwd);
  printObvGrid(obvResult.grid, obvResult.best);

  // 4. Deep-dive on best VWAP config
  const vwapDecision = { has_predictive_value: false };
  if (vwapResult.best) {
    const best = vwapResult.best;
    const records = best._records;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`━━━ VWAP Extension deep-dive (N=${best.config.N}, thr=${best.config.threshold}) ─━━`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const windows = breakdownByWindow(records);
    printWindowBreakdown(windows, 'VWAP Extension');
    printDirectionBreakdown(records, 'VWAP Extension');
    printPerSymbol(records, 'VWAP Extension');

    // Decision
    const oosCount = best.oos.count;
    const oosHit   = best.oos.hitRate;
    const oosBullHit = best.oos.bull.hitRate;
    const oosBearHit = best.oos.bear.hitRate;
    const revOosHit  = best.oos_reverse.hitRate;
    const oosAvgRet  = best.oos.avgRet;
    vwapDecision.config = best.config;
    vwapDecision.train = best.train;
    vwapDecision.val   = best.val;
    vwapDecision.oos   = best.oos;
    vwapDecision.oos_reverse = { count: best.oos_reverse.count, hitRate: revOosHit, avgRet: best.oos_reverse.avgRet };
    vwapDecision.has_predictive_value =
      oosCount > MIN_SIGNALS_OOS && oosHit != null && oosHit > OOS_HIT_THRESHOLD;
    vwapDecision.reverse_has_predictive_value =
      best.oos_reverse.count > MIN_SIGNALS_OOS && revOosHit != null && revOosHit > OOS_HIT_THRESHOLD;

    console.log('\n  ── VWAP Decision ──');
    console.log(`  OOS: ${oosCount} signals, ${pct(oosHit)} momentum hit, avg signed ret ${num(oosAvgRet)}`);
    console.log(`       bull: ${best.oos.bull.count} sig ${pct(oosBullHit)} | bear: ${best.oos.bear.count} sig ${pct(oosBearHit)}`);
    console.log(`  OOS (reverse / mean-reversion interpretation): ${best.oos_reverse.count} sig ${pct(revOosHit)}`);
    console.log(`  ${vwapDecision.has_predictive_value ? '✓ MOMENTUM interpretation has OOS predictive value' : '✗ Momentum interpretation does NOT meet OOS threshold'}`);
    console.log(`  ${vwapDecision.reverse_has_predictive_value ? '✓ REVERSAL interpretation has OOS predictive value' : '✗ Reversal interpretation does NOT meet OOS threshold'}`);

    // Also report per-config OOS hit rate table for transparency
    vwapDecision.all_configs_oos = vwapResult.grid.map(c => ({
      config: c.config, train: c.train, val: c.val, oos: c.oos, train_reverse: c.train_reverse, oos_reverse: c.oos_reverse,
    }));
  } else {
    console.log('  ✗ No VWAP config produced enough TRAIN signals');
  }

  // 5. Deep-dive on best OBV config
  const obvDecision = { has_predictive_value: false };
  if (obvResult.best) {
    const best = obvResult.best;
    const records = best._records;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`━━━ OBV Divergence deep-dive (N=${best.config.N}, slopeCut=${best.config.slopeCut}) ─━━`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const windows = breakdownByWindow(records);
    printWindowBreakdown(windows, 'OBV Divergence');
    printDirectionBreakdown(records, 'OBV Divergence');
    printPerSymbol(records, 'OBV Divergence');

    const oosCount   = best.oos.count;
    const oosHit     = best.oos.hitRate;
    const oosBullHit = best.oos.bull.hitRate;
    const oosBearHit = best.oos.bear.hitRate;
    const oosAvgRet  = best.oos.avgRet;
    obvDecision.config = best.config;
    obvDecision.train = best.train;
    obvDecision.val   = best.val;
    obvDecision.oos   = best.oos;
    obvDecision.has_predictive_value =
      oosCount > MIN_SIGNALS_OOS && oosHit != null && oosHit > OOS_HIT_THRESHOLD;

    console.log('\n  ── OBV Decision ──');
    console.log(`  OOS: ${oosCount} signals, ${pct(oosHit)} hit, avg signed ret ${num(oosAvgRet)}`);
    console.log(`       bull: ${best.oos.bull.count} sig ${pct(oosBullHit)} | bear: ${best.oos.bear.count} sig ${pct(oosBearHit)}`);
    console.log(`  ${obvDecision.has_predictive_value ? '✓ Has OOS predictive value' : '✗ Does NOT meet OOS threshold'}`);

    obvDecision.all_configs_oos = obvResult.grid.map(c => ({
      config: c.config, train: c.train, val: c.val, oos: c.oos,
    }));
  } else {
    console.log('  ✗ No OBV config produced enough TRAIN signals');
  }

  // 6. Write JSON output
  const results = {
    generated_at: new Date().toISOString(),
    config: {
      symbols: SYMBOLS,
      periods: PERIODS,
      forward_windows: FORWARD_WINDOWS,
      primary_forward_window: DEFAULT_FORWARD,
      min_signals_train: MIN_SIGNALS_TRAIN,
      min_signals_oos: MIN_SIGNALS_OOS,
      oos_hit_threshold: OOS_HIT_THRESHOLD,
      vwap_thresholds_swept: VWAP_THRESHOLDS,
      vwap_periods_swept: VWAP_PERIODS,
      obv_periods_swept: OBV_PERIODS,
      obv_slope_cuts_swept: OBV_SLOPE_CUTS,
    },
    vwap_extension: {
      sweep_grid: vwapResult.grid.map(c => ({
        config: c.config,
        train: c.train, val: c.val, oos: c.oos,
        train_reverse: c.train_reverse, oos_reverse: c.oos_reverse,
      })),
      best_config: vwapResult.best ? {
        config: vwapResult.best.config,
        train: vwapResult.best.train,
        val: vwapResult.best.val,
        oos: vwapResult.best.oos,
        oos_reverse: vwapResult.best.oos_reverse,
      } : null,
      windows_breakdown: vwapResult.best ? breakdownByWindow(vwapResult.best._records) : null,
      per_symbol: vwapResult.best ? breakdownBySymbol(vwapResult.best._records, DEFAULT_FORWARD) : null,
      decision: vwapDecision,
    },
    obv_divergence: {
      sweep_grid: obvResult.grid.map(c => ({
        config: c.config,
        train: c.train, val: c.val, oos: c.oos,
      })),
      best_config: obvResult.best ? {
        config: obvResult.best.config,
        train: obvResult.best.train,
        val: obvResult.best.val,
        oos: obvResult.best.oos,
      } : null,
      windows_breakdown: obvResult.best ? breakdownByWindow(obvResult.best._records) : null,
      per_symbol: obvResult.best ? breakdownBySymbol(obvResult.best._records, DEFAULT_FORWARD) : null,
      decision: obvDecision,
    },
    summary: {
      vwap_extension: vwapDecision,
      obv_divergence: obvDecision,
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  console.log(`\n✓ Wrote ${OUT_JSON}`);

  // Final headline
  console.log('\n━━━ HEADLINE ━━━');
  if (vwapResult.best) {
    const b = vwapResult.best;
    console.log(`  VWAP Extension (N=${b.config.N}, thr=${b.config.threshold}):`);
    console.log(`    TRAIN ${b.train.count} sig | ${pct(b.train.hitRate)} hit | avgRet ${num(b.train.avgRet)}`);
    console.log(`    VAL   ${b.val.count} sig | ${pct(b.val.hitRate)} hit | avgRet ${num(b.val.avgRet)}`);
    console.log(`    OOS   ${b.oos.count} sig | ${pct(b.oos.hitRate)} hit | avgRet ${num(b.oos.avgRet)}  (rev: ${pct(b.oos_reverse.hitRate)})`);
    console.log(`    ${vwapDecision.has_predictive_value ? '✓' : '✗'} Momentum OOS predictive: ${vwapDecision.has_predictive_value}`);
    console.log(`    ${vwapDecision.reverse_has_predictive_value ? '✓' : '✗'} Reversal OOS predictive: ${vwapDecision.reverse_has_predictive_value}`);
  }
  if (obvResult.best) {
    const b = obvResult.best;
    console.log(`  OBV Divergence (N=${b.config.N}, slopeCut=${b.config.slopeCut}):`);
    console.log(`    TRAIN ${b.train.count} sig | ${pct(b.train.hitRate)} hit | avgRet ${num(b.train.avgRet)}`);
    console.log(`    VAL   ${b.val.count} sig | ${pct(b.val.hitRate)} hit | avgRet ${num(b.val.avgRet)}`);
    console.log(`    OOS   ${b.oos.count} sig | ${pct(b.oos.hitRate)} hit | avgRet ${num(b.oos.avgRet)}`);
    console.log(`    ${obvDecision.has_predictive_value ? '✓' : '✗'} OOS predictive: ${obvDecision.has_predictive_value}`);
  }
  return results;
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
