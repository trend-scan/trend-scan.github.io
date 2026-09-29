/**
 * priceFormat.test.js — unit tests for the Board's shared price formatter.
 *
 * Run with:  npm test
 * (Node's built-in node:test framework — no extra deps)
 *
 * Coverage:
 *   1. fmtCryptoPrice — majors keep the existing 2-decimal look; sub-cent
 *      cryptos (PEPE, PUMP, SHIB) render with up to 7 decimal places;
 *      trailing zeros trimmed; never exponential notation; null/NaN safe.
 *   2. fmtDollarPrice — $-prefixed tradfi conventions preserved; sub-cent
 *      band reaches 7 decimals; null/NaN safe.
 *
 * Context (2026-09-29): the crypto tables' old 2-decimal cap rendered PEPE
 * (~$0.0000085) as "0"; ThemesTab's toPrecision(4) rendered BTC as "8.391e+4".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fmtCryptoPrice, fmtDollarPrice } from '../../src/lib/board/priceFormat.js';

// ─── 1. fmtCryptoPrice ────────────────────────────────────────────────────────

describe('priceFormat.fmtCryptoPrice — Board crypto tables', () => {
  test('majors keep the existing 2-decimal look (zero visual churn)', () => {
    assert.equal(fmtCryptoPrice(83912.5), '83,912.5');
    assert.equal(fmtCryptoPrice(265.4), '265.4');
    assert.equal(fmtCryptoPrice(0.55), '0.55');
    assert.equal(fmtCryptoPrice(83), '83');
  });

  test('sub-cent cryptos render with up to 7 decimal places', () => {
    assert.equal(fmtCryptoPrice(0.0037), '0.0037');        // PUMP
    assert.equal(fmtCryptoPrice(0.0000085), '0.0000085');  // PEPE
    assert.equal(fmtCryptoPrice(0.000017), '0.000017');    // SHIB
  });

  test('7th decimal and beyond rounds (spec: up to 7 places)', () => {
    assert.equal(fmtCryptoPrice(0.00000123), '0.0000012');
    assert.equal(fmtCryptoPrice(0.00000856), '0.0000086');
  });

  test('trailing zeros trimmed — no padding, no dangling dot', () => {
    assert.equal(fmtCryptoPrice(0.005), '0.005');
    assert.equal(fmtCryptoPrice(0.0000001), '0.0000001');
    assert.equal(fmtCryptoPrice(0), '0');
  });

  test('never exponential notation (toPrecision bug class)', () => {
    for (const v of [83912.5, 103000, 0.0000085, 0.0000001, 0]) {
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
  test('existing tradfi look preserved', () => {
    assert.equal(fmtDollarPrice(4154.2), '$4,154.20');
    assert.equal(fmtDollarPrice(766.52), '$766.52');
    assert.equal(fmtDollarPrice(3.5), '$3.50');
    assert.equal(fmtDollarPrice(0.55), '$0.5500');
  });

  test('sub-cent band reaches 7 decimals (OKX H/L tooltips, tiny instruments)', () => {
    assert.equal(fmtDollarPrice(0.0037), '$0.0037');
    assert.equal(fmtDollarPrice(0.0000085), '$0.0000085');
    assert.equal(fmtDollarPrice(0.0000001), '$0.0000001');
  });

  test('null / NaN → em dash', () => {
    assert.equal(fmtDollarPrice(null), '—');
    assert.equal(fmtDollarPrice(NaN), '—');
  });
});
