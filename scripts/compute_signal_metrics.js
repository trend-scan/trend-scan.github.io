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
import { fetchWithTimeout } from '../src/lib/scanner/fetchWithTimeout.js';

/**
 * Fetch daily candles for a symbol from OKX (server-side, no geo-block).
 * Falls back to Bybit if OKX doesn't list the symbol.
 * Same pattern as compute_crypto_factors.js — do NOT use Binance (geo-blocked in US CI).
 */
async function fetchCandles(symbol, limit = 365) {
  // Try OKX SWAP (perps) first
  const okxUrl = `https://www.okx.com/api/v5/market/candles?instId=${symbol}-USDT-SWAP&bar=1D&limit=${Math.min(limit, 300)}`;
  try {
    const res = await fetchWithTimeout(okxUrl, { headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' } });
    if (res.ok) {
      const json = await res.json();
      if (json.code === '0' && json.data?.length) {
        return json.data.slice().reverse().map(c => ({
          ts: parseInt(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
          low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
        }));
      }
    }
  } catch {}

  // Fall back to OKX SPOT
  const okxSpotUrl = `https://www.okx.com/api/v5/market/candles?instId=${symbol}-USDT&bar=1D&limit=${Math.min(limit, 300)}`;
  try {
    const res = await fetchWithTimeout(okxSpotUrl, { headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' } });
    if (res.ok) {
      const json = await res.json();
      if (json.code === '0' && json.data?.length) {
        return json.data.slice().reverse().map(c => ({
          ts: parseInt(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
          low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
        }));
      }
    }
  } catch {}

  // Fall back to Bybit
  const bybitUrl = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}USDT&interval=D&limit=${Math.min(limit, 1000)}`;
  try {
    const res = await fetchWithTimeout(bybitUrl, { headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' } });
    if (res.ok) {
      const json = await res.json();
      if (json.retCode === 0 && json.result?.list?.length) {
        return json.result.list.slice().reverse().map(c => ({
          ts: parseInt(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
          low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
        }));
      }
    }
  } catch {}

  return [];
}

/**
 * Fetch funding rate history from Hyperliquid (not geo-blocked, no key needed).
 * Falls back to OKX funding rate if Hyperliquid doesn't have the symbol.
 */
async function fetchFunding(symbol, days = 90) {
  // Try Hyperliquid first (has funding history endpoint)
  try {
    const startTime = Date.now() - days * 86400000;
    const hlRes = await fetchWithTimeout('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'fundingHistory',
        coin: symbol,
        startTime,
        endTime: Date.now(),
      }),
    });
    if (hlRes.ok) {
      const arr = await hlRes.json();
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map(f => ({ ts: f.time, rate: parseFloat(f.fundingRate) }));
      }
    }
  } catch {}

  // Fall back to OKX funding rate
  try {
    const okxUrl = `https://www.okx.com/api/v5/public/funding-rate-history?instId=${symbol}-USDT-SWAP&limit=${Math.min(days * 3, 100)}`;
    const res = await fetchWithTimeout(okxUrl, { headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' } });
    if (res.ok) {
      const json = await res.json();
      if (json.code === '0' && json.data?.length) {
        return json.data.map(f => ({ ts: parseInt(f.fundingTime), rate: parseFloat(f.fundingRate) }));
      }
    }
  } catch {}

  return [];
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
    console.log('  Signal: Fetching BTC candles + funding from OKX/Bybit...');
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
      // Fetch from OKX/Bybit (not Binance — geo-blocked in US CI)
      candles = await fetchCandles(symbol, 365);
      funding = await fetchFunding(symbol, 90);

      // If OKX/Bybit didn't have it (e.g. HYPE), try Hyperliquid
      if ((!candles || candles.length < 90) && symbol === 'HYPE') {
        try {
          const hlRes = await fetchWithTimeout('https://api.hyperliquid.xyz/info', {
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

  // ── Cash weight (from server-side Ultra6 in regime_history) ──────────────
  // Uses the Ultra6 score computed in computeRegimeHistory (server-side, unified
  // with the Macro page's allocation signal). This ensures the Signal page's
  // cash weight and the Macro page's allocation panel show the same data.
  const latestRegime = prevSnapshot?.regime_history?.[prevSnapshot.regime_history.length - 1];
  const ultra6Gates = latestRegime?.ultra6_score ?? ultra6?.score ?? 0;
  const ultra6On = latestRegime?.ultra6_on ?? false;
  const ob1Score = latestRegime?.ob1_score ?? 0;
  const allocationStatus = latestRegime?.allocation_status ?? 'STABLECOINS';
  const allocationConviction = latestRegime?.allocation_conviction ?? 'NONE';

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
      ultra6_on: ultra6On,
      ob1_score: ob1Score,
      allocation_status: allocationStatus,
      allocation_conviction: allocationConviction,
      rationale: `${ultra6Gates}/6 Ultra6 gates · ${allocationStatus} (${allocationConviction})`,
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
