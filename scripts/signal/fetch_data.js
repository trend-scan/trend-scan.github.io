/**
 * fetch_data.js — Download historical klines + funding from Binance Vision
 *
 * Binance Vision is a free, unthrottled S3 bucket of ZIP/CSV files.
 *   https://data.binance.vision/data/futures/um/monthly/klines/{SYMBOL}/1d/{SYMBOL}-1d-{YYYY-MM}.zip
 *   https://data.binance.vision/data/futures/um/monthly/fundingRate/{SYMBOL}/{SYMBOL}-fundingRate-{YYYY-MM}.zip
 *
 * Downloads monthly files (24 requests per symbol for 2 years), unzips,
 * parses CSV, caches to scripts/signal/data/{SYMBOL}_{type}.json
 *
 * Usage:
 *   node scripts/signal/fetch_data.js
 *
 * NOTE: Binance Vision data is used for BACKTESTING ONLY. The production
 * signal engine (compute_signal_metrics.js) uses OKX/Bybit/Hyperliquid
 * because Binance is geo-blocked from GitHub Actions US runners.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { unzipSync } from 'fflate';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

const BASE = 'https://data.binance.vision/data/futures/um/monthly';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

const START_YEAR = 2023;
const START_MONTH = 7;
const END_YEAR = 2025;
const END_MONTH = 7;

function monthRange(startY, startM, endY, endM) {
  const out = [];
  let y = startY, m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function unzip(buf) {
  const files = unzipSync(buf);
  const name = Object.keys(files)[0];
  return new TextDecoder().decode(files[name]);
}

function parseKlines(csv) {
  const lines = csv.trim().split('\n');
  return lines.map(line => {
    const c = line.split(',');
    return {
      ts: parseInt(c[0], 10),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
      closeTime: parseInt(c[6], 10),
      quoteVolume: parseFloat(c[7]),
      tradeCount: parseInt(c[8], 10),
    };
  }).filter(c => !isNaN(c.close) && c.close > 0);
}

function parseFunding(csv) {
  const lines = csv.trim().split('\n');
  return lines.map(line => {
    const c = line.split(',');
    return { ts: parseInt(c[0], 10), intervalHours: parseInt(c[1], 10), rate: parseFloat(c[2]) };
  }).filter(r => !isNaN(r.rate));
}

async function fetchKlines(symbol) {
  const months = monthRange(START_YEAR, START_MONTH, END_YEAR, END_MONTH);
  const all = [];
  let okCount = 0, failCount = 0;
  for (const { year, month } of months) {
    const mm = String(month).padStart(2, '0');
    const fname = `${symbol}-1d-${year}-${mm}.zip`;
    const url = `${BASE}/klines/${symbol}/1d/${fname}`;
    const cachePath = path.join(DATA_DIR, `${symbol}-1d-${year}-${mm}.csv`);
    if (fs.existsSync(cachePath)) {
      const csv = fs.readFileSync(cachePath, 'utf8');
      all.push(...parseKlines(csv));
      okCount++;
      continue;
    }
    try {
      const zipBuf = await download(url);
      const csv = unzip(zipBuf);
      fs.writeFileSync(cachePath, csv);
      all.push(...parseKlines(csv));
      okCount++;
    } catch (e) {
      failCount++;
      if (failCount <= 3) console.warn(`  ✗ ${symbol} klines ${year}-${mm}: ${e.message}`);
    }
  }
  all.sort((a, b) => a.ts - b.ts);
  const seen = new Set();
  const deduped = all.filter(c => { if (seen.has(c.ts)) return false; seen.add(c.ts); return true; });
  console.log(`  ✓ ${symbol}: ${deduped.length} daily candles (${okCount} months ok, ${failCount} failed)`);
  return deduped;
}

async function fetchFunding(symbol) {
  const months = monthRange(START_YEAR, START_MONTH, END_YEAR, END_MONTH);
  const all = [];
  let okCount = 0, failCount = 0;
  for (const { year, month } of months) {
    const mm = String(month).padStart(2, '0');
    const fname = `${symbol}-fundingRate-${year}-${mm}.zip`;
    const url = `${BASE}/fundingRate/${symbol}/${fname}`;
    const cachePath = path.join(DATA_DIR, `${symbol}-funding-${year}-${mm}.csv`);
    if (fs.existsSync(cachePath)) {
      const csv = fs.readFileSync(cachePath, 'utf8');
      all.push(...parseFunding(csv));
      okCount++;
      continue;
    }
    try {
      const zipBuf = await download(url);
      const csv = unzip(zipBuf);
      fs.writeFileSync(cachePath, csv);
      all.push(...parseFunding(csv));
      okCount++;
    } catch { failCount++; }
  }
  all.sort((a, b) => a.ts - b.ts);
  const seen = new Set();
  const deduped = all.filter(r => { if (seen.has(r.ts)) return false; seen.add(r.ts); return true; });
  console.log(`  ✓ ${symbol} funding: ${deduped.length} entries (${okCount} months ok, ${failCount} failed)`);
  return deduped;
}

async function main() {
  console.log('━━━ Fetching Binance Vision historical data ━━━');
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Range: ${START_YEAR}-${String(START_MONTH).padStart(2,'0')} to ${END_YEAR}-${String(END_MONTH).padStart(2,'0')}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = {};
  for (const symbol of SYMBOLS) {
    console.log(`─ ${symbol} ─`);
    const klines = await fetchKlines(symbol);
    const funding = await fetchFunding(symbol);
    out[symbol] = { klines, funding };
  }
  const cachePath = path.join(DATA_DIR, 'all_data.json');
  fs.writeFileSync(cachePath, JSON.stringify(out));
  const sizeMB = (fs.statSync(cachePath).size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ Cached to ${cachePath} (${sizeMB} MB)`);
  console.log('\n━━━ Summary ━━━');
  for (const [sym, data] of Object.entries(out)) {
    const first = data.klines[0];
    const last = data.klines[data.klines.length - 1];
    console.log(`  ${sym}: ${data.klines.length} candles, ${new Date(first.ts).toISOString().slice(0,10)} → ${new Date(last.ts).toISOString().slice(0,10)}, ${data.funding.length} funding entries`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
