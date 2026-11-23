// Live smoke test for btcEnrichment.js — real APIs, real network, prints the
// sections that would land in snapshot.json. Run: node scripts/btcEnrichment.smoke.mjs
import { fetchBtcEnrichment } from './btcEnrichment.js';

const prevSnapshot = null; // cold-start — no previous section to merge

console.log('── cold-start live smoke ──');
const t0 = Date.now();
const out = await fetchBtcEnrichment({ BTC: { price: 64722, change24h: -0.35, change7d: -12.66, change30d: -21.94 } }, prevSnapshot);
console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

console.log('btc_market:', JSON.stringify(out.btc_market, null, 1));
console.log('\nbtc_onchain:', JSON.stringify(out.btc_onchain, null, 1));
console.log('\nbtc_vol.dvol:', out.btc_vol?.dvol, '| history points:', out.btc_vol?.dvol_history?.length);
console.log('btc_vol.term_structure:', JSON.stringify(out.btc_vol?.term_structure));
console.log('btc_vol.skew_25d:', JSON.stringify(out.btc_vol?.skew_25d));
console.log('\nbtc_derivatives:', JSON.stringify(out.btc_derivatives, null, 1));
console.log('\nmvrv_backfill rows:', out.mvrv_backfill?.rows?.length, '| span:', out.mvrv_backfill?.rows?.[0]?.date, '→', out.mvrv_backfill?.rows?.at(-1)?.date);
console.log('\nlast 3 MVRV backfill rows:', JSON.stringify(out.mvrv_backfill?.rows?.slice(-3)));
