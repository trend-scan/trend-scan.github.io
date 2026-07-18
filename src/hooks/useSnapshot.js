/**
 * useSnapshot — shared hook for reading the pre-built /snapshot.json
 *
 * DRYs up the snapshot access pattern that was duplicated across
 * fredProxy.js, traditionalMarkets.js, coingecko.js, and DailyBoard.jsx.
 *
 * The snapshot is fetched once and cached module-level — all components
 * sharing the hook get the same cached data without duplicate HTTP requests.
 */

import { useEffect, useState } from 'react';

let _snapshotCache = null;
let _fetchPromise = null;

async function fetchSnapshot() {
  if (_snapshotCache) return _snapshotCache;
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = fetch('/snapshot.json')
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      _snapshotCache = d;
      _fetchPromise = null;
      return d;
    })
    .catch(() => {
      _fetchPromise = null;
      return null;
    });

  return _fetchPromise;
}

/**
 * Read the full snapshot object. Returns null while loading.
 *
 * @returns {object|null} the snapshot data, or null if not yet loaded
 */
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState(_snapshotCache);

  useEffect(() => {
    if (_snapshotCache) {
      setSnapshot(_snapshotCache);
      return;
    }
    fetchSnapshot().then(setSnapshot);
  }, []);

  return snapshot;
}

/**
 * Read a specific key from the snapshot. Returns undefined while loading,
 * null if the key doesn't exist.
 *
 * @param {string} key — e.g. 'fred', 'factor_watch', 'etf_flows'
 * @returns {*} the snapshot section, undefined while loading, null if missing
 */
export function useSnapshotKey(key) {
  const snapshot = useSnapshot();
  if (!snapshot) return undefined; // still loading
  return snapshot[key] ?? null;
}

/**
 * Clear the snapshot cache — forces a re-fetch on next hook usage.
 * Useful after a manual data refresh.
 */
export function clearSnapshotCache() {
  _snapshotCache = null;
  _fetchPromise = null;
}
