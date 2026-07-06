import { calcEMA, calcVWAP, calcRSI } from './calculations';
import { fetchCandles, fetch24hChange, preloadExchange, fetchTop300, CANDLES_PER_DAY } from './exchanges';
import { fetchAllTickers as fetchHyperliquidTickers } from './sources/hyperliquid';

// ── CoinGecko Market Data Cache ─────────────────────────────────────────────────
let _cgMarketCache = null;
let _cgMarketCacheTime = 0;
const CG_CACHE_TTL = 60 * 1000;

async function fetchCGMarketData(cgKey) {
  const now = Date.now();
  if (_cgMarketCache && (now - _cgMarketCacheTime) < CG_CACHE_TTL) {
    return _cgMarketCache;
  }
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false`;
    const headers = cgKey ? { 'x-cg-demo-api-key': cgKey } : {};
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`CoinGecko markets HTTP ${res.status}`);
    const data = await res.json();
    _cgMarketCache = {};
    for (const coin of data) {
      _cgMarketCache[coin.symbol.toUpperCase()] = {
        marketCap: coin.market_cap || 0,
        volume24h: coin.total_volume || 0,
        marketCapRank: coin.market_cap_rank || 999999,
      };
    }
    _cgMarketCacheTime = now;
    return _cgMarketCache;
  } catch (e) {
    console.warn('CoinGecko markets fetch failed:', e.message);
    return _cgMarketCache || {};
  }
}

// ── Relative Volume (rVol) ─────────────────────────────────────────────────────
// rVol = current candle volume / 20-period SMA of volume
// rVol > 1 = volume surge, rVol < 1 = below-average volume
function computeRVol(candles, period = 20) {
  if (!candles || candles.length < period + 1) return null;
  const vols = candles.map(c => c.vol || 0);
  const recentSlice = vols.slice(-period - 1, -1);  // exclude current candle
  if (recentSlice.length < period) return null;
  const sma = recentSlice.reduce((s, v) => s + v, 0) / period;
  if (sma <= 0) return null;
  return vols[vols.length - 1] / sma;
}

async function analyzeAsset(asset, settings, cgMarketData, hlTickers) {
  const {
    fastType, emaFast, vwapFastDays, midType, emaMid, vwapMidDays, slowType, emaSlow, vwapDays,
    exchange, timeframe, minVolume, minMarketCap,
    priceAboveSlowEnabled, fastAboveMidEnabled, minVolumeEnabled, minMarketCapEnabled,
    rsiEnabled, rsiPeriod, rsiMin, rsiMax,
  } = settings;

  // Apply volume filter if specified
  if (minVolumeEnabled && minVolume > 0 && cgMarketData) {
    const marketInfo = cgMarketData[asset.symbol];
    if (!marketInfo || marketInfo.volume24h < minVolume) {
      return null;
    }
  }

  // Apply market cap filter if specified
  if (minMarketCapEnabled && minMarketCap > 0 && cgMarketData) {
    const marketInfo = cgMarketData[asset.symbol];
    if (!marketInfo || marketInfo.marketCap < minMarketCap) {
      return null;
    }
  }

  const cpd = CANDLES_PER_DAY[timeframe] || 6;
  const sparklineCandles = 7 * cpd;

  const required = Math.max(
    fastType === 'vwap' ? (vwapFastDays || 3) * cpd : (emaFast || 21),
    midType  === 'vwap' ? (vwapMidDays  || 14) * cpd : (emaMid  || 50),
    slowType === 'vwap' ? (vwapDays     || 30) * cpd : (emaSlow || 200),
    sparklineCandles
  );

  // Try the selected exchange first; if it fails, fall back to 'auto' resolver once
  let candles = await fetchCandles(asset.symbol, exchange, timeframe);
  if ((!candles || candles.length < required) && exchange !== 'auto') {
    // Retry once via the auto resolver (tries all sources in priority order)
    candles = await fetchCandles(asset.symbol, 'auto', timeframe);
  }
  if (!candles || candles.length < required) return null;

  const closes = candles.map(c => c.close);

  const fast = fastType === 'vwap' ? calcVWAP(candles, vwapFastDays || 3, cpd)  : calcEMA(closes, emaFast);
  const mid  = midType  === 'vwap' ? calcVWAP(candles, vwapMidDays  || 14, cpd) : calcEMA(closes, emaMid);
  const slow = slowType === 'vwap' ? calcVWAP(candles, vwapDays     || 30, cpd) : calcEMA(closes, emaSlow);

  if (fast == null || mid == null || slow == null) return null;

  const price = closes[closes.length - 1];

  const passesPriceVsSlow = !priceAboveSlowEnabled || price > slow;
  const passesFastVsMid = !fastAboveMidEnabled || fast > mid;

  let rsi = null;
  let passesRsi = true;
  if (rsiEnabled) {
    rsi = calcRSI(closes, rsiPeriod || 14);
    passesRsi = rsi != null && rsi >= rsiMin && rsi <= rsiMax;
  }

  if (passesPriceVsSlow && passesFastVsMid && passesRsi) {
    const change24h = await fetch24hChange(asset.symbol, exchange, candles);
    const sparkline = closes.slice(-sparklineCandles);

    // Market data
    const marketInfo = cgMarketData?.[asset.symbol] || {};

    // Relative volume (current vol / 20-period SMA vol)
    const rVol = computeRVol(candles, 20);

    // Hyperliquid per-asset data (funding, open interest) — only if available
    // hlTickers is a Map (from fetchAllTickers) — use .get()
    const hlData = hlTickers instanceof Map ? hlTickers.get(asset.symbol) : null;

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
      // Market data
      volume24h: marketInfo.volume24h || 0,
      marketCap: marketInfo.marketCap || 0,
      marketCapRank: marketInfo.marketCapRank || 999999,
      // Hyperliquid-specific (null if not on Hyperliquid)
      fundingRate: hlData?.fundingRate ?? null,
      openInterest: hlData?.openInterestUsd ?? null,  // USD value (base OI × mark price)
      openInterestRaw: hlData?.openInterest ?? null,  // base currency (for reference)
      // Relative volume
      rVol,
      rsi,
    };
  }
  return null;
}

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

export async function runScan(settings, onProgress) {
  const startTime = Date.now();
  const results = [];
  let scannedCount = 0;
  let matchedCount = 0;

  onProgress({ phase: 'fetching_universe', message: 'Fetching Top 300 (CoinGecko → CoinCap → Binance)…' });

  const assets = await fetchTop300(settings.cgKey);
  const totalAssets = assets.length;

  // Fetch market data (volume and market cap) from CoinGecko
  onProgress({ phase: 'fetching_market_data', message: 'Fetching market data (volume, market cap)…' });
  const cgMarketData = await fetchCGMarketData(settings.cgKey);

  // Fetch Hyperliquid bulk tickers (funding, OI, volume) in ONE call
  // This gives us per-asset funding rate + open interest for all 230+ perps
  let hlTickers = null;
  if (settings.exchange === 'hyperliquid') {
    onProgress({ phase: 'fetching_market_data', message: 'Fetching Hyperliquid funding + open interest…' });
    try {
      hlTickers = await fetchHyperliquidTickers();
    } catch (e) {
      console.warn('[scanEngine] Hyperliquid ticker fetch failed:', e.message);
    }
  } else {
  }

  onProgress({
    phase: 'loading_exchange',
    message: `Loading ${settings.exchange.toUpperCase()} instruments…`,
    total: totalAssets
  });

  await preloadExchange(settings.exchange);

  // Build filter info message
  const filterParts = [];
  if (settings.minVolume > 0) {
    const volStr = settings.minVolume >= 1e6
      ? `$${(settings.minVolume / 1e6).toFixed(0)}M`
      : `$${(settings.minVolume / 1e3).toFixed(0)}K`;
    filterParts.push(`Vol≥${volStr}`);
  }
  if (settings.minMarketCap > 0) {
    const mcapStr = settings.minMarketCap >= 1e9
      ? `$${(settings.minMarketCap / 1e9).toFixed(1)}B`
      : `$${(settings.minMarketCap / 1e6).toFixed(0)}M`;
    filterParts.push(`MCap≥${mcapStr}`);
  }
  if (settings.rsiEnabled) {
    filterParts.push(`RSI ${settings.rsiMin}-${settings.rsiMax}`);
  }
  const filterInfo = filterParts.length > 0 ? ` [${filterParts.join(', ')}]` : '';

  onProgress({
    phase: 'scanning',
    message: `Scanning ${totalAssets} assets on ${settings.exchange.toUpperCase()} · ${settings.timeframe}${filterInfo}…`,
    done: 0,
    total: totalAssets,
    matched: 0
  });

  const failedAssets = [];
  const tasks = assets.map(asset => () => analyzeAsset(asset, settings, cgMarketData, hlTickers));

  await runWithPool(tasks, settings.concurrency || 5, (done, match) => {
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

  // Retry pass: re-attempt failed assets via 'auto' resolver with lower concurrency
  if (failedAssets.length > 0) {
    onProgress({
      phase: 'scanning',
      done: totalAssets,
      total: totalAssets,
      matched: matchedCount,
      message: `Retrying ${failedAssets.length} failed assets…`,
      results: [...results]
    });
    const retrySettings = { ...settings, exchange: 'auto' };
    const retryTasks = failedAssets.map(asset => () => analyzeAsset(asset, retrySettings, cgMarketData, hlTickers));
    await runWithPool(retryTasks, 3, (_, match) => {
      if (match) {
        results.push(match);
        matchedCount++;
      }
    });
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  onProgress({
    phase: 'complete',
    done: totalAssets,
    total: totalAssets,
    matched: matchedCount,
    results,
    duration,
    updatedAt: new Date().toLocaleTimeString()
  });

  return { results, duration };
}
