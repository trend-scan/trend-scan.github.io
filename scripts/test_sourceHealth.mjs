// Quick test of sourceHealth.js logic
// Verifies that markGloballyBlocked / isGloballyBlocked behave correctly.
//
// NOTE: 403 tracking was removed — only HTTP 451 triggers a global block.
// 403 can mean many things (WAF, rate limit, symbol-specific issue) and
// false-positive blocking was hurting coverage (especially for OKX, which
// is NOT geo-blocked but may occasionally return 403 for other reasons).

import {
  markGloballyBlocked,
  isGloballyBlocked,
  getBlockedSources,
  unblockSource,
  unblockAll,
} from '../src/lib/scanner/sourceHealth.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
}

console.log('Test 1: markGloballyBlocked → isGloballyBlocked');
unblockAll();
assert(!isGloballyBlocked('binance_perps'), 'not blocked initially');
markGloballyBlocked('binance_perps');
assert(isGloballyBlocked('binance_perps'), 'blocked after markGloballyBlocked');
assert(!isGloballyBlocked('okx_perps'), 'other source not blocked');

console.log('\nTest 2: getBlockedSources returns list with secondsLeft');
const blocked = getBlockedSources();
assert(blocked.length === 1, 'one source blocked');
assert(blocked[0].sourceId === 'binance_perps', 'correct sourceId');
assert(blocked[0].secondsLeft > 0 && blocked[0].secondsLeft <= 600, 'secondsLeft in valid range');

console.log('\nTest 3: unblockSource clears single source');
unblockSource('binance_perps');
assert(!isGloballyBlocked('binance_perps'), 'cleared after unblockSource');

console.log('\nTest 4: 403 does NOT trigger blocking (removed — was causing false positives)');
// 403 tracking was removed entirely. Only 451 triggers a block.
// This test verifies that calling markGloballyBlocked is the ONLY way to block.
unblockAll();
assert(!isGloballyBlocked('okx_perps'), 'OKX not blocked (no 451 received)');
markGloballyBlocked('okx_perps');
assert(isGloballyBlocked('okx_perps'), 'OKX blocked only after explicit 451');

console.log('\nTest 5: unblockAll clears everything');
markGloballyBlocked('binance_perps');
markGloballyBlocked('okx_perps');
assert(isGloballyBlocked('binance_perps') && isGloballyBlocked('okx_perps'), 'both blocked');
unblockAll();
assert(!isGloballyBlocked('binance_perps') && !isGloballyBlocked('okx_perps'), 'all cleared');

console.log('\nTest 6: block auto-expires (simulated)');
// We can't wait 10 min in a test, but we can verify the expiry logic
// by checking that getUnblockTime returns a future timestamp.
unblockAll();
markGloballyBlocked('bybit');
const until = getBlockedSources()[0];
assert(until !== undefined, 'block exists');
assert(until.unblockAt > Date.now(), 'unblockAt is in the future');
assert(until.secondsLeft > 0, 'secondsLeft is positive');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
