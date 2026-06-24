/**
 * Alpha Vantage — free with email-registered key, CORS-enabled (Access-Control-Allow-Origin: *)
 *
 * Free tier: 25 req/day. 'demo' key works for CPI only.
 *
 * Used as a live fallback for macro series; the daily GitHub Action snapshot
 * is the primary source (baked into snapshot.json at build time).
 *
 * Docs: https://www.alphavantage.co/documentation/
 */

const BASE = 'https://www.alphavantage.co/query';
const API_KEY = import.meta.env?.VITE_ALPHAVANTAGE_KEY || 'demo';

async function callAV(functionName, params = {}) {
  const url = new URL(BASE);
  url.searchParams.set('function', functionName);
  url.searchParams.set('apikey', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const d = await res.json();
  if (d.Information || d.Note) {
    throw new Error(d.Information || d.Note);
  }
  return d;
}

/**
 * CPI — Consumer Price Index for All Urban Consumers (CPIAUCSL equivalent)
 * Free with 'demo' key.
 */
export async function fetchCPI() {
  const d = await callAV('CPI', { interval: 'monthly' });
  if (!d.data) return [];
  return d.data.map(p => ({
    date: p.date,
    time: new Date(p.date).getTime(),
    value: parseFloat(p.value),
  })).reverse();  // AV returns newest-first; FRED returns oldest-first
}

/**
 * M2 Money Supply (M2SL equivalent)
 * Requires free key (not 'demo').
 */
export async function fetchM2() {
  const d = await callAV('M2', { interval: 'monthly' });
  if (!d.data) return [];
  return d.data.map(p => ({
    date: p.date,
    time: new Date(p.date).getTime(),
    value: parseFloat(p.value) * 1e9,  // AV reports in Billions; FRED in Millions → convert to $
  })).reverse();
}

/**
 * Initial Jobless Claims (ICSA equivalent)
 * Requires free key.
 */
export async function fetchInitialClaims() {
  const d = await callAV('INITIAL_CLAIMS');
  if (!d.data) return [];
  return d.data.map(p => ({
    date: p.date,
    time: new Date(p.date).getTime(),
    value: parseFloat(p.value) * 1000,  // AV in thousands; FRED in actual count
  })).reverse();
}

/**
 * Retail Sales (monthly)
 */
export async function fetchRetailSales() {
  const d = await callAV('RETAIL_SALES');
  if (!d.data) return [];
  return d.data.map(p => ({
    date: p.date,
    time: new Date(p.date).getTime(),
    value: parseFloat(p.value) * 1e6,  // AV in millions
  })).reverse();
}

/**
 * Federal Debt (quarterly)
 */
export async function fetchFederalDebt() {
  const d = await callAV('FEDERAL_DEBT');
  if (!d.data) return [];
  return d.data.map(p => ({
    date: p.date,
    time: new Date(p.date).getTime(),
    value: parseFloat(p.value) * 1e9,
  })).reverse();
}

/**
 * Treasury Yield (daily) — useful for computing bond proxies
 * Maturities: 3month, 2year, 5year, 7year, 10year, 30year
 */
export async function fetchTreasuryYield(maturity = '10year') {
  const d = await callAV('TREASURY_YIELD', { interval: 'daily', maturity });
  if (!d.data) return [];
  return d.data.map(p => ({
    date: p.date,
    time: new Date(p.date).getTime(),
    value: parseFloat(p.value),
  })).reverse();
}

export const sourceMeta = {
  id: 'alphavantage',
  type: 'macro',
  requiresApiKey: true,  // 'demo' works for CPI only
  rateLimitPerDay: 25,
};
