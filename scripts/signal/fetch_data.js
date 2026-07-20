/**
 * Historical market data fetcher for the /signal engine.
 *
 * Pulls multi-year daily candles + funding for the TrendScan signal universe
 * from Binance public data sources:
 *
 *   1. Daily klines (OHLCV)        — Binance Vision monthly zips
 *      https://data.binance.vision/data/futures/um/monthly/klines/{SYMBOL}/1d/{SYMBOL}-1d-{YYYY-MM}.zip
 *
 *   2. Mark-price klines (OHLCV at mark price — used for funding accuracy)
 *      https://data.binance.vision/data/futures/um/monthly/markPriceKlines/{SYMBOL}/1d/{SYMBOL}-1d-{YYYY-MM}.zip
 *
 *   3. Funding rate history — Binance Futures public REST API (paginated)
 *      https://fapi.binance.com/fapi/v1/fundingRate?symbol={SYMBOL}&startTime=…&endTime=…&limit=1000
 *      (Binance Vision does NOT host fundingRate archives, so we hit the
 *       live API. Each call returns up to 1000 funding events — ~333 days
 *       at the 8-hour funding cadence — so 4-5 paginated calls cover the
 *       full 3.5-year history per symbol.)
 *
 * Symbols (13 total — covers 4 themes: L1 smart-contract, DeFi, memecoin-adjacent,
 * and modular/alt-L1 momentum):
 *   BTC, ETH, SOL, AVAX, LINK, DOGE, ARB, OP, INJ, SUI, NEAR, APT, TIA
 *
 * Date range: 2022-01 → 2025-07 (covers 2022 bear, 2023 recovery, 2024 halving
 * rally, 2025 distribution — gives every signal a full regime cycle for validation).
 *
 * Notes:
 *   - Several alt-L1s (ARB Mar-2023, OP Aug-2022, APT Oct-2022, SUI May-2023,
 *     TIA Oct-2023) listed after the start date; missing monthly files 404
 *     silently and we just skip them.
 *   - Output is JSON (parsed CSV) under data/historical/{SYMBOL}/ so the
 *     signal engine can read it without a zip dep on the client.
 *   - Re-running the script skips files already on disk (incremental refresh).
 *
 * Usage:
 *   node scripts/signal/fetch_data.js                # full refresh (skip existing)
 *   node scripts/signal/fetch_data.js --force        # re-download everything
 *   node scripts/signal/fetch_data.js --symbols BTC,ETH  # subset
 *   node scripts/signal/fetch_data.js --since 2024-01 # only months >= given YYYY-MM
 *
 * Output: data/historical/{SYMBOL}/{klines_1d,mark_klines_1d,funding}.json
 *         data/historical/_summary.json   (totals + per-symbol stats)
 */

import { unzipSync, strFromU8 } from 'fflate';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(ROOT, 'data', 'historical');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ALL_SYMBOLS = [
  'BTC', 'ETH', 'SOL',           // majors
  'AVAX', 'LINK', 'DOGE',        // mid-cap L1s / oracles / memecoin-adjacent
  'ARB', 'OP',                   // L2 rollups
  'INJ', 'SUI', 'NEAR', 'APT', 'TIA',  // alt-L1 momentum basket
];

const START_MONTH = '2022-01';   // inclusive (bear-market start for validation)
const END_MONTH   = '2025-07';   // inclusive (latest month with mostly-complete data)

const VISION_BASE = 'https://data.binance.vision/data/futures/um/monthly';
const FAPI_BASE   = 'https://fapi.binance.com/fapi/v1';

// Concurrency limits (Binance Vision is a CDN — generous; FAPI is rate-limited)
const VISION_CONCURRENCY = 8;
const FAPI_CONCURRENCY   = 4;

// ---------------------------------------------------------------------------
// CLI flag parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = { force: false, symbols: null, since: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') flags.force = true;
    else if (a === '--symbols') flags.symbols = argv[++i]?.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--since') flags.since = argv[++i];
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/signal/fetch_data.js [--force] [--symbols BTC,ETH] [--since 2024-01]');
      process.exit(0);
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Yield YYYY-MM strings from start (inclusive) to end (inclusive). */
function* monthsBetween(start, end) {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    yield `${y}-${String(m).padStart(2, '0')}`;
    m++;
    if (m > 12) { m = 1; y++; }
  }
}

/** Convert YYYY-MM to UTC start/end timestamps (ms). */
function monthToRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1);
  const end   = Date.UTC(y, m, 1) - 1; // last ms of the month
  return { start, end };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchArrayBuffer(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 30000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'TrendScan-HistoricalFetcher/1.0', ...(opts.headers || {}) },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
      err.status = res.status;
      err.body = body.slice(0, 200);
      throw err;
    }
    return await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, opts = {}) {
  const buf = await fetchArrayBuffer(url, opts);
  return JSON.parse(new TextDecoder().decode(buf));
}

/** Run async tasks with bounded concurrency. Returns array of settled results. */
async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  let active = 0;
  return new Promise((resolve) => {
    function launch() {
      while (active < concurrency && cursor < items.length) {
        const i = cursor++;
        active++;
        Promise.resolve()
          .then(() => worker(items[i], i))
          .then(
            (v) => { results[i] = { status: 'fulfilled', value: v }; },
            (e) => { results[i] = { status: 'rejected', reason: e }; },
          )
          .finally(() => { active--; if (cursor < items.length) launch(); else if (active === 0) resolve(results); });
      }
    }
    launch();
  });
}

// ---------------------------------------------------------------------------
// Zip / CSV parsing
// ---------------------------------------------------------------------------

/** Unzip a Binance Vision monthly archive and return the inner CSV text. */
function unzipCsv(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const files = unzipSync(bytes);
  // Binance zips contain exactly one .csv file
  const csvName = Object.keys(files).find(name => name.toLowerCase().endsWith('.csv'));
  if (!csvName) throw new Error('No .csv inside zip');
  return strFromU8(files[csvName]);
}

/** Parse Binance kline CSV → array of candle objects. */
function parseKlineCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  // Skip header row
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < 9) continue;
    out.push({
      t: Number(c[0]),   // open_time (ms)
      o: parseFloat(c[1]),
      h: parseFloat(c[2]),
      l: parseFloat(c[3]),
      c: parseFloat(c[4]),
      v: parseFloat(c[5]),
      T: Number(c[6]),   // close_time (ms)
      q: parseFloat(c[7]), // quote_volume
      n: Number(c[8]),   // trade count
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-symbol fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch one monthly zip from Binance Vision.
 * Returns parsed candles (klines) or {__missing:true} if the month doesn't
 * exist for this symbol (e.g. coin listed after this month).
 */
async function fetchVisionMonth(symbol, dataType, ym) {
  // dataType: 'klines' | 'markPriceKlines'
  // Binance Vision stores futures under the {SYMBOL}USDT ticker (with the
  // quote suffix), even though TrendScan uses base symbols internally.
  const ticker  = `${symbol}USDT`;
  const interval = '1d';
  const filename = `${ticker}-1d-${ym}.zip`;
  const url = `${VISION_BASE}/${dataType}/${ticker}/${interval}/${filename}`;
  try {
    const buf = await fetchArrayBuffer(url, { timeout: 20000 });
    const text = unzipCsv(buf);
    return parseKlineCsv(text);
  } catch (e) {
    if (e.status === 404) return { __missing: true };
    // Network / 5xx — rethrow after brief backoff handled by caller
    throw e;
  }
}

/**
 * Fetch funding-rate history for one symbol between [start, end] (ms).
 * Paginates through the Binance FAPI fundingRate endpoint (max 1000 records/call,
 * ~333 days at the 8h funding cadence).
 */
async function fetchFundingRange(symbol, startMs, endMs) {
  const url = `${FAPI_BASE}/fundingRate?symbol=${symbol}USDT&startTime=${startMs}&endTime=${endMs}&limit=1000`;
  const data = await fetchJson(url, { timeout: 15000 });
  if (!Array.isArray(data)) return [];
  return data.map(r => ({
    t:    r.fundingTime,           // ms
    rate: parseFloat(r.fundingRate),
    mp:   r.markPrice ? parseFloat(r.markPrice) : null,
  }));
}

/**
 * Fetch the full funding history for one symbol across all months in [START, END].
 * Uses page-forward pagination: each response gives up to 1000 events; if exactly
 * 1000 came back we advance startTime to lastEvent+1 and continue.
 */
async function fetchFundingHistory(symbol, startMonth, endMonth) {
  const { start: startMs } = monthToRange(startMonth);
  const { end:   endMs   } = monthToRange(endMonth);
  const all = [];
  let cursor = startMs;
  let guard = 0;
  while (cursor < endMs && guard++ < 50) {
    let batch;
    try {
      batch = await fetchFundingRange(symbol, cursor, endMs);
    } catch (e) {
      if (e.status === 400) {
        // Symbol not listed yet / invalid — bail out cleanly
        return all;
      }
      // Transient — back off and retry once
      await new Promise(r => setTimeout(r, 500));
      try {
        batch = await fetchFundingRange(symbol, cursor, endMs);
      } catch (e2) {
        console.warn(`  ⚠ ${symbol} funding @ ${new Date(cursor).toISOString().slice(0,10)}: ${e2.message}`);
        return all;
      }
    }
    if (!batch.length) break;
    all.push(...batch);
    const lastT = batch[batch.length - 1].t;
    if (batch.length < 1000) break;       // got everything
    cursor = lastT + 1;                    // page forward
    if (cursor <= startMs) break;          // safety against infinite loops
  }
  // Dedupe by timestamp (in case ranges overlap)
  const seen = new Set();
  const dedup = [];
  for (const r of all) {
    if (seen.has(r.t)) continue;
    seen.add(r.t);
    dedup.push(r);
  }
  dedup.sort((a, b) => a.t - b.t);
  return dedup;
}

// ---------------------------------------------------------------------------
// Per-symbol driver
// ---------------------------------------------------------------------------

async function fetchSymbol(symbol, months, opts) {
  const symDir = join(OUT_DIR, symbol);
  await mkdir(symDir, { recursive: true });

  const klinePath    = join(symDir, 'klines_1d.json');
  const markKlinePath = join(symDir, 'mark_klines_1d.json');
  const fundingPath  = join(symDir, 'funding.json');

  // Skip if all three files exist and !opts.force
  if (!opts.force &&
      existsSync(klinePath) && existsSync(markKlinePath) && existsSync(fundingPath)) {
    const [k, mk, f] = await Promise.all([
      readFile(klinePath, 'utf8').then(JSON.parse).catch(() => []),
      readFile(markKlinePath, 'utf8').then(JSON.parse).catch(() => []),
      readFile(fundingPath, 'utf8').then(JSON.parse).catch(() => []),
    ]);
    return { symbol, klines: k, markKlines: mk, funding: f, cached: true };
  }

  // 1. Daily klines + mark-price klines (parallel — both are Vision zips)
  const visionTasks = [];
  for (const ym of months) {
    visionTasks.push({ type: 'klines',         ym });
    visionTasks.push({ type: 'markPriceKlines', ym });
  }

  const klinesByMonth = {};
  const markByMonth   = {};
  let vision404 = 0, visionErr = 0;

  const settled = await pool(visionTasks, VISION_CONCURRENCY, async (task) => {
    const key = task.ym;
    try {
      const candles = await fetchVisionMonth(symbol, task.type, task.ym);
      if (candles && candles.__missing) {
        vision404++;
        return;
      }
      if (task.type === 'klines') klinesByMonth[key] = candles;
      else                        markByMonth[key]   = candles;
    } catch (e) {
      visionErr++;
      console.warn(`  ⚠ ${symbol} ${task.type} ${task.ym}: ${e.message}`);
    }
  });
  void settled; // settled array not used directly

  // Flatten months in chronological order
  const klines    = months.flatMap(ym => klinesByMonth[ym] || []);
  const markKlines = months.flatMap(ym => markByMonth[ym]   || []);

  // Dedupe by open_time (months don't overlap, but be safe)
  const dedupeKlines = (arr) => {
    const seen = new Set();
    const out = [];
    for (const k of arr) {
      if (seen.has(k.t)) continue;
      seen.add(k.t);
      out.push(k);
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  };
  const klinesClean    = dedupeKlines(klines);
  const markKlinesClean = dedupeKlines(markKlines);

  // 2. Funding history (paginated REST API)
  let funding = [];
  try {
    funding = await fetchFundingHistory(symbol, months[0], months[months.length - 1]);
  } catch (e) {
    console.warn(`  ⚠ ${symbol} funding: ${e.message}`);
  }

  // 3. Persist
  await writeFile(klinePath,     JSON.stringify(klinesClean),     'utf8');
  await writeFile(markKlinePath, JSON.stringify(markKlinesClean), 'utf8');
  await writeFile(fundingPath,   JSON.stringify(funding),         'utf8');

  const stats = {
    symbol,
    klines: klinesClean,
    markKlines: markKlinesClean,
    funding,
    vision404,
    visionErr,
    cached: false,
  };
  console.log(`  ${symbol}: ${String(klinesClean.length).padStart(4)} klines | ${String(markKlinesClean.length).padStart(4)} mark | ${String(funding.length).padStart(5)} funding events${vision404 ? ` (404s: ${vision404})` : ''}${visionErr ? ` (errs: ${visionErr})` : ''}`);
  return stats;
}

// ---------------------------------------------------------------------------
// File-size reporting
// ---------------------------------------------------------------------------

async function fileSizeBytes(path) {
  try { return (await stat(path)).size; } catch { return 0; }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const symbols = opts.symbols || ALL_SYMBOLS;
  const months = [...monthsBetween(opts.since || START_MONTH, END_MONTH)];

  console.log('━━━ TrendScan Historical Data Fetcher ━━━');
  console.log(`  Symbols:  ${symbols.join(', ')}  (${symbols.length})`);
  console.log(`  Months:   ${months[0]} → ${months[months.length - 1]}  (${months.length} months)`);
  console.log(`  Output:   ${OUT_DIR}`);
  console.log(`  Force:    ${opts.force}`);
  console.log('');

  await mkdir(OUT_DIR, { recursive: true });

  // Fetch symbols sequentially to keep memory bounded (each symbol's data
  // can be a few MB — 13 in parallel would balloon RAM).
  const results = [];
  for (const sym of symbols) {
    try {
      const r = await fetchSymbol(sym, months, opts);
      results.push(r);
    } catch (e) {
      console.error(`  ✗ ${sym} failed: ${e.message}`);
      results.push({ symbol: sym, klines: [], markKlines: [], funding: [], error: e.message });
    }
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log('\n━━━ Summary ━━━');

  const perSymbol = [];
  let totalKlines = 0, totalMark = 0, totalFunding = 0, totalBytes = 0;

  for (const r of results) {
    const symDir = join(OUT_DIR, r.symbol);
    const kSize = await fileSizeBytes(join(symDir, 'klines_1d.json'));
    const mkSize = await fileSizeBytes(join(symDir, 'mark_klines_1d.json'));
    const fSize = await fileSizeBytes(join(symDir, 'funding.json'));
    const symBytes = kSize + mkSize + fSize;
    totalBytes += symBytes;
    totalKlines += r.klines.length;
    totalMark += r.markKlines.length;
    totalFunding += r.funding.length;

    perSymbol.push({
      symbol: r.symbol,
      klines: r.klines.length,
      markKlines: r.markKlines.length,
      funding: r.funding.length,
      firstKline: r.klines[0] ? new Date(r.klines[0].t).toISOString().slice(0, 10) : null,
      lastKline:  r.klines[r.klines.length - 1] ? new Date(r.klines[r.klines.length - 1].t).toISOString().slice(0, 10) : null,
      bytes: symBytes,
      kSize, mkSize, fSize,
      cached: !!r.cached,
      error: r.error || null,
    });
  }

  // Pretty-print table
  const header = ['SYMBOL', 'KLINES', 'MARK', 'FUNDING', 'FIRST', 'LAST', 'SIZE'];
  const rows = perSymbol.map(p => [
    p.symbol,
    String(p.klines),
    String(p.markKlines),
    String(p.funding),
    p.firstKline || '-',
    p.lastKline || '-',
    fmtBytes(p.bytes),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(fmt(header));
  console.log(widths.map(w => '─'.repeat(w)).join('  '));
  for (const r of rows) console.log(fmt(r));
  console.log(widths.map(w => '─'.repeat(w)).join('  '));
  console.log(fmt(['TOTAL', String(totalKlines), String(totalMark), String(totalFunding), '', '', fmtBytes(totalBytes)]));

  // Persist summary JSON
  const summary = {
    generated_at: new Date().toISOString(),
    start_month: months[0],
    end_month: months[months.length - 1],
    months: months.length,
    symbols: symbols,
    totals: {
      klines: totalKlines,
      markKlines: totalMark,
      fundingEvents: totalFunding,
      bytes: totalBytes,
      bytesHuman: fmtBytes(totalBytes),
    },
    per_symbol: perSymbol,
  };
  await writeFile(join(OUT_DIR, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\nWrote ${join(OUT_DIR, '_summary.json')}`);
  console.log(`Total data: ${fmtBytes(totalBytes)} across ${symbols.length} symbols`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
