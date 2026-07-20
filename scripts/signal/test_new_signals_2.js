/**
 * test_new_signals_2.js — Walk-forward validation of THREE new candidate signals:
 *
 *   1. RSI Divergence (per-symbol)
 *      Compute RSI(14). Over a lookback window of N days (default 14):
 *        - Find idx_low  = argmin(low)  in [i-N, i-1]   (previous price low)
 *        - Find idx_high = argmax(high) in [i-N, i-1]   (previous price high)
 *      Bullish divergence (potential bottom):
 *        low[i]  <  low[idx_low]  AND  rsi[i] > rsi[idx_low]
 *        (price makes a LOWER low but RSI makes a HIGHER low → momentum improving)
 *      Bearish divergence (potential top):
 *        high[i] >  high[idx_high] AND  rsi[i] < rsi[idx_high]
 *        (price makes a HIGHER high but RSI makes a LOWER high → momentum fading)
 *      Direction: +1 bullish div, -1 bearish div
 *      Sweep: lookback N ∈ {10, 14, 20, 30}
 *
 *   2. Multi-Horizon Momentum Alignment (per-symbol)
 *      Compute returns over horizons {1d, 3d, 5d, 10d, 20d, 60d}.
 *      Bullish alignment: all 6 returns > +threshold  (consistent uptrend)
 *      Bearish alignment: all 6 returns < -threshold  (consistent downtrend)
 *      Mixed: otherwise → no signal
 *      Direction: +1 bullish align, -1 bearish align (continuation hypothesis)
 *      Sweep: threshold ∈ {0, 0.005, 0.01, 0.02, 0.03}
 *      Also tested (reverse / mean-reversion): direction inverted.
 *
 *   3. Cross-Asset Correlation (Crowding) — market-wide signal applied to every symbol
 *      For each day t, compute 30-day rolling Pearson correlation:
 *        - BTC ↔ ETH
 *        - average of all C(13,2)=78 pairwise correlations across the 13 symbols
 *      High crowding (avg_corr > highCut):  reversal risk → bearish trigger (-1)
 *      Low crowding  (avg_corr < lowCut):   stock-picking → bullish trigger (+1)
 *      Mid: no signal.
 *      Sweep: highCut ∈ {0.70, 0.75, 0.80, 0.85}, lowCut ∈ {0.30, 0.40, 0.50}
 *
 * All three signals are tested INDIVIDUALLY (not integrated into compute.js).
 * For each signal:
 *   - Compute the signal for every (symbol, day) in the dataset.
 *   - Bucket by TRAIN / VAL / OOS using the same date boundaries as walk_forward_backtest.js.
 *   - Compute hit rate (signed forward return matches signal direction) at
 *     1d / 5d / 10d / 20d forward windows.
 *   - Sweep config grid; pick best by TRAIN hit rate (>= 50 TRAIN signals);
 *     apply unchanged to VAL/OOS.
 *   - Report per-period hit rates, per-direction breakdown, per-symbol OOS breakdown.
 *
 * Decision criterion: OOS hit rate > 50% with > 100 OOS signals → predictive value.
 *
 * Usage:
 *   node scripts/signal/test_new_signals_2.js
 *
 * Output:
 *   scripts/signal/test_new_signals_2_results.json  (full results)
 *   console summary
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data', 'historical');
const OUT_JSON = path.join(__dirname, 'test_new_signals_2_results.json');

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

const MIN_SIGNALS_TRAIN = 50;
const MIN_SIGNALS_OOS   = 100;
const OOS_HIT_THRESHOLD = 0.50;

// RSI Divergence sweep grid
const RSI_PERIOD        = 14;                       // Wilder RSI length (fixed)
const RSI_LOOKBACKS     = [10, 14, 20, 30];         // divergence lookback window N

// Multi-horizon alignment sweep grid
const MH_HORIZONS       = [1, 3, 5, 10, 20, 60];
const MH_THRESHOLDS     = [0, 0.005, 0.01, 0.02, 0.03];

// Crowding sweep grid
const CROWD_LOOKBACK    = 30;                       // 30-day rolling correlation
const CROWD_HIGH_CUTS   = [0.70, 0.75, 0.80, 0.85]; // > → bearish (reversal risk)
const CROWD_LOW_CUTS    = [0.30, 0.40, 0.50];       // < → bullish (stock-picking)

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

// ─── Data loading ───────────────────────────────────────────────────────────

function loadSymbol(symbol) {
  const kPath = path.join(DATA_DIR, symbol, 'klines_1d.json');
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

function pearson(x, y) {
  const n = x.length;
  if (n !== y.length || n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]; sy += y[i];
    sxy += x[i] * y[i];
    sx2 += x[i] * x[i];
    sy2 += y[i] * y[i];
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
  if (den === 0) return null;
  return num / den;
}

// ─── Signal 1: RSI Divergence ───────────────────────────────────────────────

/**
 * Wilder's RSI series, aligned with `candles`.
 * First valid RSI is at index = period (uses changes[0..period-1]).
 */
function computeRsiSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const changes = new Array(candles.length - 1);
  for (let i = 1; i < candles.length; i++) {
    changes[i - 1] = candles[i].close - candles[i - 1].close;
  }
  let gainSum = 0, lossSum = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) gainSum += changes[i];
    else lossSum += -changes[i];
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < candles.length; i++) {
    const ch = changes[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * RSI divergence series.
 *   For each bar i, look back over [i-N, i-1] (exclude current day):
 *     idx_low  = argmin(low)
 *     idx_high = argmax(high)
 *   Bullish div:  low[i]  <  low[idx_low]  AND  rsi[i] > rsi[idx_low]
 *   Bearish div:  high[i] >  high[idx_high] AND  rsi[i] < rsi[idx_high]
 */
function computeRsiDivergenceSeries(candles, lookback = 14, rsiPeriod = 14) {
  const rsi = computeRsiSeries(candles, rsiPeriod);
  const out = new Array(candles.length).fill(null);
  for (let i = lookback + 1; i < candles.length; i++) {
    if (rsi[i] == null) continue;
    let idxLow = i - lookback;
    let idxHigh = i - lookback;
    for (let j = i - lookback + 1; j <= i - 1; j++) {
      if (candles[j].low < candles[idxLow].low) idxLow = j;
      if (candles[j].high > candles[idxHigh].high) idxHigh = j;
    }
    if (rsi[idxLow] == null || rsi[idxHigh] == null) continue;
    const bullishDiv =
      candles[i].low < candles[idxLow].low && rsi[i] > rsi[idxLow];
    const bearishDiv =
      candles[i].high > candles[idxHigh].high && rsi[i] < rsi[idxHigh];
    out[i] = {
      rsi: rsi[i],
      prev_rsi_low:  rsi[idxLow],
      prev_rsi_high: rsi[idxHigh],
      prev_low:      candles[idxLow].low,
      prev_high:     candles[idxHigh].high,
      bullish_div:   bullishDiv,
      bearish_div:   bearishDiv,
    };
  }
  return out;
}

// ─── Signal 2: Multi-Horizon Momentum Alignment ─────────────────────────────

/**
 * Multi-horizon return + alignment series.
 *   For each bar i (with i >= max(horizons)), compute:
 *     ret[h] = close[i] / close[i - h] - 1   for h in horizons
 *   Bullish align: all ret[h] > +threshold
 *   Bearish align: all ret[h] < -threshold
 */
function computeMultiHorizonAlignment(candles, horizons = MH_HORIZONS, threshold = 0) {
  const out = new Array(candles.length).fill(null);
  const closes = candles.map(c => c.close);
  const maxH = Math.max(...horizons);
  for (let i = maxH; i < candles.length; i++) {
    const rets = {};
    for (const h of horizons) rets[h] = closes[i] / closes[i - h] - 1;
    const vals = horizons.map(h => rets[h]);
    const allBull = vals.every(r => r > threshold);
    const allBear = vals.every(r => r < -threshold);
    out[i] = {
      returns: rets,
      bullish_align: allBull,
      bearish_align: allBear,
      mixed: !allBull && !allBear,
    };
  }
  return out;
}

// ─── Signal 3: Cross-Asset Correlation (Crowding) ───────────────────────────

/**
 * Build a daily-return matrix aligned by timestamp across all symbols.
 * Returns:
 *   {
 *     dates:   sorted array of timestamps where >=1 symbol has a return,
 *     symbols: array of symbol names (columns),
 *     matrix:  2D array [dateIdx][symIdx] -> return or null
 *   }
 */
function buildReturnMatrix(allCandles) {
  const symbols = Object.keys(allCandles);
  const retByTsSym = new Map(); // ts -> { sym -> ret }
  for (const sym of symbols) {
    const candles = allCandles[sym];
    for (let i = 1; i < candles.length; i++) {
      const ts = candles[i].ts;
      const ret = candles[i].close / candles[i - 1].close - 1;
      if (!retByTsSym.has(ts)) retByTsSym.set(ts, {});
      retByTsSym.get(ts)[sym] = ret;
    }
  }
  const dates = [...retByTsSym.keys()].sort((a, b) => a - b);
  const matrix = dates.map(ts => symbols.map(s => {
    const d = retByTsSym.get(ts);
    return d[s] != null ? d[s] : null;
  }));
  return { dates, symbols, matrix };
}

/**
 * Compute the rolling crowding series.
 *   For each date t (index >= lookback - 1 in the matrix):
 *     For each pair (a, b), a < b: take aligned non-null returns over last `lookback`
 *     days, compute Pearson, accumulate.
 *   avg_corr   = mean of all valid pairwise correlations
 *   btc_eth    = BTC vs ETH correlation (special case)
 * Returns a Map<ts, {avg_corr, btc_eth_corr, n_pairs}>.
 */
function computeCrowdingSeries(allCandles, lookback = CROWD_LOOKBACK) {
  const { dates, symbols, matrix } = buildReturnMatrix(allCandles);
  const btcIdx = symbols.indexOf('BTC');
  const ethIdx = symbols.indexOf('ETH');
  const nSyms = symbols.length;
  const out = new Map();

  for (let i = lookback - 1; i < dates.length; i++) {
    let sumCorr = 0, cntCorr = 0;
    let btcEth = null;
    for (let a = 0; a < nSyms; a++) {
      for (let b = a + 1; b < nSyms; b++) {
        const xs = [], ys = [];
        for (let k = i - lookback + 1; k <= i; k++) {
          const ra = matrix[k][a];
          const rb = matrix[k][b];
          if (ra != null && rb != null) { xs.push(ra); ys.push(rb); }
        }
        if (xs.length < 5) continue;
        const c = pearson(xs, ys);
        if (c == null || !isFinite(c)) continue;
        sumCorr += c; cntCorr++;
        if (a === btcIdx && b === ethIdx) btcEth = c;
      }
    }
    const avgCorr = cntCorr > 0 ? sumCorr / cntCorr : null;
    out.set(dates[i], { avg_corr: avgCorr, btc_eth_corr: btcEth, n_pairs: cntCorr });
  }
  return out;
}

/**
 * For one symbol, build a per-bar crowding signal series aligned with its candles.
 *   Each bar: { crowding, btc_eth_corr, high_regime, low_regime }
 *   high_regime = crowding > highCut   → reversal risk (bearish trigger)
 *   low_regime  = crowding < lowCut    → stock-picking (bullish trigger)
 */
function buildCrowdingSignalSeries(candles, crowdingByTs, highCut, lowCut) {
  const out = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const c = crowdingByTs.get(candles[i].ts);
    if (c == null || c.avg_corr == null) continue;
    out[i] = {
      crowding:      c.avg_corr,
      btc_eth_corr:  c.btc_eth_corr,
      high_regime:   c.avg_corr > highCut,
      low_regime:    c.avg_corr < lowCut,
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
        entry.fwd[w] = (candles[i + w].close / candles[i].close - 1);
      }
    }
    out[i] = entry;
  }
  return out;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

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
      direction: trigger.direction,
      signal_value: trigger.value,
      fwd: fwdData[i].fwd,
    });
  }
  return out;
}

function aggregateHits(records, fwdWin) {
  const out = {
    total:   { count: 0, hits: 0, retSum: 0 },
    bullish: { count: 0, hits: 0, retSum: 0 },
    bearish: { count: 0, hits: 0, retSum: 0 },
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
    out[k].hitRate    = out[k].count > 0 ? out[k].hits / out[k].count : null;
    out[k].avgSignedRet = out[k].count > 0 ? out[k].retSum / out[k].count : null;
  }
  return out;
}

function aggregateHitsReversed(records, fwdWin) {
  const out = { total: { count: 0, hits: 0, retSum: 0 } };
  for (const r of records) {
    const fwd = r.fwd[fwdWin];
    if (fwd == null) continue;
    const signedRet = fwd * (-r.direction);
    out.total.count++;
    out.total.retSum += signedRet;
    if (signedRet > 0) out.total.hits++;
  }
  out.total.hitRate      = out.total.count > 0 ? out.total.hits / out.total.count : null;
  out.total.avgSignedRet = out.total.count > 0 ? out.total.retSum / out.total.count : null;
  return out;
}

// ─── RSI divergence sweep ───────────────────────────────────────────────────

function sweepRsiDivergence(allCandles, allFwd) {
  const results = [];
  let best = null;
  for (const N of RSI_LOOKBACKS) {
    const seriesBySymbol = {};
    for (const sym of Object.keys(allCandles)) {
      seriesBySymbol[sym] = computeRsiDivergenceSeries(allCandles[sym], N, RSI_PERIOD);
    }
    const triggerFn = (sig) => {
      if (sig == null) return null;
      if (sig.bullish_div) return { direction: +1, value: sig.rsi - sig.prev_rsi_low };
      if (sig.bearish_div) return { direction: -1, value: sig.prev_rsi_high - sig.rsi };
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
    const trainRev  = aggregateHitsReversed(trainRecs, DEFAULT_FORWARD);
    const oosRev    = aggregateHitsReversed(oosRecs,   DEFAULT_FORWARD);

    const cell = {
      config: { N, rsiPeriod: RSI_PERIOD },
      train: {
        count: trainAgg.total.count, hitRate: trainAgg.total.hitRate, avgRet: trainAgg.total.avgSignedRet,
        bull: { count: trainAgg.bullish.count, hitRate: trainAgg.bullish.hitRate, avgRet: trainAgg.bullish.avgSignedRet },
        bear: { count: trainAgg.bearish.count, hitRate: trainAgg.bearish.hitRate, avgRet: trainAgg.bearish.avgSignedRet },
      },
      val:   { count: valAgg.total.count, hitRate: valAgg.total.hitRate, avgRet: valAgg.total.avgSignedRet },
      oos:   {
        count: oosAgg.total.count, hitRate: oosAgg.total.hitRate, avgRet: oosAgg.total.avgSignedRet,
        bull: { count: oosAgg.bullish.count, hitRate: oosAgg.bullish.hitRate, avgRet: oosAgg.bullish.avgSignedRet },
        bear: { count: oosAgg.bearish.count, hitRate: oosAgg.bearish.hitRate, avgRet: oosAgg.bearish.avgSignedRet },
      },
      train_reverse: { count: trainRev.total.count, hitRate: trainRev.total.hitRate, avgRet: trainRev.total.avgSignedRet },
      oos_reverse:   { count: oosRev.total.count,   hitRate: oosRev.total.hitRate,   avgRet: oosRev.total.avgSignedRet   },
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
  return { grid: results, best };
}

// ─── Multi-horizon alignment sweep ──────────────────────────────────────────

function sweepMultiHorizon(allCandles, allFwd) {
  const results = [];
  let best = null;
  for (const threshold of MH_THRESHOLDS) {
    const seriesBySymbol = {};
    for (const sym of Object.keys(allCandles)) {
      seriesBySymbol[sym] = computeMultiHorizonAlignment(allCandles[sym], MH_HORIZONS, threshold);
    }
    const triggerFn = (sig) => {
      if (sig == null) return null;
      const vals = MH_HORIZONS.map(h => sig.returns[h]);
      if (sig.bullish_align) return { direction: +1, value: Math.min(...vals) };
      if (sig.bearish_align) return { direction: -1, value: -Math.max(...vals) };
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
    const trainRev  = aggregateHitsReversed(trainRecs, DEFAULT_FORWARD);
    const oosRev    = aggregateHitsReversed(oosRecs,   DEFAULT_FORWARD);

    const cell = {
      config: { threshold, horizons: MH_HORIZONS },
      train: {
        count: trainAgg.total.count, hitRate: trainAgg.total.hitRate, avgRet: trainAgg.total.avgSignedRet,
        bull: { count: trainAgg.bullish.count, hitRate: trainAgg.bullish.hitRate, avgRet: trainAgg.bullish.avgSignedRet },
        bear: { count: trainAgg.bearish.count, hitRate: trainAgg.bearish.hitRate, avgRet: trainAgg.bearish.avgSignedRet },
      },
      val:   { count: valAgg.total.count, hitRate: valAgg.total.hitRate, avgRet: valAgg.total.avgSignedRet },
      oos:   {
        count: oosAgg.total.count, hitRate: oosAgg.total.hitRate, avgRet: oosAgg.total.avgSignedRet,
        bull: { count: oosAgg.bullish.count, hitRate: oosAgg.bullish.hitRate, avgRet: oosAgg.bullish.avgSignedRet },
        bear: { count: oosAgg.bearish.count, hitRate: oosAgg.bearish.hitRate, avgRet: oosAgg.bearish.avgSignedRet },
      },
      train_reverse: { count: trainRev.total.count, hitRate: trainRev.total.hitRate, avgRet: trainRev.total.avgSignedRet },
      oos_reverse:   { count: oosRev.total.count,   hitRate: oosRev.total.hitRate,   avgRet: oosRev.total.avgSignedRet   },
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
  return { grid: results, best };
}

// ─── Crowding sweep ─────────────────────────────────────────────────────────

function sweepCrowding(allCandles, allFwd, crowdingByTs) {
  const results = [];
  let best = null;
  for (const highCut of CROWD_HIGH_CUTS) {
    for (const lowCut of CROWD_LOW_CUTS) {
      if (lowCut >= highCut) continue;  // sensible constraint
      const seriesBySymbol = {};
      for (const sym of Object.keys(allCandles)) {
        seriesBySymbol[sym] = buildCrowdingSignalSeries(allCandles[sym], crowdingByTs, highCut, lowCut);
      }
      const triggerFn = (sig) => {
        if (sig == null) return null;
        if (sig.high_regime) return { direction: -1, value: sig.crowding }; // bearish: reversal risk
        if (sig.low_regime)  return { direction: +1, value: sig.crowding }; // bullish: stock-picking
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
      const trainRev  = aggregateHitsReversed(trainRecs, DEFAULT_FORWARD);
      const oosRev    = aggregateHitsReversed(oosRecs,   DEFAULT_FORWARD);

      const cell = {
        config: { highCut, lowCut, lookback: CROWD_LOOKBACK },
        train: {
          count: trainAgg.total.count, hitRate: trainAgg.total.hitRate, avgRet: trainAgg.total.avgSignedRet,
          bull: { count: trainAgg.bullish.count, hitRate: trainAgg.bullish.hitRate, avgRet: trainAgg.bullish.avgSignedRet },
          bear: { count: trainAgg.bearish.count, hitRate: trainAgg.bearish.hitRate, avgRet: trainAgg.bearish.avgSignedRet },
        },
        val:   { count: valAgg.total.count, hitRate: valAgg.total.hitRate, avgRet: valAgg.total.avgSignedRet },
        oos:   {
          count: oosAgg.total.count, hitRate: oosAgg.total.hitRate, avgRet: oosAgg.total.avgSignedRet,
          bull: { count: oosAgg.bullish.count, hitRate: oosAgg.bullish.hitRate, avgRet: oosAgg.bullish.avgSignedRet },
          bear: { count: oosAgg.bearish.count, hitRate: oosAgg.bearish.hitRate, avgRet: oosAgg.bearish.avgSignedRet },
        },
        train_reverse: { count: trainRev.total.count, hitRate: trainRev.total.hitRate, avgRet: trainRev.total.avgSignedRet },
        oos_reverse:   { count: oosRev.total.count,   hitRate: oosRev.total.hitRate,   avgRet: oosRev.total.avgSignedRet   },
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

function printRsiGrid(grid, best) {
  console.log('\n── RSI Divergence: TRAIN sweep (10d forward, continuation hit rate) ──');
  console.log('  Config (N)  │ TRAIN count  hit  avgRet │ VAL count  hit │ OOS count  hit │ TRAIN-rev hit');
  console.log('  ────────────┼──────────────────────────┼────────────────┼────────────────┼──────────────');
  for (const c of grid) {
    const mark = best && c.config.N === best.config.N ? '*' : ' ';
    console.log(
      `  N=${String(c.config.N).padStart(3)} ${mark}    │ ` +
      `${String(c.train.count).padStart(5)}  ${pct(c.train.hitRate)} ${num(c.train.avgRet)} │ ` +
      `${String(c.val.count).padStart(5)}  ${pct(c.val.hitRate)} │ ` +
      `${String(c.oos.count).padStart(5)}  ${pct(c.oos.hitRate)} │ ` +
      `${pct(c.train_reverse.hitRate)}`
    );
  }
  if (best) {
    console.log(`\n  ✓ Best TRAIN config: N=${best.config.N}  (${pct(best.train.hitRate)} TRAIN hit, ${best.train.count} signals)`);
  }
}

function printMultiHorizonGrid(grid, best) {
  console.log('\n── Multi-Horizon Alignment: TRAIN sweep (10d forward, continuation hit rate) ──');
  console.log('  threshold │ TRAIN count  hit  avgRet │ VAL count  hit │ OOS count  hit │ TRAIN-rev hit');
  console.log('  ──────────┼──────────────────────────┼────────────────┼────────────────┼──────────────');
  for (const c of grid) {
    const mark = best && c.config.threshold === best.config.threshold ? '*' : ' ';
    console.log(
      `  thr=${c.config.threshold.toFixed(3).padStart(5)} ${mark}│ ` +
      `${String(c.train.count).padStart(5)}  ${pct(c.train.hitRate)} ${num(c.train.avgRet)} │ ` +
      `${String(c.val.count).padStart(5)}  ${pct(c.val.hitRate)} │ ` +
      `${String(c.oos.count).padStart(5)}  ${pct(c.oos.hitRate)} │ ` +
      `${pct(c.train_reverse.hitRate)}`
    );
  }
  if (best) {
    console.log(`\n  ✓ Best TRAIN config: threshold=${best.config.threshold}  (${pct(best.train.hitRate)} TRAIN hit, ${best.train.count} signals)`);
  }
}

function printCrowdingGrid(grid, best) {
  console.log('\n── Cross-Asset Crowding: TRAIN sweep (10d forward, reversal-direction hit rate) ──');
  console.log('  (highCut → bearish, lowCut → bullish) ');
  console.log('  highCut lowCut │ TRAIN count  hit  avgRet │ VAL count  hit │ OOS count  hit │ TRAIN-rev hit');
  console.log('  ───────────────┼──────────────────────────┼────────────────┼────────────────┼──────────────');
  for (const c of grid) {
    const mark = best && c.config.highCut === best.config.highCut && c.config.lowCut === best.config.lowCut ? '*' : ' ';
    console.log(
      `  ${c.config.highCut.toFixed(2).padStart(5)} ${c.config.lowCut.toFixed(2).padStart(5)} ${mark}│ ` +
      `${String(c.train.count).padStart(5)}  ${pct(c.train.hitRate)} ${num(c.train.avgRet)} │ ` +
      `${String(c.val.count).padStart(5)}  ${pct(c.val.hitRate)} │ ` +
      `${String(c.oos.count).padStart(5)}  ${pct(c.oos.hitRate)} │ ` +
      `${pct(c.train_reverse.hitRate)}`
    );
  }
  if (best) {
    console.log(`\n  ✓ Best TRAIN config: highCut=${best.config.highCut}, lowCut=${best.config.lowCut}  (${pct(best.train.hitRate)} TRAIN hit, ${best.train.count} signals)`);
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
    const bStr = o.bull.count > 0 ? `${String(o.bull.count).padStart(4)}  ${pct(o.bull.hitRate)}` : '   0   —  ';
    const rStr = o.bear.count > 0 ? `${String(o.bear.count).padStart(4)}  ${pct(o.bear.hitRate)}` : '   0   —  ';
    console.log(`  ${pad(sym, 6)}  │ ${tStr} │ ${bStr} │ ${rStr}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━ TrendScan New Signal Tests #2: RSI Div + Multi-Horizon + Crowding ━━━');
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

  // ─── Signal 1: RSI Divergence ────────────────────────────────────────────
  console.log('\n━━━ RSI Divergence sweep ━━━');
  const rsiResult = sweepRsiDivergence(allCandles, allFwd);
  printRsiGrid(rsiResult.grid, rsiResult.best);

  // ─── Signal 2: Multi-Horizon Momentum Alignment ──────────────────────────
  console.log('\n━━━ Multi-Horizon Momentum Alignment sweep ━━━');
  const mhResult = sweepMultiHorizon(allCandles, allFwd);
  printMultiHorizonGrid(mhResult.grid, mhResult.best);

  // ─── Signal 3: Cross-Asset Crowding ──────────────────────────────────────
  console.log('\n━━━ Cross-Asset Correlation (Crowding) — computing 30-day rolling series ━━━');
  const crowdingByTs = computeCrowdingSeries(allCandles, CROWD_LOOKBACK);
  // Quick sanity stats on the crowding series itself
  const crowdingVals = [];
  let btcEthVals = [];
  for (const v of crowdingByTs.values()) {
    if (v.avg_corr != null) crowdingVals.push(v.avg_corr);
    if (v.btc_eth_corr != null) btcEthVals.push(v.btc_eth_corr);
  }
  if (crowdingVals.length > 0) {
    crowdingVals.sort((a, b) => a - b);
    const q = (p) => crowdingVals[Math.floor(p * (crowdingVals.length - 1))];
    const meanC = mean(crowdingVals);
    console.log(`  Crowding series (avg pairwise corr, 30-day rolling, ${crowdingVals.length} days):`);
    console.log(`    mean=${meanC.toFixed(3)}  min=${crowdingVals[0].toFixed(3)}  p25=${q(0.25).toFixed(3)}  p50=${q(0.5).toFixed(3)}  p75=${q(0.75).toFixed(3)}  max=${crowdingVals[crowdingVals.length-1].toFixed(3)}`);
    btcEthVals.sort((a, b) => a - b);
    const qbe = (p) => btcEthVals[Math.floor(p * (btcEthVals.length - 1))];
    console.log(`  BTC-ETH corr (30-day rolling, ${btcEthVals.length} days):`);
    console.log(`    mean=${mean(btcEthVals).toFixed(3)}  p25=${qbe(0.25).toFixed(3)}  p50=${qbe(0.5).toFixed(3)}  p75=${qbe(0.75).toFixed(3)}`);
  }

  console.log('\n━━━ Crowding sweep ━━━');
  const crowdResult = sweepCrowding(allCandles, allFwd, crowdingByTs);
  printCrowdingGrid(crowdResult.grid, crowdResult.best);

  // ─── Deep-dive on best RSI config ────────────────────────────────────────
  const rsiDecision = { has_predictive_value: false, reverse_has_predictive_value: false };
  if (rsiResult.best) {
    const best = rsiResult.best;
    const records = best._records;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`━━━ RSI Divergence deep-dive (N=${best.config.N}, rsiPeriod=${best.config.rsiPeriod}) ─━━`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const windows = breakdownByWindow(records);
    printWindowBreakdown(windows, 'RSI Divergence');
    printDirectionBreakdown(records, 'RSI Divergence');
    printPerSymbol(records, 'RSI Divergence');

    rsiDecision.config = best.config;
    rsiDecision.train = best.train;
    rsiDecision.val   = best.val;
    rsiDecision.oos   = best.oos;
    rsiDecision.oos_reverse = { count: best.oos_reverse.count, hitRate: best.oos_reverse.hitRate, avgRet: best.oos_reverse.avgRet };
    rsiDecision.has_predictive_value =
      best.oos.count > MIN_SIGNALS_OOS && best.oos.hitRate != null && best.oos.hitRate > OOS_HIT_THRESHOLD;
    rsiDecision.reverse_has_predictive_value =
      best.oos_reverse.count > MIN_SIGNALS_OOS && best.oos_reverse.hitRate != null && best.oos_reverse.hitRate > OOS_HIT_THRESHOLD;

    console.log('\n  ── RSI Decision ──');
    console.log(`  OOS: ${best.oos.count} signals, ${pct(best.oos.hitRate)} continuation hit, avg signed ret ${num(best.oos.avgRet)}`);
    console.log(`       bull: ${best.oos.bull.count} sig ${pct(best.oos.bull.hitRate)} | bear: ${best.oos.bear.count} sig ${pct(best.oos.bear.hitRate)}`);
    console.log(`  OOS (reverse / mean-reversion interpretation): ${best.oos_reverse.count} sig ${pct(best.oos_reverse.hitRate)}`);
    console.log(`  ${rsiDecision.has_predictive_value ? '✓' : '✗'} Continuation interpretation: ${rsiDecision.has_predictive_value}`);
    console.log(`  ${rsiDecision.reverse_has_predictive_value ? '✓' : '✗'} Reversal interpretation: ${rsiDecision.reverse_has_predictive_value}`);

    rsiDecision.all_configs_oos = rsiResult.grid.map(c => ({
      config: c.config, train: c.train, val: c.val, oos: c.oos,
      train_reverse: c.train_reverse, oos_reverse: c.oos_reverse,
    }));
  } else {
    console.log('  ✗ No RSI divergence config produced enough TRAIN signals');
  }

  // ─── Deep-dive on best Multi-Horizon config ──────────────────────────────
  const mhDecision = { has_predictive_value: false, reverse_has_predictive_value: false };
  if (mhResult.best) {
    const best = mhResult.best;
    const records = best._records;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`━━━ Multi-Horizon Alignment deep-dive (threshold=${best.config.threshold}, horizons=${best.config.horizons.join(',')}) ─━━`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const windows = breakdownByWindow(records);
    printWindowBreakdown(windows, 'Multi-Horizon Alignment');
    printDirectionBreakdown(records, 'Multi-Horizon Alignment');
    printPerSymbol(records, 'Multi-Horizon Alignment');

    mhDecision.config = best.config;
    mhDecision.train = best.train;
    mhDecision.val   = best.val;
    mhDecision.oos   = best.oos;
    mhDecision.oos_reverse = { count: best.oos_reverse.count, hitRate: best.oos_reverse.hitRate, avgRet: best.oos_reverse.avgRet };
    mhDecision.has_predictive_value =
      best.oos.count > MIN_SIGNALS_OOS && best.oos.hitRate != null && best.oos.hitRate > OOS_HIT_THRESHOLD;
    mhDecision.reverse_has_predictive_value =
      best.oos_reverse.count > MIN_SIGNALS_OOS && best.oos_reverse.hitRate != null && best.oos_reverse.hitRate > OOS_HIT_THRESHOLD;

    console.log('\n  ── Multi-Horizon Decision ──');
    console.log(`  OOS: ${best.oos.count} signals, ${pct(best.oos.hitRate)} continuation hit, avg signed ret ${num(best.oos.avgRet)}`);
    console.log(`       bull: ${best.oos.bull.count} sig ${pct(best.oos.bull.hitRate)} | bear: ${best.oos.bear.count} sig ${pct(best.oos.bear.hitRate)}`);
    console.log(`  OOS (reverse / mean-reversion interpretation): ${best.oos_reverse.count} sig ${pct(best.oos_reverse.hitRate)}`);
    console.log(`  ${mhDecision.has_predictive_value ? '✓' : '✗'} Continuation interpretation: ${mhDecision.has_predictive_value}`);
    console.log(`  ${mhDecision.reverse_has_predictive_value ? '✓' : '✗'} Reversal interpretation: ${mhDecision.reverse_has_predictive_value}`);

    mhDecision.all_configs_oos = mhResult.grid.map(c => ({
      config: c.config, train: c.train, val: c.val, oos: c.oos,
      train_reverse: c.train_reverse, oos_reverse: c.oos_reverse,
    }));
  } else {
    console.log('  ✗ No Multi-Horizon config produced enough TRAIN signals');
  }

  // ─── Deep-dive on best Crowding config ───────────────────────────────────
  const crowdDecision = { has_predictive_value: false, reverse_has_predictive_value: false };
  if (crowdResult.best) {
    const best = crowdResult.best;
    const records = best._records;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`━━━ Crowding deep-dive (highCut=${best.config.highCut}, lowCut=${best.config.lowCut}, lookback=${best.config.lookback}) ─━━`);
    console.log('  (high regime → bearish/reversal, low regime → bullish/opportunity)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const windows = breakdownByWindow(records);
    printWindowBreakdown(windows, 'Crowding');
    printDirectionBreakdown(records, 'Crowding');
    printPerSymbol(records, 'Crowding');

    crowdDecision.config = best.config;
    crowdDecision.train = best.train;
    crowdDecision.val   = best.val;
    crowdDecision.oos   = best.oos;
    crowdDecision.oos_reverse = { count: best.oos_reverse.count, hitRate: best.oos_reverse.hitRate, avgRet: best.oos_reverse.avgRet };
    crowdDecision.has_predictive_value =
      best.oos.count > MIN_SIGNALS_OOS && best.oos.hitRate != null && best.oos.hitRate > OOS_HIT_THRESHOLD;
    crowdDecision.reverse_has_predictive_value =
      best.oos_reverse.count > MIN_SIGNALS_OOS && best.oos_reverse.hitRate != null && best.oos_reverse.hitRate > OOS_HIT_THRESHOLD;

    console.log('\n  ── Crowding Decision ──');
    console.log(`  OOS: ${best.oos.count} signals, ${pct(best.oos.hitRate)} directional hit, avg signed ret ${num(best.oos.avgRet)}`);
    console.log(`       bull(low-crowd): ${best.oos.bull.count} sig ${pct(best.oos.bull.hitRate)} | bear(high-crowd): ${best.oos.bear.count} sig ${pct(best.oos.bear.hitRate)}`);
    console.log(`  OOS (reverse interpretation): ${best.oos_reverse.count} sig ${pct(best.oos_reverse.hitRate)}`);
    console.log(`  ${crowdDecision.has_predictive_value ? '✓' : '✗'} Directional interpretation: ${crowdDecision.has_predictive_value}`);
    console.log(`  ${crowdDecision.reverse_has_predictive_value ? '✓' : '✗'} Reverse interpretation: ${crowdDecision.reverse_has_predictive_value}`);

    crowdDecision.all_configs_oos = crowdResult.grid.map(c => ({
      config: c.config, train: c.train, val: c.val, oos: c.oos,
      train_reverse: c.train_reverse, oos_reverse: c.oos_reverse,
    }));
  } else {
    console.log('  ✗ No Crowding config produced enough TRAIN signals');
  }

  // ─── Write JSON output ───────────────────────────────────────────────────
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
      rsi_period: RSI_PERIOD,
      rsi_lookbacks_swept: RSI_LOOKBACKS,
      mh_horizons: MH_HORIZONS,
      mh_thresholds_swept: MH_THRESHOLDS,
      crowd_lookback: CROWD_LOOKBACK,
      crowd_high_cuts_swept: CROWD_HIGH_CUTS,
      crowd_low_cuts_swept: CROWD_LOW_CUTS,
    },
    crowding_series_stats: crowdingVals.length > 0 ? (() => {
      const q = (p) => crowdingVals[Math.floor(p * (crowdingVals.length - 1))];
      return {
        n_days: crowdingVals.length,
        mean: mean(crowdingVals),
        min: crowdingVals[0],
        p25: q(0.25), p50: q(0.5), p75: q(0.75),
        max: crowdingVals[crowdingVals.length - 1],
        btc_eth_mean: btcEthVals.length > 0 ? mean(btcEthVals) : null,
      };
    })() : null,
    rsi_divergence: {
      sweep_grid: rsiResult.grid.map(c => ({
        config: c.config,
        train: c.train, val: c.val, oos: c.oos,
        train_reverse: c.train_reverse, oos_reverse: c.oos_reverse,
      })),
      best_config: rsiResult.best ? {
        config: rsiResult.best.config,
        train: rsiResult.best.train,
        val: rsiResult.best.val,
        oos: rsiResult.best.oos,
        oos_reverse: rsiResult.best.oos_reverse,
      } : null,
      windows_breakdown: rsiResult.best ? breakdownByWindow(rsiResult.best._records) : null,
      per_symbol: rsiResult.best ? breakdownBySymbol(rsiResult.best._records, DEFAULT_FORWARD) : null,
      decision: rsiDecision,
    },
    multi_horizon_alignment: {
      sweep_grid: mhResult.grid.map(c => ({
        config: c.config,
        train: c.train, val: c.val, oos: c.oos,
        train_reverse: c.train_reverse, oos_reverse: c.oos_reverse,
      })),
      best_config: mhResult.best ? {
        config: mhResult.best.config,
        train: mhResult.best.train,
        val: mhResult.best.val,
        oos: mhResult.best.oos,
        oos_reverse: mhResult.best.oos_reverse,
      } : null,
      windows_breakdown: mhResult.best ? breakdownByWindow(mhResult.best._records) : null,
      per_symbol: mhResult.best ? breakdownBySymbol(mhResult.best._records, DEFAULT_FORWARD) : null,
      decision: mhDecision,
    },
    cross_asset_crowding: {
      sweep_grid: crowdResult.grid.map(c => ({
        config: c.config,
        train: c.train, val: c.val, oos: c.oos,
        train_reverse: c.train_reverse, oos_reverse: c.oos_reverse,
      })),
      best_config: crowdResult.best ? {
        config: crowdResult.best.config,
        train: crowdResult.best.train,
        val: crowdResult.best.val,
        oos: crowdResult.best.oos,
        oos_reverse: crowdResult.best.oos_reverse,
      } : null,
      windows_breakdown: crowdResult.best ? breakdownByWindow(crowdResult.best._records) : null,
      per_symbol: crowdResult.best ? breakdownBySymbol(crowdResult.best._records, DEFAULT_FORWARD) : null,
      decision: crowdDecision,
    },
    summary: {
      rsi_divergence: rsiDecision,
      multi_horizon_alignment: mhDecision,
      cross_asset_crowding: crowdDecision,
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  console.log(`\n✓ Wrote ${OUT_JSON}`);

  // ─── Final headline ──────────────────────────────────────────────────────
  console.log('\n━━━ HEADLINE ━━━');
  if (rsiResult.best) {
    const b = rsiResult.best;
    console.log(`  RSI Divergence (N=${b.config.N}):`);
    console.log(`    TRAIN ${b.train.count} sig | ${pct(b.train.hitRate)} cont hit | avgRet ${num(b.train.avgRet)}`);
    console.log(`    VAL   ${b.val.count} sig | ${pct(b.val.hitRate)} cont hit | avgRet ${num(b.val.avgRet)}`);
    console.log(`    OOS   ${b.oos.count} sig | ${pct(b.oos.hitRate)} cont hit | avgRet ${num(b.oos.avgRet)}  (rev: ${pct(b.oos_reverse.hitRate)})`);
    console.log(`    ${rsiDecision.has_predictive_value ? '✓' : '✗'} Continuation predictive: ${rsiDecision.has_predictive_value}`);
    console.log(`    ${rsiDecision.reverse_has_predictive_value ? '✓' : '✗'} Reversal predictive: ${rsiDecision.reverse_has_predictive_value}`);
  }
  if (mhResult.best) {
    const b = mhResult.best;
    console.log(`  Multi-Horizon Alignment (thr=${b.config.threshold}):`);
    console.log(`    TRAIN ${b.train.count} sig | ${pct(b.train.hitRate)} cont hit | avgRet ${num(b.train.avgRet)}`);
    console.log(`    VAL   ${b.val.count} sig | ${pct(b.val.hitRate)} cont hit | avgRet ${num(b.val.avgRet)}`);
    console.log(`    OOS   ${b.oos.count} sig | ${pct(b.oos.hitRate)} cont hit | avgRet ${num(b.oos.avgRet)}  (rev: ${pct(b.oos_reverse.hitRate)})`);
    console.log(`    ${mhDecision.has_predictive_value ? '✓' : '✗'} Continuation predictive: ${mhDecision.has_predictive_value}`);
    console.log(`    ${mhDecision.reverse_has_predictive_value ? '✓' : '✗'} Reversal predictive: ${mhDecision.reverse_has_predictive_value}`);
  }
  if (crowdResult.best) {
    const b = crowdResult.best;
    console.log(`  Cross-Asset Crowding (highCut=${b.config.highCut}, lowCut=${b.config.lowCut}):`);
    console.log(`    TRAIN ${b.train.count} sig | ${pct(b.train.hitRate)} directional hit | avgRet ${num(b.train.avgRet)}`);
    console.log(`    VAL   ${b.val.count} sig | ${pct(b.val.hitRate)} directional hit | avgRet ${num(b.val.avgRet)}`);
    console.log(`    OOS   ${b.oos.count} sig | ${pct(b.oos.hitRate)} directional hit | avgRet ${num(b.oos.avgRet)}  (rev: ${pct(b.oos_reverse.hitRate)})`);
    console.log(`    ${crowdDecision.has_predictive_value ? '✓' : '✗'} Directional predictive: ${crowdDecision.has_predictive_value}`);
    console.log(`    ${crowdDecision.reverse_has_predictive_value ? '✓' : '✗'} Reverse predictive: ${crowdDecision.reverse_has_predictive_value}`);
  }

  return results;
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
