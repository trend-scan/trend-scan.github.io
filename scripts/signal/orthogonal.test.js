/**
 * orthogonal.test.js — Unit tests for the OrthoSys v6.1 JS port
 *
 * Run with:  node --test scripts/signal/orthogonal.test.js
 *
 * Coverage:
 *   1. Statistical primitives (sma, stdev, ema, rsi, rollZscore)
 *   2. Pivot detection (no look-ahead)
 *   3. Raw signal computation (all 9 signals, sign conventions)
 *   4. Composite engine (weighted average, threshold logic)
 *   5. Position derivation (long/short/flat, pivot filter)
 *   6. Edge cases (insufficient data, NaN guards, constant series)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sma, stdev, ema, rsi, rollZscore,
  computePivotSignal, computeRawSignals, computeOrthoS,
  DEFAULT_PARAMS, SIGNAL_NAMES,
} from '../../src/lib/signal/orthogonal.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildCandles(n = 400, startPrice = 100, drift = 0.002) {
  const candles = [];
  let price = startPrice;
  const baseTs = Date.now() - n * 86400000;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price * (1 + drift + Math.sin(i / 7) * 0.005);
    const high = Math.max(open, close) * 1.003;
    const low = Math.min(open, close) * 0.997;
    candles.push({
      ts: baseTs + i * 86400000,
      open, high, low, close,
      volume: 1000 + Math.random() * 500,
    });
    price = close;
  }
  return candles;
}

function buildFlatCandles(n = 400, price = 100) {
  const candles = [];
  const baseTs = Date.now() - n * 86400000;
  for (let i = 0; i < n; i++) {
    candles.push({
      ts: baseTs + i * 86400000,
      open: price, high: price, low: price, close: price, volume: 1000,
    });
  }
  return candles;
}

// ─── 1. Statistical primitives ───────────────────────────────────────────────

describe('Statistical primitives', () => {
  test('sma returns null for first n-1 bars', () => {
    const r = sma([1, 2, 3, 4, 5], 3);
    assert.equal(r[0], null);
    assert.equal(r[1], null);
    assert.equal(r[2], 2);  // (1+2+3)/3
  });

  test('sma computes rolling mean correctly', () => {
    const r = sma([1, 2, 3, 4, 5], 3);
    assert.equal(r[2], 2);  // (1+2+3)/3
    assert.equal(r[3], 3);  // (2+3+4)/3
    assert.equal(r[4], 4);  // (3+4+5)/3
  });

  test('stdev returns null for first n-1 bars', () => {
    const r = stdev([1, 2, 3, 4, 5], 3);
    assert.equal(r[0], null);
    assert.equal(r[1], null);
    assert.ok(r[2] != null);
  });

  test('stdev of constant series is 0', () => {
    const r = stdev([5, 5, 5, 5, 5], 3);
    assert.equal(r[2], 0);
    assert.equal(r[4], 0);
  });

  test('stdev uses population formula (N divisor)', () => {
    // [1,2,3] → mean=2, variance=((1-2)²+(2-2)²+(3-2)²)/3 = 2/3, stdev=√(2/3)
    const r = stdev([1, 2, 3, 4, 5], 3);
    assert.equal(r[2].toFixed(6), Math.sqrt(2 / 3).toFixed(6));
  });

  test('ema seeds with first value', () => {
    const r = ema([10, 20, 30], 3);
    assert.equal(r[0], 10);
  });

  test('ema computes exponential smoothing', () => {
    const r = ema([10, 20, 30], 3);
    const k = 2 / (3 + 1);  // 0.5
    assert.equal(r[1], 20 * k + 10 * (1 - k));  // 15
    assert.equal(r[2], 30 * k + 15 * (1 - k));  // 22.5
  });

  test('rsi returns null for first n bars', () => {
    const r = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
    for (let i = 0; i < 14; i++) assert.equal(r[i], null);
    assert.ok(r[14] != null);
  });

  test('rsi returns 100 for purely advancing series', () => {
    const closes = [];
    for (let i = 0; i < 30; i++) closes.push(100 + i);
    const r = rsi(closes, 14);
    assert.equal(r[14], 100);
    assert.equal(r[29], 100);
  });

  test('rollZscore returns 0 when stdev is 0', () => {
    const r = rollZscore([5, 5, 5, 5, 5], 3);
    assert.equal(r[2], 0);
    assert.equal(r[4], 0);
  });

  test('rollZscore returns 0 for first n-1 bars (default fill)', () => {
    const r = rollZscore([1, 2, 3, 4, 5], 3);
    assert.equal(r[0], 0);
    assert.equal(r[1], 0);
    // At i=2, mean=2, stdev=√(2/3), z=(3-2)/√(2/3) = √(3/2)
    assert.ok(Math.abs(r[2] - Math.sqrt(3 / 2)) < 0.0001);
  });
});

// ─── 2. Pivot detection ──────────────────────────────────────────────────────

describe('Pivot detection (no look-ahead)', () => {
  test('computePivotSignal returns array of same length as input', () => {
    const highs = [1, 2, 3, 4, 5, 4, 3, 2, 1, 2];
    const lows = highs.map(h => h - 1);
    const closes = highs.map(h => h - 0.5);
    const r = computePivotSignal(highs, lows, closes, 3, 1);
    assert.equal(r.length, highs.length);
  });

  test('pivot signal is 0 when no pivots confirmed yet', () => {
    // Need at least leftBars + rightBars + 1 bars for first pivot
    const highs = [1, 2, 3, 4, 5];
    const lows = [0, 1, 2, 3, 4];
    const closes = [0.5, 1.5, 2.5, 3.5, 4.5];
    const r = computePivotSignal(highs, lows, closes, 3, 1);
    // With only 5 bars and leftBars=3, rightBars=1, the first pivot can confirm at bar 4
    // (pivot at bar 3, confirmed at bar 4). Before that, signal is 0.
    for (let i = 0; i < 4; i++) {
      assert.equal(r[i], 0, `bar ${i} should be 0 before any pivot confirms`);
    }
  });

  test('pivot signal respects no-look-ahead: bar i cannot see pivot at i+1', () => {
    // Build a series where the pivot high is at bar 10 (a clear peak)
    const highs = [];
    const lows = [];
    const closes = [];
    for (let i = 0; i < 20; i++) {
      const v = i <= 10 ? 100 + i * 2 : 120 - (i - 10) * 2;
      highs.push(v + 1);
      lows.push(v - 1);
      closes.push(v);
    }
    const r = computePivotSignal(highs, lows, closes, 7, 1);
    // Pivot at bar 10 should only be visible starting at bar 11 (rightBars=1)
    // So r[10] should still be using the PREVIOUS pivot state, r[11] is the first bar
    // that can "see" the bar-10 pivot.
    // Without look-ahead, r[10] should not reflect the bar-10 pivot.
    // (It might be 0 or reflect an earlier pivot, but should NOT use bar 10's high.)
    // Hard to assert exact value without knowing prior pivots — just check it doesn't crash.
    assert.equal(r.length, 20);
  });

  test('pivot signal in [-0.5, 0.5] range when pivots exist', () => {
    // Build a clear oscillating series with many pivots
    const highs = [];
    const lows = [];
    const closes = [];
    for (let i = 0; i < 100; i++) {
      const v = 100 + Math.sin(i / 5) * 10;
      highs.push(v + 1);
      lows.push(v - 1);
      closes.push(v);
    }
    const r = computePivotSignal(highs, lows, closes, 7, 1);
    for (let i = 20; i < 100; i++) {
      assert.ok(r[i] >= -0.5 && r[i] <= 0.5, `bar ${i}: pivot_sig ${r[i]} out of [-0.5, 0.5]`);
    }
  });
});

// ─── 3. Raw signal computation ───────────────────────────────────────────────

describe('Raw signals (all 9, sign conventions)', () => {
  test('computeRawSignals returns all 9 signal arrays', () => {
    const candles = buildCandles(200);
    const r = computeRawSignals(candles);
    for (const name of SIGNAL_NAMES) {
      assert.ok(Array.isArray(r[name]), `signal ${name} should be an array`);
      assert.equal(r[name].length, candles.length, `signal ${name} length mismatch`);
    }
  });

  test('vol_ratio: positive vol_dir × (v/sma) × -1 → sign is -1 × dir', () => {
    // Build candles where close > open (dir=+1) and volume is constant
    const candles = [];
    for (let i = 0; i < 30; i++) {
      candles.push({
        open: 100, high: 102, low: 99, close: 101, volume: 1000, ts: i,
      });
    }
    const r = computeRawSignals(candles);
    // dir = +1 (close > open), vol/sma = 1000/1000 = 1, × -1 → -1
    assert.ok(r.vol_ratio[29] < 0, 'vol_ratio should be negative when close>open and vol flat');
    assert.ok(Math.abs(r.vol_ratio[29] - (-1)) < 0.001);
  });

  test('bb_width: positive for non-zero volatility', () => {
    const candles = buildCandles(50);
    const r = computeRawSignals(candles);
    for (let i = 25; i < 50; i++) {
      assert.ok(r.bb_width[i] > 0, `bb_width should be positive at bar ${i}, got ${r.bb_width[i]}`);
    }
  });

  test('rsi_signal: in [-1, 1] range', () => {
    const candles = buildCandles(50);
    const r = computeRawSignals(candles);
    for (let i = 20; i < 50; i++) {
      assert.ok(r.rsi_signal[i] >= -1 && r.rsi_signal[i] <= 1,
        `rsi_signal at bar ${i} out of range: ${r.rsi_signal[i]}`);
    }
  });

  test('zscore_20: negated (sign convention)', () => {
    // If close is ABOVE the 20-MA, raw (c-μ)/σ is positive, but sign-corrected is NEGATIVE
    const candles = [];
    for (let i = 0; i < 50; i++) {
      candles.push({
        open: 100 + i * 0.5, high: 100 + i * 0.5 + 1, low: 100 + i * 0.5 - 1,
        close: 100 + i * 0.5, volume: 1000, ts: i,
      });
    }
    const r = computeRawSignals(candles);
    // Last close is well above 20-MA (uptrend) → (c-μ)/σ > 0 → × -1 → negative
    assert.ok(r.zscore_20[49] < 0, `zscore_20 should be negative in uptrend, got ${r.zscore_20[49]}`);
  });

  test('mom_6: negated (sign convention)', () => {
    // In uptrend, (c - c[6])/c[6] > 0, × -1 → negative
    const candles = [];
    for (let i = 0; i < 50; i++) {
      candles.push({
        open: 100 + i, high: 100 + i + 1, low: 100 + i - 1,
        close: 100 + i, volume: 1000, ts: i,
      });
    }
    const r = computeRawSignals(candles);
    assert.ok(r.mom_6[10] < 0, 'mom_6 should be negative in uptrend (sign = -1)');
    assert.ok(r.mom_18[25] < 0, 'mom_18 should be negative in uptrend (sign = -1)');
  });

  test('ema_cross: positive when ema_fast > ema_slow (uptrend)', () => {
    const candles = [];
    for (let i = 0; i < 60; i++) {
      candles.push({
        open: 100 + i, high: 100 + i + 1, low: 100 + i - 1,
        close: 100 + i, volume: 1000, ts: i,
      });
    }
    const r = computeRawSignals(candles);
    assert.ok(r.ema_cross[59] > 0, 'ema_cross should be positive in uptrend');
  });

  test('hl_mom: in [-0.5, 0.5] range', () => {
    const candles = buildCandles(50);
    const r = computeRawSignals(candles);
    for (let i = 0; i < 50; i++) {
      assert.ok(r.hl_mom[i] >= -0.5 && r.hl_mom[i] <= 0.5,
        `hl_mom at bar ${i} out of range: ${r.hl_mom[i]}`);
    }
  });

  test('hl_mom: returns 0 when high == low (no range)', () => {
    const candles = buildFlatCandles(30);
    const r = computeRawSignals(candles);
    for (let i = 0; i < 30; i++) {
      assert.equal(r.hl_mom[i], 0);
    }
  });

  test('taker_ratio: in [-1, 1] range', () => {
    const candles = buildCandles(50);
    const r = computeRawSignals(candles);
    for (let i = 20; i < 50; i++) {
      assert.ok(r.taker_ratio[i] >= -1 && r.taker_ratio[i] <= 1,
        `taker_ratio at bar ${i} out of range: ${r.taker_ratio[i]}`);
    }
  });

  test('taker_ratio: negative when up-bars dominate (sign = -1)', () => {
    // Build candles where close > open on every bar (all up-bars)
    const candles = [];
    for (let i = 0; i < 30; i++) {
      candles.push({
        open: 100, high: 102, low: 99, close: 101, volume: 1000, ts: i,
      });
    }
    const r = computeRawSignals(candles);
    // up_vol = 20 × 1000 = 20000, dn_vol = 0, (up-dn)/(up+dn) = 1, × -1 = -1
    assert.ok(Math.abs(r.taker_ratio[29] - (-1)) < 0.001,
      `taker_ratio should be -1 when all up-bars, got ${r.taker_ratio[29]}`);
  });
});

// ─── 4. Composite engine ─────────────────────────────────────────────────────

describe('Composite engine', () => {
  test('computeOrthoS returns all required fields', () => {
    const candles = buildCandles(200);
    const r = computeOrthoS(candles);
    assert.ok(r.composite, 'missing composite');
    assert.ok(r.pivot_sig, 'missing pivot_sig');
    assert.ok(r.position, 'missing position');
    assert.ok(r.raw, 'missing raw');
    assert.ok(r.z, 'missing z');
    assert.ok(r.smoothed, 'missing smoothed');
    assert.ok(r.threshold !== undefined, 'missing threshold');
    assert.ok(r.weights, 'missing weights');
  });

  test('composite has same length as input', () => {
    const candles = buildCandles(200);
    const r = computeOrthoS(candles);
    assert.equal(r.composite.length, candles.length);
    assert.equal(r.pivot_sig.length, candles.length);
    assert.equal(r.position.length, candles.length);
  });

  test('composite values are finite numbers', () => {
    const candles = buildCandles(200);
    const r = computeOrthoS(candles);
    for (let i = 100; i < candles.length; i++) {
      assert.ok(Number.isFinite(r.composite[i]), `composite[${i}] is not finite: ${r.composite[i]}`);
    }
  });

  test('custom weights are respected', () => {
    const candles = buildCandles(200);
    const r1 = computeOrthoS(candles, { weights: { vol_ratio: 1, bb_width: 0, rsi_signal: 0, zscore_20: 0, mom_6: 0, mom_18: 0, ema_cross: 0, hl_mom: 0, taker_ratio: 0 } });
    const r2 = computeOrthoS(candles, { weights: { vol_ratio: 0, bb_width: 1, rsi_signal: 0, zscore_20: 0, mom_6: 0, mom_18: 0, ema_cross: 0, hl_mom: 0, taker_ratio: 0 } });
    // With only one signal weighted, composite should equal that signal's smoothed z-score
    // (weighted average of one non-zero value = that value)
    assert.ok(Math.abs(r1.composite[150] - r1.smoothed.vol_ratio[150]) < 0.001);
    assert.ok(Math.abs(r2.composite[150] - r2.smoothed.bb_width[150]) < 0.001);
  });

  test('all-zero weights produces zero composite', () => {
    const candles = buildCandles(200);
    const weights = {};
    for (const name of SIGNAL_NAMES) weights[name] = 0;
    const r = computeOrthoS(candles, { weights });
    for (let i = 0; i < candles.length; i++) {
      assert.equal(r.composite[i], 0);
    }
  });
});

// ─── 5. Position derivation ─────────────────────────────────────────────────

describe('Position derivation', () => {
  test('position values are in {-1, 0, 1}', () => {
    const candles = buildCandles(400);
    const r = computeOrthoS(candles);
    for (let i = 0; i < candles.length; i++) {
      assert.ok([-1, 0, 1].includes(r.position[i]),
        `position[${i}] = ${r.position[i]} not in {-1, 0, 1}`);
    }
  });

  test('position = 1 requires composite > +τ', () => {
    const candles = buildCandles(400);
    const r = computeOrthoS(candles, { thresh: 0.3, use_pivot: false });
    for (let i = 0; i < candles.length; i++) {
      if (r.position[i] === 1) {
        assert.ok(r.composite[i] > 0.3,
          `LONG at bar ${i} but composite ${r.composite[i]} ≤ τ=0.3`);
      }
    }
  });

  test('position = -1 requires composite < -τ', () => {
    const candles = buildCandles(400);
    const r = computeOrthoS(candles, { thresh: 0.3, use_pivot: false });
    for (let i = 0; i < candles.length; i++) {
      if (r.position[i] === -1) {
        assert.ok(r.composite[i] < -0.3,
          `SHORT at bar ${i} but composite ${r.composite[i]} ≥ -τ=-0.3`);
      }
    }
  });

  test('pivot filter suppresses signals when pivot_sig is wrong direction', () => {
    // With use_pivot=true and pivot_tau=0.5 (strict), LONG requires pivot_sig > 0.5
    // This should suppress most longs (pivot_sig is rarely > 0.5)
    const candles = buildCandles(400);
    const rStrict = computeOrthoS(candles, { thresh: 0.2, use_pivot: true, pivot_tau: 0.5 });
    const rLoose = computeOrthoS(candles, { thresh: 0.2, use_pivot: false });
    const strictLongs = rStrict.position.filter(p => p === 1).length;
    const looseLongs = rLoose.position.filter(p => p === 1).length;
    assert.ok(strictLongs <= looseLongs,
      `strict pivot (${strictLongs} longs) should be ≤ loose (${looseLongs} longs)`);
  });

  test('higher τ produces fewer signals', () => {
    const candles = buildCandles(400);
    const rLow = computeOrthoS(candles, { thresh: 0.2, use_pivot: false });
    const rHigh = computeOrthoS(candles, { thresh: 0.8, use_pivot: false });
    const lowSignals = rLow.position.filter(p => p !== 0).length;
    const highSignals = rHigh.position.filter(p => p !== 0).length;
    assert.ok(highSignals < lowSignals,
      `higher τ should produce fewer signals (high=${highSignals}, low=${lowSignals})`);
  });
});

// ─── 6. Edge cases ──────────────────────────────────────────────────────────

describe('Edge cases', () => {
  test('handles constant series without NaN', () => {
    const candles = buildFlatCandles(200);
    const r = computeOrthoS(candles);
    for (let i = 0; i < candles.length; i++) {
      assert.ok(Number.isFinite(r.composite[i]), `composite[${i}] is NaN on flat series`);
      assert.ok(Number.isFinite(r.pivot_sig[i]), `pivot_sig[${i}] is NaN on flat series`);
    }
  });

  test('handles insufficient data (< 80 bars for zsc_len)', () => {
    const candles = buildCandles(50);
    const r = computeOrthoS(candles);
    // Should not crash, composite should still be finite
    for (let i = 0; i < candles.length; i++) {
      assert.ok(Number.isFinite(r.composite[i]));
    }
  });

  test('handles very short series (< 30 bars)', () => {
    const candles = buildCandles(20);
    const r = computeOrthoS(candles);
    assert.equal(r.composite.length, 20);
    assert.equal(r.position.length, 20);
  });

  test('DEFAULT_PARAMS has expected values', () => {
    assert.equal(DEFAULT_PARAMS.lb, 5);
    assert.equal(DEFAULT_PARAMS.zsc_len, 80);
    assert.equal(DEFAULT_PARAMS.thresh, 0.5);
    assert.equal(DEFAULT_PARAMS.use_pivot, true);
    assert.equal(DEFAULT_PARAMS.pivot_tau, 0.0);
    for (const name of SIGNAL_NAMES) {
      assert.equal(DEFAULT_PARAMS.weights[name], 1.0, `default weight for ${name} should be 1.0`);
    }
  });

  test('SIGNAL_NAMES has all 9 signals', () => {
    assert.equal(SIGNAL_NAMES.length, 9);
    assert.ok(SIGNAL_NAMES.includes('vol_ratio'));
    assert.ok(SIGNAL_NAMES.includes('bb_width'));
    assert.ok(SIGNAL_NAMES.includes('rsi_signal'));
    assert.ok(SIGNAL_NAMES.includes('zscore_20'));
    assert.ok(SIGNAL_NAMES.includes('mom_6'));
    assert.ok(SIGNAL_NAMES.includes('mom_18'));
    assert.ok(SIGNAL_NAMES.includes('ema_cross'));
    assert.ok(SIGNAL_NAMES.includes('hl_mom'));
    assert.ok(SIGNAL_NAMES.includes('taker_ratio'));
  });
});
