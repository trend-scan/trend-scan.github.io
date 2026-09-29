/**
 * watchlist_live.verify.mjs — LIVE-API verification of the Watchlist's 15s
 * refresh data layer (Task 33, 2026-09-30).
 *
 * ⚠️ NOT part of `npm test` — hits the real OKX/Hyperliquid APIs. Run on demand:
 *
 *   node --import ./scripts/esm-ext-hook-register.mjs scripts/board/watchlist_live.verify.mjs
 *
 * Verifies:
 *   1. fetchAllSwapTickers(): bulk Map of USDT-quoted SWAP perps, sane values
 *   2. Request economy: 1 bulk request serves a 20-symbol refresh loop at ANY
 *      watchlist size; TTL (10s) collapses immediate repeats to 0 requests;
 *      expiry re-fetches
 *   3. fetchWatchlistTradfiLive() bulk path: aliases (SPX→US500), guaranteed
 *      misses, okxInstId passthrough, fetchedAt ISO
 *   4. Divergence guard: >40% off snapshot → row dropped; matching → kept;
 *      null tradData → guard skipped
 *   5. Fallback path: bulk outage → per-symbol probes, misses negatively
 *      cached (10 min) so repeat calls skip dead instruments
 *   6. Bulk vs per-symbol probe consistency (SPY price within 1%)
 */

import assert from 'node:assert/strict';
import { fetchAllSwapTickers, fetchTicker as fetchOkxTicker } from '../../src/lib/scanner/sources/okxTradfi.js';
import { fetchWatchlistTradfiLive } from '../../src/lib/board/watchlistEngine.js';

// ─── fetch instrumentation ───────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let log = [];
let failBulk = false;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  log.push(u);
  if (failBulk && u.includes('/market/tickers?instType=SWAP')) {
    throw new Error('simulated bulk outage');
  }
  return realFetch(url, opts);
};
const count = (needle) => log.filter(u => u.includes(needle)).length;
const reset = () => { log = []; };

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    const v = fn();
    if (v === false) throw new Error('returned false');
    console.log(`  ✔ ${name}`);
    pass += 1;
  } catch (e) {
    console.log(`  ✘ ${name} — ${e.message}`);
    fail += 1;
  }
}
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg ?? `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// ─── 5. Fallback path FIRST (needs a cold module cache: bulk must fail before
//        any successful call leaves a stale cache to fall back to) ─────────────
console.log('\n[1] Fallback path — simulated bulk outage → per-symbol probes');
failBulk = true;
reset();
{
  const res = await fetchWatchlistTradfiLive(['SPY', 'AAPL', 'ZZZ'], null);
  eq(res.rows.size, 2, 'SPY+AAPL live, ZZZ (unlisted) missed');
  check('SPY row has okxInstId + fraction ret1d', () => {
    const r = res.rows.get('SPY');
    if (!r.okxInstId || !r.okxInstId.endsWith('-USDT-SWAP')) return false;
    if (typeof r.ret1d !== 'number' || Math.abs(r.ret1d) > 0.5) return false;
    if (!(r.price > 0) || !Number.isFinite(r.high24h)) return false;
    return true;
  });
  eq(count('/market/ticker?instId='), 3, '3 per-symbol probes fired (SPY, AAPL, ZZZ)');
  eq(count('/market/tickers?instType=SWAP'), 1, '1 (failed) bulk attempt');

  // Negative cache: repeat call re-probes hits but skips the known miss.
  reset();
  await fetchWatchlistTradfiLive(['SPY', 'AAPL', 'ZZZ'], null);
  eq(count('/market/ticker?instId='), 2, 'ZZZ negative-cached — only SPY+AAPL re-probed');
}
failBulk = false;

// ─── 1. Bulk basics ──────────────────────────────────────────────────────────
console.log('\n[2] fetchAllSwapTickers — bulk Map basics');
reset();
const bulk = await fetchAllSwapTickers();
check(`Map with 400-600 USDT perps (got ${bulk.size})`, () => bulk.size > 400 && bulk.size < 600);
check('key tickers present (AAPL, XAU, US500, OPENAI-ish coverage varies)', () => {
  for (const k of ['AAPL', 'XAU', 'US500']) {
    const t = bulk.get(k);
    if (!t || !(t.price > 0) || !Number.isFinite(t.change24hPct) || !t.instId?.endsWith('-USDT-SWAP')) return false;
  }
  return true;
});
check('every entry price > 0 and instId ends with -USDT-SWAP', () => {
  for (const t of bulk.values()) {
    if (!(t.price > 0) || !t.instId?.endsWith('-USDT-SWAP')) return false;
  }
  return true;
});
eq(count('/market/tickers?instType=SWAP'), 1, 'exactly one bulk request');

// TTL: immediate repeat = cache hit, zero requests
reset();
await fetchAllSwapTickers();
eq(log.length, 0, '10s TTL — immediate repeat makes no request');

// ─── 2+3. Bulk path through the engine: request economy at 20 symbols ───────
console.log('\n[3] fetchWatchlistTradfiLive — bulk path, 20 symbols');
const SYMS20 = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'MSFT', 'GOOGL', 'META', 'AMZN', 'TSLA',
  'XAU', 'XAG', 'SPX', 'XPL', 'ZZZ', 'YYY', 'BRK_B', 'OPENAI', 'ANTHROPIC', 'PLTR', 'HOOD'];
reset();
{
  const res = await fetchWatchlistTradfiLive(SYMS20, null);  // null tradData → guard skipped
  check(`most symbols live (got ${res.rows.size}/20)`, () => res.rows.size >= 12);
  eq(log.length, 0, 'ZERO extra requests — bulk TTL cache served all 20 lookups');
  check('alias SPX → US500-USDT-SWAP instId', () => res.rows.get('SPX')?.okxInstId === 'US500-USDT-SWAP');
  check('alias XPL → XPT-USDT-SWAP instId (platinum, not Plasma token)', () => res.rows.get('XPL')?.okxInstId === 'XPT-USDT-SWAP');
  check('fetchedAt is a parseable ISO timestamp', () => !Number.isNaN(Date.parse(res.fetchedAt)));
  const spyPrice = res.rows.get('SPY').price;  // reused for the guard test below
  globalThis.__spyPrice = spyPrice;
}

// ─── 4. Divergence guard ─────────────────────────────────────────────────────
console.log('\n[4] Divergence guard — >40% off snapshot → snapshot wins');
reset();
{
  const bad = await fetchWatchlistTradfiLive(['SPY', 'QQQ'], { assets: [{ symbol: 'SPY', price: 99999 }] });
  eq(bad.rows.size, 1, 'SPY dropped (99999 vs ~real), QQQ kept');
  const good = await fetchWatchlistTradfiLive(['SPY'], { assets: [{ symbol: 'SPY', price: globalThis.__spyPrice }] });
  eq(good.rows.size, 1, 'matching snapshot price → live row kept');
}

// ─── TTL expiry → fresh fetch ────────────────────────────────────────────────
console.log('\n[5] Bulk TTL expiry — cache refreshes after 10s');
await new Promise(r => setTimeout(r, 10_500));
reset();
await fetchAllSwapTickers();
eq(count('/market/tickers?instType=SWAP'), 1, 'expired cache → exactly one fresh bulk request');

// ─── 6. Bulk vs per-symbol probe consistency ─────────────────────────────────
console.log('\n[6] Bulk ↔ per-symbol probe consistency (SPY)');
reset();
{
  const [probe, res] = await Promise.all([
    fetchOkxTicker('SPY'),
    fetchWatchlistTradfiLive(['SPY'], null),
  ]);
  const bulkPx = res.rows.get('SPY').price;
  check(`probe ${probe.price.toFixed(2)} vs bulk ${bulkPx.toFixed(2)} within 1%`, () =>
    Math.abs(probe.price / bulkPx - 1) < 0.01);
}

console.log(`\n${pass} pass · ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
