/**
 * priceFormat.test.js — unit tests for the Board's shared price formatter.
 *
 * Run with:  npm test
 * (Node's built-in node:test framework — no extra deps)
 *
 * Coverage:
 *   1. fmtCryptoPrice — majors keep the existing 2-decimal look; sub-$1
 *      cryptos render the exchange's NATIVE precision (pass-through, Task 33):
 *      OKX's deepest quote is 12dp (SATS 0.000000012431), so nothing a venue
 *      actually sends is ever rounded; trailing zeros trimmed; never
 *      exponential; float dust absorbed; null/NaN safe.
 *   2. fmtDollarPrice — $-prefixed tradfi conventions preserved above $1;
 *      native pass-through below $1 (OKX H/L tooltips, tiny instruments).
 *
 * Context: Task 32's 7-decimal cap still rendered OKX's 12dp SATS-USDT-SWAP
 * (0.000000012431) as "0" — the user asked for the native price to pass
 * through "despite the decimal number" (2026-09-30).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fmtCryptoPrice, fmtDollarPrice } from '../../src/lib/board/priceFormat.js';

// ─── 1. fmtCryptoPrice ────────────────────────────────────────────────────────

describe('priceFormat.fmtCryptoPrice — Board crypto tables', () => {
  test('majors keep the existing 2-decimal look (zero visual churn)', () => {
    assert.equal(fmtCryptoPrice(83912.5), '83,912.5');
    assert.equal(fmtCryptoPrice(265.4), '265.4');
    assert.equal(fmtCryptoPrice(1.5), '1.5');
    assert.equal(fmtCryptoPrice(83), '83');
  });

  test('sub-cent cryptos render native precision — no rounding', () => {
    assert.equal(fmtCryptoPrice(0.0037), '0.0037');          // PUMP
    assert.equal(fmtCryptoPrice(0.0000085), '0.0000085');    // PEPE
    assert.equal(fmtCryptoPrice(0.000017), '0.000017');      // SHIB
    assert.equal(fmtCryptoPrice(0.00009197), '0.00009197');  // NEIRO (OKX 8dp)
  });

  test('native pass-through beyond 7 decimals (Task 33 motivation)', () => {
    assert.equal(fmtCryptoPrice(0.00000123), '0.00000123');          // was "0.0000012" under 7dp
    assert.equal(fmtCryptoPrice(0.00000856), '0.00000856');          // was "0.0000086"
    assert.equal(fmtCryptoPrice(0.000000012431), '0.000000012431');  // OKX SATS — was "0" under 7dp!
  });

  test('sub-$1 band no longer rounds to 2dp (old 0.014 → "0.01" bug class)', () => {
    assert.equal(fmtCryptoPrice(0.55), '0.55');
    assert.equal(fmtCryptoPrice(0.014), '0.014');
    assert.equal(fmtCryptoPrice(0.5234), '0.5234');
    assert.equal(fmtCryptoPrice(0.006757), '0.006757');  // OKX OL
  });

  test('trailing zeros trimmed — no padding, no dangling dot', () => {
    assert.equal(fmtCryptoPrice(0.005), '0.005');
    assert.equal(fmtCryptoPrice(0.0000001), '0.0000001');
    assert.equal(fmtCryptoPrice(0.25), '0.25');
    assert.equal(fmtCryptoPrice(0), '0');
  });

  test('float dust absorbed at the 12-decimal cap (pass-through never shows artifacts)', () => {
    assert.equal(fmtCryptoPrice(0.1 + 0.2), '0.3');
    assert.equal(fmtCryptoPrice(0.0037 * 1), '0.0037');
  });

  test('layout guard — dust below 1e-12 collapses to "0"', () => {
    assert.equal(fmtCryptoPrice(1e-13), '0');
    assert.equal(fmtCryptoPrice(1e-15), '0');
  });

  test('never exponential notation (toPrecision bug class)', () => {
    for (const v of [83912.5, 103000, 0.0000085, 0.0000001, 1.23e-9, 0.000000012431, 0]) {
      const out = fmtCryptoPrice(v);
      assert.ok(!out.includes('e') && !out.includes('E'), `${v} → "${out}"`);
    }
  });

  test('null / NaN / undefined → em dash', () => {
    assert.equal(fmtCryptoPrice(null), '—');
    assert.equal(fmtCryptoPrice(NaN), '—');
    assert.equal(fmtCryptoPrice(undefined), '—');
    assert.equal(fmtCryptoPrice(Number('x')), '—');
  });
});

// ─── 2. fmtDollarPrice ────────────────────────────────────────────────────────

describe('priceFormat.fmtDollarPrice — $-prefixed conventions', () => {
  test('existing tradfi look preserved above $1', () => {
    assert.equal(fmtDollarPrice(4154.2), '$4,154.20');
    assert.equal(fmtDollarPrice(766.52), '$766.52');
    assert.equal(fmtDollarPrice(3.5), '$3.50');
  });

  test('below $1: native pass-through (OKX H/L tooltips, tiny instruments)', () => {
    assert.equal(fmtDollarPrice(0.55), '$0.55');            // was "$0.5500" (4dp pad)
    assert.equal(fmtDollarPrice(0.014), '$0.014');
    assert.equal(fmtDollarPrice(0.0037), '$0.0037');
    assert.equal(fmtDollarPrice(0.0000085), '$0.0000085');
    assert.equal(fmtDollarPrice(0.00009197), '$0.00009197'); // NEIRO (OKX 8dp)
    assert.equal(fmtDollarPrice(0.0000001), '$0.0000001');
    assert.equal(fmtDollarPrice(0.000000012431), '$0.000000012431'); // OKX SATS 12dp
  });

  test('null / NaN → em dash', () => {
    assert.equal(fmtDollarPrice(null), '—');
    assert.equal(fmtDollarPrice(NaN), '—');
  });
});
