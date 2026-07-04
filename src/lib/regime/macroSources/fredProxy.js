/**
 * FRED Proxy — reads macro data from the pre-built snapshot.json.
 *
 * GitHub Pages can't run serverless functions, so FRED data is fetched
 * server-side by the daily GitHub Action workflow and baked into
 * /snapshot.json. This module reads that file at runtime.
 *
 * If the snapshot is missing (e.g. first deploy before workflow runs),
 * returns empty arrays — the macro resolver then falls back to Alpha Vantage / Treasury.gov.
 */

let _snapshotCache = null;

async function loadSnapshot() {
  if (_snapshotCache) return _snapshotCache;
  try {
    // snapshot.json is committed to the repo root by the daily workflow
    const res = await fetch('/snapshot.json');
    if (!res.ok) return null;
    _snapshotCache = await res.json();
    return _snapshotCache;
  } catch {
    return null;
  }
}

/**
 * Fetch a FRED series from the baked snapshot.
 * @returns {Promise<Array<{date, time, value}>>} or [] if not in snapshot
 */
export async function fetchSeries(seriesId) {
  const snap = await loadSnapshot();
  if (!snap?.fred?.[seriesId]) return [];
  return snap.fred[seriesId];
}

/**
 * Get all available FRED series from snapshot.
 */
export async function getAllSeries() {
  const snap = await loadSnapshot();
  return snap?.fred || {};
}

/**
 * When the snapshot was last generated (ISO string or null).
 */
export async function getSnapshotTimestamp() {
  const snap = await loadSnapshot();
  return snap?.generated_at || null;
}

export const sourceMeta = {
  id: 'fred_proxy',
  type: 'macro',
  requiresApiKey: false,  // key lives in GitHub Actions secret
  // Cache freshness = 24h (snapshot is rebuilt daily)
};
