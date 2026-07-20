/**
 * backfill_history.js — One-time backfill of regime_history + signal_history
 *
 * Fetches CoinGecko historical data (365 days) + FRED (from snapshot) + 
 * Fear&Greed (120 days from snapshot) and replays the regime computation
 * day-by-day for the past 90 days, producing a warm-started history.
 *
 * Also backfills factor_watch_history and crypto_factor_history from the
 * previous snapshot's accumulated data (if available).
 *
 * Usage:
 *   node scripts/backfill_history.js
 *
 * Output: Writes a merged history JSON to scripts/backfill_output.json
 * which build_snapshot.js can read as a warm start.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TrendScan-Backfill/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`  ✗ Fetch failed: ${url.slice(0, 60)}... — ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('━━━ Backfilling regime_history (90 days) ━━━');

  // Load current snapshot for FRED + Fear&Greed data
  const snapshotPath = path.join(ROOT, 'public', 'snapshot.json');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const fred = snapshot.fred || {};
  const fearGreed = snapshot.fear_greed || [];

  // Fetch CoinGecko historical data (365 days — enough for 90-day lookback windows)
  console.log('Fetching CoinGecko historical data (365 days)...');
  const [btcRes, ethRes, globalRes] = await Promise.all([
    fetchJson('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily'),
    fetchJson('https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=365&interval=daily'),
    fetchJson('https://api.coingecko.com/api/v3/global/market_cap_chart?vs_currency=usd&days=365'),
  ]);

  if (!btcRes?.prices?.length || !ethRes?.prices?.length) {
    console.error('✗ Failed to fetch CoinGecko historical data — cannot backfill');
    process.exit(1);
  }

  // Extract price/volume/dominance series
  const btcPrices = btcRes.prices.map(p => p[1]);
  const btcVolumes = (btcRes.total_volumes || []).map(v => v[1]);
  const ethPrices = ethRes.prices.map(p => p[1]);
  const ethBtcRatio = btcPrices.map((btc, i) => btc > 0 ? (ethPrices[i] || 0) / btc : 0);

  const globalMcaps = globalRes?.market_cap_by_currency?.usd || globalRes?.market_caps || [];
  const btcMcaps = (btcRes.market_caps || []).map(m => m[1]);
  const btcDominance = globalMcaps.map((g, i) => {
    const total = g[1] || 0;
    const btc = btcMcaps[i] || 0;
    return total > 0 ? (btc / total) * 100 : 0;
  });
  const usdtDominance = btcDominance.map(() => 5.0); // flat approximation

  // Extract timestamps from CoinGecko data (they're [ts, value] pairs)
  const timestamps = btcRes.prices.map(p => p[0]);

  console.log(`  ✓ BTC: ${btcPrices.length} days`);
  console.log(`  ✓ ETH: ${ethPrices.length} days`);
  console.log(`  ✓ Dominance: ${btcDominance.length} days`);
  console.log(`  ✓ Fear&Greed: ${fearGreed.length} days`);

  // Dynamically import the regime engine
  const regimeSignals = await import('../src/lib/regime/regimeSignals.js');
  const calc = await import('../src/lib/regime/regimeCalculations.js');

  const fredAvailable = Object.values(fred).some(v => Array.isArray(v) && v.length > 0);
  const fgSeries = fearGreed.map(d => d.value).filter(v => v != null);

  // Replay day-by-day for the last 90 days (or as many as we have data for)
  const backfillDays = Math.min(90, btcPrices.length - 100); // need 100 days lookback
  const startIdx = btcPrices.length - backfillDays;

  const history = [];

  console.log(`\nReplaying ${backfillDays} days of regime computation...`);

  for (let i = startIdx; i < btcPrices.length; i++) {
    // Slice data up to day i (as-of simulation)
    const sliceBtcPrice = btcPrices.slice(0, i + 1);
    const sliceEthPrice = ethPrices.slice(0, i + 1);
    const sliceBtcVolume = btcVolumes.slice(0, i + 1);
    const sliceEthBtcRatio = ethBtcRatio.slice(0, i + 1);
    const sliceBtcDominance = btcDominance.slice(0, i + 1);
    const sliceUsdtDominance = usdtDominance.slice(0, i + 1);
    const sliceFg = fgSeries.slice(0, Math.min(i + 1, fgSeries.length));

    // Skip if not enough data
    if (sliceBtcPrice.length < 90) continue;

    try {
      // Compute growth signals
      const growthSignals = regimeSignals.computeGrowthSignals({
        btcPrice: sliceBtcPrice, ethPrice: sliceEthPrice,
        fearGreed: sliceFg, fred, fredAvailable,
      });
      const growthZ = calc.weightedComposite(growthSignals);
      const growthNowcast = calc.computeNowcast([growthZ]);
      const growthLabel = regimeSignals.classifyGrowthRegime(growthZ);

      // Compute inflation signals
      const inflationSignals = regimeSignals.computeInflationSignals({
        btcPrice: sliceBtcPrice, fearGreed: sliceFg, fred, fredAvailable,
      });
      const inflationZ = calc.weightedComposite(inflationSignals);
      const inflationNowcast = calc.computeNowcast([inflationZ]);
      const inflationLabel = regimeSignals.classifyInflationRegime(inflationZ);

      // Compute liquidity signals
      const liquiditySignals = regimeSignals.computeLiquiditySignals({
        btcPrice: sliceBtcPrice, fred, fredAvailable,
      });
      const liquidityZ = calc.weightedComposite(liquiditySignals);
      const liquidityNowcast = calc.computeNowcast([liquidityZ]);
      const liquidityLabel = regimeSignals.classifyLiquidityRegime(liquidityZ);

      // Classify quadrant
      const quadrant = calc.classifyQuadrant(growthNowcast.nowcast, inflationNowcast.nowcast);

      // Compute Ultra6 + OB1 + Allocation
      const macroData = {
        btcPrice: sliceBtcPrice, ethPrice: sliceEthPrice,
        btcDominance: sliceBtcDominance, ethBtcRatio: sliceEthBtcRatio,
        btcVolume: sliceBtcVolume, usdtDominance: sliceUsdtDominance,
      };

      const ultra6 = regimeSignals.computeUltra6(
        macroData, growthNowcast.nowcast, growthNowcast.meZ, quadrant, liquidityLabel
      );
      const ob1 = regimeSignals.computeOB1Signals(macroData);
      const core9Score = regimeSignals.computeCore9Score(macroData, growthSignals);
      const allocation = regimeSignals.computeAllocation(ultra6, ob1, core9Score, sliceBtcPrice);

      // Format date from timestamp
      const date = new Date(timestamps[i]).toISOString().slice(0, 10);

      history.push({
        date,
        quadrant,
        growth: growthLabel,
        inflation: inflationLabel,
        liquidity: liquidityLabel,
        growthNowcast: Math.round(growthNowcast.nowcast * 10) / 10,
        inflationNowcast: Math.round(inflationNowcast.nowcast * 10) / 10,
        liquidityNowcast: Math.round(liquidityNowcast.nowcast * 10) / 10,
        ultra6_score: ultra6.score,
        ultra6_on: ultra6.on,
        ob1_score: ob1.score,
        ob1_on: ob1.on,
        allocation_status: allocation.status,
        allocation_vehicle: allocation.vehicle,
        allocation_conviction: allocation.conviction,
      });
    } catch (e) {
      // Skip days that fail computation
      console.warn(`  ✗ Day ${i}: ${e.message}`);
    }

    if ((i - startIdx) % 10 === 0) {
      console.log(`  ${i - startIdx}/${backfillDays} days computed`);
    }
  }

  console.log(`\n✓ Backfilled ${history.length} days of regime_history`);
  if (history.length > 0) {
    console.log(`  First: ${history[0].date} (${history[0].quadrant})`);
    console.log(`  Last: ${history[history.length - 1].date} (${history[history.length - 1].quadrant})`);
    
    // Show allocation distribution
    const allocCounts = {};
    for (const h of history) {
      const key = `${h.allocation_status} (${h.allocation_conviction})`;
      allocCounts[key] = (allocCounts[key] || 0) + 1;
    }
    console.log('\n  Allocation distribution:');
    for (const [key, count] of Object.entries(allocCounts)) {
      console.log(`    ${key}: ${count} days`);
    }
  }

  // Save output for build_snapshot.js to read as warm start
  const outputPath = path.join(ROOT, 'public', 'regime_history_backfill.json');
  fs.writeFileSync(outputPath, JSON.stringify(history, null, 2));
  console.log(`\n✓ Written to ${outputPath}`);
  console.log('  build_snapshot.js will merge this with live entries on next run.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
