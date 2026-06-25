#!/usr/bin/env node
/**
 * build_snapshot.js — Daily pre-build of macro + crypto data.
 *
 * Runs in GitHub Actions daily (and on every push to main).
 * Output: public/snapshot.json — a single JSON file consumed by the browser.
 *
 * What this script fetches server-side (using secrets):
 *   - FRED macro series (uses FRED_API_KEY from environment)
 *   - Top 100 crypto market data from CoinGecko (no key)
 *
 * What this script does NOT do:
 *   - Compute regime signals (the client does that — same code path as live mode)
 *   - Fetch tradfi OHLC (the resolver does that client-side via OKX/Lighter)
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

const FRED_API_KEY = process.env.FRED_API_KEY;
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━ Building TrendScan snapshot ━━━');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`FRED_API_KEY: ${FRED_API_KEY ? '✓ set' : '✗ not set'}`);
  console.log('');

  const [fred, coingecko, fearGreed, kenFrench] = await Promise.all([
    fetchAllFred(),
    fetchCoinGeckoTop(),
    fetchFearGreed(),
    fetchKenFrench(),
  ]);

  const snapshot = {
    generated_at: new Date().toISOString(),
    fred,
    coingecko_top: coingecko,
    fear_greed: fearGreed,
    ken_french: kenFrench,
  };

  // Stats
  const fredCount = Object.keys(fred).filter(k => fred[k].length > 0).length;
  console.log('');
  console.log('━━━ Snapshot summary ━━━');
  console.log(`  FRED series populated:  ${fredCount}/${Object.keys(FRED_SERIES).length}`);
  console.log(`  CoinGecko coins:        ${Object.keys(coingecko).length}`);
  console.log(`  Fear & Greed days:      ${fearGreed.length}`);
  console.log(`  Ken French months:      ${kenFrench.length}`);
  console.log(`  Total size:             ${JSON.stringify(snapshot).length.toLocaleString()} bytes`);

  // Write to public/snapshot.json (gets committed to repo, served from /)
  const outDir = path.join(ROOT, 'public');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'snapshot.json');
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`  Written to:             ${path.relative(ROOT, outPath)}`);
  console.log('');
  console.log('✓ Done.');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
