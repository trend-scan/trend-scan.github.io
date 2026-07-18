/**
 * Crypto Factor Computation — server-side factor engine for build_snapshot.js
 *
 * Ports the client-side factorEngine.js to Node.js so crypto factor data
 * can be computed server-side and persisted in the snapshot. This enables:
 *
 *   1. Server-side rotation history (crypto_factor_history in snapshot.json)
 *   2. Server-side crowding history (spread series in snapshot)
 *   3. Instant first paint for the Factor Monitor (no client-side fetch needed)
 *   4. Shared state across all visitors (not per-browser localStorage)
 *
 * Data flow:
 *   1. Fetch top 100 crypto by market cap from CoinGecko (already in build_snapshot)
 *   2. Fetch 1 year of daily candles from exchange APIs (server-side, no CORS)
 *   3. Run factorEngine.js: computeFactorScores → buildQuintilePortfolios →
 *      computeSpreadMonitor → detectFactorRotation
 *   4. Store the current leader + spread data in snapshot.json
 *   5. Append today's leader to crypto_factor_history (capped at 90 entries)
 *
 * The client FactorMonitor reads from the snapshot for instant first paint,
 * then optionally live-refreshes for fresh data.
 */

import { computeFactorScores, buildQuintilePortfolios, computeSpreadMonitor, detectFactorRotation } from '../src/lib/scanner/factorEngine.js';
import { detectRotation, appendToHistory } from '../src/lib/factors/rotationDetector.js';
import { buildCrowdingMatrix, extractSpreadSeries } from '../src/lib/factors/crowdingMatrix.js';
import { fetchWithTimeout } from '../src/lib/scanner/fetchWithTimeout.js';

const FACTORS = ['momentum', 'size', 'volatility', 'beta', 'liquidity'];

/**
 * Fetch top 100 crypto by market cap from CoinGecko.
 * Reuses the same endpoint as the client-side coingecko.js source.
 */
async function fetchTopCryptoByMcap(limit = 100) {
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=' + limit + '&page=1&sparkline=false';
  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' },
    }, 15000);
    if (!res.ok) return [];
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    return arr.map(c => ({
      symbol: (c.symbol || '').toUpperCase(),
      marketCap: c.market_cap || 0,
      volume24h: c.total_volume || 0,
    })).filter(c => c.symbol && c.marketCap > 0);
  } catch {
    return [];
  }
}

/**
 * Fetch daily candles for a crypto symbol from OKX (server-side, no CORS).
 * Falls back to Bybit if OKX doesn't list the symbol.
 */
async function fetchCryptoCandles(symbol, limit = 365) {
  // Try OKX SWAP (perps) first
  const okxUrl = `https://www.okx.com/api/v5/market/candles?instId=${symbol}-USDT-SWAP&bar=1D&limit=${Math.min(limit, 300)}`;
  try {
    const res = await fetchWithTimeout(okxUrl, {
      headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' },
    }, 10000);
    if (res.ok) {
      const d = await res.json();
      if (d.code === '0' && d.data?.length > 0) {
        const candles = d.data.reverse().map(k => ({
          ts: parseInt(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          vol: parseFloat(k[5]),
        })).filter(c => c.close > 0);
        if (candles.length >= 30) return candles;
      }
    }
  } catch {}

  // Fall back to OKX SPOT
  const okxSpotUrl = `https://www.okx.com/api/v5/market/candles?instId=${symbol}-USDT&bar=1D&limit=${Math.min(limit, 300)}`;
  try {
    const res = await fetchWithTimeout(okxSpotUrl, {
      headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' },
    }, 10000);
    if (res.ok) {
      const d = await res.json();
      if (d.code === '0' && d.data?.length > 0) {
        return d.data.reverse().map(k => ({
          ts: parseInt(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          vol: parseFloat(k[5]),
        })).filter(c => c.close > 0);
      }
    }
  } catch {}

  // Fall back to Bybit
  const bybitUrl = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}USDT&interval=D&limit=${Math.min(limit, 200)}`;
  try {
    const res = await fetchWithTimeout(bybitUrl, {
      headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' },
    }, 10000);
    if (res.ok) {
      const d = await res.json();
      if (d.retCode === 0 && d.result?.list?.length > 0) {
        return d.result.list.reverse().map(k => ({
          ts: parseInt(k[0]),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          vol: parseFloat(k[5]),
        })).filter(c => c.close > 0);
      }
    }
  } catch {}

  return [];
}

/**
 * Compute crypto factors server-side.
 *
 * @param {object} prevSnapshot - previous snapshot (for history accumulation)
 * @returns {Promise<object|null>} factor data or null on failure
 */
export async function computeCryptoFactors(prevSnapshot) {
  console.log('  Computing crypto factors...');

  // 1. Fetch top 100 by market cap
  const topCoins = await fetchTopCryptoByMcap(100);
  if (topCoins.length < 20) {
    console.warn('  ⚠ Crypto factors: not enough market data');
    return null;
  }

  // 2. Fetch candles (batched, 5 at a time to be respectful)
  const batchSize = 5;
  const universe = [];

  for (let i = 0; i < topCoins.length; i += batchSize) {
    const batch = topCoins.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async coin => {
        const candles = await fetchCryptoCandles(coin.symbol, 365);
        if (!candles || candles.length < 60) return null;
        return {
          symbol: coin.symbol,
          candles,
          marketCap: coin.marketCap,
          volume24h: coin.volume24h,
        };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        // Inject 24h volume into last candle if vol=0
        if (r.value.volume24h > 0 && r.value.candles.length > 0) {
          const lastCandle = r.value.candles[r.value.candles.length - 1];
          if (lastCandle.vol === 0) {
            lastCandle.vol = r.value.volume24h / (lastCandle.close || 1);
          }
        }
        universe.push(r.value);
      }
    }

    // Brief pause between batches
    if (i + batchSize < topCoins.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (universe.length < 20) {
    console.warn(`  ⚠ Crypto factors: only ${universe.length} assets with sufficient candle data`);
    return null;
  }

  // 3. Compute factor scores
  const scored = computeFactorScores(universe);
  if (scored.length === 0) {
    console.warn('  ⚠ Crypto factors: scoring failed');
    return null;
  }

  // 4. Build quintile portfolios
  const portfoliosByFactor = {};
  for (const factor of FACTORS) {
    portfoliosByFactor[factor] = buildQuintilePortfolios(scored, factor);
  }

  // 5. Build candles-by-symbol map
  const candlesBySymbol = {};
  for (const u of universe) candlesBySymbol[u.symbol] = u.candles;

  // 6. Compute spread monitor
  const benchmarkSymbols = universe.map(u => u.symbol);
  const spreadMonitor = computeSpreadMonitor(portfoliosByFactor, candlesBySymbol, benchmarkSymbols);

  // 7. Compute rotation (snapshot-based)
  const rotation = detectFactorRotation(portfoliosByFactor, candlesBySymbol);
  const today = new Date().toISOString().slice(0, 10);

  // 8. Accumulate factor leadership history
  let factorHistory = prevSnapshot?.crypto_factor_history || [];
  factorHistory = appendToHistory(factorHistory, today, rotation.leader_20d);

  // 9. Compute confirmed rotation from history
  const confirmedRotation = detectRotation(factorHistory);

  // 10. Compute crowding matrix from live spread series
  const spreadSeries = extractSpreadSeries(portfoliosByFactor, candlesBySymbol, 90);
  const crowding = buildCrowdingMatrix(spreadSeries, 90);

  // 11. Accumulate daily spread returns for server-side crowding history.
  // Each day we store the latest Q5-Q1 spread return per factor. This builds
  // a 90-day rolling series that can be used for correlation without needing
  // a live candle fetch — the crowding matrix renders instantly from snapshot.
  let spreadHistory = prevSnapshot?.crypto_factor_spread_history || [];
  const todaySpread = { date: today };
  for (const factor of FACTORS) {
    const series = spreadSeries[factor] || [];
    todaySpread[factor] = series.length > 0 ? series[series.length - 1] : null;
  }
  // Don't duplicate if today's entry already exists
  if (spreadHistory.length === 0 || spreadHistory[spreadHistory.length - 1].date !== today) {
    spreadHistory.push(todaySpread);
    // Cap at 90 entries (matching the correlation window)
    if (spreadHistory.length > 90) {
      spreadHistory = spreadHistory.slice(-90);
    }
  }

  // 12. Build crowding matrix from accumulated history (server-side)
  // This gives us a 90-day correlation matrix without needing live candles
  const historySpreadSeries = {};
  for (const factor of FACTORS) {
    historySpreadSeries[factor] = spreadHistory
      .map(h => h[factor])
      .filter(v => v != null && Number.isFinite(v));
  }
  const historyCrowding = buildCrowdingMatrix(historySpreadSeries, 90);

  // 13. Compute factor stances using the crowding data
  const stances = {};
  for (const row of Object.values(spreadMonitor)) {
    const spread20d = row.spread_20d || {};
    stances[row.factor] = {
      stance: computeStanceFromSpread(spread20d, confirmedRotation, historyCrowding.maxCorrelation(row.factor)),
      factor: row.factor,
    };
  }

  console.log(`  ✓ Crypto factors: ${universe.length} assets, leader=${rotation.leader_20d}, history=${factorHistory.length} days, spread_history=${spreadHistory.length} days`);

  // 14. Build compact snapshot data (don't store full candle data — too large)
  const factorData = {
    timestamp: new Date().toISOString(),
    as_of: today,
    universe_size: universe.length,
    leader: rotation.leader_20d,
    leader_held_days: confirmedRotation.heldSessions,
    flip_flag: confirmedRotation.flipFlag,
    flip_confirmed: confirmedRotation.confirmed,
    previous_leader: confirmedRotation.previousLabel,
    trailing_20d_returns: rotation.trailing_20d_returns,
    spread_monitor: Object.values(spreadMonitor).map(row => ({
      factor: row.factor,
      label: row.label,
      spread_20d: row.spread_20d ? { ret: row.spread_20d.ret, z: row.spread_20d.z, pctile: row.spread_20d.pctile } : null,
      rel_20d: row.rel_20d ? { ret: row.rel_20d.ret, z: row.rel_20d.z, pctile: row.rel_20d.pctile } : null,
      spread_5d: row.spread_5d ? { ret: row.spread_5d.ret, z: row.spread_5d.z, pctile: row.spread_5d.pctile } : null,
      spread_1d: row.spread_1d ? { ret: row.spread_1d.ret, z: row.spread_1d.z, pctile: row.spread_1d.pctile } : null,
      spread_60d: row.spread_60d ? { ret: row.spread_60d.ret, z: row.spread_60d.z, pctile: row.spread_60d.pctile } : null,
    })),
    // Server-side crowding matrix (computed from 90-day accumulated history)
    crowding: {
      matrix: historyCrowding.matrix,
      max_correlations: Object.fromEntries(
        FACTORS.map(f => [f, historyCrowding.maxCorrelation(f)])
      ),
    },
    // Server-side stances (computed from spread z + crowding + rotation)
    stances,
  };

  return {
    factorData,
    factorHistory,
    spreadHistory,
  };
}

/**
 * Lightweight stance computation for server-side use.
 * Mirrors computeFactorStance but without importing the full compositeEngine
 * (which has React-incompatible import paths in some environments).
 */
function computeStanceFromSpread(spread20d, rotation, crowdingScore) {
  const z = spread20d?.z ?? 0;
  const absZ = Math.abs(z);
  const crowded = (crowdingScore ?? 0) > 0.7;
  const confirmed = rotation?.confirmed ?? false;

  let stance, confidence;

  if (absZ >= 2.0 && confirmed && !crowded) {
    stance = 'CONSTRUCTIVE';
    confidence = 7;
  } else if (absZ >= 2.0 && confirmed && crowded) {
    stance = 'SELECTIVE';
    confidence = 5;
  } else if (absZ >= 2.0 && !confirmed) {
    stance = 'WAIT';
    confidence = 3;
  } else if (absZ >= 1.0 && confirmed) {
    stance = 'SELECTIVE';
    confidence = 5;
  } else if (absZ >= 2.0 && z < 0) {
    stance = 'DEFENSIVE';
    confidence = 6;
  } else {
    stance = 'WAIT';
    confidence = 2;
  }

  if (crowded && stance === 'CONSTRUCTIVE') {
    stance = 'SELECTIVE';
    confidence = Math.min(confidence, 5);
  }

  return { stance, confidence, crowdingScore };
}
