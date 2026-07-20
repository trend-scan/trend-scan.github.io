/**
 * walk_forward_backtest.js — Walk-forward validation of the v3.1 signal engine.
 *
 * Addresses the four criticisms of the legacy in-sample backtester:
 *   1. IN-SAMPLE BIAS     → split data into TRAIN / VALIDATION / OOS periods
 *   2. NO TUNING BUDGET   → thresholds tuned ONLY on TRAIN, applied unchanged to VAL/OOS
 *   3. WEAK SIGNAL COUNT  → test on ALL 13 symbols (not just BTC/ETH/SOL)
 *   4. NO TRANSACTION COSTS → model 10bps/side fees + funding cost over hold
 *
 * Periods (40 / 28 / 30 by months — labeled 40/40/20 by spec):
 *   TRAIN       2022-01-01 → 2023-06-30  (18 months — thresholds tuned here)
 *   VALIDATION  2023-07-01 → 2024-06-30  (12 months — validate, no tuning)
 *   OOS         2024-07-01 → 2025-07-31  (13 months — final out-of-sample test)
 *
 * Pipeline:
 *   1. Load 13 symbols × (klines_1d + funding) from data/historical/
 *   2. For each (symbol, day) compute stance/confidence ONCE via computeSignal
 *      (cached). For each ablation gate, compute the ablated stance once.
 *   3. Pre-compute forward returns (1d, 3d, 5d, 10d, 20d) and funding cost
 *      per (symbol, day, forward_window).
 *   4. Threshold sweep on TRAIN (STRONG × WEAK ∈ {5..10}², 36 combos) → pick
 *      best by combined hit rate (>= 50 signals).
 *   5. Apply best thresholds to VAL and OOS unchanged.
 *   6. Forward-window sweep (1d/3d/5d/10d/20d) using best thresholds.
 *   7. Per-gate ablation: 9 gates, run with each gate disabled on TRAIN/OOS,
 *      report hit-rate delta vs baseline.
 *   8. Per-symbol breakdown of OOS performance.
 *   9. Write scripts/signal/walk_forward_results.json + console summary.
 *
 * Cost model:
 *   fees_round_trip  = 20bps (10bps each side, slippage + maker/taker blend)
 *   funding_cost     = sum of funding rates during holding period
 *                      long pays funding, short receives funding
 *   net_return_long  = price_return - fees - funding_cost
 *   net_return_short = -price_return - fees + funding_cost
 *   post_cost_hit    = net_return > 0
 *
 * Usage:
 *   node scripts/signal/walk_forward_backtest.js
 *   node scripts/signal/walk_forward_backtest.js --min-signals=80
 *   node scripts/signal/walk_forward_backtest.js --no-ablation   (skip ablation step)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSignal,
  mapStanceToVerdict,
  DEFAULT_THRESHOLDS,
} from '../../src/lib/signal/compute.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data', 'historical');
const OUT_JSON = path.join(__dirname, 'walk_forward_results.json');

// ─── Configuration ───────────────────────────────────────────────────────────

const SYMBOLS = [
  'BTC', 'ETH', 'SOL',
  'AVAX', 'LINK', 'DOGE',
  'ARB', 'OP',
  'INJ', 'SUI', 'NEAR', 'APT', 'TIA',
];

// 40/40/20 (approximately — by spec): explicit date boundaries.
const PERIODS = {
  TRAIN:       { start: '2022-01-01', end: '2023-06-30', label: 'TRAIN (tune)'       },
  VALIDATION:  { start: '2023-07-01', end: '2024-06-30', label: 'VALIDATION (hold)'  },
  OOS:         { start: '2024-07-01', end: '2025-07-31', label: 'OOS (untouched)'    },
};

const FORWARD_WINDOWS = [1, 3, 5, 10, 20];           // days
const DEFAULT_FORWARD = 10;                            // primary reporting window
const THRESHOLD_RANGE = [5, 6, 7, 8, 9, 10];

// Cost model
const FEES_BPS_PER_SIDE = 10;                          // 10 bps per side
const FEES_BPS_ROUND_TRIP = FEES_BPS_PER_SIDE * 2;     // 20 bps total
// All fee/funding math below is done in PERCENT (e.g., 0.20 means 0.20%).
// 20 bps = 0.20%  →  fees_pct_round_trip = 0.20
const FEES_PCT_ROUND_TRIP = FEES_BPS_ROUND_TRIP / 100; // 0.20 (percent)

// Ablation gates (must match compute.js's accepted ablation keys)
const ABLATION_GATES = [
  'adaptiveZ',
  'trendTenure',
  'atrExt50ma',
  'rsVsBtc',
  'fundingZ',
  'rsiPenalty',
  'impulseZPenalty',
  'macroZBoost',
  'mhAlignment',
  'returns',
];

// CLI flags
const args = process.argv.slice(2);
let MIN_SIGNALS_FOR_TUNE = 30; // TRAIN has ~3888 day-signals across 13 symbols; 30/side gives statistical headroom
let RUN_ABLATION = true;
for (const a of args) {
  if (a.startsWith('--min-signals=')) MIN_SIGNALS_FOR_TUNE = parseInt(a.split('=')[1], 10);
  else if (a === '--no-ablation') RUN_ABLATION = false;
}

// ─── Date helpers ────────────────────────────────────────────────────────────

const tsOf = (yyyyMmDd) => Date.UTC(+yyyyMmDd.slice(0,4), +yyyyMmDd.slice(5,7)-1, +yyyyMmDd.slice(8,10));
const TRAIN_START_TS    = tsOf(PERIODS.TRAIN.start);
const TRAIN_END_TS      = tsOf(PERIODS.TRAIN.end);
const VAL_START_TS      = tsOf(PERIODS.VALIDATION.start);
const VAL_END_TS        = tsOf(PERIODS.VALIDATION.end);
const OOS_START_TS      = tsOf(PERIODS.OOS.start);
const OOS_END_TS        = tsOf(PERIODS.OOS.end);

function periodForTs(ts) {
  if (ts >= TRAIN_START_TS && ts <= TRAIN_END_TS) return 'TRAIN';
  if (ts >= VAL_START_TS && ts <= VAL_END_TS) return 'VALIDATION';
  if (ts >= OOS_START_TS && ts <= OOS_END_TS) return 'OOS';
  return null;
}

const ymd = (ts) => new Date(ts).toISOString().slice(0, 10);

// ─── Data loading ────────────────────────────────────────────────────────────

/**
 * Load one symbol's klines + funding, transforming Binance-style records
 * ({t,o,h,l,c,v,T,q,n} and {t,rate,mp}) into compute.js format
 * ({ts,open,high,low,close,volume} and {ts,rate}).
 */
function loadSymbol(symbol) {
  const kPath = path.join(DATA_DIR, symbol, 'klines_1d.json');
  const fPath = path.join(DATA_DIR, symbol, 'funding.json');
  if (!fs.existsSync(kPath)) return null;
  const kRaw = JSON.parse(fs.readFileSync(kPath, 'utf8'));
  const fRaw = fs.existsSync(fPath) ? JSON.parse(fs.readFileSync(fPath, 'utf8')) : [];
  const candles = kRaw
    .map(r => ({ ts: r.t, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }))
    .filter(c => c.ts != null && c.close != null)
    .sort((a, b) => a.ts - b.ts);
  const funding = fRaw
    .map(r => ({ ts: r.t, rate: r.rate }))
    .filter(f => f.ts != null && f.rate != null)
    .sort((a, b) => a.ts - b.ts);
  return { symbol, candles, funding };
}

function loadAllSymbols() {
  console.log('━━━ Loading historical data ━━━');
  const out = {};
  for (const s of SYMBOLS) {
    const d = loadSymbol(s);
    if (!d) {
      console.warn(`  ⚠ ${s}: no data found, skipping`);
      continue;
    }
    out[s] = d;
    const first = d.candles[0]?.ts, last = d.candles[d.candles.length-1]?.ts;
    console.log(`  ${s.padEnd(5)} ${String(d.candles.length).padStart(4)} candles | ${String(d.funding.length).padStart(5)} funding | ${first ? ymd(first) : '-'} → ${last ? ymd(last) : '-'}`);
  }
  return out;
}

// ─── Forward returns + funding cost pre-computation ──────────────────────────

/**
 * For each (symbol, dayIdx) build a record with:
 *   ts, close,
 *   fwd: { 1: {retPct, fwdClose}, 3: ..., 5: ..., 10: ..., 20: ... }
 *   fundCost: { 1: funding_paid_during_hold, 3: ..., ... }   (in fraction of notional)
 *
 * fwd return is in PERCENT (close[N+W] / close[N] - 1) * 100.
 * fundCost is in FRACTION (sum of funding rates) — used directly as cost on notional.
 *
 * We do not record a fwd entry if the window extends past the last candle.
 */
function precomputeForwardData(symbolData) {
  const { candles, funding } = symbolData;
  const out = new Array(candles.length);
  // funding index pointer — funding is sorted by ts
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const entry = { ts: c.ts, close: c.close, idx: i, fwd: {}, fundCost: {} };
    for (const w of FORWARD_WINDOWS) {
      if (i + w < candles.length) {
        const futureClose = candles[i + w].close;
        const retPct = (futureClose / c.close - 1) * 100;
        entry.fwd[w] = { retPct, futureClose };
        // funding paid during hold = sum of funding rates with ts in (c.ts, future_ts]
        const futureTs = candles[i + w].ts;
        let fundSum = 0;
        // walk funding pointer from previous position
        // (funding is sorted; we can binary-search for the start)
        // For simplicity here we do a slice scan — funding arrays are a few thousand rows
        for (let j = 0; j < funding.length; j++) {
          const f = funding[j];
          if (f.ts > futureTs) break;
          if (f.ts > c.ts && f.ts <= futureTs) fundSum += f.rate;
        }
        entry.fundCost[w] = fundSum;
      }
    }
    out[i] = entry;
  }
  return out;
}

// ─── Signal evaluation ───────────────────────────────────────────────────────

/**
 * For each (symbol, dayIdx) compute the BASE signal once (no ablations),
 * plus one variant per ablation gate.  Returns Map of records.
 *
 * Each record has:
 *   ts, close, period, symbol,
 *   base: { stance, confidence, verdict_default_thresholds, drivers },
 *   ablated: { [gate]: { stance, confidence } }
 *
 * Verdict mapping is done LATER in the threshold-sweep step (cheap, just a
 * comparison on confidence) so we don't have to re-call computeSignal for
 * every threshold pair.
 */
function computeSignalsForSymbol(symbol, symbolData, btcData, fwdData) {
  const { candles, funding } = symbolData;
  const isBtc = symbol === 'BTC';
  const out = [];

  // Pre-slice funding using a moving pointer for speed
  let fundingPtr = 0;
  for (let i = 90; i < candles.length; i++) {
    const asOfTs = candles[i].ts;
    const candlesSlice = candles.slice(0, i + 1);
    // Advance funding pointer to include all events <= asOfTs
    while (fundingPtr < funding.length && funding[fundingPtr].ts <= asOfTs) fundingPtr++;
    const fundingSlice = funding.slice(0, fundingPtr);
    const btcCandles = isBtc ? null : btcData.candles.slice(0, i + 1);

    const period = periodForTs(asOfTs);
    if (!period) continue; // outside TRAIN/VAL/OOS

    // Base signal
    const baseSig = computeSignal({
      candles: candlesSlice,
      fundingHistory: fundingSlice,
      btcCandles,
      isBtc,
      thresholds: DEFAULT_THRESHOLDS,
    });

    const record = {
      symbol, ts: asOfTs, period, idx: i,
      close: candlesSlice[candlesSlice.length - 1].close,
      stance: baseSig.stance,
      confidence: baseSig.confidence,
      drivers: baseSig.drivers,
      fwd: fwdData[i].fwd,
      fundCost: fwdData[i].fundCost,
      ablated: {},
    };

    // Per-gate ablation stances (confidence is what matters; stance rarely changes)
    if (RUN_ABLATION) {
      for (const gate of ABLATION_GATES) {
        const aSig = computeSignal({
          candles: candlesSlice,
          fundingHistory: fundingSlice,
          btcCandles,
          isBtc,
          thresholds: DEFAULT_THRESHOLDS,
          ablations: [gate],
        });
        record.ablated[gate] = { stance: aSig.stance, confidence: aSig.confidence };
      }
    }
    out.push(record);
  }
  return out;
}

// ─── Verdict mapping + cost-adjusted hit/return ──────────────────────────────

/**
 * Apply (STRONG, WEAK) thresholds to a record.  Returns 'STRONG' | 'WEAK' | 'NEUTRAL'.
 * If `ablation` is provided, uses the ablated confidence instead.
 */
function applyThresholds(record, strong, weak, ablation = null) {
  const stance = ablation ? record.ablated[ablation]?.stance : record.stance;
  const conf   = ablation ? record.ablated[ablation]?.confidence : record.confidence;
  if (stance == null) return 'NEUTRAL';
  return mapStanceToVerdict(stance, conf, { STRONG: strong, WEAK: weak });
}

/**
 * Compute net return (post-cost) given a verdict and a forward window.
 *   STRONG (long):  net = fwd.retPct - fees_pct - funding_cost_pct*100
 *   WEAK   (short): net = -fwd.retPct - fees_pct + funding_cost_pct*100
 *   NEUTRAL:        null (no position)
 *
 * fwd.retPct is in PERCENT. fundCost is in FRACTION (so ×100 to get percent).
 * fees_pct = 0.20 (20bps).
 */
function netReturnPct(verdict, fwd, fundCost) {
  if (!fwd || verdict === 'NEUTRAL') return null;
  // All terms in PERCENT.
  // fees_pct_round_trip = 0.20 (20 bps round trip)
  // fundCost is in FRACTION (e.g., 0.003 = 30bps); ×100 → 0.30 (percent)
  const feesPct = FEES_PCT_ROUND_TRIP;            // 0.20 percent
  const fundPct = (fundCost ?? 0) * 100;          // fraction → percent
  if (verdict === 'STRONG') return fwd.retPct - feesPct - fundPct;
  if (verdict === 'WEAK')   return -fwd.retPct - feesPct + fundPct;
  return null;
}

/**
 * Hit test (pre and post cost) for a STRONG/WEAK signal.
 *   STRONG hit (pre-cost):  fwd.retPct > 0
 *   STRONG hit (post-cost): net > 0
 *   WEAK   hit (pre-cost):  fwd.retPct < 0
 *   WEAK   hit (post-cost): net > 0
 */
function hitTest(verdict, fwd, fundCost) {
  if (!fwd || verdict === 'NEUTRAL') return { pre: null, post: null };
  const net = netReturnPct(verdict, fwd, fundCost);
  const pre = verdict === 'STRONG' ? fwd.retPct > 0
            : verdict === 'WEAK'   ? fwd.retPct < 0
            : null;
  return { pre, post: net > 0 };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Bucket records into verdict counts + hit stats + return stats.
 *
 * @param {Array} records  — list of {symbol, ts, period, stance, confidence, fwd, fundCost, ablated}
 * @param {number} strong  — STRONG threshold
 * @param {number} weak    — WEAK threshold
 * @param {number} fwdWin  — forward window in days
 * @param {string|null} ablation — gate name or null for baseline
 * @param {function|null} recordFilter — optional pre-filter on record (e.g. by symbol or period)
 */
function aggregate(records, strong, weak, fwdWin, ablation = null, recordFilter = null) {
  const stats = {
    STRONG: { count: 0, preHits: 0, postHits: 0, preRetPctSum: 0, postRetPctSum: 0 },
    WEAK:   { count: 0, preHits: 0, postHits: 0, preRetPctSum: 0, postRetPctSum: 0 },
    NEUTRAL:{ count: 0 },
  };
  for (const r of records) {
    if (recordFilter && !recordFilter(r)) continue;
    const v = applyThresholds(r, strong, weak, ablation);
    if (v === 'NEUTRAL') { stats.NEUTRAL.count++; continue; }
    const fwd = r.fwd[fwdWin];
    const fundCost = r.fundCost[fwdWin];
    if (!fwd) continue; // no forward data for this window
    const net = netReturnPct(v, fwd, fundCost);
    const s = stats[v];
    s.count++;
    s.preRetPctSum += fwd.retPct * (v === 'STRONG' ? 1 : -1); // signed by direction
    s.postRetPctSum += net;
    const { pre, post } = hitTest(v, fwd, fundCost);
    if (pre)  s.preHits++;
    if (post) s.postHits++;
  }
  // Derive averages
  for (const v of ['STRONG', 'WEAK']) {
    const s = stats[v];
    s.preHitRate  = s.count > 0 ? s.preHits / s.count : null;
    s.postHitRate = s.count > 0 ? s.postHits / s.count : null;
    s.avgPreRetPct  = s.count > 0 ? s.preRetPctSum / s.count : null;
    s.avgPostRetPct = s.count > 0 ? s.postRetPctSum / s.count : null;
  }
  // Combined
  const totalSignals = stats.STRONG.count + stats.WEAK.count;
  stats.combined = {
    count: totalSignals,
    preHits: stats.STRONG.preHits + stats.WEAK.preHits,
    postHits: stats.STRONG.postHits + stats.WEAK.postHits,
    preHitRate:  totalSignals > 0 ? (stats.STRONG.preHits + stats.WEAK.preHits) / totalSignals : null,
    postHitRate: totalSignals > 0 ? (stats.STRONG.postHits + stats.WEAK.postHits) / totalSignals : null,
  };
  return stats;
}

// ─── Threshold sweep on TRAIN ────────────────────────────────────────────────

function sweepThresholds(trainRecords, fwdWin) {
  const grid = [];
  let best = null;
  for (const strong of THRESHOLD_RANGE) {
    for (const weak of THRESHOLD_RANGE) {
      const s = aggregate(trainRecords, strong, weak, fwdWin);
      const combined = s.combined;
      const cell = {
        strong, weak,
        strongCount: s.STRONG.count, weakCount: s.WEAK.count, total: combined.count,
        strongPreHit: s.STRONG.preHitRate, weakPreHit: s.WEAK.preHitRate,
        combinedPreHit: combined.preHitRate, combinedPostHit: combined.postHitRate,
        strongPostHit: s.STRONG.postHitRate, weakPostHit: s.WEAK.postHitRate,
      };
      grid.push(cell);
      // Selection rule: require BOTH STRONG and WEAK counts to clear the minimum
      // (otherwise the "best" degenerates to whichever verdict has fewer signals).
      // Tiebreak: higher combined count (more statistical power), then higher
      // STRONG pre-hit rate (the primary signal).
      if (
        s.STRONG.count >= MIN_SIGNALS_FOR_TUNE &&
        s.WEAK.count   >= MIN_SIGNALS_FOR_TUNE
      ) {
        if (
          !best ||
          cell.combinedPreHit > best.combinedPreHit ||
          (cell.combinedPreHit === best.combinedPreHit && cell.strongCount + cell.weakCount > best.strongCount + best.weakCount) ||
          (cell.combinedPreHit === best.combinedPreHit && cell.strongCount + cell.weakCount === best.strongCount + best.weakCount && cell.strongPreHit > best.strongPreHit)
        ) {
          best = cell;
        }
      }
    }
  }
  return { grid, best };
}

// ─── Forward window comparison ───────────────────────────────────────────────

function sweepForwardWindows(recordsByPeriod, strong, weak) {
  const out = {};
  for (const w of FORWARD_WINDOWS) {
    out[w] = {};
    for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
      const recs = recordsByPeriod[period];
      const s = aggregate(recs, strong, weak, w);
      out[w][period] = {
        strong: { count: s.STRONG.count, preHit: s.STRONG.preHitRate, postHit: s.STRONG.postHitRate, avgPreRet: s.STRONG.avgPreRetPct, avgPostRet: s.STRONG.avgPostRetPct },
        weak:   { count: s.WEAK.count,   preHit: s.WEAK.preHitRate,   postHit: s.WEAK.postHitRate,   avgPreRet: s.WEAK.avgPreRetPct,   avgPostRet: s.WEAK.avgPostRetPct   },
        combined: s.combined,
      };
    }
  }
  return out;
}

// ─── Per-gate ablation ───────────────────────────────────────────────────────

function runAblation(recordsByPeriod, strong, weak, fwdWin) {
  const out = { baseline: {}, ablations: {} };
  for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
    const recs = recordsByPeriod[period];
    const base = aggregate(recs, strong, weak, fwdWin);
    out.baseline[period] = {
      strong: { count: base.STRONG.count, preHit: base.STRONG.preHitRate, postHit: base.STRONG.postHitRate },
      weak:   { count: base.WEAK.count,   preHit: base.WEAK.preHitRate,   postHit: base.WEAK.postHitRate   },
      combined: base.combined,
    };
    for (const gate of ABLATION_GATES) {
      if (!out.ablations[gate]) out.ablations[gate] = {};
      const a = aggregate(recs, strong, weak, fwdWin, gate);
      out.ablations[gate][period] = {
        strong: { count: a.STRONG.count, preHit: a.STRONG.preHitRate, postHit: a.STRONG.postHitRate },
        weak:   { count: a.WEAK.count,   preHit: a.WEAK.preHitRate,   postHit: a.WEAK.postHitRate   },
        combined: a.combined,
        delta_combined_preHit: (a.combined.preHitRate ?? 0) - (base.combined.preHitRate ?? 0),
        delta_strong_preHit:   (a.STRONG.preHitRate ?? 0) - (base.STRONG.preHitRate ?? 0),
      };
    }
  }
  return out;
}

// ─── Per-symbol breakdown ────────────────────────────────────────────────────

function perSymbolBreakdown(recordsByPeriod, strong, weak, fwdWin) {
  const out = {};
  for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
    out[period] = {};
    for (const sym of SYMBOLS) {
      const recs = recordsByPeriod[period].filter(r => r.symbol === sym);
      const s = aggregate(recs, strong, weak, fwdWin);
      // Flag a symbol if any verdict with >= 20 signals has hit rate < 50%.
      const verdictsToCheck = [];
      if (s.STRONG.count >= 20) verdictsToCheck.push({ verdict: 'STRONG', count: s.STRONG.count, hit: s.STRONG.preHitRate });
      if (s.WEAK.count   >= 20) verdictsToCheck.push({ verdict: 'WEAK',   count: s.WEAK.count,   hit: s.WEAK.preHitRate   });
      const failingVerdicts = verdictsToCheck.filter(v => v.hit != null && v.hit < 0.5).map(v => v.verdict);
      out[period][sym] = {
        strong: { count: s.STRONG.count, preHit: s.STRONG.preHitRate, postHit: s.STRONG.postHitRate, avgPreRet: s.STRONG.avgPreRetPct, avgPostRet: s.STRONG.avgPostRetPct },
        weak:   { count: s.WEAK.count,   preHit: s.WEAK.preHitRate,   postHit: s.WEAK.postHitRate,   avgPreRet: s.WEAK.avgPreRetPct,   avgPostRet: s.WEAK.avgPostRetPct   },
        totalSignals: s.STRONG.count + s.WEAK.count,
        flaggedWeak: failingVerdicts.length > 0,
        failingVerdicts,
      };
    }
  }
  return out;
}

// ─── Overfit check ───────────────────────────────────────────────────────────

function overfitCheck(periodAgg) {
  // Check divergence between VALIDATION and OOS for BOTH verdicts.
  const checks = [];
  for (const v of ['STRONG', 'WEAK']) {
    const valHit = periodAgg.VALIDATION[v].preHitRate;
    const oosHit = periodAgg.OOS[v].preHitRate;
    if (valHit == null || oosHit == null) {
      checks.push({ verdict: v, valHit, oosHit, divergence: null, flagged: false, reason: 'insufficient data' });
      continue;
    }
    const divergence = Math.abs(valHit - oosHit);
    const flagged = divergence > 0.20;
    checks.push({
      verdict: v, valHit, oosHit, divergence,
      flagged,
      reason: flagged
        ? `OOS diverges from VAL by ${(divergence*100).toFixed(1)}pp (>20pp threshold) — possible overfit`
        : `OOS within ${(divergence*100).toFixed(1)}pp of VAL (<=20pp threshold)`,
    });
  }
  const anyFlagged = checks.some(c => c.flagged);
  return { checks, flagged: anyFlagged };
}

// ─── Console printing helpers ────────────────────────────────────────────────

function pct(x, digits = 1) {
  if (x == null || !isFinite(x)) return '   —  ';
  return (x * 100).toFixed(digits).padStart(5) + '%';
}
function num(x, digits = 2) {
  if (x == null || !isFinite(x)) return '   —  ';
  return (x >= 0 ? '+' : '') + x.toFixed(digits).padStart(6);
}
function pad(s, n) { return String(s).padEnd(n); }

function printThresholdSweepTable(grid, best) {
  console.log('\n── Threshold Sweep (TRAIN, 10d forward, pre-cost combined hit rate) ──');
  console.log('         WEAK →');
  console.log('  STRONG    ' + THRESHOLD_RANGE.map(w => `w=${w}`).join('  '));
  for (const s of THRESHOLD_RANGE) {
    const cells = THRESHOLD_RANGE.map(w => {
      const c = grid.find(g => g.strong === s && g.weak === w);
      if (!c) return '   —  ';
      const mark = best && best.strong === s && best.weak === w ? '*' : ' ';
      // Mark cells that don't pass the min-signal filter for either verdict.
      const dot = (c.strongCount < MIN_SIGNALS_FOR_TUNE || c.weakCount < MIN_SIGNALS_FOR_TUNE) ? '·' : ' ';
      const pctStr = c.combinedPreHit != null ? (c.combinedPreHit*100).toFixed(1)+'%' : '  —  ';
      return pctStr.padStart(6) + mark + dot;
    });
    console.log(`    s=${s}  ` + cells.join('  '));
  }
  console.log('  (* = selected best  · = below min-signals threshold for STRONG or WEAK)');

  // Also print STRONG count grid (so users see which thresholds produce enough STRONG signals)
  console.log('\n  STRONG count grid:');
  console.log('  STRONG    ' + THRESHOLD_RANGE.map(w => `w=${w}`).join('  '));
  for (const s of THRESHOLD_RANGE) {
    const cells = THRESHOLD_RANGE.map(w => {
      const c = grid.find(g => g.strong === s && g.weak === w);
      if (!c) return '   —  ';
      return String(c.strongCount).padStart(5);
    });
    console.log(`    s=${s}  ` + cells.join('   '));
  }
}

function printPeriodHitRates(periodAgg, label) {
  for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
    const a = periodAgg[period];
    console.log(
      `  ${pad(period, 12)} ` +
      `STRONG ${String(a.STRONG.count).padStart(4)} sig | preHit ${pct(a.STRONG.preHitRate)} | postHit ${pct(a.STRONG.postHitRate)} | avgPre ${num(a.STRONG.avgPreRetPct)}% | avgPost ${num(a.STRONG.avgPostRetPct)}%   ` +
      `|| WEAK ${String(a.WEAK.count).padStart(4)} sig | preHit ${pct(a.WEAK.preHitRate)} | postHit ${pct(a.WEAK.postHitRate)} | avgPre ${num(a.WEAK.avgPreRetPct)}% | avgPost ${num(a.WEAK.avgPostRetPct)}%`
    );
  }
}

function printAblationTable(ablation) {
  console.log('\n── Per-Gate Ablation (10d forward, pre-cost STRONG hit rate by period) ──');
  console.log('  Gate                │ TRAIN Δ     │ VAL Δ       │ OOS Δ       │ TRAIN STRONG │ OOS STRONG');
  console.log('  ────────────────────┼─────────────┼─────────────┼─────────────┼──────────────┼──────────────');
  const baseTrain = ablation.baseline.TRAIN.strong.preHit;
  const baseVal   = ablation.baseline.VALIDATION.strong.preHit;
  const baseOos   = ablation.baseline.OOS.strong.preHit;
  console.log(
    `  ${pad('BASELINE', 18)}   │   ${pct(baseTrain)}    │   ${pct(baseVal)}    │   ${pct(baseOos)}    │  ${String(ablation.baseline.TRAIN.strong.count).padStart(4)} (${pct(baseTrain)})  │  ${String(ablation.baseline.OOS.strong.count).padStart(4)} (${pct(baseOos)})`
  );
  // Sort gates by OOS delta magnitude (largest impact first)
  const sortedGates = [...ABLATION_GATES].sort((a, b) => {
    const da = Math.abs(ablation.ablations[a].OOS.delta_strong_preHit || 0);
    const db = Math.abs(ablation.ablations[b].OOS.delta_strong_preHit || 0);
    return db - da;
  });
  for (const gate of sortedGates) {
    const g = ablation.ablations[gate];
    const dt = (g.TRAIN.delta_strong_preHit || 0);
    const dv = (g.VALIDATION.delta_strong_preHit || 0);
    const do_ = (g.OOS.delta_strong_preHit || 0);
    const stCount = g.TRAIN.strong.count;
    const oosCount = g.OOS.strong.count;
    const flag = do_ < -0.05 ? '⚠ hurts' : do_ > 0.05 ? '✓ helps' : '';
    console.log(
      `  ${pad(gate, 18)}   │ ${num(dt*100, 1)}pp     │ ${num(dv*100, 1)}pp     │ ${num(do_*100, 1)}pp     │  ${String(stCount).padStart(4)} (${pct(g.TRAIN.strong.preHit)})  │  ${String(oosCount).padStart(4)} (${pct(g.OOS.strong.preHit)})  ${flag}`
    );
  }
}

function printPerSymbolTable(perSym) {
  console.log('\n── Per-Symbol OOS Performance (10d forward, pre-cost) ──');
  console.log('  Symbol  │ STRONG count  hit │ WEAK count  hit │ Flag');
  console.log('  ────────┼───────────────────┼─────────────────┼─────────────────');
  for (const sym of SYMBOLS) {
    const o = perSym.OOS[sym];
    if (!o) continue;
    const sStr = o.strong.count > 0 ? `${String(o.strong.count).padStart(4)}  ${pct(o.strong.preHit)}` : '   0   —  ';
    const wStr = o.weak.count   > 0 ? `${String(o.weak.count).padStart(4)}  ${pct(o.weak.preHit)}`   : '   0   —  ';
    let flag = '';
    if (o.flaggedWeak) {
      flag = '⚠ ' + o.failingVerdicts.map(v => `${v}<50%`).join(' & ');
    }
    console.log(`  ${pad(sym, 6)}  │ ${sStr} │ ${wStr} │ ${flag}`);
  }
}

function printForwardWindowTable(fwdSweep) {
  console.log('\n── Forward Window Comparison (best thresholds, combined pre-cost hit rate) ──');
  console.log('  Window │ TRAIN count  hit │ VAL count  hit │ OOS count  hit');
  console.log('  ───────┼──────────────────┼────────────────┼────────────────');
  for (const w of FORWARD_WINDOWS) {
    const t = fwdSweep[w].TRAIN, v = fwdSweep[w].VALIDATION, o = fwdSweep[w].OOS;
    console.log(
      `  ${String(w).padStart(4)}d  │ ${String(t.combined.count).padStart(5)}  ${pct(t.combined.preHitRate)} │ ${String(v.combined.count).padStart(4)}  ${pct(v.combined.preHitRate)} │ ${String(o.combined.count).padStart(4)}  ${pct(o.combined.preHitRate)}`
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━ TrendScan Walk-Forward Backtester ━━━');
  console.log(`  Symbols:     ${SYMBOLS.length}  (${SYMBOLS.join(', ')})`);
  console.log(`  Periods:     TRAIN ${PERIODS.TRAIN.start}→${PERIODS.TRAIN.end} | VAL ${PERIODS.VALIDATION.start}→${PERIODS.VALIDATION.end} | OOS ${PERIODS.OOS.start}→${PERIODS.OOS.end}`);
  console.log(`  Forward:     ${FORWARD_WINDOWS.join(', ')} days  (primary = ${DEFAULT_FORWARD}d)`);
  console.log(`  Costs:       ${FEES_BPS_PER_SIDE}bps/side = ${FEES_BPS_ROUND_TRIP}bps round-trip + funding`);
  console.log(`  Thresholds:  STRONG,WEAK ∈ {${THRESHOLD_RANGE.join(',')}}  (min ${MIN_SIGNALS_FOR_TUNE} signals to tune)`);
  console.log(`  Ablation:    ${RUN_ABLATION ? 'ENABLED' : 'DISABLED'} (9 gates)`);
  console.log('');

  // 1. Load data
  const allData = loadAllSymbols();
  if (!allData.BTC) {
    console.error('✗ BTC data missing — required as reference');
    process.exit(1);
  }

  // 2. Pre-compute forward returns + funding costs per symbol
  console.log('\n━━━ Pre-computing forward returns + funding costs ━━━');
  const fwdBySymbol = {};
  for (const sym of Object.keys(allData)) {
    fwdBySymbol[sym] = precomputeForwardData(allData[sym]);
  }

  // 3. Compute signals per (symbol, day) — base + ablations
  console.log('\n━━━ Computing signals (base + ablations) ━━━');
  const t0 = Date.now();
  const allRecords = [];
  for (const sym of Object.keys(allData)) {
    const recs = computeSignalsForSymbol(sym, allData[sym], allData.BTC, fwdBySymbol[sym]);
    allRecords.push(...recs);
    process.stdout.write(`  ${sym.padEnd(5)} ${String(recs.length).padStart(4)} day-signals\n`);
  }
  const dt = Date.now() - t0;
  console.log(`✓ Computed ${allRecords.length} day-signal records in ${(dt/1000).toFixed(1)}s (${(dt/allRecords.length).toFixed(2)}ms each)`);

  // Split by period
  const recordsByPeriod = {
    TRAIN: allRecords.filter(r => r.period === 'TRAIN'),
    VALIDATION: allRecords.filter(r => r.period === 'VALIDATION'),
    OOS: allRecords.filter(r => r.period === 'OOS'),
  };
  console.log(`  Period splits:  TRAIN ${recordsByPeriod.TRAIN.length} | VAL ${recordsByPeriod.VALIDATION.length} | OOS ${recordsByPeriod.OOS.length}`);

  // 4. Threshold sweep on TRAIN (10d forward)
  console.log('\n━━━ Threshold sweep on TRAIN ━━━');
  const { grid, best } = sweepThresholds(recordsByPeriod.TRAIN, DEFAULT_FORWARD);
  if (!best) {
    console.error(`✗ No threshold combination produced >= ${MIN_SIGNALS_FOR_TUNE} signals on TRAIN`);
    process.exit(1);
  }
  printThresholdSweepTable(grid, best);
  console.log(`\n  ✓ Best TRAIN thresholds: STRONG=${best.strong} WEAK=${best.weak}`);
  console.log(`    TRAIN: ${best.strongCount} STRONG (${pct(best.strongPreHit)} pre-hit) + ${best.weakCount} WEAK (${pct(best.weakPreHit)} pre-hit)`);
  console.log(`    TRAIN combined: ${best.total} signals, ${pct(best.combinedPreHit)} pre-cost hit, ${pct(best.combinedPostHit)} post-cost hit`);

  // 5. Apply best thresholds to VAL + OOS
  console.log('\n━━━ Applying best thresholds to VAL + OOS ━━━');
  const periodAgg = {};
  for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
    periodAgg[period] = aggregate(recordsByPeriod[period], best.strong, best.weak, DEFAULT_FORWARD);
  }
  printPeriodHitRates(periodAgg);

  // 6. Overfit check: VAL vs OOS divergence (per verdict)
  console.log('\n━━━ Overfit Check ━━━');
  const overfit = overfitCheck(periodAgg);
  for (const c of overfit.checks) {
    console.log(`  ${c.verdict.padEnd(7)} pre-cost hit: VAL ${pct(c.valHit)} vs OOS ${pct(c.oosHit)} → divergence ${c.divergence == null ? '—' : pct(c.divergence)}  ${c.flagged ? '⚠' : '✓'}`);
    console.log(`           ${c.reason}`);
  }
  console.log(`  ${overfit.flagged ? '⚠ OVERFIT FLAGGED on at least one verdict' : '✓ No overfit flag (both verdicts within 20pp)'}`);

  // 7. Forward window sweep
  console.log('\n━━━ Forward window sweep ━━━');
  const fwdSweep = sweepForwardWindows(recordsByPeriod, best.strong, best.weak);
  printForwardWindowTable(fwdSweep);
  // Pick best window by TRAIN combined pre-cost hit rate
  let bestWindow = DEFAULT_FORWARD;
  let bestWindowHit = -1;
  for (const w of FORWARD_WINDOWS) {
    const h = fwdSweep[w].TRAIN.combined.preHitRate;
    if (h != null && h > bestWindowHit && fwdSweep[w].TRAIN.combined.count >= MIN_SIGNALS_FOR_TUNE) {
      bestWindowHit = h; bestWindow = w;
    }
  }
  console.log(`  ✓ Best TRAIN forward window: ${bestWindow}d (${pct(bestWindowHit)} combined pre-cost hit)`);

  // 8. Per-gate ablation
  let ablationResults = null;
  if (RUN_ABLATION) {
    console.log('\n━━━ Per-gate ablation ━━━');
    ablationResults = runAblation(recordsByPeriod, best.strong, best.weak, DEFAULT_FORWARD);
    printAblationTable(ablationResults);
  }

  // 9. Per-symbol breakdown
  console.log('\n━━━ Per-symbol breakdown ━━━');
  const perSym = perSymbolBreakdown(recordsByPeriod, best.strong, best.weak, DEFAULT_FORWARD);
  printPerSymbolTable(perSym);

  // 10. Assemble output JSON
  const results = {
    generated_at: new Date().toISOString(),
    config: {
      symbols: SYMBOLS,
      periods: PERIODS,
      forward_windows: FORWARD_WINDOWS,
      primary_forward_window: DEFAULT_FORWARD,
      best_forward_window_train: bestWindow,
      fees_bps_per_side: FEES_BPS_PER_SIDE,
      min_signals_for_tune: MIN_SIGNALS_FOR_TUNE,
      ablation_enabled: RUN_ABLATION,
      ablation_gates: ABLATION_GATES,
    },
    threshold_sweep_train: {
      grid,
      best,
      selected_thresholds: { STRONG: best.strong, WEAK: best.weak },
    },
    period_hit_rates: {
      TRAIN:       periodAgg.TRAIN,
      VALIDATION:  periodAgg.VALIDATION,
      OOS:         periodAgg.OOS,
    },
    overfit_check: overfit,
    forward_window_sweep: fwdSweep,
    ablation: ablationResults,
    per_symbol: perSym,
    summary: {
      best_thresholds: { STRONG: best.strong, WEAK: best.weak },
      best_forward_window_train: bestWindow,
      train_combined_pre_hit:  best.combinedPreHit,
      train_combined_post_hit: best.combinedPostHit,
      val_strong_pre_hit:  periodAgg.VALIDATION.STRONG.preHitRate,
      oos_strong_pre_hit:  periodAgg.OOS.STRONG.preHitRate,
      val_strong_post_hit: periodAgg.VALIDATION.STRONG.postHitRate,
      oos_strong_post_hit: periodAgg.OOS.STRONG.postHitRate,
      overfit_flagged: overfit.flagged,
      notes: [
        'Thresholds tuned ONLY on TRAIN. Applied unchanged to VAL/OOS.',
        `Costs: ${FEES_BPS_ROUND_TRIP}bps round-trip fees + funding cost over hold.`,
        'preHit  = hit rate before costs (price return only).',
        'postHit = hit rate after fees + funding (net return > 0).',
        'Best thresholds selected by combined (STRONG+WEAK) pre-cost hit rate on TRAIN.',
        `OOS flagged overfit if STRONG pre-hit diverges from VAL by >20pp.`,
      ],
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  console.log(`\n✓ Wrote ${OUT_JSON}`);

  // Final headline summary
  console.log('\n━━━ HEADLINE ━━━');
  console.log(`  Best TRAIN thresholds: STRONG=${best.strong}, WEAK=${best.weak}  (selected by TRAIN combined pre-cost hit rate, min ${MIN_SIGNALS_FOR_TUNE} signals/side)`);
  console.log(`  Best TRAIN forward window: ${bestWindow}d (primary report uses ${DEFAULT_FORWARD}d)`);
  console.log(`  STRONG pre-cost hit  : TRAIN ${pct(periodAgg.TRAIN.STRONG.preHitRate)} | VAL ${pct(periodAgg.VALIDATION.STRONG.preHitRate)} | OOS ${pct(periodAgg.OOS.STRONG.preHitRate)}`);
  console.log(`  STRONG post-cost hit : TRAIN ${pct(periodAgg.TRAIN.STRONG.postHitRate)} | VAL ${pct(periodAgg.VALIDATION.STRONG.postHitRate)} | OOS ${pct(periodAgg.OOS.STRONG.postHitRate)}`);
  console.log(`  WEAK   pre-cost hit  : TRAIN ${pct(periodAgg.TRAIN.WEAK.preHitRate)} | VAL ${pct(periodAgg.VALIDATION.WEAK.preHitRate)} | OOS ${pct(periodAgg.OOS.WEAK.preHitRate)}`);
  console.log(`  WEAK   post-cost hit : TRAIN ${pct(periodAgg.TRAIN.WEAK.postHitRate)} | VAL ${pct(periodAgg.VALIDATION.WEAK.postHitRate)} | OOS ${pct(periodAgg.OOS.WEAK.postHitRate)}`);
  console.log(`  STRONG count         : TRAIN ${periodAgg.TRAIN.STRONG.count} | VAL ${periodAgg.VALIDATION.STRONG.count} | OOS ${periodAgg.OOS.STRONG.count}`);
  console.log(`  WEAK   count         : TRAIN ${periodAgg.TRAIN.WEAK.count} | VAL ${periodAgg.VALIDATION.WEAK.count} | OOS ${periodAgg.OOS.WEAK.count}`);
  console.log(`  Overfit flagged      : ${overfit.flagged ? 'YES — see check details above' : 'no'}`);
  return results;
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
