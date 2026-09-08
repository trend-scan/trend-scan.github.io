/**
 * tradfiScanEngine.js — TradFi scanner mode.
 *
 * Mirrors scanEngine.js's runScan() flow but for the tradfi universe (389 tickers
 * from TRAD_UNIVERSE). Reuses analyzeAsset() from scanEngine.js so all the same
 * technical filters (EMA Fast/Mid/Slow, VWAP, RSI range, price>slow, fast>mid,
 * volume) work identically to crypto mode.
 *
 * Source priority:
 *   1. Binance TRADIFI perps (150 tickers, intraday 15m–1W, CORS *, no VPN)
 *   2. OKX SWAP tradfi perps (54 tickers, intraday 15m–1W)
 *   3. Daily snapshot (382 tickers, 1D only, max 4h stale)
 *
 * Intraday limitation:
 *   The daily snapshot only has 1D candles. If the user selects an intraday
 *   timeframe (15m/30m/1H/4H/12H), only Binance + OKX perp tickers will have
 *   data at that timeframe. The remaining ~230 tickers will be skipped (return
 *   null from analyzeAsset). The UI offers an "Expand to daily" option that
 *   re-runs the scan at 1D to include the full universe.
 */

import { TRAD_UNIVERSE } from '../board/traditionalMarkets';
import { fetchCandles, fetch24hChange, CANDLES_PER_DAY } from './exchanges';
import { calcEMA, calcVWAP, calcRSI } from './calculations';
import { getTradfiPerpSymbols } from './sources/binancePerps';
import { TRADFI_TICKERS as OKX_TRADFI_TICKERS } from './sources/okxTradfi';

// ── Snapshot tradfi loader (mirrors traditionalMarkets.js loadSnapshotTradfi) ──
let _snapCache = null;
async function loadSnapshotTradfi() {
  if (_snapCache) return _snapCache;
  try {
    const res = await fetch('/snapshot.tradfi.json');
    if (!res.ok) return null;
    const snap = await res.json();
    _snapCache = snap?.tradfi_ohlcv || null;
    return _snapCache;
  } catch {
    return null;
  }
}

function candlesFromSnapshot(snapData) {
  if (!snapData || !Array.isArray(snapData)) return null;
  return snapData.map(c => ({
    ts: c.t, open: c.o, high: c.h, low: c.l, close: c.c, vol: c.v,
  }));
}

// ── Determine which source to use for a symbol ──────────────────────────────
// Returns: 'binance_perps' | 'okx_perps' | 'snapshot'
//
// Honors the user's selected exchange:
//   'auto'          → Binance perps if listed, else OKX perps if listed, else snapshot
//   'binance_perps' → Binance perps if listed, else snapshot fallback
//   'okx_perps'     → OKX perps if listed, else snapshot fallback
//   'snapshot'      → always snapshot (daily only)
//
// Binance perps is preferred (150 tickers, intraday, CORS *).
// OKX perps is fallback for the 54 tickers Binance doesn't have (but OKX does).
// Snapshot is fallback for the remaining ~230 tickers (daily only).
async function pickSource(symbol, binanceTradfiSet, exchange) {
  // Explicit snapshot mode — always use snapshot regardless of perp listing
  if (exchange === 'snapshot') return 'snapshot';

  // Explicit Binance perps mode
  if (exchange === 'binance_perps') {
    return binanceTradfiSet.has(symbol) ? 'binance_perps' : 'snapshot';
  }

  // Explicit OKX perps mode
  if (exchange === 'okx_perps') {
    return OKX_TRADFI_TICKERS.has(symbol) ? 'okx_perps' : 'snapshot';
  }

  // Auto mode (default): Binance → OKX → snapshot
  if (binanceTradfiSet.has(symbol)) return 'binance_perps';
  if (OKX_TRADFI_TICKERS.has(symbol)) return 'okx_perps';
  return 'snapshot';
}

// ── Relative Volume (rVol) — duplicated from scanEngine.js (same logic) ──────
function computeRVol(candles, period = 20) {
  if (!candles || candles.length < period + 1) return null;
  const vols = candles.map(c => c.vol || 0);
  const recentSlice = vols.slice(-period - 1, -1);
  if (recentSlice.length < period) return null;
  const sma = recentSlice.reduce((s, v) => s + v, 0) / period;
  if (sma <= 0) return null;
  return vols[vols.length - 1] / sma;
}

// ── analyzeTradFiAsset — adapted from scanEngine.js analyzeAsset ────────────
// Skips crypto-specific filters (chain/sector/maxSupply/marketCap — all rely
// on cgMarketData which we pass as null). Keeps all technical filters:
// price>slow, fast>mid, RSI range, volume (from candle data, not cgMarketData).
async function analyzeTradFiAsset(asset, settings, candleSource) {
  const {
    fastType, emaFast, vwapFastDays, midType, emaMid, vwapMidDays, slowType, emaSlow, vwapDays,
    timeframe, minVolume,
    priceAboveSlowEnabled, fastAboveMidEnabled, minVolumeEnabled,
    rsiEnabled, rsiPeriod, rsiTimeframe, rsiMin, rsiMax,
  } = settings;

  const cpd = CANDLES_PER_DAY[timeframe] || 6;
  const sparklineCandles = 7 * cpd;

  const required = Math.max(
    fastType === 'vwap' ? (vwapFastDays || 3) * cpd : (emaFast || 21),
    midType  === 'vwap' ? (vwapMidDays  || 14) * cpd : (emaMid  || 50),
    slowType === 'vwap' ? (vwapDays     || 30) * cpd : (emaSlow || 200),
    sparklineCandles
  );

  // Fetch candles from the chosen source
  let candles;
  if (candleSource === 'snapshot') {
    // Snapshot is always daily — force timeframe to 1D regardless of user's selection
    const snap = await loadSnapshotTradfi();
    const snapCandles = snap?.[asset.symbol];
    candles = candlesFromSnapshot(snapCandles);
  } else {
    // Binance perps or OKX perps — use user's selected timeframe.
    // Pass `required` as fetch limit + resolver minCandles so a deep VWAP
    // (cap raised 90→365, 2026-09-08) isn't silently starved by the 300-candle
    // source default — deeper sources get a chance to satisfy it.
    candles = await fetchCandles(asset.symbol, candleSource, timeframe, required, required);
  }

  if (!candles || candles.length < required) return null;

  // Sanitize: filter out candles with null/zero/NaN prices
  const cleanCandles = candles.filter(c =>
    c.close != null && c.close > 0 && !isNaN(c.close) &&
    c.high != null && c.high > 0 && c.low != null && c.low > 0
  );
  if (cleanCandles.length < required) return null;

  const closes = cleanCandles.map(c => c.close);

  // Compute EMA/VWAP indicators
  const fast = fastType === 'vwap' ? calcVWAP(cleanCandles, vwapFastDays || 3) : calcEMA(closes, emaFast || 21);
  const mid  = midType  === 'vwap' ? calcVWAP(cleanCandles, vwapMidDays  || 14) : calcEMA(closes, emaMid  || 50);
  const slow = slowType === 'vwap' ? calcVWAP(cleanCandles, vwapDays     || 30) : calcEMA(closes, emaSlow || 200);

  if (fast == null || mid == null || slow == null) return null;

  const price = closes[closes.length - 1];

  // ── Gates (same as crypto mode, minus chain/sector/maxSupply/marketCap) ──
  const passesPriceVsSlow = !priceAboveSlowEnabled || price > slow;
  const passesFastVsMid = !fastAboveMidEnabled || fast > mid;

  // RSI filter (optional, separate timeframe)
  let rsi = null;
  if (rsiEnabled) {
    const rsiTf = rsiTimeframe && rsiTimeframe !== timeframe ? rsiTimeframe : timeframe;
    let rsiCandles;
    if (candleSource === 'snapshot') {
      // Snapshot is always daily — RSI on daily snapshot candles
      rsiCandles = cleanCandles;
    } else {
      rsiCandles = rsiTf !== timeframe
        ? await fetchCandles(asset.symbol, candleSource, rsiTf)
        : cleanCandles;
    }
    if (rsiCandles && rsiCandles.length >= (rsiPeriod || 14) + 1) {
      const rsiCloses = rsiCandles.map(c => c.close);
      rsi = calcRSI(rsiCloses, rsiPeriod || 14);
    }
    if (rsi == null) return null;
    if (rsiMin != null && rsi < rsiMin) return null;
    if (rsiMax != null && rsi > rsiMax) return null;
  }

  if (!passesPriceVsSlow || !passesFastVsMid) return null;

  // ── Volume filter (uses candle volume, not cgMarketData) ──
  // For tradfi, volume comes from the candle data itself (Binance/OKX perp volume
  // or snapshot Yahoo volume). cgMarketData is null in tradfi mode.
  if (minVolumeEnabled && minVolume > 0) {
    // Audit F-14-e-2 (2026-08-26): previously took lastCandle.vol × price as
    // "24h USD volume" — wrong for any non-daily timeframe (4H candle → 4h of
    // volume, 1H → 1h, 1W → 7-day). Now aggregates (vol × close) over the
    // trailing 24h window of candles. For 1D candles this is 1 candle ≈ 24h
    // vol; for 4H it's 6 candles; for 1H it's 24; for 1W the most recent
    // weekly candle is included wholesale (slight over-estimate, acceptable
    // since this filter rejects truly illiquid names, not precise 24h figures).
    const lastCandle = cleanCandles[cleanCandles.length - 1];
    const msPerDay = 24 * 60 * 60 * 1000;
    const since = (lastCandle.ts ?? Date.now()) - msPerDay;
    let vol24hUsd = 0;
    for (const c of cleanCandles) {
      if (c.ts != null && c.ts >= since && c.vol != null && c.close != null) {
        vol24hUsd += (c.vol || 0) * c.close;
      }
    }
    // Fallback: if no candle had a ts (e.g., snapshot candles without ts),
    // use the most-recent candle's vol × price as before — better than nothing.
    if (vol24hUsd === 0 && lastCandle) {
      vol24hUsd = (lastCandle.vol || 0) * price;
    }
    if (vol24hUsd < minVolume) return null;
  }

  // ── 24h change ──
  // For Binance/OKX perps: use fetch24hChange (exchange ticker endpoint).
  // For snapshot: derive from candles directly (fetch24hChange doesn't handle 'snapshot').
  let change24h = null;
  if (candleSource === 'snapshot') {
    if (cleanCandles.length >= 2) {
      const now = Date.now();
      const target = now - 24 * 60 * 60 * 1000;
      let best = cleanCandles[0];
      for (const c of cleanCandles) {
        if (Math.abs(c.ts - target) < Math.abs(best.ts - target)) best = c;
      }
      const open24h = best.open;
      const lastClose = cleanCandles[cleanCandles.length - 1].close;
      if (open24h > 0) change24h = ((lastClose - open24h) / open24h) * 100;
    }
  } else {
    change24h = await fetch24hChange(asset.symbol, candleSource, cleanCandles);
  }
  const sparkline = closes.slice(-sparklineCandles);
  const rVol = computeRVol(cleanCandles, 20);

  return {
    ...asset,
    price,
    emaFast: fast,
    emaMid: mid,
    emaSlow: slow,
    pricePct: (price - slow) / slow * 100,
    emaPct: (fast - mid) / mid * 100,
    change24h,
    sparkline,
    // Tradfi mode: these crypto-specific fields are null
    volume24h: 0,
    marketCap: 0,
    marketCapRank: 999999,
    change1h: null,
    change60d: null,
    change90d: null,
    circulatingSupply: null,
    totalSupply: null,
    maxSupply: null,
    fullyDilutedMarketCap: null,
    numMarketPairs: null,
    dateAdded: null,
    tags: [],
    platform: null,
    category: asset.category || null,  // tradfi category (e.g. 'Semiconductors')
    fundingRate: null,
    openInterest: null,
    openInterestRaw: null,
    oiSources: 0,
    // Relative volume + RSI (same as crypto)
    rVol,
    rsi,
    // Tradfi-specific: which source provided the candles
    source: candleSource,
  };
}

// ── runWithPool — same as scanEngine.js ─────────────────────────────────────
async function runWithPool(tasks, concurrency, onEach) {
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      const result = await tasks[i]();
      onEach(i + 1, result);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// ── Main entry point ────────────────────────────────────────────────────────
export async function runTradFiScan(settings, onProgress) {
  const startTime = Date.now();
  const results = [];
  let scannedCount = 0;
  let matchedCount = 0;
  let skippedIntradayCount = 0;  // tickers skipped because intraday TF + no perp listing

  onProgress({ phase: 'fetching_universe', message: 'Loading tradfi universe (TRAD_UNIVERSE: 389 tickers)…' });

  // Pre-load Binance tradfi perp universe so we know which symbols support intraday
  onProgress({ phase: 'fetching_universe', message: 'Checking Binance + OKX tradfi perp listings…' });
  const binanceTradfiList = await getTradfiPerpSymbols();
  const binanceTradfiSet = new Set(binanceTradfiList);
  const okxTradfiSet = OKX_TRADFI_TICKERS;
  const intradayTickerCount = new Set([...binanceTradfiList, ...okxTradfiSet]).size;

  // Determine if user selected an intraday timeframe
  const isIntraday = !['1D', '1w', '1W'].includes(settings.timeframe);

  const assets = TRAD_UNIVERSE.map(t => ({ symbol: t.symbol, name: t.name, rank: 0, category: t.category, subtheme: t.subtheme, tier: t.tier, type: t.type }));
  const totalAssets = assets.length;

  onProgress({
    phase: 'scanning',
    message: `Scanning ${totalAssets} tradfi tickers · ${settings.timeframe}${isIntraday ? ` (intraday: ${intradayTickerCount} perps, ${totalAssets - intradayTickerCount} daily-only)` : ''}…`,
    done: 0,
    total: totalAssets,
    matched: 0
  });

  const failedAssets = [];
  const tasks = assets.map(asset => async () => {
    const source = await pickSource(asset.symbol, binanceTradfiSet, settings.exchange);

    // If intraday TF + ticker only in snapshot (no perp listing) → skip silently
    // (don't waste API calls on a source that can't provide intraday data)
    if (isIntraday && source === 'snapshot') {
      skippedIntradayCount++;
      return null;
    }

    return await analyzeTradFiAsset(asset, settings, source);
  });

  await runWithPool(tasks, settings.concurrency || 10, (done, match) => {
    scannedCount = done;
    if (match) {
      results.push(match);
      matchedCount++;
    } else {
      failedAssets.push(assets[done - 1]);
    }
    onProgress({
      phase: 'scanning',
      done: scannedCount,
      total: totalAssets,
      matched: matchedCount,
      results: [...results]
    });
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // OI/MC ratio not applicable for tradfi (no OI data)
  for (const r of results) {
    r.oiRatio = null;
  }

  onProgress({
    phase: 'complete',
    done: totalAssets,
    total: totalAssets,
    matched: matchedCount,
    results,
    duration,
    updatedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    // Tradfi-specific metadata for UI
    tradfiMeta: {
      intradayTickers: intradayTickerCount,
      dailyOnlyTickers: totalAssets - intradayTickerCount,
      skippedIntraday: skippedIntradayCount,
      isIntraday,
      binancePerps: binanceTradfiList.length,
      okxPerps: okxTradfiSet.size,
    }
  });

  return { results, duration };
}
