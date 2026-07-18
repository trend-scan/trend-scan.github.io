// Test that Kraken's fallback symbol map has the key symbols.
// Simple content-based test — no regex extraction needed.

import { readFileSync } from 'fs';

const src = readFileSync(new URL('../src/lib/scanner/sources/kraken.js', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('Test: Kraken fallback map has key symbols with correct pairs');

// BTC → XBTUSDT (Kraken uses XBT for Bitcoin)
assert(src.includes("BTC: 'XBTUSDT'"), 'BTC → XBTUSDT (XBT not BTC)');

// DOGE → XDGUSDT (Kraken uses XDG for Dogecoin)
assert(src.includes("DOGE: 'XDGUSDT'"), 'DOGE → XDGUSDT (XDG not DOGE)');

// USD-quoted pairs (not USDT)
assert(src.includes("TRX: 'TRXUSD'"), 'TRX → TRXUSD (USD not USDT)');
assert(src.includes("TON: 'TONUSD'"), 'TON → TONUSD (USD not USDT)');
assert(src.includes("XMR: 'XMRUSD'"), 'XMR → XMRUSD (USD not USDT)');
assert(src.includes("ZEC: 'ZECUSD'"), 'ZEC → ZECUSD (USD not USDT)');
assert(src.includes("HBAR: 'HBARUSD'"), 'HBAR → HBARUSD (USD not USDT)');

console.log('\nTest: Dynamic pair map loading is implemented');
assert(src.includes('async function loadPairMap'), 'loadPairMap function exists');
assert(src.includes('/AssetPairs'), 'fetches /AssetPairs endpoint');
assert(src.includes('_pairMapPromise'), 'deduplicates concurrent loads');
assert(src.includes('PAIR_MAP_TTL_MS'), 'has TTL for cache expiry');

console.log('\nTest: normalizeBase handles Kraken naming quirks');
assert(src.includes("if (base === 'XBT') base = 'BTC'"), 'XBT → BTC normalization');
assert(src.includes("if (base === 'XDG') base = 'DOGE'"), 'XDG → DOGE normalization');
assert(src.includes("/^[XZ][A-Z0-9]{3}$/"), 'strips X/Z prefix from 4-char codes');

console.log('\nTest: isSupported export exists for resolver');
assert(src.includes('export async function isSupported'), 'isSupported exported');

console.log('\nTest: USDT preferred over USD in pair map');
assert(src.includes("if (q === 'USDT')"), 'USDT pairs stored first');
assert(src.includes("else if (q === 'USD' && !map[base])"), 'USD pairs only stored if no USDT pair');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
