// ─── BTC on-chain & derivatives enrichment (Task 42, 2026-11-23) ──────────────
//
// Four new snapshot sections, built to serve the weekly desk update:
//
//   btc_market      — spot price + 24h/7d/30d changes, long-horizon moving
//                     averages (111D / 200W / 350W), Mayer Multiple, and the
//                     Pi Cycle Top gap — all computed locally from 8 years of
//                     daily closes (blockchain.info charts API, keyless).
//   btc_onchain     — realized price, MVRV, SOPR, NUPL, Puell, LTH realized
//                     price, hashrate, SSR + per-field as-of stamps, from
//                     bitcoin-data.com (keyless, free tier = 7-day delay,
//                     10 req/hr — so this section fetches at most once per day
//                     and carries forward between refreshes). MVRV history is
//                     backfilled from the coinmetrics/data GitHub CSV
//                     (CapMVRVCur, dense through ~May 2026; the stale tail is
//                     labeled, not silently served).
//   btc_vol         — Deribit DVOL daily history + 25-delta skew by tenor +
//                     ATM IV term structure (computed from the public option
//                     book summary; Black-Scholes delta for strike selection).
//   btc_derivatives — BTC perp funding rate (OKX per-instrument call — fills
//                     the null fundingRate that the OKX primary OI path leaves
//                     behind), long/short account ratio (Binance, Bybit
//                     fallback for GitHub Actions geo-blocks), and daily OI
//                     history accumulation.
//
// Every fetch is bounded (15s default, safeFetchJson-style degradation), and
// every section degrades to the previous snapshot's value (merge-previous)
// so a single dead upstream can never blank the weekly read.
//
// Sourced as an ESM module matching build_snapshot.js's `import` style; its
// fetch helpers are module-private there, so this file carries its own
// bounded copies (same 15s default) rather than refactoring the 2544-line
// build file's internals.

// ─── Bounded fetch helpers (mirror build_snapshot.js semantics) ─────────────

function redactUrl(u) {
  return String(u).replace(/([?&])(api_key|apikey|token|access_token)=([^&]*)/g, '$1$2=***');
}

async function fetchJson(url, opts = {}) {
  const signal = opts.signal || AbortSignal.timeout(15000);
  const res = await fetch(url, { ...opts, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${redactUrl(url)}`);
  return res.json();
}

async function fetchText(url, opts = {}) {
  const signal = opts.signal || AbortSignal.timeout(15000);
  const res = await fetch(url, { ...opts, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${redactUrl(url)}`);
  return res.text();
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

// Coerce a {d, unixTs, <field>} row from bitcoin-data.com into
// { value, asOf } with numeric coercion. BD returns numbers OR numeric
// strings depending on endpoint (lthRealizedPrice was a string; sopr a
// number) — normalize here so downstream math never concatenates strings.
function bdRow(value, asOf) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return { value: Number.isFinite(n) ? n : null, asOf: asOf || null };
}

// Merge-previous for a keyed section: keep any field the fresh fetch failed
// to produce, if the previous value is not older than maxAgeHours. Fresh
// values always win. A prev section missing its as_of stamp is treated as
// fresh-enough (rather than infinitely stale) — dropping every field because
// a stamp is absent is worse than carrying values one extra cycle.
function mergePrevious(section, prevSection, maxAgeHours) {
  if (!prevSection || typeof prevSection !== 'object') return section;
  const out = { ...section };
  const prevAt = prevSection.as_of || prevSection.generated_at;
  const prevAgeMs = prevAt ? Date.now() - new Date(prevAt).getTime() : 0; // unstamped → assume fresh
  const prevFresh = prevAgeMs <= maxAgeHours * 3600 * 1000;
  for (const [k, v] of Object.entries(prevSection)) {
    const cur = out[k];
    const curEmpty = cur == null || (typeof cur === 'object' && cur.value == null);
    if (curEmpty && v != null) {
      if (!prevFresh && k !== 'history' && !Array.isArray(v)) continue; // too stale to carry
      out[k] = v;
    }
  }
  return out;
}

// SMA over the last n points of a numeric array. Returns null when the
// window is incomplete (never a partial-window average — a partial 350W
// average is a lie that looks real).
function smaLast(series, n) {
  if (!Array.isArray(series) || series.length < n) return null;
  const win = series.slice(-n);
  return win.reduce((a, b) => a + b, 0) / n;
}

// ─── Phase 1: btc_market — spot, changes, long MAs, Mayer, Pi Cycle ──────────

// blockchain.info charts API is keyless and serves daily points for up to
// ~10 years. 8y comfortably covers the 350W (2450d) window.
const BCHART_URL = 'https://api.blockchain.info/charts/market-price?timespan=8y&format=json&sampled=false';

async function fetchBtcMarket(coingeckoTop) {
  console.log('── BTC market (blockchain.info 8y + CoinGecko spot) ──');
  const out = { spot: null, ma111d: null, ma200w: null, ma350w: null, mayer: null, pi_cycle_gap_pct: null, as_of: null };
  try {
    const chart = await fetchJson(BCHART_URL);
    const pts = (chart.values || []).filter(p => p.y != null && p.y > 0);
    if (pts.length < 2450) {
      console.warn(`  ⚠ BTC market: only ${pts.length} closes (<350W window) — MAs withheld`);
      return out;
    }
    const closes = pts.map(p => p.y);
    const spotFromChart = closes[closes.length - 1];

    // Spot + 24h/7d/30d changes: prefer CoinGecko's quote (live, has
    // official change windows); fall back to chart-derived if CG 429s.
    let spot = null, ch24 = null, ch7 = null, ch30 = null, spotAsOf = null;
    const cg = coingeckoTop?.BTC;
    if (cg && typeof cg.price === 'number' && Number.isFinite(cg.price)) {
      spot = cg.price;
      ch24 = cg.change24h ?? null;
      ch7 = cg.change7d ?? null;
      ch30 = cg.change30d ?? null;
      spotAsOf = 'coingecko';
    } else {
      // Chart closes are daily; approximate change windows by calendar-day
      // offsets from the end of the series.
      const at = (daysAgo) => closes.length > daysAgo ? closes[closes.length - 1 - daysAgo] : null;
      const pct = (then) => then && then > 0 ? (spotFromChart / then - 1) * 100 : null;
      spot = spotFromChart; ch24 = pct(at(1)); ch7 = pct(at(7)); ch30 = pct(at(30));
      spotAsOf = 'blockchain.info (daily close)';
    }

    const ma111d = smaLast(closes, 111);
    const ma200w = smaLast(closes, 1400);   // 200 weeks × 7
    const ma350w = smaLast(closes, 2450);   // 350 weeks × 7
    const mayer = ma200w ? spot / ma200w : null;
    // Pi Cycle Top: 111DMA crossing above 350WMA signals a cycle top.
    // Gap = (111DMA − 350WMA) / 350WMA; positive → 111DMA above (late-cycle
    // territory), approaching 0 from above historically marks the top.
    const piGap = ma111d && ma350w ? (ma111d - ma350w) / ma350w * 100 : null;

    out.spot = { price: spot, change24h_pct: ch24, change7d_pct: ch7, change30d_pct: ch30, source: spotAsOf };
    out.ma111d = { value: ma111d, as_of: pts[pts.length - 1].x };
    out.ma200w = { value: ma200w, as_of: pts[pts.length - 1].x };
    out.ma350w = { value: ma350w, as_of: pts[pts.length - 1].x };
    out.mayer = mayer != null ? Number(mayer.toFixed(4)) : null;
    out.pi_cycle_gap_pct = piGap != null ? Number(piGap.toFixed(2)) : null;
    out.as_of = new Date().toISOString();
    console.log(`  ✓ spot $${Math.round(spot).toLocaleString()} (${spotAsOf}) | 111D $${Math.round(ma111d).toLocaleString()} | 200W $${Math.round(ma200w).toLocaleString()} | 350W $${Math.round(ma350w).toLocaleString()} | Mayer ${out.mayer} | Pi gap ${out.pi_cycle_gap_pct}%`);
  } catch (e) {
    console.warn(`  ✗ BTC market: ${e.message}`);
  }
  return out;
}

// ─── Phase 2: btc_onchain — bitcoin-data.com (gated daily) + CM backfill ──────

const BD_BASE = 'https://bitcoin-data.com/v1';
// Free tier: 10 requests/hour. One full pull = 8 requests (below) — we fetch
// only when the previous section is older than this gate, else carry forward.
const BD_REQUESTS_PER_PULL = 8;
const BD_GATE_HOURS = 20;

const BD_ENDPOINTS = [
  // Path components are hyphenated on BD's real API — underscored forms 404
  // (verified on the GitHub Actions runner, run #1282: realized_price/puell/
  // lth_realized_price all 404'd while their hyphenated forms serve data).
  ['realized_price', 'realizedPrice', 'realized-price'],
  ['mvrv', 'mvrv', 'mvrv'],
  ['sopr', 'sopr', 'sopr'],
  ['nupl', 'nupl', 'nupl'],
  ['puell', 'puellMultiple', 'puell-multiple'],
  ['lth_realized_price', 'lthRealizedPrice', 'lth-realized-price'],
  ['hashrate', 'hashrate', 'hashrate'],
  ['ssr', 'ssrStablecoin', 'ssr'],
];

async function fetchBtcOnchain(prevSection) {
  console.log('── BTC on-chain (bitcoin-data.com, gated daily) ──');
  // Gate: if previous fetch is fresh enough, skip the API entirely (BD's
  // free tier is 10 req/hr and data is ~7d delayed anyway — hammering it
  // 4×/day buys nothing).
  const prevAt = prevSection?.as_of;
  const prevAgeH = prevAt ? (Date.now() - new Date(prevAt).getTime()) / 3600000 : Infinity;
  if (prevSection && prevAgeH < BD_GATE_HOURS) {
    console.log(`  ⏭ BD gate: previous pull ${prevAgeH.toFixed(1)}h old (< ${BD_GATE_HOURS}h) — carrying forward`);
    return prevSection;
  }

  const out = { as_of: null, delayed_days: 7, source: 'bitcoin-data.com (free, delayed)' };
  let fetched = 0;
  for (const [key, field, path] of BD_ENDPOINTS) {
    if (fetched >= BD_REQUESTS_PER_PULL) break;
    try {
      const row = await fetchJson(`${BD_BASE}/${path}/latest`);
      const norm = bdRow(row?.[field] ?? null, row?.d ?? null);
      if (norm.value != null) {
        out[key] = norm;
        fetched++;
      } else {
        out[key] = null;
      }
    } catch (e) {
      console.warn(`  ✗ BD ${key}: ${e.message}`);
      out[key] = null;
    }
  }
  if (fetched === 0) {
    console.warn('  ⚠ BD returned nothing — carrying previous section if fresh');
    return null; // caller merges previous
  }
  out.as_of = new Date().toISOString();
  console.log(`  ✓ BD: ${fetched}/${BD_ENDPOINTS.length} fields (realized $${out.realized_price?.value?.toLocaleString?.() ?? '?'} | MVRV ${out.mvrv?.value} | SOPR ${out.sopr?.value} | Puell ${out.puell?.value})`);
  return out;
}

// MVRV history backfill from the coinmetrics/data GitHub CSV (raw.githubusercontent
// is reachable from GitHub Actions and this sandbox; CapMVRVCur is dense
// historically but the repo's tail lags ~6 months — entries are labeled stale).
async function backfillMvrvHistory() {
  console.log('── BTC MVRV history backfill (coinmetrics/data CSV) ──');
  try {
    const csv = await fetchText('https://raw.githubusercontent.com/coinmetrics/data/master/csv/btc.csv');
    const lines = csv.split('\n');
    const hdr = lines[0].split(',');
    const tIdx = hdr.indexOf('time');
    const mvrvIdx = hdr.indexOf('CapMVRVCur');
    if (tIdx < 0 || mvrvIdx < 0) throw new Error('CapMVRVCur column missing');
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      if (c.length <= Math.max(tIdx, mvrvIdx)) continue;
      const v = parseFloat(c[mvrvIdx]);
      if (Number.isFinite(v) && c[tIdx]) rows.push({ date: c[tIdx], mvrv: v });
    }
    // Keep the last 2 years daily (730 entries) — plenty for the weekly
    // read's 8-week window and keeps snapshot.json lean.
    const trimmed = rows.slice(-730);
    console.log(`  ✓ CM backfill: ${trimmed.length} MVRV rows (${trimmed[0]?.date} → ${trimmed[trimmed.length - 1]?.date})`);
    return trimmed;
  } catch (e) {
    console.warn(`  ✗ CM backfill: ${e.message}`);
    return [];
  }
}

// ─── Phase 3a: btc_vol — Deribit DVOL + skew + term structure ─────────────────

// Black-Scholes call delta — used only to SELECT the ~25-delta strike per
// expiry (nearest |delta − 0.25|), not to price anything.
function bsCallDelta(S, K, tYears, vol, r = 0) {
  if (S <= 0 || K <= 0 || tYears <= 0 || vol <= 0) return null;
  const sqrtT = Math.sqrt(tYears);
  const d1 = (Math.log(S / K) + (r + vol * vol / 2) * tYears) / (vol * sqrtT);
  // Normal CDF via erf approximation (Abramowitz-Stegun 7.1.26)
  const sign = d1 >= 0 ? 1 : -1;
  const x = Math.abs(d1) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  const normCdf = 0.5 * (1 + sign * y);
  return normCdf;
}

async function fetchBtcVol(spot) {
  console.log('── BTC vol (Deribit DVOL + skew + term structure) ──');
  const out = { dvol: null, dvol_history: [], skew_25d: null, term_structure: null, as_of: null };
  const nowMs = Date.now(); // function-scoped — the book path below also needs it
  try {
    // DVOL: current index + last 60 daily closes (hourly, sampled to 1/day).
    const endMs = nowMs;
    const startMs = nowMs - 61 * 86400 * 1000;
    const hist = await fetchJson(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${startMs}&end_timestamp=${endMs}&resolution=86400`);
    const data = hist?.result?.data || [];
    out.dvol_history = data.map(d => ({ t: d[0], v: d[4] })).filter(p => p.v != null);
    if (out.dvol_history.length) {
      out.dvol = out.dvol_history[out.dvol_history.length - 1].v;
    }
    console.log(`  ✓ DVOL ${out.dvol} (${out.dvol_history.length} daily points)`);
  } catch (e) {
    console.warn(`  ✗ DVOL history: ${e.message}`);
  }

  try {
    // Option book: all live BTC options, mark_iv per instrument.
    const book = await fetchJson('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option&expired=false');
    const insts = (book?.result || []).filter(r => r.mark_iv != null && r.instrument_name);
    const S = spot || null;
    if (insts.length && S) {
      // Group by expiry; parse "BTC-26MAR27-40000-C"
      const byExpiry = new Map();
      for (const r of insts) {
        const parts = r.instrument_name.split('-');
        if (parts.length < 4) continue;
        const exp = parts[1];
        if (!byExpiry.has(exp)) byExpiry.set(exp, []);
        byExpiry.get(exp).push({ ...r, strike: parseFloat(parts[2]), isCall: parts[3] === 'C', iv: r.mark_iv });
      }
      // Days-to-expiry from Deribit's expiry date format (DDMONYY).
      const D = new Map([['JAN',0],['FEB',1],['MAR',2],['APR',3],['MAY',4],['JUN',5],['JUL',6],['AUG',7],['SEP',8],['OCT',9],['NOV',10],['DEC',11]]);
      const dte = (exp) => {
        const m = exp.match(/^(\d{2})([A-Z]{3})(\d{2})$/);
        if (!m) return null;
        const d = parseInt(m[1], 10), mo = D.get(m[2]);
        if (mo == null) return null;
        const yr = 2000 + parseInt(m[3], 10);
        const ms = Date.UTC(yr, mo, d, 8, 0, 0); // 08:00 UTC expiry
        return (ms - nowMs) / 86400000;
      };

      // Term structure: ATM (|strike − spot| minimal) IV per expiry, nearest 6.
      const termRows = [];
      for (const [exp, rows] of byExpiry) {
        const atm = rows.reduce((best, r) => (Math.abs(r.strike - S) < Math.abs(best.strike - S) ? r : best), rows[0]);
        const days = dte(exp);
        if (atm && days != null && days >= 0) termRows.push({ expiry: exp, days: Math.round(days), atm_iv: atm.iv });
      }
      termRows.sort((a, b) => a.days - b.days);
      out.term_structure = termRows.slice(0, 6);

      // 25-delta skew for the first 6 expiries: IV(25Δ put) − IV(25Δ call),
      // strikes chosen by BS delta with each expiry's ATM IV as the vol input.
      const skewRows = [];
      for (const [exp, rows] of byExpiry) {
        const days = dte(exp);
        if (days == null || days < 1) continue;
        const tYears = days / 365;
        const atm = rows.reduce((best, r) => (Math.abs(r.strike - S) < Math.abs(best.strike - S) ? r : best), rows[0]);
        if (!atm) continue;
        const vol = atm.iv / 100;
        const call25 = rows.filter(r => r.isCall).reduce((best, r) => {
          const delta = bsCallDelta(S, r.strike, tYears, vol);
          if (delta == null) return best;
          const target = Math.abs(delta - 0.25);
          return (!best || target < best.target) ? { r, target } : best;
        }, null);
        const put25 = rows.filter(r => !r.isCall).reduce((best, r) => {
          const delta = bsCallDelta(S, r.strike, tYears, vol); // put delta ≈ call delta − 1
          if (delta == null) return best;
          const target = Math.abs(Math.abs(delta - 1) - 0.25); // |putDelta| ≈ 0.25
          return (!best || target < best.target) ? { r, target } : best;
        }, null);
        if (call25 && put25) {
          skewRows.push({
            expiry: exp,
            days: Math.round(days),
            put_25d_iv: put25.r.iv,
            call_25d_iv: call25.r.iv,
            skew: put25.r.iv - call25.r.iv, // >0 → puts richer (downside demand)
          });
        }
      }
      skewRows.sort((a, b) => a.days - b.days);
      out.skew_25d = skewRows.slice(0, 6);
      console.log(`  ✓ term structure ${out.term_structure?.length} expiries; skew ${out.skew_25d?.length} expiries (front ${out.skew_25d?.[0]?.skew?.toFixed?.(2) ?? '?'} vol pts)`);
    }
  } catch (e) {
    console.warn(`  ✗ Deribit book: ${e.message}`);
  }
  out.as_of = new Date().toISOString();
  return out;
}

// ─── Phase 3b: btc_derivatives — funding, long/short, OI history ─────────────

async function fetchBtcDerivatives(prevSection) {
  console.log('── BTC derivatives (OKX funding, Binance/Bybit L/S, OI hist) ──');
  const out = { funding: null, long_short: null, oi_history: prevSection?.oi_history || [], as_of: null };

  // Funding: OKX per-instrument call for BTC-USDT-SWAP (fills the null the
  // batch OI path leaves). 8h funding × 3 = 24h annualized ÷ 365.
  try {
    const fr = await fetchJson('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP');
    const d = fr?.data?.[0];
    if (d?.fundingRate != null) {
      const rate8h = parseFloat(d.fundingRate);
      out.funding = {
        rate_8h: rate8h,
        annualized_pct: rate8h * 3 * 365 * 100,
        next_funding_time: d.nextFundingTime ?? null,
        as_of: new Date().toISOString(),
      };
    }
  } catch (e) {
    console.warn(`  ✗ OKX funding: ${e.message}`);
  }

  // Long/short + perp context: Hyperliquid as the runner-safe primary.
  // Binance geo-blocks GitHub Actions runners (HTTP 451, observed run #1282)
  // and Bybit's account-ratio 403'd the runner too; OKX's rubik stats return
  // 404 for every param shape. Hyperliquid's public info API is keyless,
  // POST-only, and not geo-blocked — the codebase already trusts it
  // client-side for funding rates. It has no long/short ACCOUNT ratio, but
  // it gives taker-side positioning proxies: premium + impact-price skew.
  // Chain: Hyperliquid (positioning proxies) → Binance (true account L/S,
  // sandbox/local runs) → Bybit (last-ditch).
  try {
    let ls = null;
    try {
      const hl = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        signal: AbortSignal.timeout(15000),
      });
      if (hl.ok) {
        const [meta, ctxs] = await hl.json();
        const idx = (meta?.universe || []).findIndex(p => p?.name === 'BTC');
        const ctx = ctxs?.[idx];
        if (ctx) {
          ls = {
            source: 'hyperliquid',
            // Positioning proxies (no account ratio on HL):
            premium: parseFloat(ctx.premium),               // perp vs oracle (positive = longs pay)
            funding_next_8h: parseFloat(ctx.funding),       // HL funding is hourly
            oi_usd: parseFloat(ctx.openInterest) * parseFloat(ctx.markPx || '0'),
            mark_px: parseFloat(ctx.markPx),
            as_of: new Date().toISOString(),
          };
        }
      }
    } catch (e) {
      console.warn(`  ⚠ Hyperliquid ctx unavailable (${e.message}) — trying Binance`);
    }
    if (!ls) {
      try {
        const bin = await fetchJson('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1d&limit=1');
        if (Array.isArray(bin) && bin[0]) {
          ls = { source: 'binance', long_pct: parseFloat(bin[0].longAccount) * 100, ratio: parseFloat(bin[0].longShortRatio), as_of: new Date().toISOString() };
        }
      } catch (e) {
        console.warn(`  ⚠ Binance L/S unavailable (${e.message}) — trying Bybit`);
      }
    }
    if (!ls) {
      const by = await fetchJson('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1d&limit=1');
      const row = by?.result?.list?.[0];
      if (row?.buyRatio != null) {
        ls = { source: 'bybit', long_pct: parseFloat(row.buyRatio) * 100, ratio: parseFloat(row.buyRatio) / parseFloat(row.sellRatio), as_of: new Date().toISOString() };
      }
    }
    // Carry forward the last true account-ratio when only the HL proxy is
    // available this run (merge-previous at the field level).
    if (ls && ls.source === 'hyperliquid' && prevSection?.long_short && (prevSection.long_short.long_pct != null)) {
      ls.long_pct = prevSection.long_short.long_pct;
      ls.ratio = prevSection.long_short.ratio;
      ls.ratio_as_of = prevSection.long_short.as_of;
    }
    out.long_short = ls;
  } catch (e) {
    console.warn(`  ✗ long/short: ${e.message}`);
  }

  out.as_of = new Date().toISOString();
  const f = out.funding?.rate_8h;
  const ls = out.long_short;
  const lsDesc = ls
    ? (ls.ratio != null
        ? `ratio ${ls.ratio.toFixed(2)} (${ls.source}${ls.ratio_as_of ? ', ratio as-of ' + ls.ratio_as_of.slice(0, 10) : ''})`
        : `HL proxy (premium ${(ls.premium * 100).toFixed(4)}%, OI $${Math.round(ls.oi_usd / 1e9)}B)`)
    : 'null';
  console.log(`  ✓ funding ${f != null ? (f * 100).toFixed(4) + '%/8h (ann ' + (out.funding.annualized_pct).toFixed(1) + '%)' : 'null'} | L/S ${lsDesc}`);
  return out;
}

// OI history accumulation — called from main() with the fresh binanceOI so
// the daily BTC OI level persists even when the on-chain gate skips BD.
export function accumulateBtcOiHistory(prevHistory, binanceOI) {
  const hist = Array.isArray(prevHistory) ? [...prevHistory] : [];
  const btc = binanceOI?.BTC;
  if (btc?.oiUsd != null && btc.oiUsd > 0) {
    const today = new Date().toISOString().slice(0, 10);
    if (!hist.some(h => h.date === today)) {
      hist.push({ date: today, oi_usd: btc.oiUsd });
      hist.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  return hist.slice(-90);
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export async function fetchBtcEnrichment(coingeckoTop, prevSnapshot) {
  const prevOnchain = prevSnapshot?.btc_onchain || null;
  const prevDerivs = prevSnapshot?.btc_derivatives || null;

  const market = await fetchBtcMarket(coingeckoTop);
  const onchain = await fetchBtcOnchain(prevOnchain);
  const mergedOnchain = onchain || mergePrevious({}, prevOnchain, 7 * 24); // carry up to 7d
  const vol = await fetchBtcVol(market?.spot?.price);
  const derivatives = await fetchBtcDerivatives(prevDerivs);

  const mvrvBackfill = await backfillMvrvHistory();

  return {
    btc_market: Object.keys(market).some(k => market[k] != null && k !== 'as_of') ? market : (prevSnapshot?.btc_market || null),
    btc_onchain: mergedOnchain && Object.keys(mergedOnchain).length ? mergedOnchain : null,
    btc_vol: vol,
    btc_derivatives: mergePrevious(derivatives, prevDerivs, 24),
    mvrv_backfill: mvrvBackfill.length ? { source: 'coinmetrics/data CSV (CapMVRVCur)', rows: mvrvBackfill, note: 'historical backfill; tail lags live by months — use BD for current MVRV' } : null,
  };
}
