/**
 * watchlistEngine.js — data resolution for the Board's Watchlist tab.
 *
 * Per-asset source precedence (per product spec):
 *   1. Hyperliquid live data, when the asset is listed there
 *      (bulk tickers: price / 24h vol / OI / funding; candles for indicators)
 *   2. Other live sources next — the sourceResolver tier chain
 *      (OKX → Bybit → Kraken → Yahoo → Binance → CoinGecko), still live
 *   3. Snapshot data if no live option worked for the asset
 *      (crypto_universe / coingecko_top from /snapshot.json — up to 6h old)
 *
 * Crypto rows reuse boardEngine.computeMetrics so the Watchlist's columns are
 * IDENTICAL in meaning to the Crypto tab's all-assets table (same formulas,
 * same 1D timeframe, same 300-candle window).
 *
 * TradFi rows come straight from tradData.assets (traditionalMarkets.js),
 * whose own engine already prefers live sources and falls back to the
 * server-side snapshot — the same precedence, already implemented.
 *
 * Exports:
 *   fetchWatchlistCryptoData(symbols, snapshotData, opts) → cryptoRows[]
 *   resolveWatchlistTradfi(symbols, tradData)            → tradfiRows[]
 */

import { computeMetrics } from './boardEngine';
import { fetchAllTickers as fetchHyperliquidTickers } from '../scanner/sources/hyperliquid';
import { fetchCandles as resolveCandles } from '../scanner/sourceResolver';

const TIMEFRAME = '1D';
const CANDLE_LIMIT = 300;

// Short label shown in the Src column / row badge
const SOURCE_LABELS = {
  hyperliquid: 'HL',
  okx_perps: 'OKX',
  okx: 'OKX',
  kraken: 'KRAKEN',
  bybit: 'BYBIT',
  yahoo_crypto: 'YAHOO',
  binance_spot: 'BINANCE',
  binance_perps: 'BINANCE',
  coingecko: 'COINGECKO',
  massive: 'MASSIVE',
  snapshot: 'SNAP',
};

export function sourceLabel(sourceId) {
  return SOURCE_LABELS[sourceId] || (sourceId ? String(sourceId).toUpperCase().slice(0, 8) : '?');
}

// ─── Snapshot helpers ────────────────────────────────────────────────────────

/** Market-cap map from snapshot (crypto_universe + coingecko_top), like Board.jsx's OI card. */
function buildMcapMap(snapshotData) {
  const mcaps = {};
  const cu = snapshotData?.crypto_universe;
  if (cu) for (const [sym, c] of Object.entries(cu)) if (c.marketCap) mcaps[sym] = c.marketCap;
  const cg = snapshotData?.coingecko_top;
  if (cg) for (const [sym, c] of Object.entries(cg)) if (c.marketCap && !mcaps[sym]) mcaps[sym] = c.marketCap;
  return mcaps;
}

/** Name lookup from snapshot universes (crypto_universe names, coingecko_top names). */
function buildNameMap(snapshotData) {
  const names = {};
  const cu = snapshotData?.crypto_universe;
  if (cu) for (const [sym, c] of Object.entries(cu)) if (c.name) names[sym] = c.name;
  const cg = snapshotData?.coingecko_top;
  if (cg) for (const [sym, c] of Object.entries(cg)) if (c.name && !names[sym]) names[sym] = c.name;
  return names;
}

/** Percent-point value (e.g. -1.52) → fraction (-0.0152). Null-safe. */
const pctToFraction = (v) => (v == null || !Number.isFinite(v) ? null : v / 100);

/**
 * Snapshot-fallback row — populated ONLY with what the snapshot carries
 * (price for top-100 via coingecko_top, plus multi-horizon returns).
 * Indicator columns (MAs, ATR, RSI, rVOL, ADR, OI/MC) stay null → render as
 * '—' with the SNAP source badge, honestly signalling reduced data.
 *
 * UNITS: crypto_universe (CMC) change1h/24h/7d/30d/60d/90d and coingecko_top
 * change24h/7d/30d are PERCENT-POINTS (e.g. -1.52 = -1.52%) — divided by 100
 * here to match the fractions computeMetrics produces for live rows.
 */
function snapshotCryptoRow(symbol, snapshotData, names) {
  const cg = snapshotData?.coingecko_top?.[symbol] || null;
  const cu = snapshotData?.crypto_universe?.[symbol] || null;
  return {
    symbol,
    name: names[symbol] || symbol,
    theme: null,
    price: cg?.price ?? null,
    sparkline: null,
    ret1d: pctToFraction(cu?.change24h ?? cg?.change24h),
    ret5d: pctToFraction(cu?.change7d ?? cg?.change7d),
    ret20d: pctToFraction(cu?.change30d ?? cg?.change30d),
    ret60d: pctToFraction(cu?.change60d ?? cg?.change60d),
    distMa20: null, distMa50: null,
    atrExt50ma: null, rsi14: null,
    rs_btc_20d: null,
    volRatio: null, adrUsedPct: null,
    oiRatio: null, fundingAnn: null,
    dataSource: 'snapshot',
    live: false,
  };
}

// ─── Crypto resolution ───────────────────────────────────────────────────────

/**
 * Fetch live data for watchlist crypto symbols.
 *
 * @param {string[]} symbols — bare crypto symbols (e.g. ['BTC','HYPE'])
 * @param {object|null} snapshotData — parsed /snapshot.json (for fallback + mcap)
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.onProgress] - optional status callback
 * @returns {Promise<{rows: Array, fetchedAt: string, liveCount: number, snapshotCount: number}>}
 */
export async function fetchWatchlistCryptoData(symbols, snapshotData, opts = {}) {
  const { onProgress } = opts;
  const uniq = [...new Set(symbols.map(s => String(s).toUpperCase()))].filter(Boolean);
  const report = (m) => { if (onProgress) onProgress(m); };

  // 1. Bulk Hyperliquid tickers — one call, gives price/vol/OI/funding for
  //    every HL-listed symbol (also tells us which symbols HL covers).
  report('Fetching Hyperliquid tickers…');
  let hlTickers = new Map();
  try {
    const t = await fetchHyperliquidTickers();
    if (t instanceof Map) hlTickers = t;
  } catch (e) {
    console.warn('[watchlist] Hyperliquid ticker fetch failed:', e.message);
  }

  // 2. Candles for every symbol — resolver with preferredSource='hyperliquid'
  //    sorts HL FIRST, then falls back to the live tier chain (OKX → Bybit →
  //    Kraken → Yahoo → Binance → CoinGecko). BTC is always fetched so
  //    RS/BTC can be computed even if BTC itself isn't on the watchlist.
  report(`Fetching 1D candles for ${uniq.length} assets…`);
  const wanted = uniq.includes('BTC') ? uniq : [...uniq, 'BTC'];
  const candleResults = new Map();   // symbol → { source, candles }
  let idx = 0;
  const CONCURRENCY = 6;
  async function worker() {
    while (idx < wanted.length) {
      const sym = wanted[idx++];
      try {
        const r = await resolveCandles(sym, {
          timeframe: TIMEFRAME,
          limit: CANDLE_LIMIT,
          preferredSource: 'hyperliquid',
          type: 'crypto',
        });
        if (r && r.candles && r.candles.length >= 5) candleResults.set(sym, r);
      } catch { /* source chain exhausted — snapshot fallback */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));

  // 3. Metrics via the exact boardEngine formulas + RS/BTC injection.
  const btcCandles = candleResults.get('BTC');
  const btcMetrics = btcCandles ? computeMetrics(btcCandles.candles) : null;
  const btcRet20d = btcMetrics?.ret20d ?? null;
  // Snapshot BTC 20D proxy (change30d is a PERCENT-point value — /100 to fraction)
  const btcSnapshotRet20d = pctToFraction(snapshotData?.crypto_universe?.BTC?.change30d);

  const mcaps = buildMcapMap(snapshotData);
  const names = buildNameMap(snapshotData);
  const binanceOI = snapshotData?.binance_oi || {};

  const rows = [];
  let liveCount = 0;
  let snapshotCount = 0;

  for (const sym of uniq) {
    const hit = candleResults.get(sym);
    if (hit) {
      const m = computeMetrics(hit.candles);
      if (m) {
        // Live price: prefer the freshest HL mark when HL lists it; otherwise
        // the last candle close (still live — minutes old at 1D cadence).
        const hl = hlTickers.get(sym);
        const price = hl && hl.price > 0 ? hl.price : m.price;
        // OI aggregation: HL live OI + Binance OI from snapshot (≤4h stale),
        // same two-venue floor CryptoTab uses when others are unavailable.
        const hlOiUsd = hl?.openInterestUsd ?? 0;
        const binOiUsd = parseFloat(binanceOI[sym]?.oiUsd || '0') || 0;
        const totalOi = hlOiUsd + binOiUsd;
        const mcap = mcaps[sym] ?? null;
        const oiRatio = (totalOi > 0 && mcap != null && mcap > 0) ? totalOi / mcap : null;
        const funding = hl?.fundingRate ?? null;
        rows.push({
          symbol: sym,
          name: names[sym] || sym,
          theme: null,
          price,
          sparkline: m.sparkline,
          ret1d: m.ret1d, ret5d: m.ret5d, ret20d: m.ret20d, ret60d: m.ret60d,
          distMa20: m.distMa20, distMa50: m.distMa50,
          atrExt50ma: m.atrExt50ma, rsi14: m.rsi14,
          rs_btc_20d: (m.ret20d != null && (btcRet20d ?? btcSnapshotRet20d) != null)
            ? m.ret20d - (btcRet20d ?? btcSnapshotRet20d)
            : null,
          volRatio: m.volRatio,
          adrUsedPct: m.adrUsedPct,
          oiRatio, fundingAnn: funding != null ? funding * 3 * 365 * 100 : null,
          dataSource: hit.source,
          live: true,
        });
        liveCount += 1;
        continue;
      }
    }
    // 3. Snapshot fallback (spec: "snapshot data if no live option for the asset")
    rows.push(snapshotCryptoRow(sym, snapshotData, names));
    snapshotCount += 1;
  }

  return { rows, fetchedAt: new Date().toISOString(), liveCount, snapshotCount };
}

// ─── TradFi resolution ───────────────────────────────────────────────────────

/**
 * Watchlist tradfi rows — filtered from tradData.assets (the same objects the
 * TradFi tab's All Assets table renders; traditionalMarkets.js already applies
 * live-first / snapshot-fallback precedence per asset, tracked in `source`).
 *
 * @param {string[]} symbols
 * @param {object|null} tradData — from buildTradDataFromSnapshot / fetchTradMarketData
 * @returns {Array} rows in watchlist insertion order
 */
export function resolveWatchlistTradfi(symbols, tradData) {
  const wanted = new Set(symbols.map(s => String(s).toUpperCase()));
  const bySym = new Map((tradData?.assets || []).map(a => [String(a.symbol).toUpperCase(), a]));
  const out = [];
  for (const sym of wanted) {
    const a = bySym.get(sym);
    if (a) out.push({ ...a, dataSource: a.source || 'snapshot' });
  }
  return out;
}
