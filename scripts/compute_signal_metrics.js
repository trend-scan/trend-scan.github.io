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
 *
 * Audit A-02 (2026-11-07): bar='1D' candles open on the HONG KONG grid
 * (16:00 UTC — probe: ts % 86400000 === 57600000), because OKX's '1D' is a
 * local-market day. The 5d-exit math below (and every window in the engine)
 * assumes UTC midnights, so recorded "5-day" exits actually closed ~6.7 days
 * after the UTC-midnight entry date (HK D+5 candle opens D+5 16:00Z, closes
 * D+6 16:00Z) — the live scoreboard was ~1.7 days longer-horizon than the
 * Task 36 OOS stats, which used Binance UTC-midnight candles. Fix: use
 * bar='1Dutc' (UTC-midnight grid, ts % 86400000 === 0), aligning the live
 * engine AND the exit grid with the backtested data. Legacy history entries
 * finalized on the HK grid are recomputed once via the btc_5d_grid stamp in
 * the finalization loop below.
 */
async function fetchOkxCandles(instId, limit) {
  const PER_PAGE = 300; // OKX hard cap per request
  const byTs = new Map(); // dedupe across pages
  let after = null;
  const maxPages = Math.ceil(limit / PER_PAGE);

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ instId, bar: '1Dutc', limit: String(PER_PAGE) });
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
 * Downsample hourly funding entries to 8h buckets (audit A-01, 2026-11-07).
 *
 * Hyperliquid pays funding HOURLY; Binance/OKX pay every 8h. fundingZScore's
 * window is entry-count based (slice(-lookback)), and every OOS validation of
 * gate 6 ran on 8h Binance data where 90 entries = trailing ~30 days. Feeding
 * raw hourly entries would silently shrink that window to 90 HOURS (~3.75
 * days) — a different statistic from the one that was validated. Summing each
 * 8-hour bucket's hourly rates produces a Binance-equivalent 8h rate (the
 * total funding paid over the span), so a 90-entry window means ~30 days on
 * both cadences. Entries are stamped at the newest hourly ts inside the
 * bucket; a trailing partial bucket (< 8 entries) is dropped so the
 * "current" rate in the z-score is never an in-progress sum.
 */
function downsampleFundingTo8h(entries) {
  const byBucket = new Map();
  for (const e of entries) {
    const b = Math.floor(e.ts / 28800000); // 8h in ms
    const cur = byBucket.get(b);
    if (cur) { cur.rate += e.rate; cur.ts = Math.max(cur.ts, e.ts); cur.n += 1; }
    else byBucket.set(b, { ts: e.ts, rate: e.rate, n: 1 });
  }
  const out = [...byBucket.values()].sort((a, b) => a.ts - b.ts);
  if (out.length && out[out.length - 1].n < 8) out.pop();
  return out.map(({ ts, rate }) => ({ ts, rate }));
}

/**
 * Fetch funding rate history from Hyperliquid (not geo-blocked, no key needed).
 * Falls back to OKX funding rate if Hyperliquid doesn't have the symbol.
 *
 * Audit A-01 (2026-11-07, Critical): Hyperliquid's fundingHistory endpoint
 * caps at 500 entries per request and returns the OLDEST 500 of the requested
 * window — a [now−90d, now] request came back spanning 2026-08-09..2026-08-30,
 * i.e. data ending 69 DAYS in the past. Since ~Aug 21 (commit 745fe0d) gate 6
 * (fundingZ) was computed on August rates while the OKX fallback never fired
 * (HL always returns non-empty, just stale). Fix: page FORWARD — advance the
 * startTime cursor past the newest entry received and re-request until the
 * window is covered — then downsample hourly → 8h (see above). A staleness
 * check on the freshest entry (warn > 48h) plus the funding_as_of /
 * funding_stale stamps in signal_metrics make a future regression visible
 * in the deployed snapshot, not just CI logs.
 *
 * Robustness: pages are paced (200ms) and retried once — the endpoint
 * transiently rate-limits bursts (observed: page 2+ of a 5-page sweep
 * erroring while single requests succeed moments later). If the HL sweep
 * still ends > 48h stale (partial pagination), we fall through to the OKX
 * fallback rather than returning stale data; stale HL data is only returned
 * as a last resort when OKX also fails — flagged by the warning above.
 */
async function fetchFunding(symbol, days = 90) {
  const endTime = Date.now();
  const startTime = endTime - days * 86400000;
  let hlResult = null; // downsampled 8h entries from HL (fresh or stale)

  // Try Hyperliquid first (has funding history endpoint)
  try {
    const raw = [];
    let cursor = startTime;
    for (let page = 0; page < 40; page++) { // 90d hourly ≈ 2160 entries ≈ 5 pages; 40 = runaway guard
      let arr = null;
      for (let attempt = 0; attempt < 2 && arr == null; attempt++) {
        try {
          const hlRes = await fetchWithTimeout('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'fundingHistory',
              coin: symbol,
              startTime: cursor,
              endTime,
            }),
          });
          if (hlRes.ok) {
            const body = await hlRes.json();
            if (Array.isArray(body) && body.length > 0) arr = body;
            else break; // definitive empty page — no retry
          }
        } catch {}
        if (arr == null && attempt === 0) await new Promise(r => setTimeout(r, 500));
      }
      if (arr == null) break; // page failed twice — keep what we have
      for (const f of arr) raw.push({ ts: f.time, rate: parseFloat(f.fundingRate) });
      if (arr.length < 500) break;          // window exhausted
      const lastTs = arr[arr.length - 1].time;
      if (lastTs <= cursor) break;           // safety: no forward progress
      cursor = lastTs + 1;
      await new Promise(r => setTimeout(r, 200)); // pace the sweep
    }
    if (raw.length > 0) {
      raw.sort((a, b) => a.ts - b.ts);
      // Staleness assert (A-01): the freshest entry must be < 48h old,
      // otherwise gate 6 is computing on a dead feed. Warn loudly here;
      // computeSignalMetrics also stamps funding_as_of / funding_stale into
      // signal_metrics so the condition is visible in the live snapshot.
      const newest = raw[raw.length - 1].ts;
      const ageH = (endTime - newest) / 3600000;
      hlResult = downsampleFundingTo8h(raw);
      if (ageH > 48) {
        console.warn(`  ⚠ ${symbol} funding feed STALE: newest entry ${new Date(newest).toISOString()} (${Math.round(ageH)}h old) — trying OKX fallback (A-01)`);
      } else {
        return hlResult;
      }
    }
  } catch {}

  // Fall back to OKX funding rate (native 8h cadence — already the
  // granularity fundingZScore's entry-count window expects; 100 entries
  // ≈ 33 days, covering the 90-entry ≈ 30-day window). Sorted ascending so
  // fundingZScore's slice(-lookback) takes the NEWEST entries (OKX returns
  // newest-first).
  try {
    const okxUrl = `https://www.okx.com/api/v5/public/funding-rate-history?instId=${symbol}-USDT-SWAP&limit=${Math.min(days * 3, 100)}`;
    const res = await fetchWithTimeout(okxUrl, { headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' } });
    if (res.ok) {
      const json = await res.json();
      if (json.code === '0' && json.data?.length) {
        return json.data
          .map(f => ({ ts: parseInt(f.fundingTime), rate: parseFloat(f.fundingRate) }))
          .sort((a, b) => a.ts - b.ts);
      }
    }
  } catch {}

  // Last resort: stale HL data beats no data (already warned above).
  return hlResult ?? [];
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

  // Funding freshness stamps (A-01, 2026-11-07): gate 6's BTC confirmation
  // (fundingZ < 1 → +2) and the crowding penalty (fundingZ > 2 → −2) are only
  // trustworthy if the funding feed is recent. fetchFunding warns in CI logs;
  // these fields make the condition inspectable in the deployed snapshot
  // (signal_metrics.funding_as_of / funding_stale) without log access.
  const newestFundingTs = Array.isArray(btcFunding) && btcFunding.length
    ? btcFunding[btcFunding.length - 1].ts : null;
  const fundingAsOf = newestFundingTs != null ? new Date(newestFundingTs).toISOString() : null;
  const fundingStale = fundingAsOf == null || (Date.now() - newestFundingTs) > 48 * 3600000;
  if (fundingStale) {
    console.warn(`  ⚠ Signal: BTC funding data STALE (as of ${fundingAsOf ?? 'none'}) — fundingZ gate suspect (A-01)`);
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
    funding_as_of: fundingAsOf,
    funding_stale: fundingStale,
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
  //
  // Audit A-02 (2026-11-07): every exit finalized before today was measured
  // on OKX bar='1D' candles — the HONG KONG grid (16:00 UTC open) — so the
  // "first candle at/after entryDate+5d" rule selected the HK candle opening
  // D+5 16:00Z, whose close lands ~6.7 days after the UTC-midnight entry:
  // recorded "5-day" returns were actually ~6.7-day returns. Candles are now
  // bar='1Dutc' (UTC midnights — the same grid as the Task 36 OOS backtest's
  // Binance data), and every legacy entry is recomputed ONCE via the
  // btc_5d_grid stamp: an exit is final only when stamped btc_5d_grid='utc'.
  // The stamp makes the migration idempotent — after this build, subsequent
  // runs skip already-stamped entries exactly like the finalized flag.
  const nowMs = Date.now();
  for (const entry of signalHistory) {
    if (entry.btc_close_at_signal == null) continue;
    const entryDate = new Date(entry.date).getTime();
    const daysAgo = (nowMs - entryDate) / 86400000;
    if (daysAgo < 5) continue;
    // Already finalized on the UTC grid — nothing to do (A-02 idempotency).
    if (entry.btc_5d_finalized && entry.btc_5d_grid === 'utc') continue;
    // Find the first candle at/after entryDate + 5 days; use its close only
    // if that candle's UTC day has completed. btcCandles is oldest→newest
    // and 1Dutc (A-02), so the selected candle is the UTC day-D+5 candle and
    // its close IS the day-D+5 close. (750-candle fetch window covers D+5
    // exits for entries up to ~745 days old — beyond the 365-day history
    // cap, so every entry is covered.)
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
      entry.btc_5d_grid = 'utc';
    } else if (entry.btc_5d_return != null) {
      // Legacy value came from a partial candle (or the HK grid — A-02) and
      // the exact UTC candle is still forming — retract it; a later build
      // fills in the exact exit. The grid stamp is deliberately NOT set, so
      // the entry is re-processed next run.
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
