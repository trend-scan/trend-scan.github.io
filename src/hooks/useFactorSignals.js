/**
 * useFactorSignals — React hook that computes FactorWatch cross-asset signals
 * from the pre-built snapshot.
 *
 * Returns null while the snapshot is loading, or if factor_watch data is
 * unavailable (scraper failed). Components should check for null before
 * rendering.
 */

import { useMemo } from 'react';
import { useSnapshotKey } from './useSnapshot';
import { computeFactorSignals } from '../lib/regime/factorSignals';

export function useFactorSignals() {
  const factorWatch = useSnapshotKey('factor_watch');
  return useMemo(
    () => computeFactorSignals(factorWatch),
    [factorWatch]
  );
}

export function useFactorWatchHistory() {
  return useSnapshotKey('factor_watch_history') || [];
}
