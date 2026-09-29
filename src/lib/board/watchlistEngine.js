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
 * On top of that, fetchWatchlistTradfiLive overlays LIVE prices + 24h moves
 * from OKX's USDT-quoted SWAP perps (instId `${base}-USDT-SWAP`) for the
 * symbols OKX lists, keeping the snapshot's deep-history indicators.
 *
 * Exports:
 *   fetchWatchlistCryptoData(symbols, snapshotData, opts) → cryptoRows[]
 *   resolveWatchlistTradfi(symbols, tradData)            → tradfiRows[]
 *   fetchWatchlistTradfiLive(symbols, tradData)          → live-price Map
 */

import { computeMetrics } from './boardEngine';
import { fetchAllTickers as fetchHyperliquidTickers } from '../scanner/sources/hyperliquid';
import { fetchCandles as resolveCandles } from '../scanner/sourceResolver';
import {
  fetchAllSwapTickers as fetchOkxSwapTickers,
  fetchTicker as fetchOkxTradfiTicker,
} from '../scanner/sources/okxTradfi';

const TIMEFRAME = '1D';
const CANDLE_LIMIT = 300;

// ─── Candle cache (15s refresh support, 2026-09-30) ──────────────────────────
// The Watchlist auto-refreshes every 15s, but only PRICES need per-cycle
// freshness — they come from the bulk ticker layers (HL metaAndAssetCtxs and
// OKX SWAP tickers, both 10s-TTL). 1D-candle indicators (MAs, RSI, sparklines)
// move ~nothing in 15s, and re-downloading 300-candle histories 4×/min per
// symbol is pure bandwidth waste, so resolved candles are reused for 60s.
// Symbols with NO working source are tombstoned for 60s too (entry: null),
// keeping the 15s loop off dead tickers between snapshot refreshes. Trade-off:
// for symbols not covered by a bulk ticker layer (long-tail crypto resolved
// through the per-exchange chain), the displayed price — last candle close —
// can be up to 60s stale; HL-listed symbols' prices stay per-cycle fresh.
const CANDLE_CACHE_TTL_MS = 60 * 1000;
const _candleCache = new Map();  // SYMBOL → { entry: {source, candles} | null, ts }

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
  //    The 60s _candleCache serves repeat cycles of the 15s refresh loop
  //    (see the cache header above) — first cycle pays the full resolution.
  report(`Fetching 1D candles for ${uniq.length} assets…`);
  const wanted = uniq.includes('BTC') ? uniq : [...uniq, 'BTC'];
  const candleResults = new Map();   // symbol → { source, candles }
  let idx = 0;
  const CONCURRENCY = 6;
  async function worker() {
    while (idx < wanted.length) {
      const sym = wanted[idx++];
      const hit = _candleCache.get(sym);
      if (hit && Date.now() - hit.ts < CANDLE_CACHE_TTL_MS) {
        if (hit.entry) candleResults.set(sym, hit.entry);
        continue;  // null entry = known-miss → snapshot fallback this cycle
      }
      try {
        const r = await resolveCandles(sym, {
          timeframe: TIMEFRAME,
          limit: CANDLE_LIMIT,
          preferredSource: 'hyperliquid',
          type: 'crypto',
        });
        if (r && r.candles && r.candles.length >= 5) {
          candleResults.set(sym, r);
          _candleCache.set(sym, { entry: r, ts: Date.now() });
        } else {
          _candleCache.set(sym, { entry: null, ts: Date.now() });
        }
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

// ─── TradFi live uplift — OKX USDT-quoted SWAP perps ─────────────────────────
//
// OKX lists tokenized tradfi instruments as USDT-quoted perpetual swaps —
// instId = `${base}-USDT-SWAP` ("adding the USDT in the request"). Verified
// live 2026-09-29: ~150 of TRAD_UNIVERSE's 484 symbols answer there — mega-cap
// stocks (AAPL NVDA MSFT GOOGL META AMZN …), ETFs (SPY QQQ IWM SMH SOXL …),
// metals (XAU XAG XCU XPD XPT), index perps (US500 US100) and even pre-IPO
// names (OPENAI ANTHROPIC).
//
// BULK-FIRST (2026-09-30, 15s refresh support): one call to
// /market/tickers?instType=SWAP returns every USDT-quoted perp (~478), so any
// watchlist size costs ONE request per refresh regardless of symbol count —
// per-symbol probing would fire N requests per cycle and flirt with OKX's
// 20-req/2s per-IP limit. The bulk map doubles as live listing knowledge:
// new OKX listings light up on the very next 15s cycle, with no negative-cache
// wait. The per-symbol probe path survives as a FALLBACK for when the bulk
// endpoint is unreachable (its misses stay negatively cached, 10 min).
//
// Hybrid data policy — best source per column, mirroring the crypto side's
// HL-live-price + snapshot-OI aggregation:
//   price + 1D  → OKX live (fresh tick; perps trade 24/7, incl. nights and
//                 weekends when the underlying market is closed)
//   indicators  → the row's existing snapshot metrics (Yahoo-sourced deep
//                 history: 200MA / 52W / 60D returns that young OKX perps —
//                 US500 has only ~20 daily candles — cannot provide yet)
//
// Guards:
//   OKX_TRADFI_ALIAS — site symbol → OKX base where the perp ticker differs:
//                      SPX→US500 (S&P index perp) and XPL→XPT (platinum;
//                      OKX's own XPL is the Plasma crypto token, not the
//                      platinum spot the site's XPL stands for).
//   Divergence check — if OKX last deviates >40% from the row's snapshot
//                      price, the instrument is not tracking this asset
//                      (symbol collisions: OKX AI/S are meme tokens trading
//                      at $0.02/$0.04, OKX SPX at $0.41) → keep the snapshot.
//                      Re-checked every cycle — it's pure computation on data
//                      the bulk call already returned, so recovery is instant.

const OKX_TRADFI_ALIAS = { SPX: 'US500', XPL: 'XPT' };
const OKX_TRADFI_MISS_TTL = 10 * 60 * 1000;  // negative-cache misses for 10 min (fallback path)
const OKX_TRADFI_DIVERGENCE = 0.40;           // >40% off snapshot = not tracking
const _okxTradfiMiss = new Map();             // site symbol → miss timestamp (fallback path)

/**
 * Live tradfi prices for watchlist symbols from OKX USDT-quoted SWAP perps.
 *
 * Bulk-first: fetchAllSwapTickers() (one request, 10s TTL) supplies every
 * USDT perp at once; each watchlist symbol is looked up (aliased where
 * needed) and kept only if present AND within 40% of the snapshot's price
 * (collision guard). Callers overlay the returned { price, ret1d, … } onto
 * the snapshot row — indicators stay snapshot. If the bulk endpoint is
 * unreachable, falls back to per-symbol probes (Task 31 path, concurrency 4,
 * 10-min negative cache).
 *
 * @param {string[]} symbols — tradfi watchlist symbols (e.g. ['SPY','SPX'])
 * @param {object|null} tradData — the Board's tradData (snapshot prices for
 *        the divergence guard; null/undefined skips the guard)
 * @returns {Promise<{rows: Map<string, {price,ret1d,high24h,low24h,okxInstId}>, fetchedAt: string}>}
 */
export async function fetchWatchlistTradfiLive(symbols, tradData) {
  const uniq = [...new Set((symbols || []).map(s => String(s).toUpperCase()))].filter(Boolean);
  const snapPrice = new Map(
    (tradData?.assets || [])
      .filter(a => Number(a.price) > 0)
      .map(a => [String(a.symbol).toUpperCase(), a.price])
  );

  const rows = new Map();

  // ── Bulk path: one request covers every USDT-quoted perp ──
  const bulk = await fetchOkxSwapTickers().catch(() => null);
  if (bulk && bulk.size > 0) {
    for (const sym of uniq) {
      const base = OKX_TRADFI_ALIAS[sym] || sym;
      const t = bulk.get(base);
      if (!t || !(t.price > 0)) continue;  // not listed — the map IS the listing knowledge
      const ref = snapPrice.get(sym);
      if (ref != null && Math.abs(t.price / ref - 1) > OKX_TRADFI_DIVERGENCE) {
        continue;  // not tracking this asset — snapshot wins (re-checked next cycle, for free)
      }
      rows.set(sym, {
        price: t.price,
        ret1d: Number.isFinite(t.change24hPct) ? t.change24hPct / 100 : null,
        high24h: Number.isFinite(t.high24h) ? t.high24h : null,
        low24h: Number.isFinite(t.low24h) ? t.low24h : null,
        okxInstId: t.instId || `${base}-USDT-SWAP`,
      });
    }
    return { rows, fetchedAt: new Date().toISOString() };
  }

  // ── Fallback: bulk endpoint unreachable → per-symbol probes ──
  let idx = 0;
  async function worker() {
    while (idx < uniq.length) {
      const sym = uniq[idx++];
      const miss = _okxTradfiMiss.get(sym);
      if (miss != null && Date.now() - miss < OKX_TRADFI_MISS_TTL) continue;

      const base = OKX_TRADFI_ALIAS[sym] || sym;
      let t = null;
      try { t = await fetchOkxTradfiTicker(base); } catch { t = null; }
      if (!t || !(t.price > 0)) {
        _okxTradfiMiss.set(sym, Date.now());  // not listed / delisted — stop probing for 10 min
        continue;
      }
      const ref = snapPrice.get(sym);
      if (ref != null && Math.abs(t.price / ref - 1) > OKX_TRADFI_DIVERGENCE) {
        _okxTradfiMiss.set(sym, Date.now());  // not tracking this asset — snapshot wins
        continue;
      }

      rows.set(sym, {
        price: t.price,
        ret1d: Number.isFinite(t.change24hPct) ? t.change24hPct / 100 : null,
        high24h: Number.isFinite(t.high24h) ? t.high24h : null,
        low24h: Number.isFinite(t.low24h) ? t.low24h : null,
        okxInstId: t.instId || `${base}-USDT-SWAP`,
      });
    }
  }
  if (uniq.length > 0) {
    await Promise.all(Array.from({ length: Math.min(4, uniq.length) }, worker));
  }
  return { rows, fetchedAt: new Date().toISOString() };
}
