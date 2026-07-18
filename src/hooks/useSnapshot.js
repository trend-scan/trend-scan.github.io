/**
 * useSnapshot — shared hook for reading the pre-built /snapshot.json
 */

import { useEffect, useState } from 'react';

let _snapshotCache = null;
let _fetchPromise = null;

async function fetchSnapshot() {
  if (_snapshotCache) return _snapshotCache;
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = fetch('/snapshot.json')
    .then(r => r.ok ? r.json() : null)
    .then(d => { _snapshotCache = d; _fetchPromise = null; return d; })
    .catch(() => { _fetchPromise = null; return null; });
  return _fetchPromise;
}

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState(_snapshotCache);
  useEffect(() => {
    if (_snapshotCache) { setSnapshot(_snapshotCache); return; }
    fetchSnapshot().then(setSnapshot);
  }, []);
  return snapshot;
}

export function useSnapshotKey(key) {
  const snapshot = useSnapshot();
  if (!snapshot) return undefined;
  return snapshot[key] ?? null;
}

export function clearSnapshotCache() {
  _snapshotCache = null;
  _fetchPromise = null;
}
