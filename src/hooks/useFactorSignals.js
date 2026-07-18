/**
 * useFactorSignals — React hook that computes FactorWatch cross-asset signals
 * from the pre-built snapshot.
 *
 * Phase 3: Now passes factor_watch_leader_history to computeFactorSignals
 * so the stance engine has real rotation detection instead of null.
 */

import { useMemo } from 'react';
import { useSnapshotKey } from './useSnapshot';
import { computeFactorSignals } from '../lib/regime/factorSignals';

export function useFactorSignals() {
  const factorWatch = useSnapshotKey('factor_watch');
  const leaderHistory = useSnapshotKey('factor_watch_leader_history') || [];
  return useMemo(
    () => computeFactorSignals(factorWatch, leaderHistory),
    [factorWatch, leaderHistory]
  );
}

export function useFactorWatchHistory() {
  return useSnapshotKey('factor_watch_history') || [];
}
