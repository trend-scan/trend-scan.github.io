/**
 * ortho_integration_test.js — Fresh evaluation of OrthoSys candidate signals
 * as potential additions to TrendScan's 10-gate engine.
 *
 * Context:
 *   The full OrthoSys v6.1 daily-tuned system loses money on 2022-2025 data
 *   (-40.9% OOS annual return, Sharpe -0.625). However, two individual signals
 *   showed statistically significant OOS IC:
 *     - mom_5        (5-day contrarian momentum)  OOS IC +0.040, p=0.006
 *     - taker_ratio  (taker buy/sell ratio, -1)   OOS IC +0.031, p=0.027
 *   The previous session concluded "do not integrate the composite, but
 *   consider mom_5 and taker_ratio as individual gates 11+12."
 *
 * This script answers 4 questions before any integration decision:
 *
 *   Q1 (Orthogonality): How correlated are mom_5 and taker_ratio with each
 *      of the existing 10 gates' outputs? If they're highly correlated with
 *      existing gates, they add no new information. We want low correlation.
 *
 *   Q2 (Conditional hit rate): When the existing engine emits STRONG or WEAK,
 *      does filtering by mom_5/taker_ratio direction improve hit rate?
 *      E.g. "STRONG signals where mom_5 < 0 (contrarian bearish)" vs all STRONG.
 *
 *   Q3 (Incremental gate): If we add mom_5 (or taker_ratio) as an 11th
 *      confidence boost/penalty, does OOS hit rate improve? Test 3 modes:
 *        - Boost: +1 confidence when signal agrees with stance direction
 *        - Penalty: -1 confidence when signal disagrees
 *        - Filter: downgrade STRONG→NEUTRAL when signal strongly disagrees
 *
 *   Q4 (Regime-conditional): Is the signal's predictive power concentrated
 *      in specific regimes (bull/bear/chop)? If it only works in 1 regime,
 *      it's riskier to integrate unconditionally.
 *
 * Methodology:
 *   - Use the same TRAIN/VALIDATION/OOS split as walk_forward_backtest.js
 *   - Use the same 13 symbols and same forward returns
 *   - Use the same cost model (10bps/side + funding)
 *   - Replicate the existing engine's stance/confidence/verdict exactly
 *   - Compute mom_5 and taker_ratio per (symbol, day) using the SAME formulas
 *     as orthogonal.js (so we're testing apples to apples)
 *   - For taker_ratio: our cached klines don't have taker_buy_vol, so we use
 *     the original Pine proxy (up-bar vs down-bar volume × -1) which is what
 *     orthogonal.js implements. Note: the daily backtest's +0.031 OOS IC was
 *     measured with REAL taker_buy_vol from Binance Vision; the proxy may
 *     perform differently. We flag this.
 *
 * Output:
 *   scripts/signal/ortho_integration_results.json
 *   console summary
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
const OUT_JSON = path.join(__dirname, 'ortho_integration_results.json');

// ─── Configuration (mirrors walk_forward_backtest.js) ──────────────────────

const SYMBOLS = [
  'BTC', 'ETH', 'SOL',
  'AVAX', 'LINK', 'DOGE',
  'ARB', 'OP',
  'INJ', 'SUI', 'NEAR', 'APT', 'TIA',
];

const PERIODS = {
  TRAIN:       { start: '2022-01-01', end: '2023-06-30' },
  VALIDATION:  { start: '2023-07-01', end: '2024-06-30' },
  OOS:         { start: '2024-07-01', end: '2025-07-31' },
};
const FORWARD_WINDOWS = [1, 3, 5, 10, 20];
const DEFAULT_FORWARD = 10;
const FEES_BPS_PER_SIDE = 10;
const THRESHOLDS = DEFAULT_THRESHOLDS; // STRONG=8, WEAK=8

// ─── Data loading ──────────────────────────────────────────────────────────

function loadKlines(symbol) {
  const p = path.join(DATA_DIR, symbol, 'klines_1d.json');
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return raw.map(k => ({
    t: k.t,
    ts: k.t, // computeSignal expects .ts
    open: k.o, high: k.h, low: k.l, close: k.c,
    volume: k.v, quoteVolume: k.q,
  }));
}

function loadFunding(symbol) {
  const p = path.join(DATA_DIR, symbol, 'funding.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function inPeriod(timestamp, period) {
  const startMs = Date.parse(period.start);
  const endMs = Date.parse(period.end + 'T23:59:59Z');
  return timestamp >= startMs && timestamp <= endMs;
}

function periodLabel(timestamp) {
  for (const [name, p] of Object.entries(PERIODS)) {
    if (inPeriod(timestamp, p)) return name;
  }
  return null;
}

// ─── Forward returns + cost model (mirrors walk_forward_backtest.js) ───────

function computeForwardReturns(candles, funding) {
  // For each day i, compute forward return at windows [1,3,5,10,20] days.
  // Include fees (10bps/side) and funding cost during hold.
  // Long: price_return - fees - funding_cost
  // Short: -price_return - fees + funding_cost
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    const entry = candles[i].close;
    const entryT = candles[i].t;
    const row = { t: entryT, long: {}, short: {} };
    for (const w of FORWARD_WINDOWS) {
      const j = i + w;
      if (j >= candles.length) {
        row.long[w] = null; row.short[w] = null; continue;
      }
      const exit = candles[j].close;
      const priceRet = (exit - entry) / entry;
      const fees = (FEES_BPS_PER_SIDE * 2) / 10000; // round trip
      // Funding cost: sum of funding rates between entry and exit
      // Long pays funding, short receives funding
      let fundingSum = 0;
      for (const f of funding) {
        if (f.t > entryT && f.t <= candles[j].t) fundingSum += f.rate;
      }
      row.long[w] = priceRet - fees - fundingSum;
      row.short[w] = -priceRet - fees + fundingSum;
    }
    out.push(row);
  }
  return out;
}

// ─── Candidate signal computation (mirrors orthogonal.js) ──────────────────

function computeMom5(candles) {
  // mom_5 = (c[i] - c[i-5]) / c[i-5]  ×  sign=-1 (contrarian)
  // Net output: -1 * (c-c[5])/c[5]
  // Positive value = bearish contrarian (price rose → expect reversion down)
  // Negative value = bullish contrarian (price fell → expect reversion up)
  const out = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    if (i < 5) continue;
    const prev = candles[i - 5].close;
    if (prev === 0) continue;
    out[i] = -1 * (candles[i].close - prev) / prev;
  }
  return out;
}

function computeTakerRatio(candles) {
  // Pine proxy from orthogonal.js: (up_vol - dn_vol)/(up_vol + dn_vol) × -1, rolling 20
  // NOTE: our cached klines don't have taker_buy_vol. This is the proxy used in
  // orthogonal.js. The daily backtest used REAL taker data and got OOS IC +0.031;
  // the proxy may differ. We report both with appropriate caveats.
  const out = new Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i++) {
    if (i < 19) continue;
    let up = 0, dn = 0;
    for (let j = i - 19; j <= i; j++) {
      if (candles[j].close > candles[j].open) up += candles[j].volume;
      else if (candles[j].close < candles[j].open) dn += candles[j].volume;
    }
    const total = up + dn;
    out[i] = total !== 0 ? -1 * (up - dn) / total : 0;
  }
  return out;
}

// ─── Existing 10-gate output extraction ────────────────────────────────────

function extractGateOutputs(signalResult) {
  // Returns per-day object with each gate's raw numeric output.
  // For non-numeric gates (rsVsBtc, mhAlignment), use a numeric encoding.
  const d = signalResult.drivers;
  return {
    zScore: d.zScore,
    zPctile: d.zPctile,
    trendTenure: d.trendTenure,
    atrExt: d.atrExt,
    rsVsBtcValue: d.rsVsBtcValue, // null for BTC
    fundingZ: d.fundingZ,
    rsi: d.rsi,
    obvSlope: d.obvSlope,
    impulseZ: d.impulseZ,
    ret5d: d.ret5d,
    ret20d: d.ret20d,
    macroZ: d.macroZ,
  };
}

// ─── Statistics helpers ────────────────────────────────────────────────────

function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (x[i] == null || y[i] == null || Number.isNaN(x[i]) || Number.isNaN(y[i])) continue;
    sx += x[i]; sy += y[i]; sxy += x[i] * y[i];
    sx2 += x[i] * x[i]; sy2 += y[i] * y[i];
    cnt++;
  }
  if (cnt < 3) return null;
  const num = cnt * sxy - sx * sy;
  const den = Math.sqrt(Math.max(1e-12, (cnt * sx2 - sx * sx) * (cnt * sy2 - sy * sy)));
  return num / den;
}

function rank(arr) {
  // Returns ranks (1-indexed, ties get average rank)
  const n = arr.length;
  const indexed = arr.map((v, i) => [v, i]);
  indexed.sort((a, b) => (a[0] == null ? Infinity : a[0]) - (b[0] == null ? Infinity : b[0]));
  const ranks = new Array(n).fill(null);
  let i = 0;
  while (i < n) {
    if (indexed[i][0] == null) { i++; continue; }
    let j = i;
    while (j + 1 < n && indexed[j + 1][0] === indexed[i][0]) j++;
    const avgRank = (i + 1 + j + 1) / 2; // 1-indexed
    for (let k = i; k <= j; k++) ranks[indexed[k][1]] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearman(x, y) {
  // Pearson on ranks = Spearman
  const rx = rank(x);
  const ry = rank(y);
  return pearson(rx, ry);
}

function mean(arr) {
  let s = 0, c = 0;
  for (const v of arr) {
    if (v != null && !Number.isNaN(v)) { s += v; c++; }
  }
  return c > 0 ? s / c : null;
}

function std(arr) {
  const m = mean(arr);
  if (m == null) return null;
  let s = 0, c = 0;
  for (const v of arr) {
    if (v != null && !Number.isNaN(v)) { s += (v - m) ** 2; c++; }
  }
  return c > 1 ? Math.sqrt(s / (c - 1)) : null;
}

function zscore(arr) {
  const m = mean(arr);
  const s = std(arr);
  if (m == null || s == null || s < 1e-9) return arr.map(() => 0);
  return arr.map(v => (v == null || Number.isNaN(v)) ? 0 : (v - m) / s);
}

// ─── Main pipeline ─────────────────────────────────────────────────────────

function main() {
  console.log('=== OrthoSys Integration Candidate Test ===\n');
  console.log(`Symbols: ${SYMBOLS.length}`);
  console.log(`Periods: TRAIN ${PERIODS.TRAIN.start}→${PERIODS.TRAIN.end}, ` +
              `VAL ${PERIODS.VALIDATION.start}→${PERIODS.VALIDATION.end}, ` +
              `OOS ${PERIODS.OOS.start}→${PERIODS.OOS.end}`);
  console.log(`Forward windows: ${FORWARD_WINDOWS.join(',')}d (primary: ${DEFAULT_FORWARD}d)`);
  console.log(`Costs: ${FEES_BPS_PER_SIDE}bps/side\n`);

  // Per-symbol data load + per-day row construction
  const allRows = []; // {symbol, t, period, candles, signal, mom5, takerRatio, fwd}

  for (const symbol of SYMBOLS) {
    const candles = loadKlines(symbol);
    const funding = loadFunding(symbol);
    if (!candles || candles.length < 60) {
      console.log(`  ⚠ ${symbol}: insufficient data (${candles ? candles.length : 0} bars), skipping`);
      continue;
    }
    // Compute existing-engine signal per day
    // We need BTC candles for rsVsBtc computation
    let btcCandles = null;
    if (symbol !== 'BTC') {
      btcCandles = loadKlines('BTC');
    }
    // Compute signal for each day where we have enough lookback
    // computeSignal expects the FULL candle array + an index; let's check the signature
    // Actually computeSignal takes candles + funding history + btcCandles and returns
    // a single signal object. We need to call it per-day. Check the function.

    // Walk through each day with sufficient lookback
    const mom5 = computeMom5(candles);
    const takerRatio = computeTakerRatio(candles);
    const fwd = computeForwardReturns(candles, funding);

    // Compute signal at each day
    // We do this by calling computeSignal with the candle slice up to day i.
    // This is expensive but only ~1300 days × 13 symbols = ~17K calls.
    for (let i = 60; i < candles.length; i++) {
      const t = candles[i].t;
      const period = periodLabel(t);
      if (!period) continue;

      // Slice candles up to and including day i
      const slice = candles.slice(0, i + 1);
      const fundingSlice = funding.filter(f => f.t <= t);
      const btcSlice = btcCandles ? btcCandles.filter(c => c.t <= t) : null;

      let signal;
      try {
        signal = computeSignal({
          candles: slice,
          fundingHistory: fundingSlice,
          btcCandles: btcSlice,
          isBtc: symbol === 'BTC',
        });
      } catch (e) {
        continue;
      }
      if (!signal || !signal.drivers) continue;

      const verdict = mapStanceToVerdict(signal.stance, signal.confidence);

      allRows.push({
        symbol,
        t,
        period,
        mom5: mom5[i],
        takerRatio: takerRatio[i],
        verdict,
        stance: signal.stance,
        confidence: signal.confidence,
        gateOutputs: extractGateOutputs(signal),
        fwd: fwd[i],
      });
    }
    process.stdout.write(`  ✓ ${symbol}: ${candles.length} bars, ${candles.length - 60} daily signals\n`);
  }

  console.log(`\nTotal daily rows: ${allRows.length}`);
  const byPeriod = {};
  for (const r of allRows) {
    byPeriod[r.period] = (byPeriod[r.period] || 0) + 1;
  }
  console.log('By period:', byPeriod);

  // ─── Q1: Orthogonality ──────────────────────────────────────────────────
  console.log('\n=== Q1: Orthogonality (Pearson correlation of candidate signals vs existing 10 gates) ===\n');
  const gateNames = ['zScore', 'zPctile', 'trendTenure', 'atrExt', 'rsVsBtcValue', 'fundingZ', 'rsi', 'obvSlope', 'impulseZ', 'ret5d', 'ret20d', 'macroZ'];
  const q1 = { candidates: ['mom5', 'takerRatio'], gates: gateNames, periods: {} };

  for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
    const rows = allRows.filter(r => r.period === period);
    q1.periods[period] = {};
    console.log(`\n  ${period} (${rows.length} rows):`);
    console.log(`    ${'gate'.padEnd(15)} ${'corr(mom5)'.padStart(12)} ${'corr(taker)'.padStart(12)}`);
    console.log('    ' + '-'.repeat(42));
    for (const gate of gateNames) {
      const xs = rows.map(r => r.gateOutputs[gate]);
      const m5 = rows.map(r => r.mom5);
      const tk = rows.map(r => r.takerRatio);
      const cm5 = pearson(xs, m5);
      const ctk = pearson(xs, tk);
      q1.periods[period][gate] = { mom5: cm5, takerRatio: ctk };
      const fmt = v => v == null ? '   N/A' : (v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3));
      console.log(`    ${gate.padEnd(15)} ${fmt(cm5).padStart(12)} ${fmt(ctk).padStart(12)}`);
    }
    // Also correlation between mom5 and takerRatio themselves
    const cMT = pearson(rows.map(r => r.mom5), rows.map(r => r.takerRatio));
    q1.periods[period]._mom5_vs_takerRatio = cMT;
    const fmt2 = v => v == null ? '   N/A' : (v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3));
    console.log(`    ${'mom5 vs takerRatio'.padEnd(15)} ${fmt2(cMT).padStart(12)} (self-correlation)`);
  }

  // ─── Q2: Conditional hit rate ───────────────────────────────────────────
  console.log('\n=== Q2: Conditional hit rate (does filtering by candidate signal improve verdict hit rate?) ===\n');
  const q2 = { tests: [] };

  // For each verdict class (STRONG, WEAK, NEUTRAL), compute baseline hit rate
  // at the primary forward window, then compute filtered hit rate where
  // candidate signal agrees with the verdict direction.
  // "Agreement" definition:
  //   STRONG (bullish): mom5 < -0.01 (contrarian bullish: price fell, expect bounce)
  //                     OR takerRatio > 0.01 (proxy bearish→bullish: more dn volume, expect up)
  //   WEAK (bearish): mom5 > 0.01 (price rose, expect reversion down)
  //                   OR takerRatio < -0.01 (more up volume, expect down)
  for (const period of ['TRAIN', 'VALIDATION', 'OOS']) {
    const rows = allRows.filter(r => r.period === period);
    console.log(`\n  ${period} (${rows.length} rows, primary forward window ${DEFAULT_FORWARD}d):`);
    for (const verdict of ['STRONG', 'WEAK']) {
      const longShort = verdict === 'STRONG' ? 'long' : 'short';
      const base = rows.filter(r => r.verdict === verdict && r.fwd && r.fwd[longShort] && r.fwd[longShort][DEFAULT_FORWARD] != null);
      if (base.length < 10) {
        console.log(`    ${verdict}: too few signals (${base.length})`);
        continue;
      }
      const baseHits = base.filter(r => r.fwd[longShort][DEFAULT_FORWARD] > 0).length;
      const baseRate = baseHits / base.length;

      // Filtered: mom5 agrees
      const mom5Filt = base.filter(r => {
        if (verdict === 'STRONG') return r.mom5 != null && r.mom5 < -0.005; // contrarian bullish
        return r.mom5 != null && r.mom5 > 0.005; // contrarian bearish
      });
      const mom5Hits = mom5Filt.filter(r => r.fwd[longShort][DEFAULT_FORWARD] > 0).length;
      const mom5Rate = mom5Filt.length > 0 ? mom5Hits / mom5Filt.length : null;

      // Filtered: takerRatio agrees
      const tkFilt = base.filter(r => {
        if (verdict === 'STRONG') return r.takerRatio != null && r.takerRatio > 0.005;
        return r.takerRatio != null && r.takerRatio < -0.005;
      });
      const tkHits = tkFilt.filter(r => r.fwd[longShort][DEFAULT_FORWARD] > 0).length;
      const tkRate = tkFilt.length > 0 ? tkHits / tkFilt.length : null;

      // Filtered: BOTH agree (and-gate)
      const bothFilt = base.filter(r => {
        if (verdict === 'STRONG') return (r.mom5 != null && r.mom5 < -0.005) && (r.takerRatio != null && r.takerRatio > 0.005);
        return (r.mom5 != null && r.mom5 > 0.005) && (r.takerRatio != null && r.takerRatio < -0.005);
      });
      const bothHits = bothFilt.filter(r => r.fwd[longShort][DEFAULT_FORWARD] > 0).length;
      const bothRate = bothFilt.length > 0 ? bothHits / bothFilt.length : null;

      console.log(`    ${verdict}:`);
      console.log(`      baseline           n=${base.length.toString().padStart(4)}  hit=${baseRate.toFixed(4)}  (${baseHits}/${base.length})`);
      if (mom5Rate != null)
        console.log(`      + mom5 agrees      n=${mom5Filt.length.toString().padStart(4)}  hit=${mom5Rate.toFixed(4)}  (${mom5Hits}/${mom5Filt.length})  Δ=${(mom5Rate - baseRate >= 0 ? '+' : '')}${((mom5Rate - baseRate) * 100).toFixed(2)}pp`);
      if (tkRate != null)
        console.log(`      + taker agrees     n=${tkFilt.length.toString().padStart(4)}  hit=${tkRate.toFixed(4)}  (${tkHits}/${tkFilt.length})  Δ=${(tkRate - baseRate >= 0 ? '+' : '')}${((tkRate - baseRate) * 100).toFixed(2)}pp`);
      if (bothRate != null)
        console.log(`      + both agree       n=${bothFilt.length.toString().padStart(4)}  hit=${bothRate.toFixed(4)}  (${bothHits}/${bothFilt.length})  Δ=${(bothRate - baseRate >= 0 ? '+' : '')}${((bothRate - baseRate) * 100).toFixed(2)}pp`);

      q2.tests.push({ period, verdict, baseN: base.length, baseRate, mom5N: mom5Filt.length, mom5Rate, takerN: tkFilt.length, takerRate: tkRate, bothN: bothFilt.length, bothRate });
    }
  }

  // ─── Q3: Incremental gate ───────────────────────────────────────────────
  console.log('\n=== Q3: Incremental gate (add candidate as confidence boost/penalty/filter) ===\n');
  const q3 = { modes: [] };

  // For each mode, recompute the verdict and measure OOS hit rate vs baseline.
  // Modes:
  //   boost_mom5:    +1 confidence when mom5 agrees with stance direction
  //   boost_taker:   +1 confidence when takerRatio agrees
  //   boost_both:    +1 confidence when EITHER agrees (max +2)
  //   penalty_mom5:  -1 confidence when mom5 disagrees (min 1)
  //   filter_mom5:   downgrade STRONG→NEUTRAL when mom5 strongly disagrees (mom5 > 0.02 for STRONG)
  //   filter_taker:  downgrade STRONG→NEUTRAL when takerRatio strongly disagrees
  for (const mode of ['boost_mom5', 'boost_taker', 'boost_both', 'penalty_mom5', 'filter_mom5', 'filter_taker']) {
    const rows = allRows.filter(r => r.period === 'OOS');
    let strongN = 0, strongHits = 0;
    let weakN = 0, weakHits = 0;
    let totalN = 0, totalHits = 0;
    for (const r of rows) {
      let stance = r.stance;
      let conf = r.confidence;
      let verdict = r.verdict;

      if (mode === 'boost_mom5') {
        if (stance === 'CONSTRUCTIVE' && r.mom5 != null && r.mom5 < -0.005) conf = Math.min(10, conf + 1);
        else if (stance === 'DEFENSIVE' && r.mom5 != null && r.mom5 > 0.005) conf = Math.min(10, conf + 1);
      } else if (mode === 'boost_taker') {
        if (stance === 'CONSTRUCTIVE' && r.takerRatio != null && r.takerRatio > 0.005) conf = Math.min(10, conf + 1);
        else if (stance === 'DEFENSIVE' && r.takerRatio != null && r.takerRatio < -0.005) conf = Math.min(10, conf + 1);
      } else if (mode === 'boost_both') {
        let boost = 0;
        if (stance === 'CONSTRUCTIVE') {
          if (r.mom5 != null && r.mom5 < -0.005) boost++;
          if (r.takerRatio != null && r.takerRatio > 0.005) boost++;
        } else if (stance === 'DEFENSIVE') {
          if (r.mom5 != null && r.mom5 > 0.005) boost++;
          if (r.takerRatio != null && r.takerRatio < -0.005) boost++;
        }
        conf = Math.min(10, conf + boost);
      } else if (mode === 'penalty_mom5') {
        if (stance === 'CONSTRUCTIVE' && r.mom5 != null && r.mom5 > 0.005) conf = Math.max(1, conf - 1);
        else if (stance === 'DEFENSIVE' && r.mom5 != null && r.mom5 < -0.005) conf = Math.max(1, conf - 1);
      } else if (mode === 'filter_mom5') {
        if (verdict === 'STRONG' && r.mom5 != null && r.mom5 > 0.02) verdict = 'NEUTRAL';
        else if (verdict === 'WEAK' && r.mom5 != null && r.mom5 < -0.02) verdict = 'NEUTRAL';
      } else if (mode === 'filter_taker') {
        if (verdict === 'STRONG' && r.takerRatio != null && r.takerRatio < -0.02) verdict = 'NEUTRAL';
        else if (verdict === 'WEAK' && r.takerRatio != null && r.takerRatio > 0.02) verdict = 'NEUTRAL';
      }

      // Recompute verdict if we changed confidence (only boost/penalty modes)
      if (mode.startsWith('boost') || mode.startsWith('penalty')) {
        verdict = mapStanceToVerdict(stance, conf);
      }

      if (verdict === 'STRONG' && r.fwd && r.fwd.long && r.fwd.long[DEFAULT_FORWARD] != null) {
        strongN++;
        totalN++;
        if (r.fwd.long[DEFAULT_FORWARD] > 0) { strongHits++; totalHits++; }
      } else if (verdict === 'WEAK' && r.fwd && r.fwd.short && r.fwd.short[DEFAULT_FORWARD] != null) {
        weakN++;
        totalN++;
        if (r.fwd.short[DEFAULT_FORWARD] > 0) { weakHits++; totalHits++; }
      }
    }
    const strongRate = strongN > 0 ? strongHits / strongN : null;
    const weakRate = weakN > 0 ? weakHits / weakN : null;
    const totalRate = totalN > 0 ? totalHits / totalN : null;

    console.log(`  ${mode}:`);
    console.log(`    STRONG  n=${strongN.toString().padStart(4)}  hit=${strongRate != null ? strongRate.toFixed(4) : 'N/A'}`);
    console.log(`    WEAK    n=${weakN.toString().padStart(4)}  hit=${weakRate != null ? weakRate.toFixed(4) : 'N/A'}`);
    console.log(`    COMBINED n=${totalN.toString().padStart(4)}  hit=${totalRate != null ? totalRate.toFixed(4) : 'N/A'}`);

    q3.modes.push({ mode, strongN, strongRate, weakN, weakRate, totalN, totalRate });
  }

  // Baseline (no modification) for comparison
  {
    const rows = allRows.filter(r => r.period === 'OOS');
    let strongN = 0, strongHits = 0, weakN = 0, weakHits = 0;
    for (const r of rows) {
      if (r.verdict === 'STRONG' && r.fwd && r.fwd.long && r.fwd.long[DEFAULT_FORWARD] != null) {
        strongN++;
        if (r.fwd.long[DEFAULT_FORWARD] > 0) strongHits++;
      } else if (r.verdict === 'WEAK' && r.fwd && r.fwd.short && r.fwd.short[DEFAULT_FORWARD] != null) {
        weakN++;
        if (r.fwd.short[DEFAULT_FORWARD] > 0) weakHits++;
      }
    }
    const sRate = strongN > 0 ? strongHits / strongN : null;
    const wRate = weakN > 0 ? weakHits / weakN : null;
    const cN = strongN + weakN;
    const cH = strongHits + weakHits;
    const cRate = cN > 0 ? cH / cN : null;
    console.log(`\n  BASELINE (no modification):`);
    console.log(`    STRONG  n=${strongN.toString().padStart(4)}  hit=${sRate != null ? sRate.toFixed(4) : 'N/A'}`);
    console.log(`    WEAK    n=${weakN.toString().padStart(4)}  hit=${wRate != null ? wRate.toFixed(4) : 'N/A'}`);
    console.log(`    COMBINED n=${cN.toString().padStart(4)}  hit=${cRate != null ? cRate.toFixed(4) : 'N/A'}`);
    q3.baseline = { strongN, strongRate: sRate, weakN, weakRate: wRate, totalN: cN, totalRate: cRate };
  }

  // ─── Q4: Regime-conditional IC ──────────────────────────────────────────
  console.log('\n=== Q4: Regime-conditional IC (where do signals work?) ===\n');
  const q4 = { regimes: {} };

  // Define regimes by 30d rolling BTC return:
  //   bull: 30d ret > +10%
  //   bear: 30d ret < -10%
  //   chop: |30d ret| <= 10%
  const btcCandles = loadKlines('BTC');
  const btc30dRet = new Array(btcCandles.length).fill(null);
  for (let i = 0; i < btcCandles.length; i++) {
    if (i < 30) continue;
    btc30dRet[i] = (btcCandles[i].close - btcCandles[i - 30].close) / btcCandles[i - 30].close;
  }
  const btcTto30 = new Map();
  for (let i = 0; i < btcCandles.length; i++) btcTto30.set(btcCandles[i].t, btc30dRet[i]);

  for (const regime of ['bull', 'bear', 'chop', 'all']) {
    const rows = allRows.filter(r => {
      if (regime === 'all') return true;
      const r30 = btcTto30.get(r.t);
      if (r30 == null) return false;
      if (regime === 'bull') return r30 > 0.10;
      if (regime === 'bear') return r30 < -0.10;
      return Math.abs(r30) <= 0.10;
    });
    if (rows.length < 30) {
      console.log(`  ${regime}: too few rows (${rows.length})`);
      q4.regimes[regime] = { n: rows.length };
      continue;
    }

    // ── Q4a: Time-series IC (per-symbol, averaged) ──
    // Same as before — Pearson(signal, fwd_return) per symbol, averaged.
    let icMom5Sum = 0, icTkSum = 0, cnt = 0;
    let icMom5List = [], icTkList = [];
    for (const symbol of SYMBOLS) {
      const sRows = rows.filter(r => r.symbol === symbol && r.fwd && r.fwd.long && r.fwd.long[DEFAULT_FORWARD] != null && r.mom5 != null);
      if (sRows.length < 20) continue;
      const xs = sRows.map(r => r.mom5);
      const ys = sRows.map(r => r.fwd.long[DEFAULT_FORWARD]);
      const ic = pearson(xs, ys);
      if (ic != null) { icMom5Sum += ic; icMom5List.push(ic); }
      const xs2 = sRows.map(r => r.takerRatio);
      const ic2 = pearson(xs2, ys);
      if (ic2 != null) { icTkSum += ic2; icTkList.push(ic2); }
      cnt++;
    }
    const icMom5 = cnt > 0 ? icMom5Sum / cnt : null;
    const icTk = cnt > 0 ? icTkSum / cnt : null;

    // ── Q4b: Cross-sectional IC (proper — Spearman per day, averaged) ──
    // For each day in regime, rank all 13 symbols by signal value, rank by
    // next-10d return, compute Spearman. Average across days. This is the
    // standard quant definition of IC.
    const byDay = new Map();
    for (const r of rows) {
      if (r.fwd && r.fwd.long && r.fwd.long[DEFAULT_FORWARD] != null && r.mom5 != null) {
        if (!byDay.has(r.t)) byDay.set(r.t, []);
        byDay.get(r.t).push(r);
      }
    }
    let csMom5Sum = 0, csTkSum = 0, csDays = 0;
    for (const [t, dayRows] of byDay) {
      if (dayRows.length < 5) continue; // need ≥5 symbols for meaningful rank correlation
      const xs1 = dayRows.map(r => r.mom5);
      const xs2 = dayRows.map(r => r.takerRatio);
      const ys = dayRows.map(r => r.fwd.long[DEFAULT_FORWARD]);
      const ic1 = spearman(xs1, ys);
      const ic2 = spearman(xs2, ys);
      if (ic1 != null) { csMom5Sum += ic1; }
      if (ic2 != null) { csTkSum += ic2; }
      csDays++;
    }
    const csMom5 = csDays > 0 ? csMom5Sum / csDays : null;
    const csTk = csDays > 0 ? csTkSum / csDays : null;

    // ── Q4c: Hit rate (directional accuracy) ──
    // For each symbol-day, signal predicts direction:
    //   mom5 > 0 → bearish (price rose, expect reversion down) → SHORT
    //   mom5 < 0 → bullish (price fell, expect reversion up) → LONG
    //   takerRatio > 0 → bullish (more dn vol in proxy = expect up)
    //   takerRatio < 0 → bearish
    // Measure: % of days where signal direction matches 10d forward return direction.
    let mom5Dir = 0, mom5N = 0, tkDir = 0, tkN = 0;
    for (const r of rows) {
      if (r.fwd && r.fwd.long && r.fwd.long[DEFAULT_FORWARD] != null) {
        const fwd = r.fwd.long[DEFAULT_FORWARD];
        if (r.mom5 != null) {
          // mom5 > 0 → predict down, mom5 < 0 → predict up
          const predict = r.mom5 > 0 ? -1 : 1;
          if ((predict > 0 && fwd > 0) || (predict < 0 && fwd < 0)) mom5Dir++;
          mom5N++;
        }
        if (r.takerRatio != null) {
          // taker > 0 → predict up, taker < 0 → predict down
          const predict = r.takerRatio > 0 ? 1 : -1;
          if ((predict > 0 && fwd > 0) || (predict < 0 && fwd < 0)) tkDir++;
          tkN++;
        }
      }
    }
    const mom5Hit = mom5N > 0 ? mom5Dir / mom5N : null;
    const tkHit = tkN > 0 ? tkDir / tkN : null;

    console.log(`  ${regime}: n=${rows.length}, symbols_avg=${cnt}, cross_sectional_days=${csDays}`);
    console.log(`    time-series IC:    mom5=${icMom5 != null ? icMom5.toFixed(4) : 'N/A'}  taker=${icTk != null ? icTk.toFixed(4) : 'N/A'}`);
    console.log(`    cross-sectional IC: mom5=${csMom5 != null ? csMom5.toFixed(4) : 'N/A'}  taker=${csTk != null ? csTk.toFixed(4) : 'N/A'}`);
    console.log(`    directional hit:   mom5=${mom5Hit != null ? mom5Hit.toFixed(4) : 'N/A'}  taker=${tkHit != null ? tkHit.toFixed(4) : 'N/A'}  (baseline=0.5000)`);

    q4.regimes[regime] = {
      n: rows.length,
      symbolsAveraged: cnt,
      crossSectionalDays: csDays,
      timeSeriesIC: { mom5: icMom5, takerRatio: icTk },
      crossSectionalIC: { mom5: csMom5, takerRatio: csTk },
      directionalHit: { mom5: mom5Hit, takerRatio: tkHit, mom5N, tkN },
    };
  }

  // ─── Write results ──────────────────────────────────────────────────────
  const results = {
    generated_at: new Date().toISOString(),
    config: {
      symbols: SYMBOLS,
      periods: PERIODS,
      forward_windows: FORWARD_WINDOWS,
      default_forward: DEFAULT_FORWARD,
      fees_bps_per_side: FEES_BPS_PER_SIDE,
      thresholds: THRESHOLDS,
    },
    q1_orthogonality: q1,
    q2_conditional_hit: q2,
    q3_incremental_gate: q3,
    q4_regime_conditional: q4,
    notes: [
      'taker_ratio uses the Pine proxy (up_vol vs dn_vol) from orthogonal.js, NOT real taker_buy_vol from Binance.',
      'The ortho_daily_backtest.py used real taker_buy_vol and got OOS IC +0.031. The proxy may differ.',
      'mom5 is contrarian (sign=-1): positive value = bearish (price rose, expect reversion down).',
      'Q1 correlations are Pearson on raw values per (symbol, day) across all symbols.',
      'Q2 hit rate uses long for STRONG, short for WEAK, at primary forward window (10d).',
      'Q3 baseline is the existing 10-gate engine with no modification. STRONG=8, WEAK=8 thresholds.',
      'Q4 IC is time-series Pearson per symbol, averaged across symbols. Cross-sectional IC would be more rigorous.',
    ],
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  console.log(`\n✓ Results written to ${OUT_JSON}`);
}

main();
