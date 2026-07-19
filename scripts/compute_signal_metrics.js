/**
 * compute_signal_metrics.js — Server-side signal computation for snapshot.json
 *
 * Runs during build_snapshot.js. Computes STRONG/WEAK/NEUTRAL verdicts for:
 *   - BTC (anchor asset, uses funding as confirmation)
 *   - Majors (ETH, SOL, HYPE — uses RS vs BTC as confirmation)
 *   - Cash weight (from Ultra6 macro gates)
 *
 * Uses the pure compute.js module (same as backtester) for consistency.
 *
 * Output: signal_metrics object written to snapshot.json
 */

import { computeSignal, DEFAULT_THRESHOLDS } from '../src/lib/signal/compute.js';

/**
 * Fetch daily candles for a symbol from Binance Vision (free, no key).
 * Used for server-side signal computation during snapshot build.
 */
async function fetchCandles(symbol, days = 400) {
  const binanceSymbol = `${symbol}USDT`;
  const endTime = Date.now();
  const startTime = endTime - days * 86400000;
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1d&startTime=${startTime}&endTime=${endTime}&limit=${days}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(k => ({
      ts: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch funding rate history from Binance Futures (free, no key).
 */
async function fetchFunding(symbol, days = 90) {
  const binanceSymbol = `${symbol}USDT`;
  const endTime = Date.now();
  const startTime = endTime - days * 86400000;
  const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${binanceSymbol}&startTime=${startTime}&endTime=${endTime}&limit=1000`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(f => ({ ts: f.fundingTime, rate: parseFloat(f.fundingRate) }));
  } catch {
    return [];
  }
}

/**
 * Compute signal metrics for BTC + majors.
 */
export async function computeSignalMetrics({
  btcCandles: providedBtcCandles, btcFunding: providedBtcFunding,
  majorAssets: providedMajorAssets = [],
  ultra6 = null, prevSnapshot = null,
}) {
  const asOf = new Date().toISOString();
  const isWeekend = new Date().getUTCDay() === 0 || new Date().getUTCDay() === 6;

  // Fetch BTC data if not provided
  let btcCandles = providedBtcCandles;
  let btcFunding = providedBtcFunding;
  if (!btcCandles || btcCandles.length < 90) {
    console.log('  Signal: Fetching BTC candles + funding from Binance...');
    btcCandles = await fetchCandles('BTC', 400);
    btcFunding = await fetchFunding('BTC', 90);
    console.log(`  Signal: BTC ${btcCandles.length} candles, ${btcFunding.length} funding entries`);
  }

  // ── BTC signal ──────────────────────────────────────────────────────────
  const btcSignal = computeSignal({
    candles: btcCandles,
    fundingHistory: btcFunding,
    isBtc: true,
    thresholds: DEFAULT_THRESHOLDS,
  });

  // ── Majors signals ───────────────────────────────────────────────────────
  const majorSymbols = [
    { symbol: 'ETH', name: 'Ethereum' },
    { symbol: 'SOL', name: 'Solana' },
    { symbol: 'HYPE', name: 'Hyperliquid' },
  ];

  const majorResults = [];
  let strongCount = 0;

  for (const { symbol, name } of majorSymbols) {
    // Check if provided in majorAssets
    const provided = providedMajorAssets.find(a => a.symbol === symbol);
    let candles = provided?.candles;
    let funding = provided?.funding;

    if (!candles || candles.length < 90) {
      // Fetch from Binance (skip HYPE — not on Binance, use Hyperliquid)
      if (symbol !== 'HYPE') {
        candles = await fetchCandles(symbol, 400);
        funding = await fetchFunding(symbol, 90);
      } else {
        // HYPE: try Hyperliquid API
        try {
          const hlRes = await fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'candleSnapshot',
              req: { coin: 'HYPE', interval: '1d', startTime: Date.now() - 400 * 86400000, endTime: Date.now() },
            }),
          });
          if (hlRes.ok) {
            const arr = await hlRes.json();
            candles = arr.map(c => ({ ts: c.t, open: Number(c.o), high: Number(c.h), low: Number(c.l), close: Number(c.c), volume: Number(c.v) }));
          }
        } catch { candles = []; }
      }
    }

    if (!candles || candles.length < 90) {
      majorResults.push({
        symbol, name, verdict: 'NEUTRAL', confidence: 0, stance: 'WAIT',
        close: null, drivers: { error: 'Insufficient data' },
      });
      continue;
    }

    const signal = computeSignal({
      candles,
      fundingHistory: funding || [],
      btcCandles,
      isBtc: false,
      thresholds: DEFAULT_THRESHOLDS,
    });

    majorResults.push({
      symbol, name,
      verdict: signal.verdict, confidence: signal.confidence, stance: signal.stance,
      close: signal.close, drivers: signal.drivers,
    });
    if (signal.verdict === 'STRONG') strongCount++;
  }

  const sectorSummary = `${strongCount}/${majorResults.length} STRONG`;

  // ── Cash weight ──────────────────────────────────────────────────────────
  const ultra6Gates = ultra6?.score ?? 0;
  let cashPct, cashVerdict;
  if (ultra6Gates >= 5) { cashPct = 15; cashVerdict = 'STRONG'; }
  else if (ultra6Gates >= 3) { cashPct = 40; cashVerdict = 'NEUTRAL'; }
  else { cashPct = 70; cashVerdict = 'WEAK'; }

  const signalMetrics = {
    as_of: asOf,
    is_weekend: isWeekend,
    btc_stance: {
      verdict: btcSignal.verdict,
      confidence: btcSignal.confidence,
      stance: btcSignal.stance,
      close_at_signal: btcSignal.close,
      drivers: btcSignal.drivers,
    },
    majors: {
      sector_summary: sectorSummary,
      assets: majorResults,
    },
    cash_weight: {
      verdict: cashVerdict,
      suggested_pct: cashPct,
      ultra6_gates: ultra6Gates,
      rationale: `${ultra6Gates}/6 Ultra6 gates constructive`,
    },
  };

  // ── Signal history ───────────────────────────────────────────────────────
  const today = asOf.slice(0, 10);
  let signalHistory = prevSnapshot?.signal_history || [];
  signalHistory = signalHistory.filter(h => h.date !== today);
  signalHistory.push({
    date: today,
    btc_verdict: btcSignal.verdict,
    btc_confidence: btcSignal.confidence,
    btc_close_at_signal: btcSignal.close,
    majors_strong_count: strongCount,
    cash_pct: cashPct,
    btc_5d_return: null,
    btc_5d_hit: null,
  });
  // Backfill 5-day returns
  for (const entry of signalHistory) {
    if (entry.btc_5d_return === null && entry.btc_close_at_signal && btcSignal.close) {
      const entryDate = new Date(entry.date).getTime();
      const daysAgo = (Date.now() - entryDate) / 86400000;
      if (daysAgo >= 5) {
        entry.btc_5d_return = ((btcSignal.close - entry.btc_close_at_signal) / entry.btc_close_at_signal) * 100;
        entry.btc_5d_hit =
          (entry.btc_verdict === 'STRONG' && entry.btc_5d_return > 0) ||
          (entry.btc_verdict === 'WEAK' && entry.btc_5d_return < 0);
      }
    }
  }
  signalHistory = signalHistory.slice(-90);

  return { signal_metrics: signalMetrics, signal_history: signalHistory };
}
