/**
 * Macro Resolver — multi-source fallback chain for macro economic data.
 *
 * Each FRED series has a fallback chain. The resolver tries each source in order;
 * first successful non-empty response wins.
 *
 * Architecture:
 *   1. fred_proxy (baked snapshot.json — primary source, contains all 11 FRED series)
 *   2. alphavantage (live fallback for CPI, M2, ICSA)
 *   3. treasury_gov (live fallback for TGA, RRP)
 *
 * If all sources fail, returns empty array — regime engine has graceful degradation.
 */

import * as alphaVantage from './macroSources/alphaVantage.js';
import * as treasuryGov from './macroSources/treasuryGov.js';
import * as fredProxy from './macroSources/fredProxy.js';

// Series-level cache (avoids re-fetching same series within 5 min)
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Chain definitions — order = priority
const CHAINS = {
  // Inflation
  CPIAUCSL:   [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('CPIAUCSL') },
               { id: 'alphavantage',   fetch: () => alphaVantage.fetchCPI() }],

  T10YIE:     [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('T10YIE') }],
  T5YIFR:     [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('T5YIFR') }],

  // Liquidity
  M2SL:       [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('M2SL') },
               { id: 'alphavantage',   fetch: () => alphaVantage.fetchM2() }],
  WALCL:      [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('WALCL') }],
  WTREGEN:    [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('WTREGEN') },
               { id: 'treasury_gov',   fetch: () => treasuryGov.fetchTGA() }],
  RRPONTSYD:  [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('RRPONTSYD') },
               { id: 'treasury_gov',   fetch: () => treasuryGov.fetchRRP() }],
  WRESBAL:    [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('WRESBAL') }],
  NFCI:       [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('NFCI') }],

  // Growth / Risk
  ICSA:       [{ id: 'fred_proxy',     fetch: () => fredProxy.fetchSeries('ICSA') },
               { id: 'alphavantage',   fetch: () => alphaVantage.fetchInitialClaims() }],
  BAMLH0A0HYM2: [{ id: 'fred_proxy',   fetch: () => fredProxy.fetchSeries('BAMLH0A0HYM2') }],
};

/**
 * Fetch a macro series by FRED-style id.
 * @returns {Promise<{source: string|null, series: Array}>}
 */
export async function fetchSeries(seriesId) {
  // Check cache
  const cacheKey = seriesId;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  const chain = CHAINS[seriesId] || [];
  for (const src of chain) {
    try {
      const series = await src.fetch();
      if (series && series.length > 0) {
        const value = { source: src.id, series };
        _cache.set(cacheKey, { ts: Date.now(), value });
        return value;
      }
    } catch (e) {
      console.warn(`[macroResolver] ${src.id} failed for ${seriesId}: ${e.message}`);
    }
  }

  const value = { source: null, series: [] };
  _cache.set(cacheKey, { ts: Date.now(), value });
  return value;
}

/**
 * Fetch ALL macro series in parallel. Used by regimeSources.js to populate the regime engine.
 *
 * @returns {Promise<{series: object, sources: object, available: boolean}>}
 */
export async function fetchAllMacro() {
  const seriesIds = Object.keys(CHAINS);
  const results = await Promise.all(seriesIds.map(id => fetchSeries(id).then(r => ({ id, ...r }))));

  const series = {};
  const sources = {};
  let anyAvailable = false;

  for (const r of results) {
    series[r.id] = r.series;
    sources[r.id] = r.source;
    if (r.series.length > 0) anyAvailable = true;
  }

  return { series, sources, available: anyAvailable };
}

/**
 * Compute FRED_NET_LIQUIDITY (derived series, matches FRED's calculation):
 *   Fed Assets (WALCL) − TGA (WTREGEN) − RRP (RRPONTSYD), in $ trillions
 */
export function computeNetLiquidity(series) {
  const { WALCL = [], WTREGEN = [], RRPONTSYD = [] } = series;
  if (!WALCL.length || !WTREGEN.length || !RRPONTSYD.length) return [];

  // Align by date
  const dates = new Set([
    ...WALCL.map(d => d.date),
    ...WTREGEN.map(d => d.date),
    ...RRPONTSYD.map(d => d.date),
  ]);

  return Array.from(dates).sort().map(date => {
    const walcl = WALCL.find(d => d.date === date);
    const wtregen = WTREGEN.find(d => d.date === date);
    const rrp = RRPONTSYD.find(d => d.date === date);
    if (!walcl || !wtregen || !rrp) return null;
    return {
      date,
      time: walcl.time,
      // All three are in millions of $ → divide by 1e6 for trillions
      value: (walcl.value - wtregen.value - rrp.value) / 1e6,
    };
  }).filter(Boolean);
}
