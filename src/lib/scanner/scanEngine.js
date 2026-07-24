import { calcEMA, calcVWAP, calcRSI } from './calculations';
import { fetchCandles, fetch24hChange, preloadExchange, fetchTop500, CANDLES_PER_DAY } from './exchanges';
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

  // ── Snapshot-first: crypto_universe already has marketCap + volume24h for 500 coins ──
  // Avoids an extra CoinGecko call per scan (the universe fetch already got this data).
  // Also surfaces the Phase 1a rich fields: 1h/60d/90d changes, supply metrics, tags, platform.
  try {
    const res = await fetch('/snapshot.json');
    if (res.ok) {
      const snap = await res.json();
      const universe = snap?.crypto_universe;
      if (universe && Object.keys(universe).length >= 400) {
        _cgMarketCache = {};
        for (const c of Object.values(universe)) {
          _cgMarketCache[c.symbol] = {
            marketCap: c.marketCap || 0,
            volume24h: c.volume24h || 0,
            marketCapRank: c.marketCapRank || 999999,
            // Phase 1a: multi-timeframe changes (1h/60d/90d)
            change1h: c.change1h,
            change60d: c.change60d,
            change90d: c.change90d,
            // Phase 1a: supply metrics
            circulatingSupply: c.circulatingSupply,
            totalSupply: c.totalSupply,
            maxSupply: c.maxSupply,
            fullyDilutedMarketCap: c.fullyDilutedMarketCap,
            numMarketPairs: c.numMarketPairs,
            dateAdded: c.dateAdded,
            // Phase 2: tags + platform for chain/sector filtering
            tags: c.tags || [],
            platform: c.platform || null,
            category: c.category || null,
          };
        }
        _cgMarketCacheTime = now;
        return _cgMarketCache;
      }
    }
  } catch (e) {
    console.warn('Snapshot market data fetch failed, falling back to CoinGecko:', e.message);
  }

  // ── Live fallback: CoinGecko top 250 by volume (only covers top 250, not full 500) ──
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
    rsiEnabled, rsiPeriod, rsiTimeframe, rsiMin, rsiMax,
    // Phase 2: chain + sector filters (null/empty = no filter)
    chainFilter, sectorFilter,
    // Phase 1c: max supply filter (0 = no filter, otherwise USD value)
    maxSupplyFilter,
  } = settings;

  // ── Phase 2: Chain filter (platform) ──────────────────────────────────────
  // chainFilter values: null/'All' = no filter, 'Native' = coins with no platform
  // (BTC, ETH, SOL native L1s), or specific chain name ('Ethereum', 'Solana', etc.)
  if (chainFilter && chainFilter !== 'All' && cgMarketData) {
    const marketInfo = cgMarketData[asset.symbol];
    if (marketInfo) {
      const coinPlatform = marketInfo.platform || null;
      if (chainFilter === 'Native') {
        if (coinPlatform !== null) return null;  // skip tokens on a platform
      } else if (coinPlatform !== chainFilter) {
        return null;
      }
    }
  }

  // ── Phase 2: Sector filter (CMC tags) ─────────────────────────────────────
  // sectorFilter values: null/'All' = no filter, or a tag slug ('defi', 'ai-agents', etc.)
  // CMC tags come as objects with slug + name; we match on slug.
  if (sectorFilter && sectorFilter !== 'All' && cgMarketData) {
    const marketInfo = cgMarketData[asset.symbol];
    if (marketInfo) {
      const tags = Array.isArray(marketInfo.tags) ? marketInfo.tags : [];
      // CMC tag objects have shape { slug, name, ... } OR may be string slugs (depends on endpoint)
      const tagSlugs = tags.map(t => (typeof t === 'string' ? t : t?.slug)).filter(Boolean);
      if (!tagSlugs.includes(sectorFilter)) return null;
    }
  }

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

  // ── Phase 1c: Max supply filter ───────────────────────────────────────────
  // Filters out coins whose max supply is null (inflationary, e.g. ETH, DOGE) or
  // below the specified threshold. 0 = no filter.
  if (maxSupplyFilter && maxSupplyFilter > 0 && cgMarketData) {
    const marketInfo = cgMarketData[asset.symbol];
    if (marketInfo) {
      const maxSupply = marketInfo.maxSupply;
      if (maxSupply == null || maxSupply < maxSupplyFilter) return null;
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

  // Sanitize: filter out candles with null/zero/NaN prices
  const cleanCandles = candles.filter(c =>
    c.close != null && c.close > 0 && !isNaN(c.close) &&
    c.high != null && c.high > 0 && c.low != null && c.low > 0
  );
  if (cleanCandles.length < required) return null;

  // Detect price-scale discontinuities (mixed basket vs per-token prices
  // from Binance 1000x/1000000x prefix mismatches). Crypto can have extreme
  // real price moves (100x pumps, 99% rug pulls), so only reject truly
  // impossible ratios: >10000x gain or >99.99% drop in one day.
  const closes = cleanCandles.map(c => c.close);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i-1] > 0 && closes[i] > 0) {
      const ratio = closes[i] / closes[i-1];
      if (ratio > 10000 || ratio < 0.0001) return null;  // reject corrupted data
    }
  }
  candles = cleanCandles;

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
    // RSI can use a separate timeframe from the main scan timeframe.
    // If rsiTimeframe differs, fetch candles at that timeframe; otherwise
    // reuse the already-fetched closes to avoid an extra API call.
    let rsiCloses = closes;
    if (rsiTimeframe && rsiTimeframe !== timeframe) {
      let rsiCandles = await fetchCandles(asset.symbol, exchange, rsiTimeframe);
      if ((!rsiCandles || rsiCandles.length < (rsiPeriod || 14) + 1) && exchange !== 'auto') {
        rsiCandles = await fetchCandles(asset.symbol, 'auto', rsiTimeframe);
      }
      if (rsiCandles && rsiCandles.length >= (rsiPeriod || 14) + 1) {
        rsiCloses = rsiCandles.map(c => c.close);
      } else {
        // Not enough data at the RSI timeframe — fail the RSI check
        passesRsi = false;
      }
    }
    if (passesRsi) {
      rsi = calcRSI(rsiCloses, rsiPeriod || 14);
      passesRsi = rsi != null && rsi >= rsiMin && rsi <= rsiMax;
    }
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
      // Phase 1a: multi-timeframe changes (1h/60d/90d) from CMC
      change1h: marketInfo.change1h ?? null,
      change60d: marketInfo.change60d ?? null,
      change90d: marketInfo.change90d ?? null,
      // Phase 1a: supply metrics from CMC
      circulatingSupply: marketInfo.circulatingSupply ?? null,
      totalSupply: marketInfo.totalSupply ?? null,
      maxSupply: marketInfo.maxSupply ?? null,
      fullyDilutedMarketCap: marketInfo.fullyDilutedMarketCap ?? null,
      numMarketPairs: marketInfo.numMarketPairs ?? null,
      dateAdded: marketInfo.dateAdded ?? null,
      // Phase 2: tags + platform for chain/sector display
      tags: marketInfo.tags || [],
      platform: marketInfo.platform || null,
      category: marketInfo.category || null,
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

  onProgress({ phase: 'fetching_universe', message: 'Fetching Top 500 (snapshot → CMC → CoinGecko → CoinCap → Binance)…' });

  const assets = await fetchTop500(settings.cgKey);
  const totalAssets = assets.length;

  // Fetch market data (volume and market cap) — snapshot-first (reuses crypto_universe),
  // falls back to CoinGecko top-250-by-volume if snapshot is missing.
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
    const tf = settings.rsiTimeframe && settings.rsiTimeframe !== settings.timeframe
      ? `@${settings.rsiTimeframe}` : '';
    filterParts.push(`RSI${tf} ${settings.rsiMin}-${settings.rsiMax}`);
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
    updatedAt: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  });

  return { results, duration };
}
