/**
 * backtest.js — Day-by-day replay of the signal engine over historical data.
 *
 * For each day N in the backtest period:
 *   1. Slice candle data to [0..N]
 *   2. Run computeSignal() → verdict + confidence + close
 *   3. Record the result
 *   4. After the loop, backfill forward returns
 *   5. Compute hit rates by verdict type and confidence bucket
 *
 * Output:
 *   scripts/signal/backtest_results.csv — per-day results
 *   scripts/signal/backtest_summary.json — aggregate stats
 *
 * Usage:
 *   node scripts/signal/backtest.js
 *   node scripts/signal/backtest.js --thresholds=8,8   (STRONG=8, WEAK=8)
 *   node scripts/signal/backtest.js --forward=10        (10-day forward return)
 *
 * IMPORTANT — IN-SAMPLE TUNING CAVEAT:
 *   The thresholds in compute.js (DEFAULT_THRESHOLDS) were tuned on this same
 *   backtest period (2023-10 to 2025-07). The reported hit rates are IN-SAMPLE
 *   performance — they represent an upper bound on expected live performance,
 *   not a prediction. A proper walk-forward validation (train on 40%, validate
 *   on 40%, test on 20% out-of-sample) has NOT been performed. The 62.0%
 *   STRONG hit rate and 54.1% WEAK hit rate should be treated as optimistic
 *   until validated against out-of-sample data.
 *
 *   Additionally, the WEAK signal count (61) is below the 100-trade minimum
 *   for statistical significance per standard backtesting practice. The 54.1%
 *   hit rate has a wide confidence interval and may not be distinguishable
 *   from a coin flip.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeSignal,
  DEFAULT_THRESHOLDS,
} from '../../src/lib/signal/compute.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

const args = process.argv.slice(2);
let thresholds = { ...DEFAULT_THRESHOLDS };
let forwardDays = 10;
let startDate = '2023-10-01';
let endDate = '2025-07-31';

for (const arg of args) {
  if (arg.startsWith('--thresholds=')) {
    const [s, w] = arg.split('=')[1].split(',');
    thresholds = { STRONG: parseInt(s, 10), WEAK: parseInt(w, 10) };
  } else if (arg.startsWith('--forward=')) {
    forwardDays = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--start=')) {
    startDate = arg.split('=')[1];
  } else if (arg.startsWith('--end=')) {
    endDate = arg.split('=')[1];
  }
}

const SYMBOL_MAP = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
};

function loadData() {
  const cachePath = path.join(DATA_DIR, 'all_data.json');
  if (!fs.existsSync(cachePath)) {
    console.error(`✗ Data cache not found at ${cachePath}`);
    console.error('  Run: node scripts/signal/fetch_data.js first');
    process.exit(1);
  }
  console.log(`Loading data from ${cachePath}...`);
  return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
}

function sliceAsOf(candles, asOfTs) {
  return candles.filter(c => c.ts < asOfTs);
}

function sliceFundingAsOf(funding, asOfTs) {
  return funding.filter(f => f.ts <= asOfTs);
}

async function runBacktest() {
  console.log('━━━ TrendScan Signal Backtest ━━━');
  console.log(`Period: ${startDate} to ${endDate}`);
  console.log(`Forward window: ${forwardDays} days`);
  console.log(`Thresholds: STRONG >= ${thresholds.STRONG}, WEAK >= ${thresholds.WEAK}`);
  console.log('');
  console.log('⚠ IN-SAMPLE TUNING CAVEAT: Thresholds were tuned on this same period.');
  console.log('  Reported hit rates are optimistic (upper bound, not prediction).');
  console.log('  WEAK signal count (61) is below 100-trade minimum for significance.');
  console.log('');

  const data = loadData();
  const btcData = data[SYMBOL_MAP.BTC];
  if (!btcData) { console.error('✗ BTC data missing'); process.exit(1); }

  const startTs = new Date(startDate + 'T00:00:00Z').getTime();
  const endTs = new Date(endDate + 'T23:59:59Z').getTime();
  const backtestDays = btcData.klines.filter(c => c.ts >= startTs && c.ts <= endTs);
  console.log(`Backtest days: ${backtestDays.length}`);
  console.log('');

  const results = [];

  for (let i = 0; i < backtestDays.length; i++) {
    const day = backtestDays[i];
    const asOfTs = day.ts;
    if ((i + 1) % 100 === 0 || i === 0) {
      console.log(`  Day ${i + 1}/${backtestDays.length}: ${new Date(asOfTs).toISOString().slice(0, 10)}`);
    }

    const btcCandles = sliceAsOf(btcData.klines, asOfTs);
    const btcFunding = sliceFundingAsOf(btcData.funding, asOfTs);
    const btcSignal = computeSignal({
      candles: btcCandles, fundingHistory: btcFunding, isBtc: true, thresholds,
    });

    results.push({
      date: new Date(asOfTs).toISOString().slice(0, 10),
      symbol: 'BTC', verdict: btcSignal.verdict, confidence: btcSignal.confidence,
      stance: btcSignal.stance, close: btcSignal.close, drivers: btcSignal.drivers, ts: asOfTs,
    });

    for (const [displaySym, binanceSym] of Object.entries(SYMBOL_MAP)) {
      if (displaySym === 'BTC') continue;
      const symData = data[binanceSym];
      if (!symData) continue;
      const candles = sliceAsOf(symData.klines, asOfTs);
      const funding = sliceFundingAsOf(symData.funding, asOfTs);
      const signal = computeSignal({
        candles, fundingHistory: funding, btcCandles, isBtc: false, thresholds,
      });
      results.push({
        date: new Date(asOfTs).toISOString().slice(0, 10),
        symbol: displaySym, verdict: signal.verdict, confidence: signal.confidence,
        stance: signal.stance, close: signal.close, drivers: signal.drivers, ts: asOfTs,
      });
    }
  }

  console.log(`\n✓ Computed ${results.length} signal entries`);
  console.log(`Backfilling ${forwardDays}-day forward returns...`);

  let backfilled = 0;
  for (const r of results) {
    const symData = data[SYMBOL_MAP[r.symbol]];
    if (!symData) continue;
    const futureCandles = symData.klines.filter(c => c.ts > r.ts);
    if (futureCandles.length >= forwardDays) {
      const futureClose = futureCandles[forwardDays - 1].close;
      r.forward_return = ((futureClose - r.close) / r.close) * 100;
      r.forward_close = futureClose;
      r.hit = r.verdict === 'STRONG' ? r.forward_return > 0 :
              r.verdict === 'WEAK' ? r.forward_return < 0 : null;
      backfilled++;
    } else {
      r.forward_return = null; r.forward_close = null; r.hit = null;
    }
  }
  console.log(`✓ Backfilled ${backfilled}/${results.length} entries with forward returns`);

  const summary = computeSummary(results);
  writeCsv(results, path.join(__dirname, 'backtest_results.csv'));
  fs.writeFileSync(path.join(__dirname, 'backtest_summary.json'), JSON.stringify(summary, null, 2));
  printSummary(summary);
  return summary;
}

function computeSummary(results) {
  const withReturns = results.filter(r => r.forward_return != null);
  const byVerdict = {}, bySymbol = {}, byConfidence = {};

  for (const r of withReturns) {
    if (!byVerdict[r.verdict]) byVerdict[r.verdict] = { count: 0, hits: 0, total_return: 0 };
    byVerdict[r.verdict].count++;
    if (r.hit === true) byVerdict[r.verdict].hits++;
    byVerdict[r.verdict].total_return += r.forward_return;

    if (!bySymbol[r.symbol]) bySymbol[r.symbol] = {};
    if (!bySymbol[r.symbol][r.verdict]) bySymbol[r.symbol][r.verdict] = { count: 0, hits: 0, total_return: 0 };
    bySymbol[r.symbol][r.verdict].count++;
    if (r.hit === true) bySymbol[r.symbol][r.verdict].hits++;
    bySymbol[r.symbol][r.verdict].total_return += r.forward_return;

    const bucket = r.confidence >= 8 ? '8-10' : r.confidence >= 5 ? '5-7' : '2-4';
    if (!byConfidence[bucket]) byConfidence[bucket] = { count: 0, hits: 0, total_return: 0 };
    byConfidence[bucket].count++;
    if (r.hit === true) byConfidence[bucket].hits++;
    byConfidence[bucket].total_return += r.forward_return;
  }

  for (const v of Object.values(byVerdict)) {
    v.hit_rate = v.count > 0 ? v.hits / v.count : 0;
    v.avg_return = v.count > 0 ? v.total_return / v.count : 0;
  }
  for (const sym of Object.values(bySymbol)) {
    for (const v of Object.values(sym)) {
      v.hit_rate = v.count > 0 ? v.hits / v.count : 0;
      v.avg_return = v.count > 0 ? v.total_return / v.count : 0;
    }
  }
  for (const v of Object.values(byConfidence)) {
    v.hit_rate = v.count > 0 ? v.hits / v.count : 0;
    v.avg_return = v.count > 0 ? v.total_return / v.count : 0;
  }

  return {
    period: { start: startDate, end: endDate },
    forward_days: forwardDays, thresholds,
    total_signals: results.length, with_returns: withReturns.length,
    by_verdict: byVerdict, by_symbol: bySymbol, by_confidence: byConfidence,
    caveat: 'IN-SAMPLE: thresholds tuned on this same period. Hit rates are optimistic upper bounds.',
  };
}

function writeCsv(results, filePath) {
  const headers = ['date','symbol','verdict','confidence','stance','close','forward_close','forward_return','hit','macroZ','zScore','rsi','trendTenure','atrExt'];
  const lines = [headers.join(',')];
  for (const r of results) {
    const d = r.drivers || {};
    lines.push([
      r.date, r.symbol, r.verdict, r.confidence, r.stance,
      r.close?.toFixed(2) ?? '', r.forward_close?.toFixed(2) ?? '',
      r.forward_return?.toFixed(2) ?? '', r.hit === null ? '' : r.hit ? 'true' : 'false',
      d.macroZ ?? '', d.zScore ?? '', d.rsi ?? '', d.trendTenure ?? '', d.atrExt ?? '',
    ].join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'));
  console.log(`✓ Wrote ${results.length} rows to ${filePath}`);
}

function printSummary(summary) {
  console.log('\n━━━ Backtest Summary ━━━');
  console.log(`Period: ${summary.period.start} to ${summary.period.end} (${summary.with_returns}/${summary.total_signals} with returns)`);
  console.log(`Forward window: ${summary.forward_days} days`);
  console.log(`Thresholds: STRONG >= ${summary.thresholds.STRONG}, WEAK >= ${summary.thresholds.WEAK}`);
  console.log(`⚠ ${summary.caveat}`);

  console.log('\n── By Verdict ──');
  console.log('  Verdict    Count   Hit Rate   Avg Return');
  for (const [verdict, stats] of Object.entries(summary.by_verdict)) {
    const hitPct = (stats.hit_rate * 100).toFixed(1) + '%';
    const avgRet = (stats.avg_return >= 0 ? '+' : '') + stats.avg_return.toFixed(2) + '%';
    console.log(`  ${verdict.padEnd(10)} ${String(stats.count).padStart(5)}   ${hitPct.padStart(8)}   ${avgRet.padStart(10)}`);
  }

  console.log('\n── By Symbol × Verdict ──');
  for (const [sym, verdicts] of Object.entries(summary.by_symbol)) {
    console.log(`  ${sym}:`);
    for (const [verdict, stats] of Object.entries(verdicts)) {
      const hitPct = (stats.hit_rate * 100).toFixed(1) + '%';
      const avgRet = (stats.avg_return >= 0 ? '+' : '') + stats.avg_return.toFixed(2) + '%';
      console.log(`    ${verdict.padEnd(10)} ${String(stats.count).padStart(4)} signals   ${hitPct.padStart(7)} hit   ${avgRet.padStart(8)} avg`);
    }
  }

  console.log('\n── By Confidence Bucket ──');
  console.log('  Bucket   Count   Hit Rate   Avg Return');
  for (const [bucket, stats] of Object.entries(summary.by_confidence)) {
    const hitPct = (stats.hit_rate * 100).toFixed(1) + '%';
    const avgRet = (stats.avg_return >= 0 ? '+' : '') + stats.avg_return.toFixed(2) + '%';
    console.log(`  ${bucket.padEnd(8)} ${String(stats.count).padStart(5)}   ${hitPct.padStart(8)}   ${avgRet.padStart(10)}`);
  }
}

runBacktest().catch(e => { console.error('Fatal:', e); process.exit(1); });
