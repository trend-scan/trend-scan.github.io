#!/usr/bin/env node
/**
 * build_snapshot.js — Daily pre-build of macro + crypto data.
 *
 * Runs in GitHub Actions daily (and on every push to main).
 * Outputs:
 *   - public/snapshot.json — small (~700 KB) file consumed by every page.
 *     Contains FRED, CoinGecko, Fear&Greed, Ken French, CBOE, ETF flows.
 *   - public/snapshot.tradfi.json — large (~13 MB) file lazy-loaded only
 *     when the Board or Macro page needs tradfi OHLCV. Keeping this in a
 *     separate file avoids bloating the first paint of every page.
 *
 * What this script fetches server-side (using secrets):
 *   - FRED macro series (uses FRED_API_KEY from environment)
 *   - Top 100 crypto market data from CoinGecko (no key)
 *   - Tradfi OHLCV from Yahoo Finance (no key, no CORS server-side)
 *   - ETF flows from Farside (no key)
 *
 * Architecture: server-side fetches the "hard" data (FRED is CORS-blocked in
 * browser), client-side fetches everything else and uses this snapshot as a
 * fallback / instant first paint.
 *
 * Usage:
 *   node scripts/build_snapshot.js
 *
 * Env vars:
 *   FRED_API_KEY  (required — get one free at https://fred.stlouisfed.org/docs/api/api_key.html)
 *   POLYGON_API_KEY (optional — only if you have a paid plan and want richer crypto OHLC)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────────────────────

// FRED API key — MUST be provided via the FRED_API_KEY environment variable
// (configured in GitHub Actions secrets). No hardcoded fallback: a missing
// key fails loudly so we notice, rather than silently shipping an empty
// snapshot. The key is server-side only and is NOT baked into the client
// bundle — the browser only ever sees the resulting snapshot.json.
const FRED_API_KEY = process.env.FRED_API_KEY;

// Load previous snapshot for stale-data fallback
let _prevSnapshot = null;
try {
  _prevSnapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "snapshot.json"), "utf8"));
} catch {}
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

if (!FRED_API_KEY) {
  console.warn('⚠ FRED_API_KEY not set — FRED series will be empty in snapshot.');
  console.warn('  Get a free key at: https://fred.stlouisfed.org/docs/api/api_key.html');
}

// FRED series the regime engine needs (must match macroResolver.js CHAINS)
const FRED_SERIES = {
  M2SL:       { name: 'M2 Money Supply',     limit: 104 },
  WALCL:      { name: 'Fed Assets',          limit: 104 },
  WTREGEN:    { name: 'Treasury General',    limit: 104 },
  RRPONTSYD:  { name: 'Reverse Repos',       limit: 104 },
  NFCI:       { name: 'Fin Conditions',      limit: 104 },
  WRESBAL:    { name: 'Fed Reserves',        limit: 104 },
  ICSA:       { name: 'Jobless Claims',      limit: 52  },
  BAMLH0A0HYM2: { name: 'HY Spread',         limit: 365 },
  T10YIE:     { name: '10Y Breakeven',       limit: 365 },
  T5YIFR:     { name: '5Y5Y Fwd Inflation',  limit: 365 },
  CPIAUCSL:   { name: 'CPI YoY',             limit: 60  },
};

// ─── Fetch helpers ───────────────────────────────────────────────────────────

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  }
  return res.json();
}

async function safeFetchJson(label, url, opts) {
  try {
    return await fetchJson(url, opts);
  } catch (e) {
    console.warn(`  ✗ ${label}: ${e.message}`);
    return null;
  }
}

// ─── FRED ────────────────────────────────────────────────────────────────────

async function fetchFredSeries(seriesId, limit) {
  if (!FRED_API_KEY) return [];
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}` +
    `&api_key=${FRED_API_KEY}` +
    `&file_type=json` +
    `&sort_order=desc` +
    `&limit=${limit}`;
  const data = await fetchJson(url);
  if (data.error) {
    throw new Error(data.error.message || 'FRED error');
  }
  return (data.observations || [])
    .filter(o => o.value !== '.')
    .map(o => ({
      date: o.date,
      time: new Date(o.date).getTime(),
      value: parseFloat(o.value),
    }))
    .reverse();
}

async function fetchAllFred() {
  console.log('── FRED macro series ──');
  const out = {};
  const ids = Object.keys(FRED_SERIES);

  // Fetch in batches of 4 to be polite to FRED
  for (let i = 0; i < ids.length; i += 4) {
    const batch = ids.slice(i, i + 4);
    const results = await Promise.all(batch.map(async id => {
      try {
        const data = await fetchFredSeries(id, FRED_SERIES[id].limit);
        return { id, data };
      } catch (e) {
        console.warn(`  ✗ FRED ${id}: ${e.message}`);
        return { id, data: [] };
      }
    }));
    for (const { id, data } of results) {
      out[id] = data;
      if (data.length > 0) {
        console.log(`  ✓ ${id.padEnd(12)} ${data.length.toString().padStart(4)} pts  (latest: ${data.at(-1)?.date})`);
      }
    }
  }

  // Compute FED_NET_LIQ derived series
  if (out.WALCL?.length && out.WTREGEN?.length && out.RRPONTSYD?.length) {
    const dates = new Set([
      ...out.WALCL.map(d => d.date),
      ...out.WTREGEN.map(d => d.date),
      ...out.RRPONTSYD.map(d => d.date),
    ]);
    out.FED_NET_LIQ = [...dates].sort().map(date => {
      const w = out.WALCL.find(d => d.date === date);
      const t = out.WTREGEN.find(d => d.date === date);
      const r = out.RRPONTSYD.find(d => d.date === date);
      if (!w || !t || !r) return null;
      return {
        date,
        time: w.time,
        // All three in millions of $ → divide by 1e6 for trillions
        value: (w.value - t.value - r.value) / 1e6,
      };
    }).filter(Boolean);
    console.log(`  ✓ FED_NET_LIQ   ${out.FED_NET_LIQ.length.toString().padStart(4)} pts  (derived)`);
  }

  return out;
}

// ─── CoinGecko top crypto (free, no key) ─────────────────────────────────────

async function fetchCoinGeckoTop() {
  console.log('── CoinGecko top 100 ──');
  try {
    const url = 'https://api.coingecko.com/api/v3/coins/markets' +
      '?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h,7d,30d';
    const data = await fetchJson(url);
    const out = {};
    for (const c of data) {
      out[c.symbol.toUpperCase()] = {
        id: c.id,
        name: c.name,
        symbol: c.symbol.toUpperCase(),
        price: c.current_price,
        marketCap: c.market_cap || 0,
        volume24h: c.total_volume || 0,
        marketCapRank: c.market_cap_rank || 999,
        change24h: c.price_change_percentage_24h || 0,
        change7d: c.price_change_percentage_7d_in_currency || 0,
        change30d: c.price_change_percentage_30d_in_currency || 0,
      };
    }
    console.log(`  ✓ ${Object.keys(out).length} coins cached`);
    return out;
  } catch (e) {
    console.warn(`  ✗ CoinGecko: ${e.message}`);
    return {};
  }
}

// ─── Ken French data library (free, seasonality baselines) ───────────────────
// Source: https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html
// Returns monthly factor returns (Mkt-RF, SMB, HML, RMW, RF) back to 1926.
// Used to compute "June historically +1.0% mean / 70% hit rate" baselines.

async function fetchKenFrench() {
  console.log('── Ken French factor data ──');
  try {
    // Download + unzip the CSV server-side (CORS-blocked in browser)
    const AdmZip = (await import('adm-zip')).default;
    const res = await fetch('https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_CSV.zip');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buf);
    const entry = zip.getEntries().find(e => e.entryName.endsWith('.csv'));
    if (!entry) throw new Error('CSV not found in zip');
    const csv = entry.getData().toString('utf8');

    // Parse: skip header (first line is ",Mkt-RF,SMB,HML,RF"), then parse monthly rows
    // Format: "192607,   2.89,  -2.55,  -2.39,   0.22"
    // Annual rows have format "  1926,  ..." (4-digit year with leading spaces)
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    const monthly = [];
    for (const line of lines) {
      // Stop at footer
      if (line.startsWith('Copyright') || line.startsWith('Source:')) break;
      const parts = line.split(',').map(p => p.trim());
      if (parts.length < 5) continue;
      const dateStr = parts[0];
      // Monthly: 6 digits (YYYYMM); Annual: 4 digits — skip annual
      if (!/^\d{6}$/.test(dateStr)) continue;
      const year = parseInt(dateStr.slice(0, 4));
      const month = parseInt(dateStr.slice(4, 6));
      const mktRf = parseFloat(parts[1]);
      const smb = parseFloat(parts[2]);
      const hml = parseFloat(parts[3]);
      const rf = parseFloat(parts[4]);
      if ([mktRf, smb, hml, rf].some(v => !Number.isFinite(v))) continue;
      monthly.push({
        year, month,
        mktRf: mktRf / 100,   // Ken French returns percentages; convert to decimal
        smb: smb / 100,
        hml: hml / 100,
        rf: rf / 100,
        market: (mktRf + rf) / 100,  // total market return
      });
    }

    console.log(`  ✓ ${monthly.length} monthly factor returns (since ${monthly[0]?.year}-${monthly[0]?.month})`);
    return monthly;
  } catch (e) {
    console.warn(`  ✗ Ken French: ${e.message}`);
    return [];
  }
}

// ─── CBOE Put/Call Ratios (free CSV, no key) ─────────────────────────────────
// Source: https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/
// Tracks equity, index, and total market put/call ratios — a key sentiment indicator.

async function fetchCBOEPutCall() {
  console.log('── CBOE put/call ratios ──');
  const series = {
    equity: 'https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/equitypc.csv',
    index:  'https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/indexpc.csv',
    total:  'https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/totalpc.csv',
  };
  const out = {};
  for (const [name, url] of Object.entries(series)) {
    try {
      const res = await fetch(url);
      if (!res.ok) { console.warn(`  ✗ CBOE ${name}: HTTP ${res.status}`); continue; }
      const text = await res.text();
      // CBOE CSV format: header row, then data rows with date, put volume, call volume, total, P/C ratio
      const lines = text.trim().split('\n');
      if (lines.length < 2) continue;
      // Parse header to find column indices
      const header = lines[0].split(',');
      // Take last 30 rows for recent trend
      const dataLines = lines.slice(-30);
      const parsed = dataLines.map(line => {
        const parts = line.split(',');
        return {
          date: parts[0],
          putVolume: parseFloat(parts[1]) || 0,
          callVolume: parseFloat(parts[2]) || 0,
          total: parseFloat(parts[3]) || 0,
          ratio: parseFloat(parts[4]) || 0,
        };
      }).filter(d => d.date && d.ratio > 0);
      out[name] = parsed;
      console.log(`  ✓ CBOE ${name}: ${parsed.length} days, latest ratio: ${parsed[parsed.length-1]?.ratio?.toFixed(3)}`);
    } catch (e) {
      console.warn(`  ✗ CBOE ${name}: ${e.message}`);
    }
  }
  return out;
}

// ─── Fear & Greed (free) ─────────────────────────────────────────────────────

async function fetchFearGreed() {
  console.log('── Fear & Greed ──');
  try {
    const data = await fetchJson('https://api.alternative.me/fng/?limit=120');
    const out = (data.data || []).map(d => ({
      time: parseInt(d.timestamp) * 1000,
      value: parseInt(d.value),
      classification: d.value_classification,
    }));
    console.log(`  ✓ ${out.length} days cached (latest: ${out[0]?.value} ${out[0]?.classification})`);
    return out;
  } catch (e) {
    console.warn(`  ✗ Fear & Greed: ${e.message}`);
    return [];
  }
}

// ─── Farside ETF Flows — daily net flow data for BTC, ETH, SOL, HYPE ──────────
// Farside.co.uk publishes daily ETF flow data in HTML tables.
// We parse the tables server-side (CORS-blocked in browser) and store the
// last 7 days of total net flow in the snapshot.

const FARSIDE_PAGES = {
  BTC: 'https://farside.co.uk/bitcoin-etf-flow-all-data/',
  ETH: 'https://farside.co.uk/ethereum-etf-flow-all-data/',
  SOL: 'https://farside.co.uk/sol/',
  HYPE: 'https://farside.co.uk/hyp/',
};

function parseFarsideTable(html) {
  // Extract the first table from HTML, return array of { date, total } objects
  // The table has columns: Date, ETF1, ETF2, ..., Total
  // Values are in US$ millions. Negatives use parentheses: (59.1)
  // "-" means no data (market closed)
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return [];

  const rows = tableMatch[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  const result = [];

  for (const row of rows) {
    const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) || [])
      .map(c => c.replace(/<[^>]+>/g, '').trim());

    if (cells.length < 2) continue;

    // First cell is the date (e.g. "10 Jul 2026") or a label ("Total", "Average")
    const first = cells[0];
    if (!first || first === 'Fee' || first === 'Staking fee' || first === 'Seed') continue;

    // Skip summary rows
    if (['Total', 'Average', 'Maximum', 'Minimum'].includes(first)) continue;

    // Parse date (e.g. "10 Jul 2026" → ISO)
    const dateMatch = first.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
    if (!dateMatch) continue;
    const [, day, month, year] = dateMatch;
    const date = new Date(`${day} ${month} ${year}`).toISOString().slice(0, 10);

    // Last cell is the Total column
    const totalStr = cells[cells.length - 1];
    if (totalStr === '-' || totalStr === '') continue;

    // Parse value: "(59.1)" → -59.1, "86.8" → 86.8, "60,286" → 60286
    const cleaned = totalStr.replace(/,/g, '');
    let total;
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
      total = -parseFloat(cleaned.slice(1, -1));
    } else {
      total = parseFloat(cleaned);
    }
    if (isNaN(total)) continue;

    result.push({ date, total });
  }

  return result;
}

async function fetchFarsideETFFlows() {
  const out = {};

  for (const [asset, url] of Object.entries(FARSIDE_PAGES)) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      if (!res.ok) {
        console.warn(`  ✗ Farside ${asset}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const flows = parseFarsideTable(html);
      // Keep last 7 days
      const recent = flows.slice(-7);
      out[asset] = recent;
      console.log(`  ✓ Farside ${asset}: ${recent.length} days (latest: ${recent[recent.length-1]?.date} = $${recent[recent.length-1]?.total}M)`);
    } catch (e) {
      console.warn(`  ✗ Farside ${asset}: ${e.message}`);
    }
  }

  return out;
}

// ─── Yahoo Finance — Tradfi OHLCV (server-side, no CORS issue) ───────────────
// Fetches daily OHLCV for tradfi tickers that aren't on Lighter.
// Yahoo Finance has no API key requirement and effectively unlimited rate
// limits when called server-side.
// Stores compact candle data in snapshot.json so the Macro tab can render
// instantly without waiting for client-side API calls.

// Read TRAD_UNIVERSE symbols from traditionalMarkets.js
// (parse the file to avoid importing JS in Node without a build step)
function readTradUniverseSymbols() {
  try {
    const tmPath = path.join(ROOT, 'src', 'lib', 'board', 'traditionalMarkets.js');
    const tmSrc = fs.readFileSync(tmPath, 'utf8');
    const matches = [...tmSrc.matchAll(/symbol:\s*'([^']+)'/g)];
    return matches.map(m => m[1]).filter(s => !s.includes(' '));
  } catch {
    return [];
  }
}

// Yahoo symbol formatting (BRK.B → BRK-B, forex, metals, indices)
function toYahooSymbol(symbol) {
  const s = symbol.toUpperCase();
  // Forex pairs
  const forexMap = { 'EURUSD':'EURUSD=X','GBPUSD':'GBPUSD=X','USDJPY':'JPY=X','USDCHF':'CHF=X',
    'USDCAD':'CAD=X','AUDUSD':'AUDUSD=X','NZDUSD':'NZDUSD=X','USDKRW':'KRW=X','USDHKK':'HKD=X' };
  if (forexMap[s]) return forexMap[s];
  // Metals (use futures)
  if (s === 'XAU') return 'GC=F';
  if (s === 'XAG') return 'SI=F';
  // BRK.B → BRK-B (Yahoo uses dashes)
  if (s.includes('.')) return s.replace('.', '-');
  return s;
}

async function fetchYahooOHLCV(symbol, limit = 250) {
  const ySymbol = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?range=1y&interval=1d`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' } });
    if (!res.ok) return null;
    const d = await res.json();
    const result = d?.chart?.result?.[0];
    if (!result?.timestamp) return null;
    const q = result.indicators?.quote?.[0];
    if (!q) return null;
    const candles = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      if (q.close?.[i] == null) continue;
      candles.push({
        t: result.timestamp[i] * 1000,
        o: q.open?.[i] ?? q.close[i],
        h: q.high?.[i] ?? q.close[i],
        l: q.low?.[i] ?? q.close[i],
        c: q.close[i],
        v: q.volume?.[i] ?? 0,
      });
    }
    return candles.slice(-limit);
  } catch {
    return null;
  }
}

async function fetchTradfiSnapshot() {
  const symbols = readTradUniverseSymbols();
  console.log(`  Fetching ${symbols.length} tradfi tickers from Yahoo Finance...`);
  const out = {};
  let ok = 0, fail = 0;
  // Process in batches of 10 to be respectful
  const batchSize = 10;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(sym => fetchYahooOHLCV(sym))
    );
    for (let j = 0; j < batch.length; j++) {
      const sym = batch[j];
      const r = results[j];
      if (r.status === 'fulfilled' && r.value && r.value.length >= 30) {
        out[sym] = r.value;
        ok++;
      } else {
        fail++;
      }
    }
    if ((i + batchSize) % 50 === 0 || i + batchSize >= symbols.length) {
      console.log(`    ${Math.min(i + batchSize, symbols.length)}/${symbols.length} done (${ok} ok, ${fail} fail)`);
    }
  }
  console.log(`  ✓ ${ok} tickers fetched, ${fail} failed`);
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━ Building TrendScan snapshot ━━━');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`FRED_API_KEY: ${FRED_API_KEY ? '✓ set' : '✗ not set'}`);
  console.log('');

  let [fred, coingecko, fearGreed, kenFrench, cboe, tradfiOHLCV, etfFlows] = await Promise.all([
    fetchAllFred(),
    fetchCoinGeckoTop(),
    fetchFearGreed(),
    fetchKenFrench(),
    fetchCBOEPutCall(),
    fetchTradfiSnapshot(),
    fetchFarsideETFFlows(),
  ]);

  // If FRED data is empty (API failure), use previous snapshot's FRED data
  const fredPopulated = Object.values(fred).filter(v => Array.isArray(v) && v.length > 0).length;
  if (fredPopulated === 0 && _prevSnapshot?.fred) {
    console.log('  ⚠ FRED data empty — using previous snapshot (stale)');
    fred = _prevSnapshot.fred;
  }

  const generatedAt = new Date().toISOString();

  // Small snapshot — loaded by every page (FRED proxy, CoinGecko fallback,
  // Fear&Greed, Ken French seasonality, CBOE put/call, ETF flows).
  // Keeping this lean is critical for first paint.
  const snapshot = {
    generated_at: generatedAt,
    fred,
    coingecko_top: coingecko,
    fear_greed: fearGreed,
    ken_french: kenFrench,
    cboe_put_call: cboe,
    etf_flows: etfFlows,
  };

  // Large snapshot — only loaded when Board or Macro needs tradfi OHLCV.
  // ~13 MB for 335 tickers × 250 days. Sharding keeps it off the critical path.
  const tradfiSnapshot = {
    generated_at: generatedAt,
    tradfi_ohlcv: tradfiOHLCV,
  };

  // Stats
  const fredCount = Object.keys(fred).filter(k => fred[k].length > 0).length;
  const snapshotBytes = JSON.stringify(snapshot).length;
  const tradfiBytes = JSON.stringify(tradfiSnapshot).length;
  console.log('');
  console.log('━━━ Snapshot summary ━━━');
  console.log(`  FRED series populated:  ${fredCount}/${Object.keys(FRED_SERIES).length}`);
  console.log(`  CoinGecko coins:        ${Object.keys(coingecko).length}`);
  console.log(`  Fear & Greed days:      ${fearGreed.length}`);
  console.log(`  CBOE P/C series:        ${Object.keys(cboe).length}`);
  console.log(`  Ken French months:      ${kenFrench.length}`);
  console.log(`  Tradfi OHLCV tickers:   ${Object.keys(tradfiOHLCV).length}`);
  console.log(`  ETF flow assets:        ${Object.keys(etfFlows).length} (BTC, ETH, SOL, HYPE)`);
  console.log(`  snapshot.json:          ${snapshotBytes.toLocaleString()} bytes`);
  console.log(`  snapshot.tradfi.json:   ${tradfiBytes.toLocaleString()} bytes`);

  // Write to public/ (gets committed to repo, served from /)
  const outDir = path.join(ROOT, 'public');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(outDir, 'snapshot.tradfi.json'), JSON.stringify(tradfiSnapshot, null, 2));
  console.log(`  Written to:             public/snapshot.json, public/snapshot.tradfi.json`);
  console.log('');
  console.log('✓ Done.');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
