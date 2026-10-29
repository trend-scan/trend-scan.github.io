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
 *
 * Task 36 S4 (2026-10-29): OKX silently caps /market/candles at 300 rows per
 * request, so the old single-call fetch (limit 365/400 → effectively 300)
 * truncated the engine's window — live verdicts ran adaptiveZ/percentile on a
 * 300-day history while the backtester used the full series (live horizon
 * panel showed medium/long "insufficient" as the tell; a 300-capped replay
 * matched production verdicts 85% vs 81% full-history). Fix: paginate with
 * the `after` cursor (records strictly older than ts). Fetch limit is 750
 * candles (3 pages × 300): covers every verdict-relevant window (adaptiveZ
 * 365, percentile 90+252, horizon-medium 375) AND the horizon-long stance
 * (740) so the panel no longer shows "insufficient". Graceful degradation:
 * if a later page fails, earlier pages' candles are still returned.
 */
async function fetchOkxCandles(instId, limit) {
  const PER_PAGE = 300; // OKX hard cap per request
  const byTs = new Map(); // dedupe across pages
  let after = null;
  const maxPages = Math.ceil(limit / PER_PAGE);

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ instId, bar: '1D', limit: String(PER_PAGE) });
    if (after != null) params.set('after', String(after));
    try {
      const res = await fetchWithTimeout(`https://www.okx.com/api/v5/market/candles?${params}`, {
        headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' },
      });
      if (!res.ok) break;
      const json = await res.json();
      if (json.code !== '0' || !json.data?.length) break;
      for (const c of json.data) {
        byTs.set(parseInt(c[0]), {
          ts: parseInt(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]),
          low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
        });
      }
      if (json.data.length < PER_PAGE) break; // history exhausted
      // Next page: records strictly older than the oldest we already have.
      after = Math.min(...json.data.map(c => parseInt(c[0])));
    } catch {
      break;
    }
  }

  return [...byTs.values()].sort((a, b) => a.ts - b.ts).slice(-limit);
}

async function fetchCandles(symbol, limit = 365) {
  // OKX SWAP (perps) first — paginated past the 300-row cap (see header note).
  let candles = await fetchOkxCandles(`${symbol}-USDT-SWAP`, limit);
  if (candles.length > 0) return candles;

  // Fall back to OKX SPOT
  candles = await fetchOkxCandles(`${symbol}-USDT`, limit);
  if (candles.length > 0) return candles;

  // Fall back to Bybit (single call allows limit 1000 — no pagination needed)
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
    btcCandles = await fetchCandles('BTC', 750);
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
      candles = await fetchCandles(symbol, 750);
      funding = await fetchFunding(symbol, 90);

      // If OKX/Bybit didn't have it (e.g. HYPE), try Hyperliquid
      if ((!candles || candles.length < 90) && symbol === 'HYPE') {
        try {
          const hlRes = await fetchWithTimeout('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'candleSnapshot',
              req: { coin: 'HYPE', interval: '1d', startTime: Date.now() - 750 * 86400000, endTime: Date.now() },
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
      close: signal.close, drivers: signal.drivers, horizon: signal.horizon,
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

  // ── Signal history ───────────────────────────────────────────────────────
  // Deduplicate by date — observed July 2026: when the workflow runs multiple
  // times in a day, the previous snapshot could already contain a stale
  // entry for today's date. The .filter(h => h.date !== today) handles the
  // today case, but we also walk the history in reverse to dedup any other
  // duplicate dates (keeping the LAST/most-recent entry per date).
  const today = asOf.slice(0, 10);
  let signalHistory = prevSnapshot?.signal_history || [];
  signalHistory = signalHistory.filter(h => h.date !== today);

  // Dedup: walk in reverse, keep first occurrence (most recent) per date
  const deduped = [];
  const seenDates = new Set();
  for (let i = signalHistory.length - 1; i >= 0; i--) {
    if (!seenDates.has(signalHistory[i].date)) {
      deduped.unshift(signalHistory[i]);
      seenDates.add(signalHistory[i].date);
    }
  }
  signalHistory = deduped;

  // ── Run-age (Task 36 S3, 2026-10-29) ──────────────────────────────────
  // "Day N of signal run" = consecutive days holding the same verdict.
  // True OOS (2025-08 → 2026-10): STRONG day 1-3 hit ~50% / ~+1% avg, while
  // day 4+ collapsed to 33.6% / -1.90% (half of all OOS STRONGs were day 4+;
  // the live Oct 2-6 failures were the tail of a 5-week run). Surfacing the
  // run age lets the page de-emphasize stale STRONGs instead of presenting
  // day 40 of a run identically to day 1. Computed AFTER dedup so the
  // previous entry is the true last prior day.
  const prevEntry = signalHistory.length ? signalHistory[signalHistory.length - 1] : null;
  const btcRunDay = prevEntry && prevEntry.btc_verdict === btcSignal.verdict
    ? (prevEntry.btc_run_day || 1) + 1 : 1;

  // Per-asset verdicts (Task 36 S6, 2026-10-29): previously the history kept
  // only BTC's verdict + majors_strong_count — the ETH/SOL/HYPE record lived
  // solely in git commit archaeology, and the 90-day cap erased July. Each
  // entry now persists each major's verdict + confidence + run age.
  const majorsVerdicts = {};
  for (const m of majorResults) {
    const prevM = prevEntry?.majors_verdicts?.[m.symbol];
    const runDay = prevM && prevM.verdict === m.verdict ? (prevM.run_day || 1) + 1 : 1;
    majorsVerdicts[m.symbol] = { verdict: m.verdict, confidence: m.confidence, run_day: runDay };
    m.run_day = runDay;
  }

  const signalMetrics = {
    as_of: asOf,
    is_weekend: isWeekend,
    btc_stance: {
      verdict: btcSignal.verdict,
      confidence: btcSignal.confidence,
      stance: btcSignal.stance,
      close_at_signal: btcSignal.close,
      run_day: btcRunDay,
      drivers: btcSignal.drivers,
      horizon: btcSignal.horizon,
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

  signalHistory.push({
    date: today,
    btc_verdict: btcSignal.verdict,
    btc_confidence: btcSignal.confidence,
    btc_close_at_signal: btcSignal.close,
    btc_run_day: btcRunDay,
    majors_verdicts: majorsVerdicts,
    majors_strong_count: strongCount,
    cash_pct: cashPct,
    btc_5d_return: null,
    btc_5d_hit: null,
    btc_5d_finalized: false,
  });
  // Backfill 5-day returns — from COMPLETED daily candles only.
  // Audit F-14-b-12 (2026-08-26): previously used today's BTC close
  // (btcSignal.close) for ALL entries ≥5 days old, so an entry from 30
  // days ago got a 30-day return labeled as "5-day return". Now uses the
  // BTC close at entryDate + 5 days from the BTC candle history.
  //
  // Task 36 S5 (2026-10-29): the refresh runs ~04:02 UTC, so for an entry
  // exactly 5 days old the first candle at/after targetTs is today's
  // PARTIAL candle — an intraday snapshot, not the final exit (29 of 97
  // recorded entries differed >1pp from the completed-candle exit). Rule
  // now: a candle's close is usable only once its UTC day has closed
  // (ts + 86400000 <= now). Entries whose D+5 candle is still forming are
  // left pending; a later build the same or next day finalizes them. The
  // btc_5d_finalized flag marks exact entries — legacy entries written
  // pre-S5 (no flag) are re-finalized once from completed candles, which
  // repairs the historical partial-candle exits in place.
  const nowMs = Date.now();
  for (const entry of signalHistory) {
    if (entry.btc_5d_finalized || entry.btc_close_at_signal == null) continue;
    const entryDate = new Date(entry.date).getTime();
    const daysAgo = (nowMs - entryDate) / 86400000;
    if (daysAgo < 5) continue;
    // Find the first candle at/after entryDate + 5 days; use its close only
    // if that candle's UTC day has completed. btcCandles is oldest→newest.
    // (750-candle fetch window covers D+5 exits for entries up to ~745 days
    // old — beyond the 365-day history cap, so every entry is covered.)
    const targetTs = entryDate + 5 * 86400000;
    let exitClose = null;
    for (let i = 0; i < btcCandles.length; i++) {
      if (btcCandles[i].ts >= targetTs) {
        if (btcCandles[i].ts + 86400000 <= nowMs) exitClose = btcCandles[i].close;
        break;
      }
    }
    if (exitClose != null) {
      entry.btc_5d_return = ((exitClose - entry.btc_close_at_signal) / entry.btc_close_at_signal) * 100;
      entry.btc_5d_hit =
        (entry.btc_verdict === 'STRONG' && entry.btc_5d_return > 0) ||
        (entry.btc_verdict === 'WEAK' && entry.btc_5d_return < 0);
      entry.btc_5d_finalized = true;
    } else if (entry.btc_5d_return != null) {
      // Legacy value came from a partial candle and the exact candle is
      // still forming — retract it; a later build fills in the exact exit.
      entry.btc_5d_return = null;
      entry.btc_5d_hit = null;
    }
  }
  // Task 36 S6 (2026-10-29): 90 → 365 days. The 90-day cap erased the
  // July 2026 launch record (recovering it required walking 648 git
  // commits); a year of history keeps per-asset evaluation a one-liner.
  signalHistory = signalHistory.slice(-365);

  return { signal_metrics: signalMetrics, signal_history: signalHistory };
}
