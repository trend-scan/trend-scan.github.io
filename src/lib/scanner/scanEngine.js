import { calcEMA, calcVWAP, calcRSI } from './calculations';
import { fetchCandles, fetch24hChange, preloadExchange, fetchTop500, CANDLES_PER_DAY } from './exchanges';
import { fetchAllTickers as fetchHyperliquidTickers } from './sources/hyperliquid';
import { fetchWithTimeout } from './fetchWithTimeout';

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

// ── Aggregated Open Interest (6-exchange) ─────────────────────────────────────
// Always fetched in parallel regardless of which exchange the user picked for
// the screener scan. This gives us the broadest OI coverage (~60% of total
// crypto perp OI) for the OI/MC ratio column.
//
// Sources:
// 1. Hyperliquid — client-side, ~232 perps, includes OI + funding + price
// 2. OKX         — client-side, ~421 SWAPs, OI only (no funding in /open-interest endpoint)
// 3. Bybit       — client-side, ~679 USDT perps, includes OI + funding + price
// 4. Bitget      — client-side, ~733 USDT perps, includes holdingAmount + funding + price
// 5. Gate.io     — client-side, ~857 USDT perps, includes position_size + funding + mark_price
// 6. Binance     — SERVER-SIDE in build_snapshot.js (binance_oi key, refreshed 4× daily)
//                  Includes OI + funding (premiumIndex batch)
//
// Returns: { aggregatedOI: Map<symbol, {oiUsd, oiCoin, sources}>, fundingByExchange: { hl, okx, bybit, bitget, gate, binance } }
//
// fundingByExchange lets analyzeAsset pick the FUNDING RATE from the user-selected
// exchange (rather than always using HL). If the selected exchange has no funding
// data for this symbol, falls back to null.
async function fetchHyperliquidOI() {
  const map = new Map();
  try {
    const tickers = await fetchHyperliquidTickers();
    if (tickers instanceof Map) {
      for (const [symbol, t] of tickers) {
        map.set(symbol, {
          oiUsd: t.openInterestUsd ?? 0,
          oiCoin: t.openInterest ?? 0,
          funding: t.fundingRate ?? null,
        });
      }
    }
    console.info(`[scanEngine] HL OI: ${map.size} assets`);
  } catch (e) {
    console.warn('[scanEngine] Hyperliquid OI fetch failed:', e.message);
  }
  return map;
}

async function fetchOKXOI() {
  const map = new Map();
  try {
    const res = await fetchWithTimeout('https://www.okx.com/api/v5/public/open-interest?instType=SWAP');
    if (res.ok) {
      const d = await res.json();
      if (d?.code === '0' && Array.isArray(d.data)) {
        for (const item of d.data) {
          const parts = item.instId?.split('-');
          if (!parts || parts.length < 2) continue;
          const symbol = parts[0];
          const oiUsd = parseFloat(item.oiUsd || '0');
          const oiCoin = parseFloat(item.oiCcy || '0');
          if (oiUsd > 0) map.set(symbol, { oiUsd, oiCoin, funding: null });
        }
        console.info(`[scanEngine] OKX OI: ${map.size} assets`);
      }
    }
  } catch (e) {
    console.warn('[scanEngine] OKX OI fetch failed:', e.message);
  }
  return map;
}

async function fetchBybitOI() {
  const map = new Map();
  try {
    const res = await fetchWithTimeout('https://api.bybit.com/v5/market/tickers?category=linear');
    if (res.ok) {
      const d = await res.json();
      if (d?.retCode === 0) {
        for (const item of (d?.result?.list || [])) {
          const sym = item.symbol || '';
          if (!sym.endsWith('USDT')) continue;
          const symbol = sym.replace('USDT', '');
          const oiUsd = parseFloat(item.openInterestValue || '0');
          const oiCoin = parseFloat(item.openInterest || '0');
          const funding = parseFloat(item.fundingRate || '0');
          if (oiUsd > 0) map.set(symbol, { oiUsd, oiCoin, funding });
        }
        console.info(`[scanEngine] Bybit OI: ${map.size} assets`);
      }
    }
  } catch (e) {
    console.warn('[scanEngine] Bybit OI fetch failed:', e.message);
  }
  return map;
}

async function fetchBitgetOI() {
  const map = new Map();
  try {
    const res = await fetchWithTimeout('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
    if (res.ok) {
      const d = await res.json();
      if (d?.code === '00000') {
        for (const item of (d.data || [])) {
          const sym = item.symbol || '';
          if (!sym.endsWith('USDT')) continue;
          const symbol = sym.replace('USDT', '');
          const oiCoin = parseFloat(item.holdingAmount || '0');
          const price = parseFloat(item.lastPr || '0');
          const oiUsd = oiCoin * price;
          const funding = parseFloat(item.fundingRate || '0');
          if (oiUsd > 0) map.set(symbol, { oiUsd, oiCoin, funding });
        }
        console.info(`[scanEngine] Bitget OI: ${map.size} assets`);
      }
    }
  } catch (e) {
    console.warn('[scanEngine] Bitget OI fetch failed:', e.message);
  }
  return map;
}

async function fetchGateOI() {
  const map = new Map();
  try {
    const res = await fetchWithTimeout('https://api.gateio.ws/api/v4/futures/usdt/contracts');
    if (res.ok) {
      const d = await res.json();
      if (Array.isArray(d)) {
        for (const c of d) {
          const name = c.name || '';
          if (!name.endsWith('_USDT')) continue;
          const symbol = name.replace('_USDT', '');
          const positionSize = parseFloat(c.position_size || '0');
          const quantoMultiplier = parseFloat(c.quanto_multiplier || '1');
          const markPrice = parseFloat(c.mark_price || '0');
          const oiUsd = positionSize * quantoMultiplier * markPrice;
          const oiCoin = positionSize * quantoMultiplier;
          const funding = parseFloat(c.funding_rate || '0');
          if (oiUsd > 0) map.set(symbol, { oiUsd, oiCoin, funding });
        }
        console.info(`[scanEngine] Gate.io OI: ${map.size} assets`);
      }
    }
  } catch (e) {
    console.warn('[scanEngine] Gate.io OI fetch failed:', e.message);
  }
  return map;
}

// Read Binance OI from snapshot (server-side fetched, max 4h stale).
// Returns Map<symbol, {oiUsd, oiCoin, funding}>.
// NOTE: snapshot.binance_oi may be empty when GitHub Actions runners are
// geo-blocked by Binance (HTTP 451). In that case, only OI is missing —
// funding is fetched client-side via fetchBinanceFundingClientSide().
function readBinanceOIFromSnapshot(snap) {
  const map = new Map();
  if (!snap?.binance_oi) return map;
  for (const [symbol, b] of Object.entries(snap.binance_oi)) {
    if (b && b.oiUsd > 0) {
      map.set(symbol, {
        oiUsd: b.oiUsd,
        oiCoin: b.oiCoin ?? 0,
        funding: b.fundingRate ?? null,
      });
    }
  }
  console.info(`[scanEngine] Binance OI (snapshot): ${map.size} assets`);
  return map;
}

// Fetch OKX funding rates for all USDT-SWAP instruments.
// OKX's /open-interest endpoint returns OI only (no funding rate), and there
// is no batch funding-rate endpoint — we have to call /funding-rate?instId=X
// per symbol. With 20-concurrent batching, all 421 calls complete in <1s.
// Returns Map<symbol, funding>.
async function fetchOKXFunding() {
  const map = new Map();
  try {
    // 1. Get all live USDT-SWAP instrument IDs + base assets.
    // NOTE: OKX SWAP instruments have empty `baseCcy` field — must parse base
    // from instId (e.g. "BTC-USDT-SWAP" → base="BTC").
    const instrRes = await fetchWithTimeout('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
    if (!instrRes.ok) return map;
    const instrData = await instrRes.json();
    const swaps = (instrData?.data || [])
      .filter(i => i.state === 'live' && i.instId.endsWith('-USDT-SWAP'))
      .map(i => {
        const parts = i.instId.split('-');  // e.g. ["BTC", "USDT", "SWAP"]
        return { instId: i.instId, base: parts[0] };
      });
    if (swaps.length === 0) return map;

    // 2. Fetch funding rates in parallel batches of 20 (avoids OKX rate limit)
    const BATCH = 20;
    for (let i = 0; i < swaps.length; i += BATCH) {
      const batch = swaps.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async ({ instId, base }) => {
          try {
            const r = await fetchWithTimeout(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`);
            if (!r.ok) return null;
            const d = await r.json();
            if (d.code === '0' && d.data?.[0]) {
              return { base, funding: parseFloat(d.data[0].fundingRate || '0') };
            }
            return null;
          } catch { return null; }
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.funding != null) {
          map.set(r.value.base, r.value.funding);
        }
      }
    }
    console.info(`[scanEngine] OKX funding: ${map.size} assets`);
  } catch (e) {
    console.warn('[scanEngine] OKX funding fetch failed:', e.message);
  }
  return map;
}

// Fetch Binance funding rates + mark prices for ALL USDT perps in ONE batch call.
// /fapi/v1/premiumIndex returns lastFundingRate, markPrice, nextFundingTime for
// all 850+ USDT perps at once. ~1ms response time.
//
// Used for FUNDING RATE only (when user picks 'binance_perps' as scan exchange).
// The OI(USD) for Binance is computed separately via /openInterest per symbol
// (handled server-side in build_snapshot.js, stored as binance_oi snapshot key).
//
// Requires VPN if Binance is geo-blocked in user's region. If fetch fails
// (HTTP 451 or network error), returns empty Map — funding will show as null.
// Returns Map<symbol, funding>.
async function fetchBinanceFundingClientSide() {
  const map = new Map();
  try {
    const res = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/premiumIndex');
    if (!res.ok) {
      console.warn(`[scanEngine] Binance funding HTTP ${res.status} (likely geo-blocked; user needs VPN)`);
      return map;
    }
    const data = await res.json();
    if (!Array.isArray(data)) return map;
    for (const p of data) {
      const sym = p.symbol || '';
      if (!sym.endsWith('USDT')) continue;
      const base = sym.replace('USDT', '');
      const funding = parseFloat(p.lastFundingRate || '0');
      map.set(base, funding);
    }
    console.info(`[scanEngine] Binance funding (client-side): ${map.size} assets`);
  } catch (e) {
    console.warn('[scanEngine] Binance funding fetch failed (likely geo-blocked; user needs VPN):', e.message);
  }
  return map;
}

// Fetch all 5 client-side OI sources in parallel + OKX/Binance funding (which
// require separate endpoints). Binance OI comes from snapshot.
//
// Returns: {
//   aggregatedOI: Map<symbol, {oiUsd, oiCoin, sources}>,
//   fundingByExchange: { hl, okx, bybit, bitget, gate, binance }  // each is Map<symbol, number|null>
// }
async function fetchAggregatedOI(snapshot) {
  // Run all 7 fetchers in parallel:
  // - 5 OI fetchers (HL, OKX, Bybit, Bitget, Gate)
  // - OKX funding (per-symbol batch — OKX /open-interest endpoint doesn't return funding)
  // - Binance funding client-side (1 batch call to /premiumIndex; works when user has VPN)
  const [hlMap, okxMap, bybitMap, bitgetMap, gateMap, okxFundingMap, binanceFundingMap] = await Promise.all([
    fetchHyperliquidOI(),
    fetchOKXOI(),
    fetchBybitOI(),
    fetchBitgetOI(),
    fetchGateOI(),
    fetchOKXFunding(),
    fetchBinanceFundingClientSide(),
  ]);
  const binanceMap = readBinanceOIFromSnapshot(snapshot);

  const allSymbols = new Set([
    ...hlMap.keys(),
    ...okxMap.keys(),
    ...bybitMap.keys(),
    ...bitgetMap.keys(),
    ...gateMap.keys(),
    ...binanceMap.keys(),
  ]);

  const aggregatedOI = new Map();
  for (const symbol of allSymbols) {
    const hl = hlMap.get(symbol);
    const okx = okxMap.get(symbol);
    const bybit = bybitMap.get(symbol);
    const bitget = bitgetMap.get(symbol);
    const gate = gateMap.get(symbol);
    const binance = binanceMap.get(symbol);

    const hlOi = hl?.oiUsd ?? 0;
    const okxOi = okx?.oiUsd ?? 0;
    const bybitOi = bybit?.oiUsd ?? 0;
    const bitgetOi = bitget?.oiUsd ?? 0;
    const gateOi = gate?.oiUsd ?? 0;
    const binanceOi = binance?.oiUsd ?? 0;

    const totalOi = hlOi + okxOi + bybitOi + bitgetOi + gateOi + binanceOi;
    if (totalOi > 0) {
      const hlOiCoin = hl?.oiCoin ?? 0;
      const okxOiCoin = okx?.oiCoin ?? 0;
      const bybitOiCoin = bybit?.oiCoin ?? 0;
      const bitgetOiCoin = bitget?.oiCoin ?? 0;
      const gateOiCoin = gate?.oiCoin ?? 0;
      const binanceOiCoin = binance?.oiCoin ?? 0;

      aggregatedOI.set(symbol, {
        oiUsd: totalOi,
        oiCoin: hlOiCoin + okxOiCoin + bybitOiCoin + bitgetOiCoin + gateOiCoin + binanceOiCoin,
        sources: (hlOi > 0 ? 1 : 0) + (okxOi > 0 ? 1 : 0) + (bybitOi > 0 ? 1 : 0) +
                 (bitgetOi > 0 ? 1 : 0) + (gateOi > 0 ? 1 : 0) + (binanceOi > 0 ? 1 : 0),
      });
    }
  }
  console.info(`[scanEngine] Aggregated OI (6-exchange): ${aggregatedOI.size} assets`);

  // Per-exchange funding Maps (for user-selected-exchange funding rate lookup)
  const extractFunding = (m) => {
    const out = new Map();
    for (const [sym, v] of m) if (v?.funding != null) out.set(sym, v.funding);
    return out;
  };
  const fundingByExchange = {
    hl: extractFunding(hlMap),
    // OKX /open-interest returns OI only (no funding). Use the dedicated
    // fetchOKXFunding() Map instead, which calls /funding-rate per symbol.
    okx: okxFundingMap,
    bybit: extractFunding(bybitMap),
    bitget: extractFunding(bitgetMap),
    gate: extractFunding(gateMap),
    // Binance: snapshot.binance_oi may be empty (server-side geo-blocked on
    // GitHub Actions runners). Use client-side premiumIndex fetch instead —
    // works when user has VPN. If both empty, funding shows as null.
    binance: binanceFundingMap.size > 0
      ? binanceFundingMap
      : extractFunding(binanceMap),
  };

  return { aggregatedOI, fundingByExchange };
}

// Map user-selected screener exchange → funding Map key in fundingByExchange.
// Returns null for spot-only exchanges or exchanges whose funding we don't fetch.
function fundingKeyForExchange(exchange) {
  switch (exchange) {
    case 'hyperliquid':   return 'hl';
    case 'okx_perps':     return 'okx';
    case 'bybit':         return 'bybit';
    case 'binance_perps': return 'binance';
    // okx (spot), binance (spot), kraken, coingecko — no perp funding available
    default:              return null;
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

async function analyzeAsset(asset, settings, cgMarketData, oiData) {
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

  // Audit F-14-e-13 (2026-08-26): fallback defaults must match Scanner.jsx
  // INITIAL_SETTINGS (emaFast: 21, emaMid: 100, emaSlow: 200). Previously
  // emaMid fell back to 50, mismatching the 100 default — unreachable in
  // practice but misleading for future maintainers reading the code path.
  const required = Math.max(
    fastType === 'vwap' ? (vwapFastDays || 3) * cpd : (emaFast || 21),
    midType  === 'vwap' ? (vwapMidDays  || 14) * cpd : (emaMid  || 100),
    slowType === 'vwap' ? (vwapDays     || 30) * cpd : (emaSlow || 200),
    sparklineCandles
  );

  // Try the selected exchange first; if it fails, fall back to 'auto' resolver once.
  // VWAP days cap raised 90→365 (2026-09-08): pass `required` as the fetch limit
  // AND as the resolver's minCandles so sources that can't go that deep (OKX 300)
  // yield to deeper ones (Bybit 1000 / Binance 1500 / Kraken 720 / Hyperliquid
  // start-end) instead of winning with a shallow result that fails the check below.
  let candles = await fetchCandles(asset.symbol, exchange, timeframe, required, required);
  if ((!candles || candles.length < required) && exchange !== 'auto') {
    // Retry once via the auto resolver (tries all sources in priority order)
    candles = await fetchCandles(asset.symbol, 'auto', timeframe, required, required);
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

    // ── OI + Funding (always 6-exchange aggregated, regardless of selected exchange) ──
    // aggregatedOI: SUM of HL + OKX + Bybit + Bitget + Gate + Binance(server-side)
    // fundingRate: from the user-selected exchange (if available); null otherwise.
    //   Selected exchange → funding map: hyperliquid→hl, okx_perps→okx,
    //   bybit→bybit, binance_perps→binance. Spot exchanges (okx/binance/kraken/
    //   coingecko) have no perp funding, so funding rate will be null.
    const agg = oiData?.aggregatedOI instanceof Map ? oiData.aggregatedOI.get(asset.symbol) : null;
    const fundingKey = oiData?.selectedFundingKey;  // 'hl' | 'okx' | 'bybit' | 'binance' | null
    const fundingMap = fundingKey ? oiData.fundingByExchange?.[fundingKey] : null;
    const funding = fundingMap instanceof Map ? (fundingMap.get(asset.symbol) ?? null) : null;

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
      // 6-exchange aggregated OI (always populated regardless of selected exchange)
      fundingRate: funding,                                      // from user-selected exchange
      openInterest: agg?.oiUsd ?? null,                          // aggregated USD value
      openInterestRaw: agg?.oiCoin ?? null,                      // aggregated base currency
      oiSources: agg?.sources ?? 0,                              // how many exchanges contributed
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

  // ── Always fetch 6-exchange aggregated OI (HL + OKX + Bybit + Bitget + Gate + Binance) ──
  // OI/MC ratio uses the SUM across all 6 exchanges regardless of which exchange the
  // user picked for the screener scan — this gives the broadest OI coverage (~60% of
  // total crypto perp OI vs ~4% from HL alone).
  //
  // Funding rate is user-selected-exchange-specific: we look up the funding rate from
  // whichever exchange the user picked (HL/OKX/Bybit/Binance perps). Spot exchanges
  // (kraken, coingecko, okx/binance spot) have no perp funding, so funding will be null.
  onProgress({ phase: 'fetching_market_data', message: 'Fetching 6-exchange aggregated OI (HL + OKX + Bybit + Bitget + Gate + Binance)…' });
  let snapshot = null;
  try {
    const snapRes = await fetch('/snapshot.json');
    if (snapRes.ok) snapshot = await snapRes.json();
  } catch (e) {
    console.warn('[scanEngine] Snapshot fetch failed (Binance OI unavailable):', e.message);
  }

  let oiData = { aggregatedOI: new Map(), fundingByExchange: {}, selectedFundingKey: null };
  try {
    const { aggregatedOI, fundingByExchange } = await fetchAggregatedOI(snapshot);
    const selectedFundingKey = fundingKeyForExchange(settings.exchange);
    oiData = { aggregatedOI, fundingByExchange, selectedFundingKey };
  } catch (e) {
    console.warn('[scanEngine] Aggregated OI fetch failed:', e.message);
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
  const tasks = assets.map(asset => () => analyzeAsset(asset, settings, cgMarketData, oiData));

  // Audit F-14-e-5 (2026-08-26): previously `scannedCount = done` where `done`
  // was the just-completed task index (i+1) — not a count. Under concurrency
  // (10 workers), `done` jumps non-monotonically (3 → 7 → 4 → 11 → 5), causing
  // the progress bar to move backwards. Now using a separate `++scannedCount`
  // counter that only increments.
  await runWithPool(tasks, settings.concurrency || 5, (_done, match) => {
    ++scannedCount;
    if (match) {
      results.push(match);
      matchedCount++;
    } else {
      // _done is 1-indexed; assets[_done - 1] is the asset that just failed.
      failedAssets.push(assets[_done - 1]);
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
    const retryTasks = failedAssets.map(asset => () => analyzeAsset(asset, retrySettings, cgMarketData, oiData));
    await runWithPool(retryTasks, 3, (_, match) => {
      if (match) {
        results.push(match);
        matchedCount++;
      }
    });
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Compute OI/MC ratio (normalized OI) ────────────────────────────────
  // OI in USD is not comparable across assets (BTC has $6B OI, a small cap
  // has $2M). OI in coin terms is also not comparable (1 BTC OI vs 10M DOGE OI).
  // The proper normalization: OI(USD) / MarketCap(USD) = what fraction of the
  // asset's total market cap is tied up in perp OI. This is the "OI intensity"
  // metric from the TradingRiot material — high OI/MC = crowded positioning
  // relative to the asset's size, regardless of absolute OI.
  //
  // Uses the 6-exchange aggregated OI (HL + OKX + Bybit + Bitget + Gate + Binance)
  // — NOT the selected exchange's OI. This gives a much more accurate picture
  // of total market positioning than any single exchange would.
  //
  // Only computed when both openInterest (aggregated) and marketCap (snapshot)
  // are available. Null otherwise.
  for (const r of results) {
    if (r.openInterest != null && r.openInterest > 0 && r.marketCap != null && r.marketCap > 0) {
      r.oiRatio = r.openInterest / r.marketCap;  // e.g. 0.15 = 15% of mcap is OI
    } else {
      r.oiRatio = null;
    }
  }

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
