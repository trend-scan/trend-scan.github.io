/**
 * ortho_backtest.js — Walk-forward backtest for Orthogonal Trading System v6.1
 *
 * Mirrors the structure of walk_forward_backtest.js (TrendScan's existing
 * engine) so results are directly comparable.
 *
 * Pipeline:
 *   1. Load 13 symbols × daily klines from data/historical/
 *   2. For each symbol, run computeOrthoS() → composite + position series
 *   3. Walk-forward split: TRAIN (2022-01 → 2023-06) / VAL (2023-07 → 2024-06)
 *      / OOS (2024-07 → 2025-07). Threshold τ tuned on TRAIN only.
 *   4. Threshold sweep on TRAIN: τ ∈ {0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0}
 *      Pick best by combined directional hit rate (long+short, ≥30 signals).
 *   5. Apply best τ to VAL and OOS unchanged.
 *   6. Per-symbol breakdown of OOS performance.
 *   7. Ablation: run with each of the 9 signals disabled (weight=0), report
 *      hit-rate delta vs baseline on TRAIN and OOS.
 *   8. Sensitivity sweep on lb (smoothing) and zsc_len (standardisation).
 *   9. Cost model: 20bps round-trip fees (no funding — daily holds, funding
 *      cost is small relative to volatility at this horizon).
 *  10. Write ortho_results.json + console summary.
 *
 * ADAPTATION NOTE — Daily bars vs 4H bars:
 *   The Pine script targets BTCUSDT 4H (6 bars/day). We test on DAILY bars
 *   because that's what TrendScan's data pipeline already has for 13 symbols.
 *   Parameters (lb=5, zsc_len=80, mom_6/18, ema 12/26) are kept UNCHANGED —
 *   so a "bar" here is a day, not 4 hours. This makes signals ~6× rarer than
 *   on 4H data, but the relative ranking of signals and the composite's
 *   predictive power should be preserved. A future 4H backtest would need
 *   to fetch ~7800 bars/symbol from Binance Vision (4H klines archive).
 *
 * Usage:
 *   node scripts/signal/ortho_backtest.js
 *   node scripts/signal/ortho_backtest.js --no-ablation
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeOrthoS,
  DEFAULT_PARAMS,
  SIGNAL_NAMES,
} from '../../src/lib/signal/orthogonal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data', 'historical');
const OUT_JSON = path.join(__dirname, 'ortho_results.json');

// ─── Configuration ───────────────────────────────────────────────────────────

const SYMBOLS = [
  'BTC', 'ETH', 'SOL',
  'AVAX', 'LINK', 'DOGE',
  'ARB', 'OP',
  'INJ', 'SUI', 'NEAR', 'APT', 'TIA',
];

const PERIODS = {
  TRAIN:      { start: '2022-01-01', end: '2023-06-30', label: 'TRAIN (tune)'      },
  VALIDATION: { start: '2023-07-01', end: '2024-06-30', label: 'VALIDATION (hold)' },
  OOS:        { start: '2024-07-01', end: '2025-07-31', label: 'OOS (untouched)'   },
};

const FORWARD_WINDOWS = [1, 3, 5, 10, 20];
const DEFAULT_FORWARD = 10;

// τ sweep — composite is roughly N(0, ~0.2) on daily data, so we sweep
// from very loose (0.2 ≈ 1σ) to strict (1.0 ≈ 5σ).
const TAU_RANGE = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0];

const FEES_PCT_ROUND_TRIP = 0.20; // 20 bps = 0.20%

// ─── Data loading ────────────────────────────────────────────────────────────

function loadSymbol(symbol) {
  const fp = path.join(DATA_DIR, symbol, 'klines_1d.json');
  if (!fs.existsSync(fp)) return null;
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return raw.map(c => ({
    ts: c.t,
    open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v,
  }));
}

function dateInRange(ts, start, end) {
  const d = new Date(ts).toISOString().slice(0, 10);
  return d >= start && d <= end;
}

// ─── Forward returns & cost model ────────────────────────────────────────────

/**
 * Compute forward returns for each bar.
 *   ret_k = close[i+k] / close[i] - 1
 *
 * For SHORT positions, the "directional return" is -ret_k.
 * Net return = directional_return - fees_pct_round_trip.
 */
function computeForwardReturns(candles, windows) {
  const closes = candles.map(c => c.close);
  const out = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    const obj = {};
    for (const w of windows) {
      if (i + w >= closes.length) { obj[w] = null; continue; }
      obj[w] = closes[i + w] / closes[i] - 1;
    }
    out[i] = obj;
  }
  return out;
}

// ─── Per-bar signal generation across τ values ──────────────────────────────

/**
 * For each symbol, compute the composite ONCE (default params), then for
 * each τ in TAU_RANGE, derive the position array. This avoids recomputing
 * the 9 raw signals + z-scoring + smoothing for every τ.
 *
 * Pivot filter is always on (use_pivot=true, pivot_tau=0.0) per Pine default.
 */
function computeSymbolSignals(candles, params = {}) {
  const result = computeOrthoS(candles, params);
  return result;
}

function derivePositions(composite, pivotSig, tau, usePivot = true, pivotTau = 0.0) {
  const pos = new Array(composite.length).fill(0);
  for (let i = 0; i < composite.length; i++) {
    const rawLong  = composite[i] >  tau;
    const rawShort = composite[i] < -tau;
    const pivotLongOk  = !usePivot || pivotSig[i] >  pivotTau;
    const pivotShortOk = !usePivot || pivotSig[i] < -pivotTau;
    pos[i] = (rawLong && pivotLongOk ? 1 : 0) + (rawShort && pivotShortOk ? -1 : 0);
  }
  return pos;
}

// ─── Hit-rate computation ───────────────────────────────────────────────────

/**
 * For a given position array + forward returns, compute hit rates per
 * direction (LONG / SHORT) and combined.
 *
 * preHit  = directional return > 0 (price moved in predicted direction)
 * postHit = net return > 0 (after fees)
 */
function computeHitRates(position, fwdRets, window) {
  let longCount = 0, longPreHits = 0, longPostHits = 0;
  let shortCount = 0, shortPreHits = 0, shortPostHits = 0;
  let longRetSum = 0, shortRetSum = 0;
  let longPostRetSum = 0, shortPostRetSum = 0;

  for (let i = 0; i < position.length; i++) {
    const p = position[i];
    const r = fwdRets[i]?.[window];
    if (r == null) continue;
    if (p === 1) {
      longCount++;
      const net = r * 100 - FEES_PCT_ROUND_TRIP;
      if (r > 0) longPreHits++;
      if (net > 0) longPostHits++;
      longRetSum += r * 100;
      longPostRetSum += net;
    } else if (p === -1) {
      shortCount++;
      const net = -r * 100 - FEES_PCT_ROUND_TRIP;
      if (-r > 0) shortPreHits++;
      if (net > 0) shortPostHits++;
      shortRetSum += -r * 100;
      shortPostRetSum += net;
    }
  }

  const total = longCount + shortCount;
  const combined = {
    count: total,
    preHits: longPreHits + shortPreHits,
    postHits: longPostHits + shortPostHits,
    preHitRate: total > 0 ? (longPreHits + shortPreHits) / total : null,
    postHitRate: total > 0 ? (longPostHits + shortPostHits) / total : null,
    avgPreRetPct: total > 0 ? (longRetSum + shortRetSum) / total : null,
    avgPostRetPct: total > 0 ? (longPostRetSum + shortPostRetSum) / total : null,
  };

  return {
    long: {
      count: longCount,
      preHits: longPreHits, postHits: longPostHits,
      preHitRate: longCount > 0 ? longPreHits / longCount : null,
      postHitRate: longCount > 0 ? longPostHits / longCount : null,
      avgPreRetPct: longCount > 0 ? longRetSum / longCount : null,
      avgPostRetPct: longCount > 0 ? longPostRetSum / longCount : null,
    },
    short: {
      count: shortCount,
      preHits: shortPreHits, postHits: shortPostHits,
      preHitRate: shortCount > 0 ? shortPreHits / shortCount : null,
      postHitRate: shortCount > 0 ? shortPostHits / shortCount : null,
      avgPreRetPct: shortCount > 0 ? shortRetSum / shortCount : null,
      avgPostRetPct: shortCount > 0 ? shortPostRetSum / shortCount : null,
    },
    combined,
  };
}

// ─── Per-period aggregation across all symbols ──────────────────────────────

function aggregatePeriod(symbolResults, periodKey, window) {
  let longCount = 0, longPreHits = 0, longPostHits = 0;
  let shortCount = 0, shortPreHits = 0, shortPostHits = 0;
  let longRetSum = 0, shortRetSum = 0;
  let longPostRetSum = 0, shortPostRetSum = 0;

  for (const symRes of Object.values(symbolResults)) {
    const slice = symRes.periodSlices[periodKey];
    const hr = computeHitRates(slice.position, slice.fwdRets, window);
    longCount += hr.long.count;
    longPreHits += hr.long.preHits;
    longPostHits += hr.long.postHits;
    shortCount += hr.short.count;
    shortPreHits += hr.short.preHits;
    shortPostHits += hr.short.postHits;
    longRetSum += (hr.long.avgPreRetPct ?? 0) * hr.long.count;
    shortRetSum += (hr.short.avgPreRetPct ?? 0) * hr.short.count;
    longPostRetSum += (hr.long.avgPostRetPct ?? 0) * hr.long.count;
    shortPostRetSum += (hr.short.avgPostRetPct ?? 0) * hr.short.count;
  }

  const total = longCount + shortCount;
  return {
    long: {
      count: longCount,
      preHits: longPreHits, postHits: longPostHits,
      preHitRate: longCount > 0 ? longPreHits / longCount : null,
      postHitRate: longCount > 0 ? longPostHits / longCount : null,
      avgPreRetPct: longCount > 0 ? longRetSum / longCount : null,
      avgPostRetPct: longCount > 0 ? longPostRetSum / longCount : null,
    },
    short: {
      count: shortCount,
      preHits: shortPreHits, postHits: shortPostHits,
      preHitRate: shortCount > 0 ? shortPreHits / shortCount : null,
      postHitRate: shortCount > 0 ? shortPostHits / shortCount : null,
      avgPreRetPct: shortCount > 0 ? shortRetSum / shortCount : null,
      avgPostRetPct: shortCount > 0 ? shortPostRetSum / shortCount : null,
    },
    combined: {
      count: total,
      preHits: longPreHits + shortPreHits,
      postHits: longPostHits + shortPostHits,
      preHitRate: total > 0 ? (longPreHits + shortPreHits) / total : null,
      postHitRate: total > 0 ? (longPostHits + shortPostHits) / total : null,
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Orthogonal Trading System v6.1 — Walk-Forward Backtest');
  console.log('  Adapted to daily bars (Pine script targets 4H, params unchanged)');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log();

  // Load all symbol data + compute signals
  const symbolResults = {};
  for (const sym of SYMBOLS) {
    const candles = loadSymbol(sym);
    if (!candles || candles.length < 200) {
      console.log(`  ⚠ ${sym}: insufficient data (${candles?.length ?? 0} bars), skipping`);
      continue;
    }
    const sig = computeSymbolSignals(candles);
    const fwdRets = computeForwardReturns(candles, FORWARD_WINDOWS);

    // Slice by period
    const periodSlices = {};
    for (const [key, per] of Object.entries(PERIODS)) {
      const startTs = new Date(per.start + 'T00:00:00Z').getTime();
      const endTs = new Date(per.end + 'T23:59:59Z').getTime();
      const idxStart = candles.findIndex(c => c.ts >= startTs);
      const idxEnd = candles.findIndex(c => c.ts > endTs);
      const lo = idxStart === -1 ? 0 : idxStart;
      const hi = idxEnd === -1 ? candles.length : idxEnd;
      // Need lookback bars BEFORE period start for warmup
      // OrthoSys needs ~80 bars (zsc_len) + 18 (mom_18) + 26 (ema_slow) = ~124 bars
      // We use a 150-bar warmup buffer.
      const warmupLo = Math.max(0, lo - 150);
      const sliceCandles = candles.slice(warmupLo, hi);
      const sliceComposite = sig.composite.slice(warmupLo, hi);
      const slicePivot = sig.pivot_sig.slice(warmupLo, hi);
      const sliceFwd = fwdRets.slice(warmupLo, hi);
      // Position computed per τ in the sweep; we store the slice for reuse
      periodSlices[key] = {
        candles: sliceCandles,
        composite: sliceComposite,
        pivot_sig: slicePivot,
        fwdRets: sliceFwd,
        // Position array will be filled in by τ sweep
        position: null,
      };
    }

    symbolResults[sym] = { candles, sig, fwdRets, periodSlices };
    console.log(`  ✓ ${sym}: ${candles.length} bars (${new Date(candles[0].ts).toISOString().slice(0,10)} → ${new Date(candles[candles.length-1].ts).toISOString().slice(0,10)})`);
  }
  console.log();

  // ── Threshold sweep on TRAIN ──────────────────────────────────────────────
  console.log('─── Threshold sweep on TRAIN (combined pre-cost hit rate) ───');
  console.log('  τ      long  short  total  preHit%  postHit%  avgPreRet  avgPostRet');
  const sweep = [];
  for (const tau of TAU_RANGE) {
    // Derive positions for each symbol's TRAIN slice
    for (const sym of Object.keys(symbolResults)) {
      const slice = symbolResults[sym].periodSlices.TRAIN;
      slice.position = derivePositions(slice.composite, slice.pivot_sig, tau);
    }
    const hr = aggregatePeriod(symbolResults, 'TRAIN', DEFAULT_FORWARD);
    const preHitPct = hr.combined.preHitRate != null ? (hr.combined.preHitRate * 100).toFixed(1) + '%' : '—';
    const postHitPct = hr.combined.postHitRate != null ? (hr.combined.postHitRate * 100).toFixed(1) + '%' : '—';
    const avgPre = hr.combined.count > 0 ? ((hr.long.avgPreRetPct * hr.long.count + hr.short.avgPreRetPct * hr.short.count) / hr.combined.count).toFixed(2) + '%' : '—';
    const avgPost = hr.combined.count > 0 ? ((hr.long.avgPostRetPct * hr.long.count + hr.short.avgPostRetPct * hr.short.count) / hr.combined.count).toFixed(2) + '%' : '—';
    console.log(`  ${tau.toFixed(2)}   ${String(hr.long.count).padStart(5)}  ${String(hr.short.count).padStart(5)}  ${String(hr.combined.count).padStart(5)}  ${preHitPct.padStart(7)}  ${postHitPct.padStart(7)}  ${avgPre.padStart(9)}  ${avgPost.padStart(9)}`);
    sweep.push({ tau, hr });
  }
  console.log();

  // Pick best τ by combined pre-cost hit rate (≥30 signals)
  const validSweep = sweep.filter(s => s.hr.combined.count >= 30);
  const best = validSweep.length > 0
    ? validSweep.reduce((best, s) => (s.hr.combined.preHitRate > best.hr.combined.preHitRate ? s : best))
    : sweep.reduce((best, s) => (s.hr.combined.count > best.hr.combined.count ? s : best));
  const bestTau = best.tau;
  console.log(`✓ Best τ = ${bestTau} (TRAIN combined pre-hit = ${best.hr.combined.preHitRate != null ? (best.hr.combined.preHitRate * 100).toFixed(1) + '%' : '—'}, ${best.hr.combined.count} signals)`);
  console.log();

  // ── Apply best τ to TRAIN, VAL, and OOS ──────────────────────────────────
  // TRAIN must be re-derived because the sweep left it at the last τ tested.
  for (const sym of Object.keys(symbolResults)) {
    for (const key of ['TRAIN', 'VALIDATION', 'OOS']) {
      const slice = symbolResults[sym].periodSlices[key];
      slice.position = derivePositions(slice.composite, slice.pivot_sig, bestTau);
    }
  }

  console.log('─── Period hit rates (best τ applied unchanged) ───');
  console.log('  Period        long  short  total   preHit%  postHit%  avgPreRet  avgPostRet  overfitFlag');
  const periodHitRates = {};
  for (const [key, per] of Object.entries(PERIODS)) {
    const hr = aggregatePeriod(symbolResults, key, DEFAULT_FORWARD);
    periodHitRates[key] = hr;
    const preHitPct = hr.combined.preHitRate != null ? (hr.combined.preHitRate * 100).toFixed(1) + '%' : '—';
    const postHitPct = hr.combined.postHitRate != null ? (hr.combined.postHitRate * 100).toFixed(1) + '%' : '—';
    const avgPre = hr.combined.count > 0 ? ((hr.long.avgPreRetPct * hr.long.count + hr.short.avgPreRetPct * hr.short.count) / hr.combined.count).toFixed(2) + '%' : '—';
    const avgPost = hr.combined.count > 0 ? ((hr.long.avgPostRetPct * hr.long.count + hr.short.avgPostRetPct * hr.short.count) / hr.combined.count).toFixed(2) + '%' : '—';
    // Overfit flag: VAL pre-hit diverges from OOS by > 20pp
    let overfitFlag = '';
    if (key === 'OOS' && periodHitRates.VALIDATION?.combined?.preHitRate != null && hr.combined.preHitRate != null) {
      const delta = Math.abs(periodHitRates.VALIDATION.combined.preHitRate - hr.combined.preHitRate);
      if (delta > 0.20) overfitFlag = '⚠ OVERFIT';
    }
    console.log(`  ${per.label.padEnd(16)} ${String(hr.long.count).padStart(5)} ${String(hr.short.count).padStart(5)} ${String(hr.combined.count).padStart(5)}   ${preHitPct.padStart(7)}  ${postHitPct.padStart(7)}  ${avgPre.padStart(9)}  ${avgPost.padStart(9)}  ${overfitFlag}`);
  }
  console.log();

  // ── Forward window sweep on OOS ───────────────────────────────────────────
  console.log('─── Forward window sweep (OOS) ───');
  console.log('  Window   long  short  total   preHit%  postHit%');
  const fwdSweep = {};
  for (const w of FORWARD_WINDOWS) {
    const hr = aggregatePeriod(symbolResults, 'OOS', w);
    fwdSweep[w] = hr;
    const preHitPct = hr.combined.preHitRate != null ? (hr.combined.preHitRate * 100).toFixed(1) + '%' : '—';
    const postHitPct = hr.combined.postHitRate != null ? (hr.combined.postHitRate * 100).toFixed(1) + '%' : '—';
    console.log(`  ${String(w + 'd').padEnd(7)} ${String(hr.long.count).padStart(5)} ${String(hr.short.count).padStart(5)} ${String(hr.combined.count).padStart(5)}   ${preHitPct.padStart(7)}  ${postHitPct.padStart(7)}`);
  }
  console.log();

  // ── Per-symbol OOS breakdown ──────────────────────────────────────────────
  console.log('─── Per-symbol OOS breakdown (10-day forward) ───');
  console.log('  Symbol   long  short  total   preHit%  postHit%  avgPreRet  avgPostRet');
  const perSymbol = {};
  for (const sym of Object.keys(symbolResults)) {
    const slice = symbolResults[sym].periodSlices.OOS;
    const hr = computeHitRates(slice.position, slice.fwdRets, DEFAULT_FORWARD);
    perSymbol[sym] = hr;
    const preHitPct = hr.combined.preHitRate != null ? (hr.combined.preHitRate * 100).toFixed(1) + '%' : '—';
    const postHitPct = hr.combined.postHitRate != null ? (hr.combined.postHitRate * 100).toFixed(1) + '%' : '—';
    const avgPre = hr.combined.count > 0 ? ((hr.long.avgPreRetPct * hr.long.count + hr.short.avgPreRetPct * hr.short.count) / hr.combined.count).toFixed(2) + '%' : '—';
    const avgPost = hr.combined.count > 0 ? ((hr.long.avgPostRetPct * hr.long.count + hr.short.avgPostRetPct * hr.short.count) / hr.combined.count).toFixed(2) + '%' : '—';
    console.log(`  ${sym.padEnd(7)} ${String(hr.long.count).padStart(5)} ${String(hr.short.count).padStart(5)} ${String(hr.combined.count).padStart(5)}   ${preHitPct.padStart(7)}  ${postHitPct.padEnd(7)}  ${avgPre.padStart(9)}  ${avgPost.padStart(9)}`);
  }
  console.log();

  // ── Ablation: each signal's marginal contribution ────────────────────────
  console.log('─── Ablation (each signal disabled, weight=0) ───');
  console.log('  Signal         TRAIN ΔpreHit   OOS ΔpreHit   TRAIN ΔpostHit   OOS ΔpostHit');
  const ablation = { baseline: {}, ablations: {} };
  // Recompute baseline (all weights=1) for accurate comparison
  for (const sym of Object.keys(symbolResults)) {
    const candles = symbolResults[sym].candles;
    const sig = computeSymbolSignals(candles); // default weights
    for (const [key, per] of Object.entries(PERIODS)) {
      const startTs = new Date(per.start + 'T00:00:00Z').getTime();
      const endTs = new Date(per.end + 'T23:59:59Z').getTime();
      const idxStart = candles.findIndex(c => c.ts >= startTs);
      const idxEnd = candles.findIndex(c => c.ts > endTs);
      const lo = idxStart === -1 ? 0 : Math.max(0, idxStart - 150);
      const hi = idxEnd === -1 ? candles.length : idxEnd;
      const sliceComposite = sig.composite.slice(lo, hi);
      const slicePivot = sig.pivot_sig.slice(lo, hi);
      const sliceFwd = symbolResults[sym].fwdRets.slice(lo, hi);
      const position = derivePositions(sliceComposite, slicePivot, bestTau);
      const hr = computeHitRates(position, sliceFwd, DEFAULT_FORWARD);
      if (!ablation.baseline[key]) ablation.baseline[key] = { longCount: 0, longPre: 0, longPost: 0, shortCount: 0, shortPre: 0, shortPost: 0, total: 0, preHits: 0, postHits: 0 };
      ablation.baseline[key].longCount += hr.long.count;
      ablation.baseline[key].longPre += hr.long.preHits;
      ablation.baseline[key].longPost += hr.long.postHits;
      ablation.baseline[key].shortCount += hr.short.count;
      ablation.baseline[key].shortPre += hr.short.preHits;
      ablation.baseline[key].shortPost += hr.short.postHits;
      ablation.baseline[key].total += hr.combined.count;
      ablation.baseline[key].preHits += hr.combined.preHits;
      ablation.baseline[key].postHits += hr.combined.postHits;
    }
  }

  for (const sigName of SIGNAL_NAMES) {
    const weights = { ...DEFAULT_PARAMS.weights, [sigName]: 0 };
    const stats = { TRAIN: { total: 0, preHits: 0, postHits: 0 }, OOS: { total: 0, preHits: 0, postHits: 0 } };
    for (const sym of Object.keys(symbolResults)) {
      const candles = symbolResults[sym].candles;
      const sig = computeSymbolSignals(candles, { weights });
      for (const key of ['TRAIN', 'OOS']) {
        const per = PERIODS[key];
        const startTs = new Date(per.start + 'T00:00:00Z').getTime();
        const endTs = new Date(per.end + 'T23:59:59Z').getTime();
        const idxStart = candles.findIndex(c => c.ts >= startTs);
        const idxEnd = candles.findIndex(c => c.ts > endTs);
        const lo = idxStart === -1 ? 0 : Math.max(0, idxStart - 150);
        const hi = idxEnd === -1 ? candles.length : idxEnd;
        const sliceComposite = sig.composite.slice(lo, hi);
        const slicePivot = sig.pivot_sig.slice(lo, hi);
        const sliceFwd = symbolResults[sym].fwdRets.slice(lo, hi);
        const position = derivePositions(sliceComposite, slicePivot, bestTau);
        const hr = computeHitRates(position, sliceFwd, DEFAULT_FORWARD);
        stats[key].total += hr.combined.count;
        stats[key].preHits += hr.combined.preHits;
        stats[key].postHits += hr.combined.postHits;
      }
    }
    const baseTrain = ablation.baseline.TRAIN;
    const baseOos = ablation.baseline.OOS;
    const trainPreHitBase = baseTrain.total > 0 ? baseTrain.preHits / baseTrain.total : null;
    const trainPreHitAbl = stats.TRAIN.total > 0 ? stats.TRAIN.preHits / stats.TRAIN.total : null;
    const oosPreHitBase = baseOos.total > 0 ? baseOos.preHits / baseOos.total : null;
    const oosPreHitAbl = stats.OOS.total > 0 ? stats.OOS.preHits / stats.OOS.total : null;
    const trainPostHitBase = baseTrain.total > 0 ? baseTrain.postHits / baseTrain.total : null;
    const trainPostHitAbl = stats.TRAIN.total > 0 ? stats.TRAIN.postHits / stats.TRAIN.total : null;
    const oosPostHitBase = baseOos.total > 0 ? baseOos.postHits / baseOos.total : null;
    const oosPostHitAbl = stats.OOS.total > 0 ? stats.OOS.postHits / stats.OOS.total : null;

    const trainDelta = (trainPreHitAbl != null && trainPreHitBase != null) ? (trainPreHitAbl - trainPreHitBase) * 100 : null;
    const oosDelta = (oosPreHitAbl != null && oosPreHitBase != null) ? (oosPreHitAbl - oosPreHitBase) * 100 : null;
    const trainPostDelta = (trainPostHitAbl != null && trainPostHitBase != null) ? (trainPostHitAbl - trainPostHitBase) * 100 : null;
    const oosPostDelta = (oosPostHitAbl != null && oosPostHitBase != null) ? (oosPostHitAbl - oosPostHitBase) * 100 : null;

    ablation.ablations[sigName] = {
      TRAIN: { count: stats.TRAIN.total, preHit: trainPreHitAbl, postHit: trainPostHitAbl, delta_preHit: trainDelta, delta_postHit: trainPostDelta },
      OOS: { count: stats.OOS.total, preHit: oosPreHitAbl, postHit: oosPostHitAbl, delta_preHit: oosDelta, delta_postHit: oosPostDelta },
    };

    const fmt = (v) => v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) + 'pp' : '—';
    console.log(`  ${sigName.padEnd(13)}  ${fmt(trainDelta).padStart(10)}  ${fmt(oosDelta).padStart(10)}  ${fmt(trainPostDelta).padStart(13)}  ${fmt(oosPostDelta).padStart(13)}`);
  }
  console.log();
  console.log('  (Negative Δ = removing this signal IMPROVES hit rate → signal hurts.)');
  console.log();

  // ── Sensitivity sweep: lb, zsc_len ────────────────────────────────────────
  console.log('─── Sensitivity sweep: smoothing lookback (lb) ───');
  console.log('  lb     TRAIN total  TRAIN preHit%  OOS total  OOS preHit%');
  const lbSweep = [];
  for (const lb of [1, 3, 5, 8, 10, 15]) {
    const stats = { TRAIN: { total: 0, preHits: 0 }, OOS: { total: 0, preHits: 0 } };
    for (const sym of Object.keys(symbolResults)) {
      const candles = symbolResults[sym].candles;
      const sig = computeSymbolSignals(candles, { lb });
      for (const key of ['TRAIN', 'OOS']) {
        const per = PERIODS[key];
        const startTs = new Date(per.start + 'T00:00:00Z').getTime();
        const endTs = new Date(per.end + 'T23:59:59Z').getTime();
        const idxStart = candles.findIndex(c => c.ts >= startTs);
        const idxEnd = candles.findIndex(c => c.ts > endTs);
        const lo = idxStart === -1 ? 0 : Math.max(0, idxStart - 150);
        const hi = idxEnd === -1 ? candles.length : idxEnd;
        const sliceComposite = sig.composite.slice(lo, hi);
        const slicePivot = sig.pivot_sig.slice(lo, hi);
        const sliceFwd = symbolResults[sym].fwdRets.slice(lo, hi);
        const position = derivePositions(sliceComposite, slicePivot, bestTau);
        const hr = computeHitRates(position, sliceFwd, DEFAULT_FORWARD);
        stats[key].total += hr.combined.count;
        stats[key].preHits += hr.combined.preHits;
      }
    }
    const trainHit = stats.TRAIN.total > 0 ? stats.TRAIN.preHits / stats.TRAIN.total : null;
    const oosHit = stats.OOS.total > 0 ? stats.OOS.preHits / stats.OOS.total : null;
    lbSweep.push({ lb, trainHit, oosHit, trainCount: stats.TRAIN.total, oosCount: stats.OOS.total });
    console.log(`  ${String(lb).padEnd(6)} ${String(stats.TRAIN.total).padStart(10)}  ${(trainHit != null ? (trainHit * 100).toFixed(1) + '%' : '—').padStart(12)}  ${String(stats.OOS.total).padStart(9)}  ${(oosHit != null ? (oosHit * 100).toFixed(1) + '%' : '—').padStart(11)}`);
  }
  console.log();

  console.log('─── Sensitivity sweep: standardisation window (zsc_len) ───');
  console.log('  zsc    TRAIN total  TRAIN preHit%  OOS total  OOS preHit%');
  const zscSweep = [];
  for (const zsc of [40, 60, 80, 100, 120, 150]) {
    const stats = { TRAIN: { total: 0, preHits: 0 }, OOS: { total: 0, preHits: 0 } };
    for (const sym of Object.keys(symbolResults)) {
      const candles = symbolResults[sym].candles;
      const sig = computeSymbolSignals(candles, { zsc_len: zsc });
      for (const key of ['TRAIN', 'OOS']) {
        const per = PERIODS[key];
        const startTs = new Date(per.start + 'T00:00:00Z').getTime();
        const endTs = new Date(per.end + 'T23:59:59Z').getTime();
        const idxStart = candles.findIndex(c => c.ts >= startTs);
        const idxEnd = candles.findIndex(c => c.ts > endTs);
        const lo = idxStart === -1 ? 0 : Math.max(0, idxStart - 150);
        const hi = idxEnd === -1 ? candles.length : idxEnd;
        const sliceComposite = sig.composite.slice(lo, hi);
        const slicePivot = sig.pivot_sig.slice(lo, hi);
        const sliceFwd = symbolResults[sym].fwdRets.slice(lo, hi);
        const position = derivePositions(sliceComposite, slicePivot, bestTau);
        const hr = computeHitRates(position, sliceFwd, DEFAULT_FORWARD);
        stats[key].total += hr.combined.count;
        stats[key].preHits += hr.combined.preHits;
      }
    }
    const trainHit = stats.TRAIN.total > 0 ? stats.TRAIN.preHits / stats.TRAIN.total : null;
    const oosHit = stats.OOS.total > 0 ? stats.OOS.preHits / stats.OOS.total : null;
    zscSweep.push({ zsc, trainHit, oosHit, trainCount: stats.TRAIN.total, oosCount: stats.OOS.total });
    console.log(`  ${String(zsc).padEnd(6)} ${String(stats.TRAIN.total).padStart(10)}  ${(trainHit != null ? (trainHit * 100).toFixed(1) + '%' : '—').padStart(12)}  ${String(stats.OOS.total).padStart(9)}  ${(oosHit != null ? (oosHit * 100).toFixed(1) + '%' : '—').padStart(11)}`);
  }
  console.log();

  // ── Overfit check ─────────────────────────────────────────────────────────
  const valHit = periodHitRates.VALIDATION?.combined?.preHitRate;
  const oosHit = periodHitRates.OOS?.combined?.preHitRate;
  const overfit = (valHit != null && oosHit != null) ? Math.abs(valHit - oosHit) > 0.20 : false;

  // ── Save JSON output ──────────────────────────────────────────────────────
  const out = {
    generated_at: new Date().toISOString(),
    config: {
      symbols: SYMBOLS,
      periods: PERIODS,
      forward_windows: FORWARD_WINDOWS,
      primary_forward_window: DEFAULT_FORWARD,
      fees_bps_per_side: 10,
      best_forward_window_train: 10,
      adaptation_note: 'Daily bars (Pine script targets 4H — params kept unchanged so signals are ~6x rarer than designed).',
    },
    threshold_sweep_train: sweep.map(s => ({
      tau: s.tau,
      long_count: s.hr.long.count,
      short_count: s.hr.short.count,
      total: s.hr.combined.count,
      pre_hit_rate: s.hr.combined.preHitRate,
      post_hit_rate: s.hr.combined.postHitRate,
      long_pre_hit: s.hr.long.preHitRate,
      short_pre_hit: s.hr.short.preHitRate,
    })),
    period_hit_rates: periodHitRates,
    forward_window_sweep_oos: fwdSweep,
    per_symbol_oos: perSymbol,
    ablation,
    sensitivity: { lb: lbSweep, zsc_len: zscSweep },
    summary: {
      best_tau: bestTau,
      train_combined_pre_hit: best.hr.combined.preHitRate,
      val_combined_pre_hit: valHit,
      oos_combined_pre_hit: oosHit,
      overfit_flagged: overfit,
      notes: [
        'Threshold τ tuned ONLY on TRAIN. Applied unchanged to VAL/OOS.',
        'Costs: 20bps round-trip fees. No funding cost modeled (daily holds).',
        'preHit  = directional return > 0 (price moved in predicted direction).',
        'postHit = net return > 0 (after fees).',
        'Best τ selected by combined (long+short) pre-cost hit rate on TRAIN.',
        'OOS flagged overfit if combined pre-hit diverges from VAL by > 20pp.',
        'DAILY BARS CAVEAT: Pine script targets 4H. We use existing daily klines.',
        '  Parameters (lb=5, zsc_len=80, mom_6/18, ema 12/26) are unchanged.',
        '  Signals are ~6x rarer than on 4H data. Composite stdev ~0.2 on daily.',
      ],
    },
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  console.log(`✓ Results saved to ${path.relative(ROOT, OUT_JSON)}`);
  console.log();

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`  Best τ (tuned on TRAIN): ${bestTau}`);
  console.log(`  TRAIN combined pre-hit: ${best.hr.combined.preHitRate != null ? (best.hr.combined.preHitRate * 100).toFixed(1) + '%' : '—'} (${best.hr.combined.count} signals)`);
  console.log(`  VAL combined pre-hit:   ${valHit != null ? (valHit * 100).toFixed(1) + '%' : '—'}`);
  console.log(`  OOS combined pre-hit:   ${oosHit != null ? (oosHit * 100).toFixed(1) + '%' : '—'}`);
  console.log(`  Overfit flagged:        ${overfit ? 'YES ⚠' : 'no'}`);
  console.log();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
