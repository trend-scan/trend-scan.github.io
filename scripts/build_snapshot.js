#!/usr/bin/env node
/**
 * build_snapshot.js — Daily pre-build of macro + crypto data.
 *
 * Runs in GitHub Actions daily (and on every push to main).
 * Outputs:
 *   - public/snapshot.json — small (~700 KB) file consumed by every page.
 *     Contains FRED, CoinGecko, Fear&Greed, Ken French, CBOE, ETF flows.
 *   - public/snapshot.tradfi.json — large (~13 MB) file lazy-loaded only
 *     when the Board or Macro page needs tradfi OHLCV. Keeping this in a
 *     separate file avoids bloating the first paint of every page.
 *
 * What this script fetches server-side (using secrets):
 *   - FRED macro series (uses FRED_API_KEY from environment)
 *   - Top 100 crypto market data from CoinGecko (no key)
 *   - Tradfi OHLCV from Yahoo Finance (no key, no CORS server-side)
 *   - ETF flows from Farside (no key)
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
import { fetchFactorWatch } from './scrapers/factorWatch.js';
import { computeCryptoFactors } from './compute_crypto_factors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────────────────────

// FRED API key — MUST be provided via the FRED_API_KEY environment variable
// (configured in GitHub Actions secrets). No hardcoded fallback: a missing
// key fails loudly so we notice, rather than silently shipping an empty
// snapshot. The key is server-side only and is NOT baked into the client
// bundle — the browser only ever sees the resulting snapshot.json.
const FRED_API_KEY = process.env.FRED_API_KEY;

// Load previous snapshot for stale-data fallback
// Audit F-14-a-16: log parse failures so silent history-reset is visible.
let _prevSnapshot = null;
try {
  _prevSnapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "snapshot.json"), "utf8"));
} catch (e) {
  if (fs.existsSync(path.join(ROOT, "public", "snapshot.json"))) {
    console.warn(`⚠ Could not parse previous snapshot.json: ${e.message} — rolling histories will reset.`);
  }
}
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

// Audit F-14-a-5: redact api_key query param from error messages so secrets are
// not leaked to stdout/stderr (and thus GitHub Actions logs).
function redactUrl(u) {
  return u.replace(/([?&])(api_key|apikey|token|access_token)=([^&]*)/g, '$1$2=***');
}

// Audit F-14-a-8: default 15s timeout via AbortSignal.timeout so a single hung
// endpoint cannot consume the entire workflow timeout-minutes: 10 budget.
async function fetchJson(url, opts = {}) {
  const signal = opts.signal || AbortSignal.timeout(15000);
  const res = await fetch(url, { ...opts, signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${redactUrl(url)}`);
  }
  return res.json();
}

async function fetchText(url, opts = {}) {
  const signal = opts.signal || AbortSignal.timeout(15000);
  const res = await fetch(url, { ...opts, signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${redactUrl(url)}`);
  }
  return res.text();
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
  // Audit F-14-a-5: the api_key is in the URL, but fetchJson's redactUrl() will strip
  // it from any thrown error message before it hits stdout/stderr.
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

// ─── Crypto Universe (top 500 by market cap) — for the Scanner ───────────────
// Used by the Scanner page to determine which 500 coins to scan. Baked into
// snapshot.json as `crypto_universe` so the client doesn't have to hit
// CoinGecko/CMC on every SCAN press (avoids rate limits).
//
// Source priority:
//   1. CoinMarketCap (if CMC_API_KEY env var is set) — 1 credit/call, returns
//      up to 5000 coins. Free tier: 10k credits/month. CMC rankings are the
//      industry standard and more reliable for long-tail coins.
//   2. CoinGecko (free, no key) — 2 pages × 250 = 500 coins. Used as fallback
//      when CMC key is not set or CMC fails.
//
// Returns: { SYMBOL: { symbol, name, marketCapRank, marketCap, volume24h, slug? } }
// The Scanner's fetchTop500() reads this from snapshot.json and applies its own
// stablecoin/wrapped/USD-pegged filters client-side.

const CMC_API_KEY = process.env.CMC_API_KEY;

// ─── CMC credit usage monitoring (FREE — 0 credits) ──────────────────────────
// /v1/key/info is the one endpoint that doesn't cost credits. Logs our current
// month's usage so we can see credit burn rate and avoid exhausting the budget.
async function logCMCCreditUsage() {
  if (!CMC_API_KEY) return;
  try {
    const res = await fetchJson('https://pro-api.coinmarketcap.com/v1/key/info', {
      headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY },
    });
    const plan = res?.data?.plan;
    if (plan) {
      const used = plan.current_credits_used || 0;
      const limit = plan.monthly_credit_limit || 15000;
      const remaining = plan.current_credits_remaining ?? (limit - used);
      const pct = limit > 0 ? ((used / limit) * 100).toFixed(1) : '?';
      console.log(`── CMC credit usage ──`);
      console.log(`  Plan: ${plan.name || 'Basic'} | ${used.toLocaleString()} / ${limit.toLocaleString()} credits used (${pct}%) | ${remaining.toLocaleString()} remaining`);
    }
  } catch (e) {
    console.warn(`  ⚠ CMC key/info failed: ${e.message}`);
  }
}

async function fetchCryptoUniverseCMC() {
  if (!CMC_API_KEY) return null;
  console.log('── Crypto universe (CMC, top 500) ──');
  try {
    // 1 credit per call. limit=500 returns top 500 by market cap.
    // sort=market_cap_strict ensures CMC rank order (not volume or other).
    // aux=tags,platform,date_added,cmc_rank — includes extra fields in response.
    const url = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest' +
      '?limit=500&sort=market_cap_strict&sort_dir=desc&cryptocurrency_type=all' +
      '&aux=num_market_pairs,cmc_rank,date_added,tags,platform,max_supply,circulating_supply,total_supply';
    const res = await fetchJson(url, { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY } });
    if (!res || !Array.isArray(res.data)) throw new Error('Unexpected CMC response');
    const out = {};
    for (const c of res.data) {
      const sym = c.symbol.toUpperCase();
      // Skip duplicates (keep highest rank)
      if (out[sym] && out[sym].marketCapRank <= c.cmc_rank) continue;
      const q = c.quote?.USD || {};
      out[sym] = {
        symbol: sym,
        id: c.id,  // CMC numeric ID — used for /info endpoint (more reliable than symbol)
        name: c.name,
        slug: c.slug,
        marketCapRank: c.cmc_rank || 999,
        marketCap: q.market_cap || 0,
        fullyDilutedMarketCap: q.fully_diluted_market_cap || 0,
        volume24h: q.volume_24h || 0,
        volumeChange24h: q.volume_change_24h || 0,
        // Multi-timeframe price changes (1h/24h/7d/30d/60d/90d)
        change1h: q.percent_change_1h,
        change24h: q.percent_change_24h,
        change7d: q.percent_change_7d,
        change30d: q.percent_change_30d,
        change60d: q.percent_change_60d,
        change90d: q.percent_change_90d,
        // Supply metrics
        circulatingSupply: c.circulating_supply,
        totalSupply: c.total_supply,
        maxSupply: c.max_supply,
        numMarketPairs: c.num_market_pairs,
        dateAdded: c.date_added,
        // Platform (chain) — null for native L1 coins (BTC, ETH, SOL, etc.)
        platform: c.platform ? c.platform.name : null,
        // Tags array (e.g. ["defi", "dao", "governance"]) — populated by /info endpoint below
        tags: [],
        source: 'cmc',
      };
    }
    console.log(`  ✓ CMC supplied ${Object.keys(out).length} coins (used 1 credit)`);
    return out;
  } catch (e) {
    console.warn(`  ✗ CMC failed: ${e.message}`);
    return null;
  }
}

// ─── CMC metadata: tags + platform detail (Phase 2) ──────────────────────────
// /v1/cryptocurrency/info returns tags array + platform token_address + logo +
// description + URLs. We use tags for sector filtering (DeFi, AI, Memes, etc.)
// and platform for chain filtering (Ethereum, Solana, BNB, etc.).
//
// Uses CMC numeric `id` instead of `symbol` — more reliable (some symbols like
// "SUSD1+" or "USDC.E" cause HTTP 400 on the /info endpoint when passed as
// symbol parameter, but IDs are always clean integers).
//
// Credit cost: 1 credit per call, max 100 IDs per call.
// For 500-coin universe: 5 calls = 5 credits per refresh × 4 daily = 20 credits/day.
// At 4× daily refresh = 600 credits/month (4% of 15,000 free budget).
async function fetchCryptoMetadata(ids) {
  if (!CMC_API_KEY || !ids || ids.length === 0) return {};
  console.log(`── CMC metadata (tags + platform, ${ids.length} coins by ID) ──`);
  const out = {};
  const BATCH_SIZE = 100;
  let creditsUsed = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const idParam = batch.join(',');
    try {
      const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/info?id=${idParam}&aux=platform,tags,urls,logo,description`;
      const res = await fetchJson(url, { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY } });
      creditsUsed++;
      if (!res?.data) throw new Error('Unexpected CMC info response');
      // /info returns data keyed by ID — need to look up symbol from the universe
      for (const [id, c] of Object.entries(res.data)) {
        const sym = (c.symbol || '').toUpperCase();
        if (!sym) continue;
        out[sym] = {
          tags: Array.isArray(c.tags) ? c.tags : [],
          platform: c.platform ? c.platform.name : null,
          platformTokenAddress: c.platform ? c.platform.token_address : null,
          category: c.category || null,
          logo: c.logo || null,
          description: c.description || null,
          urls: c.urls || {},
          dateLaunched: c.date_launched || null,
        };
      }
    } catch (e) {
      console.warn(`  ✗ CMC info batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${e.message}`);
    }
    // Small delay between batches (50 req/min limit, but be polite)
    if (i + BATCH_SIZE < ids.length) await new Promise(r => setTimeout(r, 300));
  }
  console.log(`  ✓ CMC metadata for ${Object.keys(out).length} coins (used ${creditsUsed} credits)`);
  return out;
}

// ─── CMC Trending / Gainers / Losers (Phase 3a — data only, NO UI yet) ───────
// Trending endpoints from CMC. Endpoint URLs verified against OpenCMC official
// skills repo (https://github.com/OpenCMC/skills-for-ai-agents-by-CoinMarketCap).
//
// Credit cost: 1 credit per call. We make 4 calls per refresh:
//   - trending/latest (top trending by social/search activity)
//   - trending/gainers-losers?sort_dir=desc (top gainers)
//   - trending/gainers-losers?sort_dir=asc (top losers)
//   - trending/most-visited (most visited CMC pages)
//   - community/trending/token (community mentions + sentiment) — bonus
// Total: 5 credits per refresh × 4 daily = 20 credits/day.
// Stored in snapshot as `cmc_trending` for future Board section. NOT surfaced in
// UI yet per user instruction (2026-07-24).
async function fetchCMCTrending() {
  if (!CMC_API_KEY) return null;
  console.log('── CMC trending / gainers / losers / community ──');
  const out = { trending: [], gainers: [], losers: [], mostVisited: [], community: [] };
  let creditsUsed = 0;

  // 1. Trending latest (social/search activity)
  try {
    const res = await fetchJson(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/trending/latest?limit=20&time_period=24h',
      { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY } }
    );
    creditsUsed++;
    if (Array.isArray(res?.data)) {
      out.trending = res.data.map(c => mapCMCTrendingCoin(c));
    }
  } catch (e) { console.warn(`  ✗ CMC trending/latest failed: ${e.message}`); }

  // 2. Gainers (sort_dir=desc = highest % gain first)
  try {
    const res = await fetchJson(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/trending/gainers-losers?limit=20&time_period=24h&sort_dir=desc',
      { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY } }
    );
    creditsUsed++;
    if (Array.isArray(res?.data)) {
      out.gainers = res.data.map(c => mapCMCTrendingCoin(c));
    }
  } catch (e) { console.warn(`  ✗ CMC gainers failed: ${e.message}`); }

  // 3. Losers (sort_dir=asc = lowest % change first)
  try {
    const res = await fetchJson(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/trending/gainers-losers?limit=20&time_period=24h&sort_dir=asc',
      { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY } }
    );
    creditsUsed++;
    if (Array.isArray(res?.data)) {
      out.losers = res.data.map(c => mapCMCTrendingCoin(c));
    }
  } catch (e) { console.warn(`  ✗ CMC losers failed: ${e.message}`); }

  // 4. Most visited (user attention, not price-based)
  try {
    const res = await fetchJson(
      'https://pro-api.coinmarketcap.com/v1/cryptocurrency/trending/most-visited?limit=20&time_period=24h',
      { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY } }
    );
    creditsUsed++;
    if (Array.isArray(res?.data)) {
      out.mostVisited = res.data.map(c => mapCMCTrendingCoin(c));
    }
  } catch (e) { console.warn(`  ✗ CMC most-visited failed: ${e.message}`); }

  // 5. Community trending (mentions + sentiment — bonus data)
  try {
    const res = await fetchJson(
      'https://pro-api.coinmarketcap.com/v1/community/trending/token?limit=20&time_period=24h',
      { headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY } }
    );
    creditsUsed++;
    if (Array.isArray(res?.data)) {
      out.community = res.data.map(c => ({
        symbol: (c.symbol || '').toUpperCase(),
        name: c.name,
        slug: c.slug,
        cmcRank: c.rank || c.cmc_rank,
        trendingRank: c.trending_rank,
        trendingScore: c.trending_score,
        mentionCount: c.mention_count,
        postCount: c.post_count,
        engagementScore: c.engagement_score,
        sentiment: c.sentiment,
        sentimentScore: c.sentiment_score,
        price: c.quote?.USD?.price,
        percentChange24h: c.quote?.USD?.percent_change_24h,
      }));
    }
  } catch (e) { console.warn(`  ✗ CMC community/trending/token failed: ${e.message}`); }

  console.log(`  ✓ CMC trending: ${out.trending.length} trending, ${out.gainers.length} gainers, ${out.losers.length} losers, ${out.mostVisited.length} most-visited, ${out.community.length} community (used ${creditsUsed} credits)`);
  return out;
}

// Helper: map a CMC trending coin response to our compact format
function mapCMCTrendingCoin(c) {
  return {
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    slug: c.slug,
    cmcRank: c.cmc_rank,
    price: c.quote?.USD?.price,
    percentChange24h: c.quote?.USD?.percent_change_24h,
    percentChange1h: c.quote?.USD?.percent_change_1h,
    percentChange7d: c.quote?.USD?.percent_change_7d,
    volume24h: c.quote?.USD?.volume_24h,
    marketCap: c.quote?.USD?.market_cap,
    tags: Array.isArray(c.tags) ? c.tags.slice(0, 5) : [],
    platform: c.platform ? c.platform.name : null,
  };
}

// ─── CMC global metrics (Phase 3b — data only, NO UI yet) ────────────────────
// 1 credit per call. Returns BTC/ETH dominance, total mcap, total volume, active
// cryptos/markets/exchanges counts. Stored as `global_metrics` for future Macro
// page enhancement. NOT surfaced in UI yet per user instruction (2026-07-24).
// Note: we already compute BTC dominance historically from CoinGecko; this is
// the "official" CMC current value.
async function fetchGlobalMetrics() {
  if (!CMC_API_KEY) return null;
  console.log('── CMC global metrics ──');
  try {
    const res = await fetchJson('https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest', {
      headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY },
    });
    if (!res?.data) throw new Error('Unexpected CMC global response');
    const d = res.data;
    const q = d.quote?.USD || {};
    const out = {
      btcDominance: d.btc_dominance,
      ethDominance: d.eth_dominance,
      activeCryptocurrencies: d.active_cryptocurrencies,
      activeMarkets: d.active_markets,
      activeExchanges: d.active_exchanges,
      totalMarketCap: q.total_market_cap,
      totalVolume24h: q.total_volume_24h,
      totalVolume24hReported: q.total_volume_24h_reported,
      altcoinMarketCap: q.altcoin_market_cap,
      altcoinVolume24h: q.altcoin_volume_24h,
      lastUpdated: q.last_updated,
      source: 'cmc',
    };
    console.log(`  ✓ CMC global: BTC dom ${(out.btcDominance || 0).toFixed(1)}%, total mcap $${((out.totalMarketCap || 0) / 1e12).toFixed(2)}T, ${out.activeCryptocurrencies} active coins (used 1 credit)`);
    return out;
  } catch (e) {
    console.warn(`  ✗ CMC global metrics failed: ${e.message}`);
    return null;
  }
}


async function fetchCryptoUniverseCoinGecko() {
  console.log('── Crypto universe (CoinGecko, top 500) ──');
  const out = {};
  try {
    for (let page = 1; page <= 2; page++) {
      const url = 'https://api.coingecko.com/api/v3/coins/markets' +
        `?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`;
      const data = await fetchJson(url);
      if (!Array.isArray(data)) throw new Error('Unexpected CoinGecko response');
      for (const c of data) {
        const sym = c.symbol.toUpperCase();
        if (out[sym] && out[sym].marketCapRank <= (c.market_cap_rank || 999)) continue;
        out[sym] = {
          symbol: sym,
          name: c.name,
          marketCapRank: c.market_cap_rank || 999,
          marketCap: c.market_cap || 0,
          volume24h: c.total_volume || 0,
          source: 'coingecko',
        };
      }
      if (page < 2) await new Promise(r => setTimeout(r, 1300));  // respect CoinGecko rate limit
    }
    console.log(`  ✓ CoinGecko supplied ${Object.keys(out).length} coins`);
  } catch (e) {
    console.warn(`  ✗ CoinGecko universe failed: ${e.message}`);
  }
  return out;
}

async function fetchCryptoUniverse() {
  // 1. CMC (preferred — better rankings, 1 credit)
  let universe = await fetchCryptoUniverseCMC();
  if (universe && Object.keys(universe).length >= 400) return universe;

  // 2. CoinGecko fallback (free, 2 pages)
  console.log('  Falling back to CoinGecko for universe...');
  universe = await fetchCryptoUniverseCoinGecko();
  if (Object.keys(universe).length >= 400) return universe;

  // 3. Empty — caller will fall back to previous snapshot or live client-side fetch
  console.warn('  ⚠ Both CMC and CoinGecko failed for universe — snapshot will have no crypto_universe');
  return {};
}

// ─── Binance Futures OI — server-side batch fetch ────────────────────────────
// Binance has no batch OI endpoint, so we fetch per-symbol in parallel batches.
// This runs server-side during snapshot build (4× daily), so the data is at most
// 4h old when displayed. Binance is the largest perp exchange by OI (~19% of total
// crypto OI per Coinglass), so this is critical data.
//
// Rate limit: 2400 weight/min. Each /fapi/v1/openInterest call = 1 weight.
// 530 symbols × 1 weight = 530 weights, well under the limit.
// Also fetches /fapi/v1/premiumIndex (1 call, all symbols) for funding rates.
//
// Returns: { SYMBOL: { oiUsd, oiCoin, fundingRate } }
//
// Primary: OKX SWAP perps (not geo-blocked from GitHub Actions).
// Fallback: Binance fapi (may be geo-blocked with HTTP 451 from US servers).
//
// OKX provides OI + funding rate in a single batch call (/public/open-interest),
// making it much more efficient than Binance's per-symbol approach.
async function fetchBinanceOI() {
  console.log('── Futures OI (OKX primary, Binance fallback) ──');
  const out = {};

  // ── Primary: OKX SWAP perps ──
  // OKX /public/open-interest returns ALL SWAP instruments in one call.
  // /public/funding-rate returns current funding rates for all SWAPs.
  // /market/tickers returns mark prices for OI→USD conversion.
  try {
    // OKX /public/open-interest returns ALL SWAP instruments in one call.
    // /market/tickers returns last prices for OI→USD conversion.
    // Funding rates: OKX /public/funding-rate requires per-instrument calls,
    // so we skip batch funding rates from OKX. The boardEngine falls back to
    // Hyperliquid funding rates (which ARE available client-side).
    const [oiRes, tickerRes] = await Promise.all([
      fetchJson('https://www.okx.com/api/v5/public/open-interest?instType=SWAP'),
      fetchJson('https://www.okx.com/api/v5/market/tickers?instType=SWAP'),
    ]);

    if (oiRes?.data && tickerRes?.data) {
      // Build price map from tickers
      const priceMap = new Map();
      for (const t of tickerRes.data) {
        priceMap.set(t.instId, parseFloat(t.last || '0'));
      }
      // Process OI — only USDT-quoted SWAPs
      for (const oi of oiRes.data) {
        const instId = oi.instId || '';
        // Format: BTC-USDT-SWAP → extract base asset "BTC"
        const parts = instId.split('-');
        if (parts.length < 3 || parts[1] !== 'USDT') continue;
        const base = parts[0];
        const oiCoin = parseFloat(oi.oi || '0');
        const price = priceMap.get(instId) ?? 0;
        const oiUsd = oiCoin * price;
        const fundingRate = null; // OKX funding rates require per-instrument calls; skipped
        if (oiUsd > 0) {
          out[base] = { oiUsd, oiCoin, fundingRate };
        }
      }
      console.log(`  ✓ OKX OI: ${Object.keys(out).length} assets with OI data`);
    }
  } catch (e) {
    console.warn(`  ✗ OKX OI failed: ${e.message}`);
  }

  // ── Fallback: Binance fapi (if OKX returned < 50 assets) ──
  if (Object.keys(out).length < 50) {
    console.log('  ⚠ OKX OI insufficient, trying Binance fallback...');
    try {
      const exchangeInfo = await fetchJson('https://fapi.binance.com/fapi/v1/exchangeInfo');
      const perpSymbols = (exchangeInfo.symbols || [])
        .filter(s => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
        .map(s => ({ base: s.baseAsset, symbol: s.symbol }));

      const premiumIndex = await fetchJson('https://fapi.binance.com/fapi/v1/premiumIndex');
      const fundingMap = new Map();
      for (const p of premiumIndex) {
        fundingMap.set(p.symbol, {
          fundingRate: parseFloat(p.lastFundingRate || '0'),
          markPrice: parseFloat(p.markPrice || '0'),
        });
      }

      const BATCH_SIZE = 20;
      for (let i = 0; i < perpSymbols.length; i += BATCH_SIZE) {
        const batch = perpSymbols.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async ({ base, symbol }) => {
            const res = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
            if (!res.ok) return null;
            const d = await res.json();
            const oiCoin = parseFloat(d.openInterest || '0');
            const pi = fundingMap.get(symbol);
            const markPrice = pi?.markPrice ?? 0;
            const fundingRate = pi?.fundingRate ?? null;
            return { base, oiCoin, oiUsd: oiCoin * markPrice, fundingRate };
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value && r.value.oiUsd > 0 && !out[r.value.base]) {
            out[r.value.base] = {
              oiUsd: r.value.oiUsd,
              oiCoin: r.value.oiCoin,
              fundingRate: r.value.fundingRate,
            };
          }
        }
      }
      console.log(`  ✓ Binance OI fallback: ${Object.keys(out).length} total assets`);
    } catch (e) {
      console.warn(`  ✗ Binance OI fallback failed: ${e.message}`);
    }
  }

  return out;
}

// ─── CoinGecko historical market charts (for Ultra6+OB1 allocation) ──────────
// Fetches BTC + ETH daily price + volume history, plus global market cap chart
// for dominance series. These are needed to compute the allocation signal
// (Ultra6 + OB1) server-side so every user sees the same value.

async function fetchCoinGeckoHistorical() {
  console.log('── CoinGecko historical (BTC/ETH/global) ──');
  try {
    // Use Promise.allSettled instead of Promise.all so that if ONE endpoint
    // fails (e.g. /global/market_cap_chart returns 401 requiring paid plan),
    // we still get the BTC + ETH data from the other endpoints.
    const [btcResult, ethResult, globalResult] = await Promise.allSettled([
      fetchJson('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily'),
      fetchJson('https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=365&interval=daily'),
      fetchJson('https://api.coingecko.com/api/v3/global/market_cap_chart?vs_currency=usd&days=365'),
    ]);

    const btcRes = btcResult.status === 'fulfilled' ? btcResult.value : {};
    const ethRes = ethResult.status === 'fulfilled' ? ethResult.value : {};
    const globalRes = globalResult.status === 'fulfilled' ? globalResult.value : {};

    if (globalResult.status === 'rejected') {
      console.log('  ⚠ CoinGecko global chart unavailable (likely 401 — paid plan required), continuing with BTC/ETH only');
    }

    const btcPrices = (btcRes.prices || []).map(p => p[1]);
    const btcVolumes = (btcRes.total_volumes || []).map(v => v[1]);
    const ethPrices = (ethRes.prices || []).map(p => p[1]);
    const ethBtcRatio = btcPrices.map((btc, i) => btc > 0 ? (ethPrices[i] || 0) / btc : 0);

    // Compute dominance from global market cap chart (may be empty if
    // the /global/market_cap_chart endpoint returned 401)
    const globalMcaps = globalRes.market_cap_by_currency?.usd || globalRes.market_caps || [];
    const btcMcaps = (btcRes.market_caps || []).map(m => m[1]);
    const ethMcaps = (ethRes.market_caps || []).map(m => m[1]);

    // Approximate BTC dominance as BTC mcap / total mcap
    const btcDominance = globalMcaps.map((g, i) => {
      const total = g[1] || 0;
      const btc = btcMcaps[i] || 0;
      return total > 0 ? (btc / total) * 100 : 0;
    });

    // USDT dominance — CoinGecko's global chart doesn't break out USDT
    // historically, and the /coins/tether/market_chart endpoint is
    // rate-limited (429). We approximate USDT dominance as:
    //   (total_mcap - btc_mcap - eth_mcap) * stablecoin_share
    //
    // Per CMC global_metrics (fetched separately), stablecoins ex-USDT
    // (USDC, DAI, FDUSD, etc.) account for ~3% of total mcap. USDT itself
    // is ~8% currently. So the "non-BTC, non-ETH" residual is ~31% of
    // total mcap, of which USDT is roughly 8/11 ≈ 73%.
    //
    // This produces a real (varying) USDT dominance series that drives
    // meaningful z-scores for the L2 liquidity signal + G6 growth signal.
    // Previously this was a flat 5.0 constant → z-score always 0 → signal
    // was dead weight in the composite.
    const usdtDominance = globalMcaps.map((g, i) => {
      const total = g[1] || 0;
      const btc = btcMcaps[i] || 0;
      const eth = ethMcaps[i] || 0;
      if (total <= 0) return 5.0;
      const residual = total - btc - eth;  // all non-BTC, non-ETH
      // USDT is ~73% of the stablecoin portion of the residual
      return Math.max(0, (residual / total) * 100 * 0.73);
    });

    console.log(`  ✓ BTC: ${btcPrices.length} prices, ${btcVolumes.length} volumes`);
    console.log(`  ✓ ETH: ${ethPrices.length} prices`);
    console.log(`  ✓ Global: ${globalMcaps.length} market caps, BTC dominance computed`);
    console.log(`  ✓ USDT dominance: derived from residual (last: ${usdtDominance.at(-1)?.toFixed(2)}%)`);

    return {
      btcPrice: btcPrices,
      ethPrice: ethPrices,
      btcVolume: btcVolumes,
      ethBtcRatio,
      btcDominance,
      usdtDominance,
    };
  } catch (e) {
    console.warn(`  ✗ CoinGecko historical: ${e.message}`);
    return { btcPrice: [], ethPrice: [], btcVolume: [], ethBtcRatio: [], btcDominance: [], usdtDominance: [] };
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

// ─── CBOE Put/Call Ratios (free CSV, no key) ─────────────────────────────────
// Source: https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/
// Tracks equity, index, and total market put/call ratios — a key sentiment indicator.

// ─── CBOE VIX real-time (free JSON API) ─────────────────────────────────────
// The old CBOE P/C ratio CSVs (equitypc.csv, indexpc.csv, totalpc.csv) stopped
// updating in October 2019 — CBOE deprecated them. We now use the CBOE delayed
// quotes JSON API for real-time VIX data. Historical VIX OHLCV comes from the
// Yahoo ^VIX fetch (part of the tradfi snapshot).
async function fetchVIXRealtime() {
  console.log('── CBOE VIX real-time ──');
  try {
    const res = await fetch('https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json');
    if (!res.ok) { console.warn(`  ✗ CBOE VIX: HTTP ${res.status}`); return null; }
    const d = await res.json();
    const vix = d?.data;
    if (!vix) return null;
    const out = {
      price: vix.current_price,
      change: vix.price_change,
      changePercent: vix.price_change_percent,
      open: vix.open,
      high: vix.high,
      low: vix.low,
      close: vix.close,
      prevClose: vix.prev_day_close,
      timestamp: d?.timestamp,
      lastTradeTime: vix.last_trade_time,
    };
    console.log(`  ✓ VIX: ${out.price} (${out.changePercent > 0 ? '+' : ''}${out.changePercent.toFixed(2)}%)`);
    return out;
  } catch (e) {
    console.warn(`  ✗ CBOE VIX: ${e.message}`);
    return null;
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

// ─── Farside ETF Flows — daily net flow data for BTC, ETH, SOL, HYPE ──────────
// Farside.co.uk publishes daily ETF flow data in HTML tables.
// We parse the tables server-side (CORS-blocked in browser) and store the
// last 7 days of total net flow in the snapshot.

const FARSIDE_PAGES = {
  BTC: ['https://farside.co.uk/bitcoin-etf-flow-all-data/', 'https://farside.co.uk/btc/'],
  ETH: ['https://farside.co.uk/ethereum-etf-flow-all-data/', 'https://farside.co.uk/eth/'],
  SOL: ['https://farside.co.uk/solana-etf-flow-all-data/', 'https://farside.co.uk/sol/'],
  HYPE: ['https://farside.co.uk/hyperliquid-etf-flow-all-data/', 'https://farside.co.uk/hyp/'],
};

function parseFarsideTable(html) {
  // Extract all tables from HTML, return array of { date, total } objects.
  // The BTC page has multiple tables (summary + detailed); we want the one
  // with the most date-like rows.
  // The table has columns: Date, ETF1, ETF2, ..., Total
  // Values are in US$ millions. Negatives use parentheses: (59.1)
  // "-" means no data (market closed)
  const tableMatches = html.match(/<table[^>]*>([\s\S]*?)<\/table>/g) || [];
  if (tableMatches.length === 0) return [];

  let bestResult = [];
  let bestDateCount = 0;

  for (const tableHtml of tableMatches) {
    const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    const result = [];

    for (const row of rows) {
      const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) || [])
        .map(c => c.replace(/<[^>]+>/g, '').trim());

      if (cells.length < 2) continue;

      // First cell is the date (e.g. "10 Jul 2026") or a label ("Total", "Average")
      const first = cells[0];
      if (!first || first === 'Fee' || first === 'Staking fee' || first === 'Seed') continue;

      // Skip summary rows
      if (['Total', 'Average', 'Maximum', 'Minimum'].includes(first)) continue;

      // Parse date (e.g. "10 Jul 2026" → ISO)
      const dateMatch = first.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
      if (!dateMatch) continue;
      const [, day, month, year] = dateMatch;
      const date = new Date(`${day} ${month} ${year}`).toISOString().slice(0, 10);

      // Last cell is the Total column
      const totalStr = cells[cells.length - 1];
      if (totalStr === '-' || totalStr === '') continue;

      // Parse value: "(59.1)" → -59.1, "86.8" → 86.8, "60,286" → 60286
      const cleaned = totalStr.replace(/,/g, '');
      let total;
      if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
        total = -parseFloat(cleaned.slice(1, -1));
      } else {
        total = parseFloat(cleaned);
      }
      if (isNaN(total)) continue;

      result.push({ date, total });
    }

    // Pick the table with the most date rows (the detailed flow table)
    if (result.length > bestDateCount) {
      bestDateCount = result.length;
      bestResult = result;
    }
  }

  return bestResult;
}

async function fetchFarsideETFFlows() {
  const out = {};

  for (const [asset, urls] of Object.entries(FARSIDE_PAGES)) {
    const urlList = Array.isArray(urls) ? urls : [urls];
    let success = false;

    for (const url of urlList) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        });
        if (!res.ok) {
          console.warn(`  ✗ Farside ${asset}: HTTP ${res.status} from ${url}`);
          continue;
        }
        const html = await res.text();
        const flows = parseFarsideTable(html);
        if (flows.length === 0) {
          console.warn(`  ✗ Farside ${asset}: no data parsed from ${url}`);
          continue;
        }
        // Keep last 7 days
        const recent = flows.slice(-7);
        out[asset] = recent;
        console.log(`  ✓ Farside ${asset}: ${recent.length} days (latest: ${recent[recent.length-1]?.date} = $${recent[recent.length-1]?.total}M) from ${url}`);
        success = true;
        break;
      } catch (e) {
        console.warn(`  ✗ Farside ${asset}: ${e.message} from ${url}`);
      }
    }

    if (!success) {
      console.warn(`  ✗ Farside ${asset}: all URLs failed`);
    }
  }

  return out;
}

// ─── Yahoo Finance — Tradfi OHLCV (server-side, no CORS issue) ───────────────
// Fetches daily OHLCV for tradfi tickers that aren't on Lighter.
// Yahoo Finance has no API key requirement and effectively unlimited rate
// limits when called server-side.
// Stores compact candle data in snapshot.json so the Macro tab can render
// instantly without waiting for client-side API calls.

// Read TRAD_UNIVERSE symbols from traditionalMarkets.js
// (parse the file to avoid importing JS in Node without a build step)
function readTradUniverseSymbols() {
  try {
    const tmPath = path.join(ROOT, 'src', 'lib', 'board', 'traditionalMarkets.js');
    const tmSrc = fs.readFileSync(tmPath, 'utf8');
    const matches = [...tmSrc.matchAll(/symbol:\s*'([^']+)'/g)];
    return matches.map(m => m[1]).filter(s => !s.includes(' '));
  } catch {
    return [];
  }
}

// Yahoo symbol formatting — mirrors the client-side toYahooSymbol in traditionalMarkets.js
const YAHOO_FOREX_MAP = {
  'EURUSD':'EURUSD=X','GBPUSD':'GBPUSD=X','USDJPY':'JPY=X','USDCHF':'CHF=X',
  'USDCAD':'CAD=X','AUDUSD':'AUDUSD=X','NZDUSD':'NZDUSD=X','USDKRW':'KRW=X','USDHKD':'HKD=X',
};
const YAHOO_INTL_MAP = {
  'TENCENT':'0700.HK','XIAOMI':'1810.HK','SAMSUNG':'005930.KS','SAMSUNGUSD':'005930.KS',
  'SKHYNIX':'000660.KS','SKHYNIXUSD':'000660.KS','SKHY':'000660.KS',
  'HYUNDAI':'005380.KS','HYUNDAIUSD':'005380.KS','KRCOMP':'^KS11','POPMART':'9992.HK',
  'SMIC':'0981.HK','BYD':'1211.HK',
};
const YAHOO_SPECIAL_MAP = {
  'XAU':'GC=F','XAG':'SI=F','XCU':'HG=F','XPD':'PA=F','XPT':'PL=F',
  'WTI':'CL=F','BRENTOIL':'BZ=F','NATGAS':'NG=F',
  'US500':'^GSPC','US100':'^NDX','SPX':'^GSPC',
  'VIX':'^VIX','VVIX':'^VVIX','SKEW':'^SKEW','VXZ':'^VXZ','DJI':'^DJI','NDX':'^NDX',
  // Commodities not covered by the above
  'WHEAT':'ZW=F',     // Wheat futures
  'PAXG':'PAXG-USD',  // Pax Gold (crypto-pegged gold, trades on Yahoo as PAXG-USD)
};

// Private/pre-IPO companies that have NO public exchange data.
// These exist only on prediction markets (Lighter) — skip them entirely
// during snapshot building to avoid wasting Yahoo requests (which would 404
// and contribute to rate limiting).
//
// NOTE: SPCX (SpaceX) IPO'd in 2026 and is now on Yahoo Finance — removed
// from this list. If other private companies IPO, remove them here too.
const PRIVATE_TICKERS = new Set([
  'OPENAI', 'ANTHROPIC', 'MINIMAX', 'ZHIPU',
  'WLFI', 'YZY', 'UNKNOWN',
]);
function toYahooSymbol(symbol) {
  const s = symbol.toUpperCase();
  if (YAHOO_FOREX_MAP[s]) return YAHOO_FOREX_MAP[s];
  if (YAHOO_INTL_MAP[s]) return YAHOO_INTL_MAP[s];
  if (YAHOO_SPECIAL_MAP[s]) return YAHOO_SPECIAL_MAP[s];
  if (s.includes('.')) return s.replace('.', '-');
  return s;
}

async function fetchYahooOHLCV(symbol, limit = 250, retries = 2) {
  const ySymbol = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?range=1y&interval=1d`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'TrendScan-Snapshot/1.0' } });
      if (res.status === 429 || res.status === 503) {
        // Rate limited — wait and retry (exponential backoff: 2s, 4s)
        if (attempt < retries) {
          const wait = 2000 * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      const d = await res.json();
      const result = d?.chart?.result?.[0];
      if (!result?.timestamp) return null;
      const q = result.indicators?.quote?.[0];
      if (!q) return null;
      const candles = [];
      for (let i = 0; i < result.timestamp.length; i++) {
        if (q.close?.[i] == null) continue;
        candles.push({
          t: result.timestamp[i] * 1000,
          o: q.open?.[i] ?? q.close[i],
          h: q.high?.[i] ?? q.close[i],
          l: q.low?.[i] ?? q.close[i],
          c: q.close[i],
          v: q.volume?.[i] ?? 0,
        });
      }
      return candles.slice(-limit);
    } catch {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function fetchTradfiSnapshot() {
  const allSymbols = readTradUniverseSymbols();
  // Skip private/pre-IPO tickers — they have no Yahoo data and waste requests
  const symbols = allSymbols.filter(s => !PRIVATE_TICKERS.has(s));
  const skipped = allSymbols.length - symbols.length;
  console.log(`  Fetching ${symbols.length} tradfi tickers from Yahoo Finance (${skipped} private/pre-IPO skipped)...`);
  const out = {};
  let ok = 0, fail = 0;
  // Process in batches of 5 (down from 10) with a delay between batches
  // to avoid Yahoo's rate limit (~200 req before 429).
  const batchSize = 5;
  const batchDelayMs = 500;  // 500ms between batches = ~10 req/s sustained
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(sym => fetchYahooOHLCV(sym))
    );
    for (let j = 0; j < batch.length; j++) {
      const sym = batch[j];
      const r = results[j];
      // Lowered from 30 → 1 to support newly-listed tickers (e.g. LYTE/NCLD
      // ETFs that IPO'd today). The client-side computeTradMetrics handles
      // short histories gracefully — with 1 candle, price + name + category
      // show but returns/MAs/ATR/RSI are null. The asset still appears in the
      // All Assets table so users know it's being tracked. As it accumulates
      // history over the coming days/weeks, the metrics fill in naturally.
      // TRAD_UNIVERSE is curated, so even 1-candle fetches are legitimate
      // (not Yahoo API errors returning junk — those would be 0 candles).
      if (r.status === 'fulfilled' && r.value && r.value.length >= 1) {
        out[sym] = r.value;
        ok++;
      } else {
        fail++;
      }
    }
    if ((i + batchSize) % 50 === 0 || i + batchSize >= symbols.length) {
      console.log(`    ${Math.min(i + batchSize, symbols.length)}/${symbols.length} done (${ok} ok, ${fail} fail)`);
    }
    // Delay between batches to avoid rate limiting
    if (i + batchSize < symbols.length) {
      await new Promise(r => setTimeout(r, batchDelayMs));
    }
  }
  console.log(`  ✓ ${ok} tickers fetched, ${fail} failed`);
  return out;
}

// ─── TradFi Breadth History — daily advancers/decliners for Zweig thrust ─────
// Computes daily breadth from the tradfi OHLCV snapshot: for each trading day,
// counts how many tickers advanced vs declined. Stores last 90 days as a time
// series so the client can compute the 10D EMA breadth thrust.
function computeTradfiBreadthHistory(tradfiOHLCV) {
  if (!tradfiOHLCV || Object.keys(tradfiOHLCV).length === 0) return [];
  console.log('── TradFi breadth history ──');
  try {
    // Exclude Benchmark, Levered, Forex categories — they're not individual stocks
    // For simplicity, exclude known non-stock tickers
    const excludeSet = new Set([
      'SPY','QQQ','IWM','DIA','RSP','SPX','NDX','DJI','VIX','VXX','VXZ','UVXY',
      'XAU','XAG','XCU','XPD','XPT','WTI','BRENTOIL','NATGAS','WHEAT',
      'EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD','USDKRW','USDHKD',
      'US500','US100','KRCOMP',
    ]);

    // Also exclude all levered ETFs (they're derivatives, not individual stocks)
    // Check by looking for the ticker in a levered set
    const leveredSet = new Set([
      'TQQQ','QLD','UPRO','SPXL','SSO','TNA','UWM','UDOW','SQQQ','QID','PSQ','SPXU','SPXS','SDS','SH','TZA','TWM','SDOW',
      'SOXL','USD','TECL','ROM','FAS','LABU','NAIL','DPST','DRN','ERX','GUSH','NUGT','JNUG','CURE','RETL','UTSL',
      'SOXS','SSG','TECS','REW','FAZ','LABD','ERY','DRIP','DUST','JDST','DRV',
      'NVDL','NVDU','TSLL','TSLT','MSTU','MSTX','CONL','PLTU','AMDL','MUU','SNXX','WDCX','STXX','UPSX','TARK',
      'AAPU','AAPB','AMZU','MSFU','METU','GGLL','AVL','NVDS','TSLQ','TSLZ','MSTZ','SNDQ','SARK',
      'UVIX','SVIX','SVXY','BITX','BITU','ETHU','SBIT','ETHD','BOIL','KOLD','UCO','SCO','AGQ','ZSL','UGL','GLL','TMF','TMV','TBT',
    ]);

    // Collect all dates and build a date → {advancers, decliners, total, newHighs20d} map
    const dateMap = new Map();

    for (const [ticker, candles] of Object.entries(tradfiOHLCV)) {
      if (excludeSet.has(ticker) || leveredSet.has(ticker)) continue;
      if (!Array.isArray(candles) || candles.length < 2) continue;

      // Track 20-day high for newHighs20d flag
      const highs20d = [];

      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const date = new Date(c.t).toISOString().slice(0, 10);
        if (!dateMap.has(date)) {
          dateMap.set(date, { date, advancers: 0, decliners: 0, total: 0, newHighs20d: 0 });
        }
        const entry = dateMap.get(date);

        // Skip the first candle (no prior close to compare)
        if (i > 0) {
          entry.total++;
          if (c.c > candles[i - 1].c) entry.advancers++;
          else if (c.c < candles[i - 1].c) entry.decliners++;
        }

        // 20D new high: today's high is the max of last 20 highs (including today)
        highs20d.push(c.h);
        if (highs20d.length > 20) highs20d.shift();
        if (highs20d.length === 20 && c.h >= Math.max(...highs20d)) {
          entry.newHighs20d++;
        }
      }
    }

    // Sort by date, take last 90 days
    const sorted = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    const result = sorted.slice(-90);

    // Compute adv/dec ratio for each day
    for (const d of result) {
      d.advDecRatio = d.total > 0 ? d.advancers / d.total : 0.5;
    }

    console.log(`  ✓ TradFi breadth history: ${result.length} days, latest ${result[result.length - 1]?.date} (adv=${result[result.length - 1]?.advancers} dec=${result[result.length - 1]?.decliners})`);
    return result;
  } catch (e) {
    console.warn(`  ✗ TradFi breadth history failed: ${e.message}`);
    return [];
  }
}

// ─── Regime History — server-side accumulation for consistent 90-day graph ──
//
// The MacroRegime page computes a daily nowcast score (growth, inflation,
// liquidity) and persists it to localStorage. This is ephemeral and
// device-specific — Incognito users, cache-clearers, and new devices see
// an empty history graph.
//
// This function computes the same nowcast server-side using the FRED data
// + CoinGecko + Fear&Greed that build_snapshot.js already fetches, then
// appends today's score to a rolling 90-day array in snapshot.json. The
// client reads from snapshot.regime_history first, merges with localStorage
// for today's entry (which may be newer).
//
// Why server-side: ensures ALL users see the same 90-day history regardless
// of their device/cache state. The client-side localStorage path remains as
// a fallback for intraday updates (the server only runs 4× daily).

async function computeRegimeHistory(fred, coingecko, fearGreed, cgHistorical, _prevSnapshot, globalMetrics, tradfiOHLCV) {
  try {
    // Dynamically import the regime engine modules (ES modules)
    const regimeSignals = await import('../src/lib/regime/regimeSignals.js');
    const calc = await import('../src/lib/regime/regimeCalculations.js');

    // Build the data shape the regime engine expects
    const fredAvailable = fred && Object.values(fred).some(v => Array.isArray(v) && v.length > 0);

    // Extract BTC/ETH price series for regime computation.
    // Priority: CoinGecko historical (has volume + dominance) → Binance klines
    // (always available, CORS-free from server) → empty array (last resort).
    //
    // Previously fell back to coingecko?.bitcoin?.prices which doesn't exist
    // (coingecko_top has a single "price" field, not a "prices" array). This
    // caused btcPrice to be [] when CoinGecko historical was rate-limited,
    // which made ALL BTC-dependent signals (U3, U4, U6, OB1) compute as
    // 0 > 0 = false. The fix adds Binance as a reliable fallback source.
    let btcPrice = (cgHistorical?.btcPrice?.length >= 50 ? cgHistorical.btcPrice : []);
    let ethPrice = (cgHistorical?.ethPrice?.length >= 50 ? cgHistorical.ethPrice : []);
    let btcVolume = cgHistorical?.btcVolume || [];
    let ethBtcRatio = cgHistorical?.ethBtcRatio || [];
    let btcDominance = cgHistorical?.btcDominance || [];
    let usdtDominance = cgHistorical?.usdtDominance || [];

    // If CoinGecko historical failed (rate-limited or 401 on global chart),
    // fetch from OKX as fallback. OKX is not geo-blocked from GitHub Actions
    // (unlike Binance fapi which returns HTTP 451 from US servers).
    // Check ALL critical series — even if BTC price is present, missing ETH
    // or volume data would cause signals to be skipped.
    const needsFallback = btcPrice.length < 50 || ethPrice.length < 50 ||
      btcVolume.length < 50 || ethBtcRatio.length < 50;
    if (needsFallback) {
      console.log('  ⚠ CoinGecko historical unavailable for regime — using OKX klines fallback');
      try {
        // OKX SWAP perps: /api/v5/market/candles returns up to 300 candles
        // per call. We need 365 for the 200-MA + z-score lookbacks.
        // Make 2 calls with different "before" timestamps to get 600 candles,
        // then take the last 365.
        async function fetchOkxAll(instId, limit = 365) {
          const url1 = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1D&limit=300`;
          const res1 = await fetchJson(url1);
          if (!res1?.data?.length) return [];
          const candles1 = res1.data.reverse(); // OKX returns newest-first
          // Get older candles using the oldest timestamp as "before"
          if (candles1.length >= 300 && limit > 300) {
            const oldestTs = candles1[0][0];
            const url2 = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1D&limit=300&before=${oldestTs}`;
            try {
              const res2 = await fetchJson(url2);
              if (res2?.data?.length) {
                const candles2 = res2.data.reverse();
                return [...candles2, ...candles1].slice(-limit);
              }
            } catch {}
          }
          return candles1.slice(-limit);
        }

        const [btcCandles, ethCandles] = await Promise.all([
          fetchOkxAll('BTC-USDT-SWAP'),
          fetchOkxAll('ETH-USDT-SWAP'),
        ]);

        if (btcCandles.length >= 50) {
          btcPrice = btcCandles.map(k => parseFloat(k[4])); // close
          btcVolume = btcCandles.map(k => parseFloat(k[5]));
          console.log(`  ✓ OKX fallback: BTC ${btcPrice.length} daily closes (last: $${btcPrice[btcPrice.length - 1].toFixed(0)})`);
        }
        if (ethCandles.length >= 50) {
          ethPrice = ethCandles.map(k => parseFloat(k[4]));
          const minLen = Math.min(btcPrice.length, ethPrice.length);
          ethBtcRatio = [];
          for (let i = 0; i < minLen; i++) {
            ethBtcRatio.push(btcPrice[i] > 0 ? ethPrice[i] / btcPrice[i] : 0);
          }
          console.log(`  ✓ OKX fallback: ETH ${ethPrice.length} daily closes`);
        }
        // Use accumulated dominance history (from snapshot.dominance_history)
        // instead of a flat approximation. This enables U6_btcDomDecline and
        // OB1_usdtDomFalling to compute meaningful ROC values.
        const domHistory = _prevSnapshot?.dominance_history || [];
        if (domHistory.length >= 10) {
          // Map dominance history to the price array length (use last N entries)
          const domSlice = domHistory.slice(-btcPrice.length);
          btcDominance = domSlice.map(h => h.btcDominance ?? globalMetrics.btcDominance ?? 58);
          usdtDominance = domSlice.map(h => h.usdtDominance ?? 8.0);
          // Pad if dominance history is shorter than price history
          while (btcDominance.length < btcPrice.length) {
            btcDominance.unshift(btcDominance[0] ?? 58);
            usdtDominance.unshift(usdtDominance[0] ?? 8.0);
          }
          console.log(`  ✓ Dominance from history: ${domHistory.length} days (btcDom ROC will compute)`);
        } else if (globalMetrics?.btcDominance) {
          // No history yet — use flat approximation (U6/OB1_usdtDomFalling will be neutral)
          btcDominance = btcPrice.map(() => globalMetrics.btcDominance);
          usdtDominance = btcPrice.map(() => 8.0);
          console.log('  ⚠ Dominance: no history, using flat approximation');
        }
      } catch (e) {
        console.warn(`  ✗ OKX fallback failed: ${e.message}`);
      }
    }

    // Extract gold price series from tradfi OHLCV (Yahoo futures GC=F)
    // Gold is a key inflation signal (I1: BTC/Gold Ratio, I2: Gold Price ROC).
    // Previously not passed to computeInflationSignals → both signals skipped.
    const goldCandles = tradfiOHLCV?.XAU || [];
    const goldPrice = goldCandles.map(c => c.c).filter(v => v != null && v > 0);

    // Fear & Greed as a series
    const fgSeries = Array.isArray(fearGreed) ? fearGreed.map(d => d.value).filter(v => v != null) : [];

    // Build the full signal data payload (same as the client-side MacroRegime).
    // Uses local variables which include Binance fallback if CoinGecko failed.
    const signalData = {
      btcPrice,
      ethPrice,
      ethBtcRatio,
      btcVolume,
      btcDominance,
      usdtDominance,
      goldPrice,
      fearGreed: fgSeries,
      fred,
      fredAvailable,
    };

    // Compute growth signals + nowcast
    const growthSignals = regimeSignals.computeGrowthSignals(signalData);
    const growthZ = calc.weightedComposite(growthSignals);
    const growthNowcast = calc.computeNowcast([growthZ]);
    const growthLabel = regimeSignals.classifyGrowthRegime(growthZ);

    // Compute inflation signals + nowcast
    const inflationSignals = regimeSignals.computeInflationSignals(signalData);
    const inflationZ = calc.weightedComposite(inflationSignals);
    const inflationNowcast = calc.computeNowcast([inflationZ]);
    const inflationLabel = regimeSignals.classifyInflationRegime(inflationZ);

    // Compute liquidity signals + nowcast
    const liquiditySignals = regimeSignals.computeLiquiditySignals(signalData);
    const liquidityZ = calc.weightedComposite(liquiditySignals);
    const liquidityNowcast = calc.computeNowcast([liquidityZ]);
    const liquidityLabel = regimeSignals.classifyLiquidityRegime(liquidityZ);

    // Classify quadrant
    const quadrant = calc.classifyQuadrant(growthNowcast.nowcast, inflationNowcast.nowcast);

    // ── Compute Ultra6 + OB1 + Allocation (server-side, unified) ──────────
    // Use the local variables (which include Binance fallback) instead of
    // re-reading from cgHistorical (which may be empty if CoinGecko failed)
    const macroData = {
      btcPrice,
      ethPrice,
      btcDominance,
      ethBtcRatio,
      btcVolume,
      usdtDominance,
    };

    const ultra6 = regimeSignals.computeUltra6(
      macroData, growthNowcast.nowcast, liquidityNowcast.meZ, quadrant, liquidityLabel
    );
    const ob1 = regimeSignals.computeOB1Signals(macroData);
    const core9Score = regimeSignals.computeCore9Score(macroData, growthSignals);
    const allocation = regimeSignals.computeAllocation(ultra6, ob1, core9Score, btcPrice);

    const today = new Date().toISOString().split('T')[0];
    const todayEntry = {
      date: today,
      quadrant,
      growth: growthLabel,
      inflation: inflationLabel,
      liquidity: liquidityLabel,
      growthNowcast: Math.round(growthNowcast.nowcast * 10) / 10,
      inflationNowcast: Math.round(inflationNowcast.nowcast * 10) / 10,
      liquidityNowcast: Math.round(liquidityNowcast.nowcast * 10) / 10,
      // BTC dominance from CMC global metrics (for 7D delta display on Board)
      btcDominance: globalMetrics?.btcDominance ?? null,
      // Grand composite (0-100) — displayed on the Regime Card.
      // Match computeGrandComposite from regimeCalculations.js:
      //   0.33*growth + 0.33*inflation + 0.34*liquidity
      // (nowcasts are already on the 0-100 scale, so we just average them)
      grandComposite: Math.round((0.33 * growthNowcast.nowcast + 0.33 * inflationNowcast.nowcast + 0.34 * liquidityNowcast.nowcast) * 10) / 10,
      // Allocation data (server-side, unified)
      ultra6_score: ultra6.score,
      ultra6_on: ultra6.on,
      ultra6_signals: ultra6.signals,  // Per-signal breakdown for SignalTable
      ob1_score: ob1.score,
      ob1_on: ob1.on,
      ob1_signals: ob1.signals,        // Per-signal breakdown for SignalTable
      core9_score: core9Score,
      allocation_status: allocation.status,
      allocation_vehicle: allocation.vehicle,
      allocation_conviction: allocation.conviction,
      // Top drivers for each axis (for CompositeGauge display).
      // Take top 3 by absolute value, same as the client-side computation.
      growth_drivers: growthSignals
        .filter(s => s.value != null)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 3)
        .map(s => ({ name: s.name, value: Math.round(s.value * 100) / 100 })),
      inflation_drivers: inflationSignals
        .filter(s => s.value != null)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 3)
        .map(s => ({ name: s.name, value: Math.round(s.value * 100) / 100 })),
      liquidity_drivers: liquiditySignals
        .filter(s => s.value != null)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 3)
        .map(s => ({ name: s.name, value: Math.round(s.value * 100) / 100 })),
    };

    // Merge with previous history + backfill data
    // Priority: backfill (historical) > previous snapshot (may have today's entry)
    let baseHistory = [];

    // 1. Try to load backfill file (generated by scripts/backfill_history.js)
    try {
      const backfillPath = path.join(ROOT, 'public', 'regime_history_backfill.json');
      if (fs.existsSync(backfillPath)) {
        const backfill = JSON.parse(fs.readFileSync(backfillPath, 'utf8'));
        baseHistory = backfill;
        console.log(`  ℹ Loaded ${backfill.length} days from backfill file`);
      }
    } catch {}

    // 2. Merge with previous snapshot's history (may have newer entries)
    const prevHistory = _prevSnapshot?.regime_history || [];
    if (prevHistory.length > 0) {
      // Add entries from prev that aren't in backfill
      const backfillDates = new Set(baseHistory.map(h => h.date));
      for (const h of prevHistory) {
        if (!backfillDates.has(h.date)) {
          baseHistory.push(h);
        }
      }
    }

    // 3. Remove today's entry if it exists (in case of re-runs), then add fresh.
    // Also DEDUPLICATE by date — observed July 2026: when the workflow runs
    // multiple times in a day (e.g. 3 scheduled runs + manual dispatch), the
    // previous snapshot may already contain a duplicate entry for an earlier
    // date if a prior run failed mid-merge. Dedup keeps the LAST entry per
    // date (most recent computation wins).
    const filtered = baseHistory.filter(h => h.date !== today);
    const deduped = [];
    const seenDates = new Set();
    // Walk in reverse so the LAST entry for each date wins
    for (let i = filtered.length - 1; i >= 0; i--) {
      if (!seenDates.has(filtered[i].date)) {
        deduped.unshift(filtered[i]);
        seenDates.add(filtered[i].date);
      }
    }
    const merged = [...deduped, todayEntry].slice(-90);

    // 4. Delete backfill file after successful merge (it's been consumed)
    try {
      const backfillPath = path.join(ROOT, 'public', 'regime_history_backfill.json');
      if (fs.existsSync(backfillPath)) fs.unlinkSync(backfillPath);
    } catch {}

    console.log(`  ✓ Regime history: ${merged.length} days (today: ${quadrant} | G:${growthLabel} I:${inflationLabel} L:${liquidityLabel} | U6:${ultra6.score}/6 OB1:${ob1.score}/6 ${allocation.status})`);
    console.log(`    Signals active: G:${growthSignals.length} I:${inflationSignals.length} L:${liquiditySignals.length} (total ${growthSignals.length + inflationSignals.length + liquiditySignals.length})`);

    // Health check: warn if all Ultra6 signals are false (indicates input
    // data failure — empty btcPrice, etc.). This catches the root cause of
    // the original bug where CoinGecko rate-limiting caused all signals to
    // compute as 0 > 0 = false.
    const latestEntry = merged[merged.length - 1];
    if (latestEntry?.ultra6_signals) {
      const allFalse = Object.values(latestEntry.ultra6_signals).every(v => v === false);
      if (allFalse) {
        console.warn(`  ⚠ WARNING: All Ultra6 signals are false — possible input data failure (btcPrice.length=${macroData.btcPrice?.length}, ethPrice.length=${macroData.ethPrice?.length})`);
      }
      // Also warn if btcPrice is suspiciously short (< 50 means signals that
      // need 50+ day lookbacks were skipped)
      if ((macroData.btcPrice?.length || 0) < 50) {
        console.warn(`  ⚠ WARNING: btcPrice series is too short (${macroData.btcPrice?.length || 0} entries) — BTC-dependent signals (U3, U4, U6, OB1) may be inaccurate`);
      }
    }

    return merged;
  } catch (e) {
    console.warn(`  ✗ Regime history computation failed: ${e.message}`);
    // Fall back to previous history if computation fails
    return _prevSnapshot?.regime_history || [];
  }
}

// ─── CBOE Put/Call Ratio Ingestion ───────────────────────────────────────────
// Audit F-14-a-1 (2026-08-26): DORMANT. The legacy CBOE CSVs at
//   https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/
//   {equitypc,indexpc,totalpc}.csv were deprecated by CBOE in October 2019
//   — they still respond HTTP 200 but `Last-Modified: 2020-10-30` and the
//   data ends 2019-10-04. TrendScan was scraping these and presenting the
//   resulting 6-year-stale P/C ratios as "current" in the EnvironmentPanel.
//
// Research (2026-08-26) found NO free, no-auth, JSON, historical-capable
// replacement endpoint. The only current free source is the SSR'd CBOE
// daily market-statistics page (Next.js RSC flight stream, undocumented,
// format-fragile, latest-day only). Paid alternatives (Cboe Datashop
// $2,499/mo) are out of scope.
//
// Decision: keep fetchCBOE_PC() defined here as documentation of the prior
// ingestion contract, but do NOT call it. The EnvironmentPanel UI auto-hides
// when snapshot.cboe_pc is null/empty. If a clean replacement source emerges
// (CBOE publishes a stable JSON API, FRED revives the series, or a paid
// feed is approved), re-wire the call at line ~2374 and un-hide the panel.
const CBOE_SOURCES = {
  equity: 'https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/equitypc.csv',
  index:  'https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/indexpc.csv',
  total:  'https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/totalpc.csv',
};

async function fetchCBOE_PC() {
  console.log('── CBOE Put/Call Ratios ──');
  const out = {};
  for (const [series, url] of Object.entries(CBOE_SOURCES)) {
    try {
      const text = await fetchText(url);
      // CBOE CSVs have varying leading disclaimer rows. Find the header.
      const lines = text.split('\n');
      let headerIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const first = lines[i].split(',')[0].trim().toUpperCase();
        if (first === 'DATE' || first === 'TRADE_DATE') { headerIdx = i; break; }
      }
      if (headerIdx === -1) { console.warn(`  ✗ CBOE ${series}: header not found`); continue; }

      // Parse rows after header
      const rows = [];
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const cells = lines[i].split(',').map(c => c.trim());
        if (cells.length < 5 || !cells[0]) continue;
        const date = cells[0];
        // Validate date format (MM/DD/YYYY or YYYY-MM-DD)
        if (!date.match(/\d{4}[-/]\d{2}[-/]\d{2}|\d{2}\/\d{2}\/\d{4}/)) continue;
        rows.push({
          date: date,
          call_vol: parseInt(cells[1]) || 0,
          put_vol: parseInt(cells[2]) || 0,
          total_vol: parseInt(cells[3]) || 0,
          pc_ratio: parseFloat(cells[4]) || 0,
        });
      }

      if (rows.length === 0) { console.warn(`  ✗ CBOE ${series}: no data rows`); continue; }

      // Take last 30 days + compute 10D SMA
      const recent = rows.slice(-30);
      const latest = recent[recent.length - 1];
      const last10 = recent.slice(-10);
      const sma10 = last10.reduce((s, r) => s + r.pc_ratio, 0) / last10.length;

      // Sentiment label
      let label = 'NEUTRAL';
      if (series === 'equity') {
        if (latest.pc_ratio > 1.0) label = 'BEARISH (hedging)';
        else if (latest.pc_ratio < 0.6) label = 'BULLISH (call-heavy)';
      } else if (series === 'index') {
        if (latest.pc_ratio > 1.3) label = 'BEARISH (hedge demand)';
        else if (latest.pc_ratio < 0.9) label = 'BULLISH (low hedging)';
      }

      out[series] = {
        latest: { date: latest.date, pc_ratio: latest.pc_ratio, call_vol: latest.call_vol, put_vol: latest.put_vol },
        sma_10d: parseFloat(sma10.toFixed(3)),
        label,
        history: recent.map(r => ({ date: r.date, pc_ratio: r.pc_ratio })),
      };
      console.log(`  ✓ CBOE ${series}: P/C=${latest.pc_ratio.toFixed(3)} (10D SMA ${sma10.toFixed(3)}) — ${label}`);
    } catch (e) {
      console.warn(`  ✗ CBOE ${series}: ${e.message}`);
    }
  }
  return out;
}

// ─── Environment Temperature Model ───────────────────────────────────────────
// Synthesized risk-conditions gauge from VIX, VVIX, SKEW, and VIX term structure.
// Produces a 0-100 temperature with regime verdict, posture, and flags.
//
// Data sources (all from tradfi OHLCV in snapshot.tradfi_ohlcv):
//   VIX  — CBOE Volatility Index (fear gauge)
//   VVIX — CBOE Vol-of-Vol Index (sophisticated hedging)
//   SKEW — CBOE SKEW Index (tail-risk pricing)
//   VXX  — VIX short-term futures ETN (front month proxy)
//   VXZ  — VIX mid-term futures ETN (4th-7th month proxy)
//   VXX/VXZ ratio = term structure proxy (contango vs backwardation)

function computeEnvironment(tradfiOHLCV) {
  console.log('  Computing environment temperature...');

  // Extract latest closes for VIX, VVIX, SKEW, VXX, VXZ
  function getLatest(symbol) {
    const candles = tradfiOHLCV?.[symbol];
    if (!candles || candles.length === 0) return null;
    return candles[candles.length - 1].c;
  }

  const vix = getLatest('VIX');
  const vvix = getLatest('VVIX');
  const skew = getLatest('SKEW');
  const vxx = getLatest('VXX');
  const vxz = getLatest('VXZ');

  // VIX term structure ratio.
  // VXX tracks 30-day VIX futures, VXZ tracks 4-7 month VIX futures.
  // The ratio VXX/VXZ (both ETN prices in the $10-$50 range) gives a
  // term structure signal: < 0.3 = steep contango (calm), > 0.5 = flat
  // (stressed). We only compute it if VXZ has enough data (10+ candles).
  let termRatio = null;
  let hasTermData = false;
  if (vxx && vxz && vxz > 0) {
    const vxzCandles = tradfiOHLCV?.['VXZ'] || [];
    if (vxzCandles.length >= 10) {
      termRatio = vxx / vxz;
      hasTermData = true;
    }
  }

  // Temperature contributions (each maps indicator to 0-100)
  const contribs = [];
  function band(x, lo, hi) {
    if (x == null) return null;
    return Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100));
  }

  // VIX: 12 → 0, 40 → 100 (weight 0.58 if no term data, 0.34 if term data available)
  const vixWeight = hasTermData ? 0.34 : 0.58;
  if (vix != null) contribs.push({ name: 'VIX', score: band(vix, 12, 40), weight: vixWeight, value: vix });
  // VVIX: 85 → 0, 150 → 100 (weight 0.14)
  if (vvix != null) contribs.push({ name: 'VVIX', score: band(vvix, 85, 150), weight: 0.14, value: vvix });
  // SKEW: 118 → 0, 160 → 100 (weight 0.14)
  if (skew != null) contribs.push({ name: 'SKEW', score: band(skew, 118, 160), weight: 0.14, value: skew });
  // Term structure ratio: 0.20 (steep contango) → 0, 0.50 (backwardation) → 100 (weight 0.24)
  // Only included if VXZ has 10+ candles. Band adjusted for ETN price ratio.
  if (hasTermData && termRatio != null) {
    contribs.push({ name: 'Term', score: band(termRatio, 0.20, 0.50), weight: 0.24, value: termRatio });
  }
  // If we don't have COR1M, redistribute the weight (0.14) to VIX
  // by adjusting VIX weight to 0.48 when COR1M is missing
  const totalWeight = contribs.reduce((s, c) => s + (c.score != null ? c.weight : 0), 0);
  const validContribs = contribs.filter(c => c.score != null);

  let temperature = null;
  if (validContribs.length > 0 && totalWeight > 0) {
    temperature = validContribs.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight;
  }

  // Regime verdict
  let verdict = 'Insufficient data';
  let posture = 'Populate VIX/VVIX/SKEW to compute environment.';
  const flags = [];

  if (temperature != null) {
    if (temperature < 30) {
      verdict = 'Calm';
      posture = 'Risk appetite healthy. Normal position sizing. Watch for complacency.';
    } else if (temperature < 55) {
      verdict = 'Moderate — discretionary zone';
      posture = 'Conditions are mixed. Selective risk-taking, normal sizing on high-conviction names.';
    } else if (temperature < 75) {
      verdict = 'Elevated / stressed';
      posture = 'Reduce risk. Size down new entries. Tighten stops. Elevated hedging activity.';
    } else {
      verdict = 'High-vol / acute stress';
      posture = 'Preserve cash for the asymmetry — the best trades come after the panic, not during it.';
    }

    // Flags
    if (vvix != null && vix != null && vvix >= 100 && vix < 16) {
      flags.push('VVIX elevated while VIX calm — sophisticated pre-hedging; size down, hold shorter');
    }
    if (vix != null && skew != null && vix < 15 && skew < 125) {
      flags.push('Low VIX + low SKEW = double complacency — cheap tails, watch for a shock');
    }
    if (hasTermData && termRatio != null && termRatio > 0.45) {
      flags.push('VIX term structure flattening/backwardation — front-month fear, stress signal');
    }
  }

  // Build tiles
  const tiles = [];
  function addTile(name, value, note) {
    tiles.push({ name, value, note: value != null ? note : 'no data' });
  }
  addTile('VIX', vix, vix != null ? `${vix.toFixed(2)} — ${vix < 15 ? 'complacent' : vix < 20 ? 'calm' : vix < 30 ? 'normal' : 'elevated'}` : 'no data');
  addTile('VVIX', vvix, `${vvix != null ? vvix.toFixed(2) : '—'} — vol-of-vol`);
  addTile('SKEW', skew, `${skew != null ? skew.toFixed(2) : '—'} — tail risk pricing`);
  if (vix != null && vvix != null && vix > 0) {
    addTile('VVIX/VIX', vvix / vix, `${(vvix / vix).toFixed(2)} — ratio (high vs calm VIX = pre-hedging)`);
  }

  const result = {
    temperature: temperature != null ? Math.round(temperature) : null,
    verdict,
    posture,
    flags,
    tiles,
    term_ratio: termRatio,
    contributions: validContribs.map(c => ({ name: c.name, score: Math.round(c.score), weight: c.weight, value: c.value })),
  };

  console.log(`  ✓ Environment: temp=${result.temperature} (${verdict})`);
  return result;
}

// ─── Levered ETF Hedging Appetite Gauge ──────────────────────────────────────
// Computes volume-weighted long vs short z-scores across the levered complex,
// plus a `short_share` metric (fraction of $-vol flowing into short products).

function computeLeveredAppetite(tradfiOHLCV) {
  console.log('  Computing levered ETF appetite...');
  try {
    // Import the levered ETF metadata
    // (We can't dynamically import, so we hardcode the short tickers here)
    // Audit F-14-f-3: UVIX is a 2x LONG VIX futures ETF (same hedge product family as UVXY).
    // It rises when VIX spikes (market crashes). Moved from LONG_TICKERS to SHORT_TICKERS.
    // SVIX and SVXY remain in LONG_TICKERS (they are short-vol / risk-on products).
    const SHORT_TICKERS = new Set(['SQQQ','QID','PSQ','SPXS','SPXU','SDS','SH','TZA','TWM','SDOW',
      'SMDD','RWM','MYY','DOG','SZK','BIS','TLL','SBB','SAGG','SBND','TMV','TBT','TYO','PST',
      'UVXY','UVIX']);  // UVXY + UVIX = long volatility = hedge products
    const LONG_TICKERS = new Set(['TQQQ','QLD','UPRO','SPXL','SSO','TNA','UWM','UDOW',
      'SOXL','USD','TECL','ROM','FAS','LABU','NAIL','DPST','DRN','ERX','EDC','KOLD',
      'SCO','AGQ','ZSL','UGL','GLL','TMF','BOIL','UCO','CONL','BITX','BITU','ETHU',
      'SVIX','SVXY','SBIT','ETHD']);  // SVIX/SVXY = short vol = risk-on

    const longs = [];
    const shorts = [];

    for (const [symbol, candles] of Object.entries(tradfiOHLCV || {})) {
      if (!SHORT_TICKERS.has(symbol) && !LONG_TICKERS.has(symbol)) continue;
      if (!candles || candles.length < 21) continue;

      const closes = candles.map(c => c.c);
      const vols = candles.map(c => c.v);
      const n = closes.length;
      const lastClose = closes[n - 1];
      const lastVol = vols[n - 1] || 0;
      const dollarVol = lastClose * lastVol;

      // 1D return
      const ret1d = n >= 2 ? (closes[n-1] / closes[n-2] - 1) : 0;

      // 20D return stdev for z-score
      const rets = [];
      for (let i = 1; i < Math.min(n, 21); i++) {
        rets.push(closes[i] / closes[i-1] - 1);
      }
      const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
      const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
      const std = Math.sqrt(variance) || 0.001;
      const z1d = (ret1d - mean) / std;

      const entry = { symbol, ret1d, z1d, dollarVol };
      if (SHORT_TICKERS.has(symbol)) shorts.push(entry);
      else longs.push(entry);
    }

    function aggregate(arr) {
      if (!arr.length) return null;
      const totalDollarVol = arr.reduce((s, r) => s + r.dollarVol, 0);
      const weightedZ = arr.reduce((s, r) => s + r.z1d * r.dollarVol, 0) / Math.max(totalDollarVol, 1);
      const weightedRet = arr.reduce((s, r) => s + r.ret1d * r.dollarVol, 0) / Math.max(totalDollarVol, 1);
      return { avg_z: parseFloat(weightedZ.toFixed(2)), avg_ret_1d: parseFloat((weightedRet * 100).toFixed(2)), total_dollar_vol: totalDollarVol, count: arr.length };
    }

    const longAgg = aggregate(longs);
    const shortAgg = aggregate(shorts);

    let shortShare = null;
    if (longAgg && shortAgg) {
      shortShare = shortAgg.total_dollar_vol / Math.max(longAgg.total_dollar_vol + shortAgg.total_dollar_vol, 1);
    }

    const result = {
      long: longAgg,
      short: shortAgg,
      short_share: shortShare != null ? parseFloat((shortShare * 100).toFixed(1)) : null,
      label: shortShare != null
        ? (shortShare > 0.25 ? 'Elevated hedging' : shortShare > 0.15 ? 'Moderate hedging' : 'Low hedging / risk-on')
        : 'Insufficient data',
    };

    console.log(`  ✓ Levered appetite: long z=${longAgg?.avg_z ?? '—'}, short z=${shortAgg?.avg_z ?? '—'}, short_share=${result.short_share ?? '—'}%`);
    return result;
  } catch (e) {
    console.warn(`  ✗ Levered appetite failed: ${e.message}`);
    return null;
  }
}

// ─── Factor Universe (curated ETF baskets + flow_z) ──────────────────────────
// Organized as category cards, each containing basket rows with $-volume
// and flow_z (z-score of today's $-vol vs trailing 30D average).

const FACTOR_BASKETS = {
  'Concentration': {
    'Mag 7': ['AAPL','MSFT','GOOGL','AMZN','META','NVDA','TSLA'],
    'Parabolic 7': ['NVDA','MSTR','COIN','HOOD','CRCL','PLTR','APP'],
  },
  'Index ETFs': {
    'SPY (S&P 500)': ['SPY'],
    'QQQ (Nasdaq 100)': ['QQQ'],
    'IWM (Russell 2000)': ['IWM'],
    'DIA (Dow 30)': ['DIA'],
  },
  'US Sectors': {
    'XLK (Tech)': ['XLK'],
    'XLF (Financials)': ['XLF'],
    'XLE (Energy)': ['XLE'],
    'XLV (Healthcare)': ['XLV'],
    'XLI (Industrials)': ['XLI'],
    'XLY (Cons Disc)': ['XLY'],
    'XLP (Cons Stap)': ['XLP'],
    'XLU (Utilities)': ['XLU'],
    'XLRE (Real Estate)': ['XLRE'],
    'XLB (Materials)': ['XLB'],
    'XLC (Comms)': ['XLC'],
  },
  'Cross-Asset': {
    'GLD (Gold)': ['GLD'],
    'TLT (20+Y Bonds)': ['TLT'],
    'UUP (Dollar)': ['UUP'],
    'HYG (High Yield)': ['HYG'],
  },
};

function computeFactorUniverse(tradfiOHLCV) {
  console.log('  Computing factor universe...');
  try {
    const categories = [];

    for (const [catName, baskets] of Object.entries(FACTOR_BASKETS)) {
      const basketRows = [];

      for (const [basketName, tickers] of Object.entries(baskets)) {
        // Build basket-level daily $-vol series: for each day, sum $-vol across
        // all basket members. This gives a single time series for the basket
        // as a whole, which we then z-score.
        const memberDollarVols = {}; // ticker → array of daily $-vol
        let maxLen = 0;

        for (const ticker of tickers) {
          const candles = tradfiOHLCV?.[ticker];
          if (!candles || candles.length < 31) continue;
          const dvs = candles.map(c => c.c * c.v);
          memberDollarVols[ticker] = dvs;
          maxLen = Math.max(maxLen, dvs.length);
        }

        if (maxLen < 31) continue;

        // Build basket-level daily $-vol series (aligned by index from the end)
        const basketDailyVol = new Array(maxLen).fill(0);
        let totalRet1d = 0;
        let validCount = 0;

        for (const [ticker, dvs] of Object.entries(memberDollarVols)) {
          // Align from the end (most recent day is at index maxLen-1)
          const offset = maxLen - dvs.length;
          for (let i = 0; i < dvs.length; i++) {
            basketDailyVol[offset + i] += dvs[i];
          }
          // 1D return (for display)
          const candles = tradfiOHLCV[ticker];
          const closes = candles.map(c => c.c);
          if (closes.length >= 2 && closes[closes.length - 2] > 0) {
            totalRet1d += (closes[closes.length - 1] / closes[closes.length - 2] - 1);
            validCount++;
          }
        }

        // Today's basket $-vol
        const totalDollarVol1d = basketDailyVol[maxLen - 1];

        // 30D average + std (excluding today)
        const trailing30 = basketDailyVol.slice(-31, -1);
        const avg30 = trailing30.reduce((s, v) => s + v, 0) / trailing30.length;
        const variance = trailing30.reduce((s, v) => s + (v - avg30) ** 2, 0) / trailing30.length;
        const std30 = Math.sqrt(variance);

        // Flow z: true z-score at the BASKET level
        let flowZ = null;
        if (std30 > 0) {
          flowZ = (totalDollarVol1d - avg30) / std30;
        }

        basketRows.push({
          name: basketName,
          dollar_vol_1d: Math.round(totalDollarVol1d),
          flow_z: flowZ != null ? parseFloat(flowZ.toFixed(2)) : null,
          avg_ret_1d: validCount > 0 ? parseFloat(((totalRet1d / validCount) * 100).toFixed(2)) : null,
        });
      }

      if (basketRows.length > 0) {
        categories.push({ category: catName, baskets: basketRows });
      }
    }

    console.log(`  ✓ Factor universe: ${categories.length} categories, ${categories.reduce((s, c) => s + c.baskets.length, 0)} baskets`);
    return { categories };
  } catch (e) {
    console.warn(`  ✗ Factor universe failed: ${e.message}`);
    return null;
  }
}

// ─── Crypto 6-Timeframe Return Grid ─────────────────────────────────────────
// Computes daily/weekly/monthly/quarterly/yearly + YTD returns for crypto baskets.
// Reads from snapshot.crypto_universe (CMC) for current prices + tags.
// Uses coingecko_top for historical price data (change24h/7d/30d/60d/90d).

function computeCryptoGrid(cryptoUniverse, coingeckoTop) {
  console.log('  Computing crypto grid...');
  try {
    // Define baskets (from SMB crypto_baskets.json, filtered to what we have)
    const BASKETS = {
      'Benchmarks': ['BTC', 'ETH', 'SOL'],
      'Layer 1s': ['APT', 'AVAX', 'BNB', 'ATOM', 'NEAR', 'SEI', 'SUI', 'TON'],
      'Memecoins': ['DOGE', 'SHIB', 'PEPE', 'BONK', 'WIF'],
      'AI': ['TAO', 'FET', 'RENDER', 'WLD', 'GRASS'],
      'DePIN': ['FIL', 'AR', 'HNT', 'AKT', 'LPT'],
      'Privacy': ['XMR', 'ZEC', 'DASH'],
      'Dinos': ['BCH', 'ADA', 'LTC', 'XRP'],
    };

    const grid = {};

    for (const [basketName, symbols] of Object.entries(BASKETS)) {
      const rows = [];
      for (const sym of symbols) {
        const coin = cryptoUniverse?.[sym];
        if (!coin) continue;

        const cg = coingeckoTop?.[sym] || {};
        const price = coin.marketCap && coin.circulatingSupply ? coin.marketCap / coin.circulatingSupply : cg.price || 0;
        const change1h = coin.change1h ?? 0;
        const change24h = coin.change24h ?? cg.change24h ?? 0;
        const change7d = coin.change7d ?? cg.change7d ?? 0;
        const change30d = coin.change30d ?? 0;
        const change60d = coin.change60d ?? 0;
        const change90d = coin.change90d ?? 0;

        rows.push({
          symbol: sym,
          name: coin.name || sym,
          price: price,
          daily: change24h,
          weekly: change7d,
          monthly: change30d,
          quarterly: change90d,
          // Label as 'qtr' (quarterly = 90D) since we don't have full YTD/1Y data
          // from CMC free tier. UI labels these as "3M" instead of "YTD/1Y".
          qtr: change90d,
          ytd: change60d,   // 60D as YTD proxy (better than 90D for recent months)
          yearly: change90d, // 90D as yearly proxy (labeled "3M" in UI until we get 365D data)
          market_cap: coin.marketCap || 0,
        });
      }
      if (rows.length > 0) {
        // Compute basket averages
        const avg = {};
        for (const tf of ['daily', 'weekly', 'monthly', 'qtr', 'ytd', 'yearly']) {
          const vals = rows.map(r => r[tf]).filter(v => v != null);
          avg[tf] = vals.length > 0 ? parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2)) : null;
        }
        grid[basketName] = { rows, avg };
      }
    }

    const basketCount = Object.keys(grid).length;
    const coinCount = Object.values(grid).reduce((s, b) => s + b.rows.length, 0);
    console.log(`  ✓ Crypto grid: ${basketCount} baskets, ${coinCount} coins`);
    return grid;
  } catch (e) {
    console.warn(`  ✗ Crypto grid failed: ${e.message}`);
    return null;
  }
}

// ─── Forward-Return Signal Verification ─────────────────────────────────────
// For each signal type (Ultra6 ON, STRONG verdict, Clean Momentum), computes
// historical 1D/3D/5D forward returns after the signal fired.
// Uses regime_history + signal_history + crypto_factor_history.

function computeSignalVerification(regimeHistory, signalHistory, cryptoFactorHistory) {
  console.log('  Computing signal verification...');
  try {
    const results = {};

    // 1. Ultra6 ON → forward BTC returns
    if (regimeHistory?.length > 0) {
      const ultra6OnDays = regimeHistory.filter(h => h.ultra6_on === true);
      const ultra6OffDays = regimeHistory.filter(h => h.ultra6_on === false);

      function computeForwardReturns(entries, allHistory) {
        if (entries.length === 0) return null;
        const rets = { '1d': [], '3d': [], '5d': [] };
        for (const entry of entries) {
          const idx = allHistory.findIndex(h => h.date === entry.date);
          if (idx === -1 || idx + 5 >= allHistory.length) continue;
          // We don't have BTC price in regime_history, but we have growthNowcast
          // which is a proxy. For now, use the nowcast delta as "forward return proxy"
          const future1 = allHistory[idx + 1]?.growthNowcast;
          const future3 = allHistory[idx + 3]?.growthNowcast;
          const future5 = allHistory[idx + 5]?.growthNowcast;
          if (future1 != null) rets['1d'].push(future1 - entry.growthNowcast);
          if (future3 != null) rets['3d'].push(future3 - entry.growthNowcast);
          if (future5 != null) rets['5d'].push(future5 - entry.growthNowcast);
        }
        const summary = {};
        for (const [k, v] of Object.entries(rets)) {
          if (v.length > 0) {
            const avg = v.reduce((s, x) => s + x, 0) / v.length;
            const positive = v.filter(x => x > 0).length;
            summary[k] = { avg: parseFloat(avg.toFixed(2)), hit_rate: parseFloat((positive / v.length * 100).toFixed(1)), count: v.length };
          }
        }
        return summary;
      }

      results.ultra6_on = computeForwardReturns(ultra6OnDays, regimeHistory);
      results.ultra6_off = computeForwardReturns(ultra6OffDays, regimeHistory);
    }

    // 2. STRONG verdict → forward returns (from signal_history)
    if (signalHistory?.length > 0) {
      const strongDays = signalHistory.filter(h => h.btc_verdict === 'STRONG');
      const weakDays = signalHistory.filter(h => h.btc_verdict === 'WEAK');

      function computeSignalForwardReturns(entries, allHistory) {
        if (entries.length === 0) return null;
        const rets = { '1d': [], '3d': [], '5d': [] };
        for (const entry of entries) {
          const idx = allHistory.findIndex(h => h.date === entry.date);
          if (idx === -1 || idx + 5 >= allHistory.length) continue;
          // Use btc_close_at_signal if available
          const close = entry.btc_close_at_signal;
          if (!close) continue;
          const future1 = allHistory[idx + 1]?.btc_close_at_signal;
          const future3 = allHistory[idx + 3]?.btc_close_at_signal;
          const future5 = allHistory[idx + 5]?.btc_close_at_signal;
          if (future1) rets['1d'].push((future1 / close - 1) * 100);
          if (future3) rets['3d'].push((future3 / close - 1) * 100);
          if (future5) rets['5d'].push((future5 / close - 1) * 100);
        }
        const summary = {};
        for (const [k, v] of Object.entries(rets)) {
          if (v.length > 0) {
            const avg = v.reduce((s, x) => s + x, 0) / v.length;
            const positive = v.filter(x => x > 0).length;
            summary[k] = { avg: parseFloat(avg.toFixed(2)), hit_rate: parseFloat((positive / v.length * 100).toFixed(1)), count: v.length };
          }
        }
        return summary;
      }

      results.signal_strong = computeSignalForwardReturns(strongDays, signalHistory);
      results.signal_weak = computeSignalForwardReturns(weakDays, signalHistory);
    }

    console.log(`  ✓ Signal verification: ${Object.keys(results).length} signal types analyzed`);
    return results;
  } catch (e) {
    console.warn(`  ✗ Signal verification failed: ${e.message}`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━ Building TrendScan snapshot ━━━');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`FRED_API_KEY: ${FRED_API_KEY ? '✓ set' : '✗ not set'}`);
  console.log(`CMC_API_KEY:  ${CMC_API_KEY ? '✓ set' : '✗ not set (will use CoinGecko for universe)'}`);
  console.log('');

  // Log CMC credit usage at start (FREE — 0 credits) so we see budget before/after
  await logCMCCreditUsage();

  let [fred, coingecko, fearGreed, kenFrench, vixRealtime, tradfiOHLCV, etfFlows, factorWatch, cryptoFactors, cgHistorical, cryptoUniverse, globalMetrics, binanceOI] = await Promise.all([
    fetchAllFred(),
    fetchCoinGeckoTop(),
    fetchFearGreed(),
    fetchKenFrench(),
    fetchVIXRealtime(),
    fetchTradfiSnapshot(),
    fetchFarsideETFFlows(),
    fetchFactorWatch(),
    computeCryptoFactors(_prevSnapshot, _prevSnapshot?.crypto_universe),
    fetchCoinGeckoHistorical(),
    fetchCryptoUniverse(),
    // fetchCMCTrending() — removed: CMC trending endpoints return 403 on free tier
    fetchGlobalMetrics(),
    fetchBinanceOI(),
  ]);

  // CMC trending endpoints return 403 on free tier — skip to save API credits.
  // The cmc_trending key is preserved from previous snapshots (stale but harmless).
  let cmcTrending = _prevSnapshot?.cmc_trending || { trending: [], gainers: [], losers: [], mostVisited: [], community: [] };

  // If crypto_universe is empty (CMC + CoinGecko both failed), reuse previous snapshot's
  //
  // F-14-a-7 (2026-08-26): added 24h age limit. Previously crypto_universe
  // could be served indefinitely stale during a multi-day CMC + CoinGecko
  // outage — Board's price-change column and factor monitor would show
  // week-old prices with no warning. 24h matches the snapshot refresh cadence
  // (4× daily via Cloudflare cron) — if the previous snapshot is older than
  // 24h, something is deeply wrong and we'd rather show empty data than
  // silently-stale data.
  if ((!cryptoUniverse || Object.keys(cryptoUniverse).length < 400) && _prevSnapshot?.crypto_universe) {
    const prevAge = Date.now() - new Date(_prevSnapshot.timestamp || _prevSnapshot.lastUpdated || Date.now()).getTime();
    if (prevAge < 24 * 60 * 60 * 1000) {  // < 24h old (price data — short freshness requirement)
      console.log(`  ⚠ crypto_universe empty — using previous snapshot (stale but <24h, age=${Math.round(prevAge / 60 / 60 / 1000)}h)`);
      cryptoUniverse = _prevSnapshot.crypto_universe;
    } else {
      console.log(`  ⚠ crypto_universe empty AND previous snapshot is ${Math.round(prevAge / 60 / 60 / 1000)}h old — leaving empty (stale >24h)`);
    }
  }

  // Audit F-14-a-6 (2026-08-26): coingecko_top had no stale-data fallback.
  // Every other major fetch (cmcTrending, globalMetrics, binanceOI, fred,
  // etfFlows, factorWatch) has a fallback — coingecko_top was forgotten.
  // A single 429 from CoinGecko wiped Board's price-change column for ~6h
  // until the next GHA rebuild. Now falls back to previous snapshot's
  // coingecko_top when the fresh fetch returns empty.
  if ((!coingecko || Object.keys(coingecko).length === 0) && _prevSnapshot?.coingecko_top) {
    console.log('  ⚠ coingecko_top empty — using previous snapshot (stale)');
    coingecko = _prevSnapshot.coingecko_top;
  }

  // ── Enrich crypto_universe with CMC tags + platform detail (Phase 2) ──────
  // Only runs if we have a CMC-sourced universe (skips CoinGecko-fallback universes
  // since CMC /info endpoint needs CMC IDs and would be wasteful on CoinGecko data).
  // Uses CMC numeric IDs (more reliable than symbols — some symbols cause HTTP 400).
  if (cryptoUniverse && CMC_API_KEY) {
    const cmcSourcedEntries = Object.values(cryptoUniverse)
      .filter(c => c.source === 'cmc' && c.id != null);
    if (cmcSourcedEntries.length >= 400) {
      const cmcIds = cmcSourcedEntries.map(c => c.id);
      const metadata = await fetchCryptoMetadata(cmcIds);
      let enrichedCount = 0;
      for (const [sym, meta] of Object.entries(metadata)) {
        if (cryptoUniverse[sym]) {
          // Merge metadata fields into existing universe entry (don't overwrite core fields)
          cryptoUniverse[sym].tags = meta.tags || [];
          cryptoUniverse[sym].platform = meta.platform || cryptoUniverse[sym].platform || null;
          cryptoUniverse[sym].platformTokenAddress = meta.platformTokenAddress || null;
          cryptoUniverse[sym].category = meta.category || null;
          cryptoUniverse[sym].logo = meta.logo || null;
          cryptoUniverse[sym].dateLaunched = meta.dateLaunched || null;
          enrichedCount++;
        }
      }
      console.log(`  ✓ Enriched ${enrichedCount} coins with tags + platform from CMC /info`);
    }
  }

  // Stale-data fallback for trending + global metrics
  if ((!cmcTrending || (cmcTrending.trending.length === 0)) && _prevSnapshot?.cmc_trending) {
    cmcTrending = _prevSnapshot.cmc_trending;
  }
  if (!globalMetrics && _prevSnapshot?.global_metrics) {
    globalMetrics = _prevSnapshot.global_metrics;
  }
  if ((!binanceOI || Object.keys(binanceOI).length < 100) && _prevSnapshot?.binance_oi) {
    // F-14-a-7 (2026-08-26): 24h age limit — binance_oi is price-derived
    // (open interest values), same short-freshness requirement as crypto_universe.
    const prevAge = Date.now() - new Date(_prevSnapshot.timestamp || _prevSnapshot.lastUpdated || Date.now()).getTime();
    if (prevAge < 24 * 60 * 60 * 1000) {
      console.log(`  ⚠ binance_oi empty — using previous snapshot (stale but <24h, age=${Math.round(prevAge / 60 / 60 / 1000)}h)`);
      binanceOI = _prevSnapshot.binance_oi;
    } else {
      console.log(`  ⚠ binance_oi empty AND previous snapshot is ${Math.round(prevAge / 60 / 60 / 1000)}h old — leaving empty (stale >24h)`);
    }
  }

  // If FRED data is empty (API failure), use previous snapshot's FRED data
  //
  // F-14-a-7 (2026-08-26): 7-day age limit for FRED (macro data — slower-moving
  // than price data, 7d freshness is acceptable). Macro series like M2, CPI,
  // Fed balance sheet update weekly/monthly, so 7d stale is tolerable. Beyond
  // 7d the macro regime engine would be operating on outdated inputs and could
  // misclassify the regime.
  const fredPopulated = Object.values(fred).filter(v => Array.isArray(v) && v.length > 0).length;
  if (fredPopulated === 0 && _prevSnapshot?.fred) {
    const prevAge = Date.now() - new Date(_prevSnapshot.timestamp || _prevSnapshot.lastUpdated || Date.now()).getTime();
    if (prevAge < 7 * 24 * 60 * 60 * 1000) {  // < 7 days old (macro data — slower-moving)
      console.log(`  ⚠ FRED data empty — using previous snapshot (stale but <7d, age=${Math.round(prevAge / 60 / 60 / 1000)}h)`);
      fred = _prevSnapshot.fred;
    } else {
      console.log(`  ⚠ FRED data empty AND previous snapshot is ${Math.round(prevAge / 60 / 60 / 24 / 1000)}d old — leaving empty (stale >7d)`);
    }
  }

  // Compute regime history server-side (appends today's nowcast to a 90-day rolling array)
  const regimeHistory = await computeRegimeHistory(fred, coingecko, fearGreed, cgHistorical, _prevSnapshot, globalMetrics, tradfiOHLCV);

  // Compute tradfi breadth history (daily advancers/decliners for Zweig thrust)
  const tradfiBreadthHistory = computeTradfiBreadthHistory(tradfiOHLCV);

  // If an ETF flow asset failed to fetch (Farside 403/timeout), fall back to
  // the previous snapshot's data for that asset. This prevents rows from
  // disappearing from the ETF Flows table when Farside has a transient failure
  // (observed: ETH returned 403 on one run, dropping the ETH row entirely).
  // Per-asset merge — only fills gaps, never overwrites fresh data.
  if (_prevSnapshot?.etf_flows) {
    const prevEtf = _prevSnapshot.etf_flows;
    for (const asset of ['BTC', 'ETH', 'SOL', 'HYPE']) {
      if ((!etfFlows[asset] || etfFlows[asset].length === 0) && prevEtf[asset]?.length > 0) {
        const prevAge = Date.now() - new Date(prevEtf[asset][prevEtf[asset].length - 1].date).getTime();
        if (prevAge < 3 * 24 * 60 * 60 * 1000) {  // < 3 days old
          etfFlows[asset] = prevEtf[asset];
          console.log(`  ⚠ Farside ${asset}: fetch failed — using previous snapshot (stale but <3d)`);
        }
      }
    }
  }

  // If FactorWatch scrape failed, fall back to previous snapshot's data
  // (if it's from today). If stale, leave as null — UI degrades gracefully.
  if (!factorWatch && _prevSnapshot?.factor_watch) {
    const prevAge = Date.now() - new Date(_prevSnapshot.factor_watch.timestamp).getTime();
    if (prevAge < 24 * 60 * 60 * 1000) {
      console.log('  ⚠ FactorWatch scrape failed — using previous snapshot (stale but <24h)');
      factorWatch = _prevSnapshot.factor_watch;
    } else {
      console.log('  ⚠ FactorWatch scrape failed and previous data is >24h old — setting to null');
    }
  }

  // Accumulate FactorWatch history for the CrossAssetDivergenceChart.
  // Append today's data point (if not already present for this date),
  // cap at 90 entries. This enables a 90-day time series chart.
  let factorWatchHistory = _prevSnapshot?.factor_watch_history || [];
  // Also accumulate FactorWatch factor leadership history for rotation detection.
  // Tracks which factor leads by 20d return on the S&P 500 each day.
  // Same pattern as crypto_factor_history — enables detectRotation() for TradFi.
  let fwLeaderHistory = _prevSnapshot?.factor_watch_leader_history || [];

  // Audit A-06 (2026-11-07): the history append below used `as_of || new Date()`,
  // which relocated the F-14-b-9 freshness lie from the scraper to this caller —
  // when the FactorWatch header regex misses (as it did from ~Nov 5 2026, when
  // FW wrapped the date in a closing </span> that broke the pattern), unknown-
  // vintage data was appended to factor_watch_history / leader history under
  // TODAY's date. The append now requires a real as_of; when null we warn and
  // skip, so the charts pause instead of accumulating mislabeled points. (The
  // scraper regex itself was also fixed to tolerate the new markup — see
  // scrapers/factorWatch.js parseAsOfDate.)
  if (factorWatch && !factorWatch.as_of && factorWatch.sp500?.factors?.momentum) {
    console.warn('⚠ FactorWatch as_of is null (header parse miss) — skipping history/leader append (A-06)');
  }

  if (factorWatch?.sp500?.factors?.momentum && factorWatch?.fw3000?.factors?.momentum && factorWatch.as_of) {
    const today = factorWatch.as_of;
    const sp500Mom5dSigma = factorWatch.sp500.factors.momentum['5d_sigma'];
    const fw3000Mom5dSigma = factorWatch.fw3000.factors.momentum['5d_sigma'];
    const sp500Mom20dSigma = factorWatch.sp500.factors.momentum['20d_sigma'];
    const fw3000Mom20dSigma = factorWatch.fw3000.factors.momentum['20d_sigma'];

    // Don't duplicate if today's entry already exists
    if (!factorWatchHistory.find(h => h.date === today)) {
      factorWatchHistory.push({
        date: today,
        sp500_mom_5d_sigma: sp500Mom5dSigma,
        fw3000_mom_5d_sigma: fw3000Mom5dSigma,
        sp500_mom_20d_sigma: sp500Mom20dSigma,
        fw3000_mom_20d_sigma: fw3000Mom20dSigma,
      });
      if (factorWatchHistory.length > 90) {
        factorWatchHistory = factorWatchHistory.slice(-90);
      }
    }

    // Determine today's FactorWatch leader: the factor with the highest
    // 20d return on the S&P 500. This is the "leading factor" that
    // detectRotation() tracks for 3-session confirmation.
    if (!fwLeaderHistory.find(h => h.date === today)) {
      const sp500Factors = factorWatch.sp500.factors || {};
      let leader = null;
      let leaderRet = -Infinity;
      for (const [factorName, data] of Object.entries(sp500Factors)) {
        const ret20d = data['20d_ret'];
        if (ret20d != null && ret20d > leaderRet) {
          leaderRet = ret20d;
          leader = factorName;
        }
      }
      if (leader) {
        fwLeaderHistory.push({ date: today, leader });
        if (fwLeaderHistory.length > 90) {
          fwLeaderHistory = fwLeaderHistory.slice(-90);
        }
      }
    }
  }

  const generatedAt = new Date().toISOString();

  // Compute signal metrics (BTC + Majors + Cash) using the backtested engine
  let signalMetrics = null;
  let signalHistory = [];
  try {
    const { computeSignalMetrics } = await import('./compute_signal_metrics.js');
    const result = await computeSignalMetrics({
      ultra6: regimeHistory?.[regimeHistory.length - 1] || null,
      prevSnapshot: _prevSnapshot,
    });
    signalMetrics = result.signal_metrics;
    signalHistory = result.signal_history;
    console.log(`  ✓ Signal metrics: BTC=${signalMetrics.btc_stance.verdict} (${signalMetrics.btc_stance.confidence}/10), Majors=${signalMetrics.majors.sector_summary}, Cash=${signalMetrics.cash_weight.suggested_pct}%`);
  } catch (e) {
    console.warn(`  ✗ Signal metrics computation failed: ${e.message}`);
    signalMetrics = _prevSnapshot?.signal_metrics || null;
    signalHistory = _prevSnapshot?.signal_history || [];
  }

  // ── Accumulate dominance history for regime signals ────────────────────
  // When CoinGecko historical fails (rate-limited), the regime computation
  // falls back to OKX klines which don't provide BTC/USDT dominance series.
  // Without dominance history, U6_btcDomDecline and OB1_usdtDomFalling
  // always compute as false (flat series → pctROC = 0).
  //
  // Fix: accumulate daily dominance values from global_metrics (CMC) into
  // a rolling 90-day array stored in snapshot.dominance_history. When the
  // CoinGecko historical fails, the regime computation can use this history
  // instead of a flat approximation.
  //
  // BACKFILL: If dominance_history is empty or very short, we backfill from
  // regime_history entries that already have btcDominance stored (the server
  // has been storing btcDominance in regime_history since July 2026). This
  // gives us 20+ days of real dominance data immediately — no waiting 10
  // days for accumulation.
  let dominanceHistory = _prevSnapshot?.dominance_history || [];

  // Backfill from regime_history if dominance_history is short (< 30 days)
  if (dominanceHistory.length < 30 && regimeHistory?.length > 0) {
    const existingDates = new Set(dominanceHistory.map(h => h.date));
    for (const rh of regimeHistory) {
      if (rh.btcDominance != null && !existingDates.has(rh.date)) {
        dominanceHistory.push({
          date: rh.date,
          btcDominance: rh.btcDominance,
          ethDominance: null,  // regime_history doesn't store ETH dominance
          // USDT dominance: estimate from residual (non-BTC, non-ETH) × ~27%
          usdtDominance: Math.max(0, 100 - rh.btcDominance - 11) * 0.27,
        });
        existingDates.add(rh.date);
      }
    }
    // Sort by date and cap at 90
    dominanceHistory.sort((a, b) => a.date.localeCompare(b.date));
    dominanceHistory = dominanceHistory.slice(-90);
    console.log(`  ✓ Dominance history backfilled from regime_history: ${dominanceHistory.length} days`);
  }

  // Append today's entry from global_metrics (more accurate than regime_history)
  if (globalMetrics?.btcDominance) {
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = dominanceHistory.some(h => h.date === today);
    if (!hasToday) {
      dominanceHistory.push({
        date: today,
        btcDominance: globalMetrics.btcDominance,
        ethDominance: globalMetrics.ethDominance ?? null,
        usdtDominance: globalMetrics.totalMarketCap && globalMetrics.btcDominance
          ? Math.max(0, 100 - globalMetrics.btcDominance - (globalMetrics.ethDominance ?? 0)) * 0.27
          : 8.0,
      });
      dominanceHistory = dominanceHistory.slice(-90);
    } else {
      // Update today's entry with the latest global_metrics values
      const todayEntry = dominanceHistory.find(h => h.date === today);
      todayEntry.btcDominance = globalMetrics.btcDominance;
      todayEntry.ethDominance = globalMetrics.ethDominance ?? todayEntry.ethDominance;
      todayEntry.usdtDominance = globalMetrics.totalMarketCap && globalMetrics.btcDominance
        ? Math.max(0, 100 - globalMetrics.btcDominance - (globalMetrics.ethDominance ?? 0)) * 0.27
        : todayEntry.usdtDominance;
    }
  }

  // ── Compute new analytical features from tradfi OHLCV + other data ──────
  // These use data we already have in memory (tradfiOHLCV, cryptoUniverse,
  // coingecko, regimeHistory, signalHistory) — no extra API calls needed.
  // Audit F-14-a-1: fetchCBOE_PC() is dormant (CSVs deprecated Oct 2019).
  // See comment block at the function definition. Setting to null so the
  // snapshot.cboe_pc key is absent and the EnvironmentPanel auto-hides.
  const cboePC = null;
  const environment = computeEnvironment(tradfiOHLCV);
  const leveredAppetite = computeLeveredAppetite(tradfiOHLCV);
  const factorUniverse = computeFactorUniverse(tradfiOHLCV);
  const cryptoGrid = computeCryptoGrid(cryptoUniverse, coingecko);
  const signalVerification = computeSignalVerification(regimeHistory, signalHistory, cryptoFactors?.factorHistory);

  // Small snapshot — loaded by every page (FRED proxy, CoinGecko fallback,
  // Fear&Greed, Ken French seasonality, CBOE put/call, ETF flows, FactorWatch,
  // crypto factors, signal metrics). Keeping this lean is critical for first paint.
  const snapshot = {
    generated_at: generatedAt,
    fred,
    coingecko_top: coingecko,
    crypto_universe: cryptoUniverse,
    cmc_trending: cmcTrending,
    global_metrics: globalMetrics,
    binance_oi: binanceOI,
    fear_greed: fearGreed,
    ken_french: kenFrench,
    vix_realtime: vixRealtime,
    etf_flows: etfFlows,
    factor_watch: factorWatch,
    factor_watch_history: factorWatchHistory,
    factor_watch_leader_history: fwLeaderHistory,
    crypto_factors: cryptoFactors?.factorData || null,
    crypto_factor_history: cryptoFactors?.factorHistory || [],
    crypto_factor_spread_history: cryptoFactors?.spreadHistory || [],
    regime_history: regimeHistory,
    dominance_history: dominanceHistory,
    tradfi_breadth_history: tradfiBreadthHistory,
    signal_metrics: signalMetrics,
    signal_history: signalHistory,
    // New analytical features (Sprints 1, 2, 4)
    cboe_pc: cboePC,
    environment,
    levered_appetite: leveredAppetite,
    factor_universe: factorUniverse,
    crypto_grid: cryptoGrid,
    signal_verification: signalVerification,
  };

  // Large snapshot — only loaded when Board or Macro needs tradfi OHLCV.
  // ~22 MB for ~470 tickers × ~250 days. Sharding keeps it off the critical path.
  const tradfiSnapshot = {
    generated_at: generatedAt,
    tradfi_ohlcv: tradfiOHLCV,
  };

  // Stats
  const fredCount = Object.keys(fred).filter(k => fred[k].length > 0).length;
  const snapshotBytes = JSON.stringify(snapshot).length;
  const tradfiBytes = JSON.stringify(tradfiSnapshot).length;
  console.log('');
  console.log('━━━ Snapshot summary ━━━');
  console.log(`  FRED series populated:  ${fredCount}/${Object.keys(FRED_SERIES).length}`);
  console.log(`  CoinGecko coins:        ${Object.keys(coingecko).length}`);
  console.log(`  Crypto universe:        ${Object.keys(cryptoUniverse).length} coins (for Scanner top-500)`);
  console.log(`  CMC trending:           ${cmcTrending ? `${(cmcTrending.trending || []).length} trending + ${(cmcTrending.gainers || []).length} gainers + ${(cmcTrending.losers || []).length} losers + ${(cmcTrending.mostVisited || []).length} most-visited + ${(cmcTrending.community || []).length} community` : 'null'}`);
  console.log(`  CMC global metrics:     ${globalMetrics ? `BTC dom ${globalMetrics.btcDominance?.toFixed(1)}%` : 'null'}`);
  console.log(`  Binance OI:             ${binanceOI ? `${Object.keys(binanceOI).length} assets` : 'null'}`);
  console.log(`  Fear & Greed days:      ${fearGreed.length}`);
  console.log(`  VIX real-time:          ${vixRealtime ? `${vixRealtime.price} (${vixRealtime.changePercent > 0 ? '+' : ''}${vixRealtime.changePercent.toFixed(2)}%)` : 'null'}`);
  console.log(`  Ken French months:      ${kenFrench.length}`);
  console.log(`  Tradfi OHLCV tickers:   ${Object.keys(tradfiOHLCV).length}`);
  console.log(`  ETF flow assets:        ${Object.keys(etfFlows).length} (BTC, ETH, SOL, HYPE)`);
  console.log(`  FactorWatch:            ${factorWatch ? '✓ populated' : 'null'} (history: ${factorWatchHistory.length} days)`);
  console.log(`  Crypto factors:         ${cryptoFactors?.factorData ? '✓ populated' : 'null'} (history: ${cryptoFactors?.factorHistory?.length || 0} days)`);
  console.log(`  snapshot.json:          ${snapshotBytes.toLocaleString()} bytes`);
  console.log(`  snapshot.tradfi.json:   ${tradfiBytes.toLocaleString()} bytes`);

  // Write to public/ (gets committed to repo, served from /)
  const outDir = path.join(ROOT, 'public');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(outDir, 'snapshot.tradfi.json'), JSON.stringify(tradfiSnapshot, null, 2));
  console.log(`  Written to:             public/snapshot.json, public/snapshot.tradfi.json`);
  console.log('');
  console.log('✓ Done.');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
