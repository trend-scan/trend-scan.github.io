/**
 * test_boost_architecture.js — Compare boost approaches for the signal engine
 *
 * Tests three configurations:
 *   A. Threshold 8, boosts at 7→8 (current production)
 *   B. Threshold 9, boosts at 7→8 (current walk-forward optimal — boosts don't fire)
 *   C. Threshold 9, boosts restructured to 8→9 (new approach)
 *
 * For each config, reports STRONG hit rate + count across TRAIN/VAL/OOS.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeSignal,
  computeAssetStance,
  mapStanceToVerdict,
  computeMacroZ,
  computeMultiHorizonAlignment,
  adaptiveZWithPctile,
  computeTrendTenure,
  computeAtrExt50ma,
  computeRsVsBtc,
  fundingZScore,
  computeRSI,
  computeOBVSlope,
  computeImpulseZ,
  computeReturns,
} from '../../src/lib/signal/compute.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data', 'historical');

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'DOGE', 'ARB', 'OP', 'INJ', 'SUI', 'NEAR', 'APT', 'TIA'];

const PERIODS = {
  TRAIN: { start: '2022-01-01', end: '2023-06-30' },
  VALIDATION: { start: '2023-07-01', end: '2024-06-30' },
  OOS: { start: '2024-07-01', end: '2025-07-31' },
};

const FORWARD_DAYS = 10;

function loadData(symbol) {
  const klinesPath = path.join(DATA_DIR, symbol, 'klines_1d.json');
  const fundingPath = path.join(DATA_DIR, symbol, 'funding.json');
  try {
    const raw = JSON.parse(fs.readFileSync(klinesPath, 'utf8'));
    // Transform short keys (t,o,h,l,c,v) to long keys (ts,open,high,low,close,volume)
    const klines = raw.map(k => ({
      ts: k.t || k.ts,
      open: k.o ?? k.open,
      high: k.h ?? k.high,
      low: k.l ?? k.low,
      close: k.c ?? k.close,
      volume: k.v ?? k.volume ?? k.vol,
    }));
    const rawFunding = fs.existsSync(fundingPath) ? JSON.parse(fs.readFileSync(fundingPath, 'utf8')) : [];
    const funding = rawFunding.map(f => ({ ts: f.t || f.ts, rate: f.rate }));
    return { klines, funding };
  } catch {
    return { klines: [], funding: [] };
  }
}

function getPeriod(ts) {
  const date = new Date(ts).toISOString().slice(0, 10);
  for (const [name, { start, end }] of Object.entries(PERIODS)) {
    if (date >= start && date <= end) return name;
  }
  return null;
}

/**
 * Compute signal with configurable boost architecture.
 * boostMode: '7to8' (current), '8to9' (restructured), 'none' (no boosts)
 */
function computeSignalWithBoostMode(candles, fundingHistory, btcCandles, isBtc, boostMode, thresholds) {
  if (!candles || candles.length < 90) {
    return { verdict: 'NEUTRAL', confidence: 0, stance: 'WAIT', close: candles?.[candles.length - 1]?.close ?? null };
  }

  const closes = candles.map(c => c.close);
  const asOfTs = candles[candles.length - 1].ts;

  const { z, pctile } = adaptiveZWithPctile(closes, 90, 365, 252);
  const trendTenure = computeTrendTenure(closes);
  const atrExt = computeAtrExt50ma(candles);
  const rsVsBtc = !isBtc && btcCandles ? computeRsVsBtc(candles, btcCandles, 7) : null;
  const fundingZ = fundingZScore(fundingHistory, asOfTs, 90);
  const rsi = computeRSI(closes, 14);
  const obvSlope = computeOBVSlope(candles, 13);
  const impulseZ = computeImpulseZ(closes, 13, 52);
  const returns = computeReturns(closes);
  const macroZ = computeMacroZ(candles, { fastLen: 4, slowLen: 17, volLen: 7 });
  const mhAlignment = computeMultiHorizonAlignment(closes, 0.02);

  // Replicate the stance computation with configurable boosts
  const stretchPositive = z >= 1.0;
  const stretchNegative = z <= -1.0;
  const persistent = trendTenure >= 3;
  const extremePctile = pctile >= 80 || pctile <= 20;
  const persistentOrExtreme = persistent || extremePctile;
  const healthyExtension = atrExt != null && atrExt >= 0 && atrExt <= 5;
  const overextended = atrExt != null && atrExt > 5;
  const deeplyOversold = atrExt != null && atrExt < -3;

  let confirmed = false, crowdingRisk = false;
  if (isBtc) { confirmed = fundingZ < 1.0; crowdingRisk = fundingZ > 2.0; }
  else { confirmed = rsVsBtc?.label === 'OUTPERFORMING'; crowdingRisk = fundingZ > 2.0; }

  const rsiOverbought = rsi > 80;
  const rsiOversold = rsi < 20;
  const obvBearish = obvSlope < -0.1;
  const accelerating = impulseZ > 0.5;
  const decelerating = impulseZ < -0.5;
  const momAlignedBearish = returns && returns.ret5d < 0 && returns.ret20d < 0;

  let stance, confidence;

  if (stretchPositive && persistentOrExtreme && healthyExtension) {
    stance = 'CONSTRUCTIVE';
    confidence = 6;
    if (confirmed) confidence += 2;
    if (pctile >= 80) confidence += 1;
    if (overextended) confidence -= 2;
    if (crowdingRisk) confidence -= 2;
    if (rsiOverbought) confidence -= 1;
    if (decelerating) confidence -= 1;

    if (boostMode === '7to8') {
      // Current: boosts fire at confidence === 7
      if (confidence === 7 && macroZ) {
        if (macroZ.macroZ > 2.5) confidence = 9;
        else if (macroZ.macroZ > 1.5) confidence = 8;
      }
      if (confidence === 7 && mhAlignment?.aligned) {
        confidence = 8;
      }
    } else if (boostMode === '8to9') {
      // Restructured: boosts fire at confidence === 8
      if (confidence === 8 && macroZ) {
        if (macroZ.macroZ > 2.5) confidence = 10;
        else if (macroZ.macroZ > 1.5) confidence = 9;
      }
      if (confidence === 8 && mhAlignment?.aligned) {
        confidence = 9;
      }
      // Also keep 7→8 for macroZ > 2.5 (very strong)
      if (confidence === 7 && macroZ && macroZ.macroZ > 2.5) {
        confidence = 9;
      }
    }
    // boostMode === 'none': no boosts at all
  } else if (stretchNegative && !isBtc) {
    stance = 'DEFENSIVE';
    confidence = 5;
    if (persistent) confidence += 2;
    if (pctile <= 20) confidence += 1;
    if (deeplyOversold) confidence += 1;
    if (confirmed) confidence += 1;
    let bearishGateCount = 0;
    if (rsi < 40) bearishGateCount++;
    if (obvBearish) bearishGateCount++;
    if (momAlignedBearish) bearishGateCount++;
    if (bearishGateCount >= 2) confidence += 1;
    if (rsiOversold) confidence -= 2;
    if (accelerating) confidence -= 1;
  } else if (stretchNegative && isBtc) {
    stance = 'SELECTIVE';
    confidence = 4;
    if (persistent) confidence += 1;
    if (deeplyOversold) confidence += 1;
  } else if (overextended && crowdingRisk) {
    stance = 'DEFENSIVE';
    confidence = 6;
    if (rsiOverbought) confidence += 1;
    if (obvBearish) confidence += 1;
  } else if (stretchPositive && !persistent) {
    stance = 'SELECTIVE';
    confidence = 4;
    if (confirmed) confidence += 1;
    if (rsi > 60) confidence += 1;
  } else if (!stretchPresent && persistent && healthyExtension) {
    stance = 'SELECTIVE';
    confidence = 5;
    if (confirmed) confidence += 1;
    if (obvSlope > 0.1) confidence += 1;
  } else {
    stance = 'WAIT';
    confidence = 2;
  }

  confidence = Math.max(1, Math.min(10, confidence));
  const verdict = mapStanceToVerdict(stance, confidence, thresholds);
  return { verdict, confidence, stance, close: closes[closes.length - 1] };
}

async function main() {
  console.log('━━━ Boost Architecture Comparison ━━━\n');

  // Load all data
  const allData = {};
  for (const sym of SYMBOLS) {
    allData[sym] = loadData(sym);
  }
  const btcData = allData['BTC'];

  // Test configurations
  const configs = [
    { name: 'A: Threshold 8, boosts 7→8 (current prod)', strongThresh: 8, weakThresh: 8, boostMode: '7to8' },
    { name: 'B: Threshold 9, boosts 7→8 (walk-forward opt, boosts inactive)', strongThresh: 9, weakThresh: 8, boostMode: '7to8' },
    { name: 'C: Threshold 9, boosts 8→9 (restructured)', strongThresh: 9, weakThresh: 8, boostMode: '8to9' },
    { name: 'D: Threshold 9, no boosts (pure base)', strongThresh: 9, weakThresh: 8, boostMode: 'none' },
    { name: 'E: Threshold 8, no boosts (pure base at 8)', strongThresh: 8, weakThresh: 8, boostMode: 'none' },
  ];

  for (const config of configs) {
    console.log(`── ${config.name} ──`);

    const thresholds = { STRONG: config.strongThresh, WEAK: config.weakThresh };
    const periodResults = { TRAIN: { strong: [], weak: [] }, VALIDATION: { strong: [], weak: [] }, OOS: { strong: [], weak: [] } };

    for (const sym of SYMBOLS) {
      const symData = allData[sym];
      if (!symData.klines.length) continue;
      const isBtc = sym === 'BTC';

      for (let i = 90; i < symData.klines.length - FORWARD_DAYS; i++) {
        const asOfTs = symData.klines[i].ts;
        const period = getPeriod(asOfTs);
        if (!period) continue;

        const candles = symData.klines.slice(0, i + 1);
        const funding = symData.funding.filter(f => f.ts <= asOfTs);
        const btcCandles = !isBtc ? btcData.klines.filter(c => c.ts < asOfTs) : null;

        const signal = computeSignalWithBoostMode(candles, funding, btcCandles, isBtc, config.boostMode, thresholds);

        // Forward return
        const futureCandles = symData.klines.filter(c => c.ts > asOfTs);
        if (futureCandles.length < FORWARD_DAYS) continue;
        const futureClose = futureCandles[FORWARD_DAYS - 1].close;
        const fwdRet = ((futureClose - signal.close) / signal.close) * 100;

        if (signal.verdict === 'STRONG') {
          periodResults[period].strong.push({ hit: fwdRet > 0, ret: fwdRet, symbol: sym });
        } else if (signal.verdict === 'WEAK') {
          periodResults[period].weak.push({ hit: fwdRet < 0, ret: fwdRet, symbol: sym });
        }
      }
    }

    // Report
    for (const periodName of ['TRAIN', 'VALIDATION', 'OOS']) {
      const pr = periodResults[periodName];
      const sHits = pr.strong.filter(s => s.hit).length;
      const sCount = pr.strong.length;
      const sHitRate = sCount > 0 ? (sHits / sCount * 100).toFixed(1) : '—';
      const sAvg = sCount > 0 ? (pr.strong.reduce((s, x) => s + x.ret, 0) / sCount).toFixed(2) : '—';

      const wHits = pr.weak.filter(w => w.hit).length;
      const wCount = pr.weak.length;
      const wHitRate = wCount > 0 ? (wHits / wCount * 100).toFixed(1) : '—';
      const wAvg = wCount > 0 ? (pr.weak.reduce((s, x) => s + x.ret, 0) / wCount).toFixed(2) : '—';

      console.log(`  ${periodName.padEnd(12)} STRONG: ${String(sCount).padStart(4)} sig, ${String(sHitRate).padStart(5)}% hit, ${String(sAvg).padStart(7)}% avg | WEAK: ${String(wCount).padStart(4)} sig, ${String(wHitRate).padStart(5)}% hit, ${String(wAvg).padStart(7)}% avg`);
    }

    // Overfit check
    const valStrong = periodResults.VALIDATION.strong;
    const oosStrong = periodResults.OOS.strong;
    if (valStrong.length > 0 && oosStrong.length > 0) {
      const valHit = valStrong.filter(s => s.hit).length / valStrong.length;
      const oosHit = oosStrong.filter(s => s.hit).length / oosStrong.length;
      const divergence = Math.abs(valHit - oosHit) * 100;
      console.log(`  Overfit: Val→OOS divergence = ${divergence.toFixed(1)}pp ${divergence > 20 ? '⚠ OVERFIT' : '✓ OK'}`);
    }
    console.log('');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
