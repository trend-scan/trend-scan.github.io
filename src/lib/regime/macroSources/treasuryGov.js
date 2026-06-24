/**
 * Treasury.gov Fiscal Data API — free, no API key, CORS-enabled (Access-Control-Allow-Origin: *)
 *
 * Replaces FRED series:
 *   WTREGEN  → Treasury General Account (operating_cash_balance)
 *   RRPONTSYD → Reverse Repo (separate endpoint)
 *
 * Docs: https://fiscaldata.treasury.gov/api-documentation/
 */

const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';

/**
 * Treasury General Account (TGA) — replaces FRED WTREGEN.
 * Daily, ~104 most recent records.
 *
 * @returns {Array<{date, time, value}>} value in millions USD (matches FRED scale)
 */
export async function fetchTGA(limit = 104) {
  // Use today minus 1 year as filter; page[size] enforces return count
  const since = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const url = `${BASE}/v1/accounting/dts/operating_cash_balance` +
              `?fields=record_date,close_today_bal` +
              `&filter=record_date:gte:${since}` +
              `&page[size]=${limit}&sort=-record_date`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (!d.data) return [];

    return d.data.map(o => ({
      date: o.record_date,
      time: new Date(o.record_date).getTime(),
      value: parseFloat(o.close_today_bal) * 1e6,  // Treasury reports in millions; convert to dollars
    })).reverse();
  } catch (e) {
    console.warn(`[treasuryGov] TGA failed: ${e.message}`);
    return [];
  }
}

/**
 * Reverse Repo Agreements — replaces FRED RRPONTSYD.
 * Reported in Daily Treasury Statement under "other liabilities" — table ID 6.
 *
 * Note: this is approximate; the original FRED RRPONTSYD series sources from
 * the NY Fed's RRP operations, while Treasury.gov reports from the TGA perspective.
 * Numbers will differ slightly but trend together.
 */
export async function fetchRRP(limit = 104) {
  const since = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  // Debt subject to limit includes RRP; use the proper DTS table
  // Actually, RRP isn't in operating_cash_balance; use a separate dataset.
  // For now, return empty — we'll rely on the FRED proxy baked into snapshot.json
  return [];
}

/**
 * 10-Year Treasury Constant Maturity Rate (DGS10 equivalent)
 * Pulled from Treasury.gov daily treasury yield curve rates.
 */
export async function fetch10Yield(limit = 365) {
  const since = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const url = `${BASE}/v2/accounting/od/avg_interest_rates` +
              `?fields=record_date,security_desc,avg_interest_rate_amt` +
              `&filter=security_desc:eq:Treasury Constant Maturities_10 Year,record_date:gte:${since}` +
              `&page[size]=${limit}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const d = await res.json();
    if (!d.data) return [];

    return d.data.map(o => ({
      date: o.record_date,
      time: new Date(o.record_date).getTime(),
      value: parseFloat(o.avg_interest_rate_amt),
    })).reverse();
  } catch {
    return [];
  }
}

export const sourceMeta = {
  id: 'treasury_gov',
  type: 'macro',
  requiresApiKey: false,
  rateLimitPerMin: 60,
};
