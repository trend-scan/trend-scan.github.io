/**
 * Change Log — track day-over-day regime changes and surface them in the UI.
 *
 * Borrowed from factorwatch.ai's SNAPSHOT.changes pattern:
 *   "items": [
 *     "divyield back inside 2σ (5d)",
 *     "highbeta back inside 2σ (5d)",
 *     "momentum back inside 2σ (5d)"
 *   ]
 *
 * Persists the previous regime snapshot to localStorage. On each new computation,
 * compares current vs previous and generates human-readable change messages.
 *
 * Used by MacroRegime.jsx to show a dismissible banner:
 *   "⚠ Since last visit (2h ago): growth crossed +2σ · regime shifted NEUTRAL → EXPANSION"
 */

const STORAGE_KEY = 'trendscan_last_regime';
const STORAGE_TS_KEY = 'trendscan_last_regime_ts';

/**
 * Save the current regime snapshot to localStorage.
 * Call this AFTER every successful regime computation.
 */
export function saveSnapshot(regime) {
  try {
    const payload = {
      ts: Date.now(),
      quadrant: regime.quadrant,
      liquidity: regime.liquidity,
      label: regime.label,
      growth: {
        nowcast: regime.growth?.nowcast,
        label: regime.growth?.label,
      },
      inflation: {
        nowcast: regime.inflation?.nowcast,
        label: regime.inflation?.label,
      },
      liquidityData: {
        nowcast: regime.liquidityData?.nowcast,
        label: regime.liquidityData?.label,
      },
      grandComposite: regime.grandComposite,
      fredAvailable: regime.fredAvailable,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(STORAGE_TS_KEY, String(payload.ts));
  } catch (e) {
    console.warn('[changeLog] save failed:', e.message);
  }
}

/**
 * Load the previous regime snapshot from localStorage.
 * @returns {object|null} previous snapshot or null
 */
export function loadLastSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Get the timestamp of the last snapshot.
 * @returns {number|null} epoch ms or null
 */
export function getLastSnapshotTime() {
  try {
    const ts = localStorage.getItem(STORAGE_TS_KEY);
    return ts ? parseInt(ts, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Format a "time ago" string from epoch ms.
 * @returns {string} e.g. "2h ago", "5m ago", "yesterday"
 */
export function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 60) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Compute the diff between current regime and previous snapshot.
 *
 * @param {object} current - current regime object (from MacroRegime useMemo)
 * @param {object|null} previous - previous snapshot (from loadLastSnapshot)
 * @returns {Array<string>} human-readable change messages
 */
export function computeChanges(current, previous) {
  if (!previous || !current) return [];

  const changes = [];

  // 1. Regime quadrant flips
  if (current.quadrant && previous.quadrant && current.quadrant !== previous.quadrant) {
    changes.push(`Regime shifted: ${previous.quadrant} → ${current.quadrant}`);
  }

  // 2. Per-axis nowcast breaches (nowcast is 0-100 scale; 50 = neutral)
  // "Extreme" threshold: nowcast >= 70 (bullish extreme) or <= 30 (bearish extreme)
  for (const axis of ['growth', 'inflation', 'liquidityData']) {
    const cur = current[axis]?.nowcast;
    const prev = previous[axis]?.nowcast;
    if (cur == null || prev == null) continue;

    const axisName = axis === 'liquidityData' ? 'liquidity' : axis;
    const curExtreme = cur >= 70 || cur <= 30;
    const prevExtreme = prev >= 70 || prev <= 30;

    if (curExtreme && !prevExtreme) {
      const direction = cur >= 70 ? 'bullish extreme' : 'bearish extreme';
      changes.push(`${axisName} entered ${direction} (nowcast ${cur.toFixed(1)})`);
    } else if (!curExtreme && prevExtreme) {
      changes.push(`${axisName} back to neutral (was ${prev.toFixed(1)})`);
    }
  }

  // 3. Per-axis label changes (e.g. NEUTRAL → EXPANSION)
  for (const axis of ['growth', 'inflation', 'liquidityData']) {
    const curLabel = current[axis]?.label;
    const prevLabel = previous[axis]?.label;
    if (curLabel && prevLabel && curLabel !== prevLabel) {
      const axisName = axis === 'liquidityData' ? 'liquidity' : axis;
      changes.push(`${axisName} label: ${prevLabel} → ${curLabel}`);
    }
  }

  // 4. Grand composite crossed 50 (mid-line)
  if (current.grandComposite != null && previous.grandComposite != null) {
    if (current.grandComposite >= 50 && previous.grandComposite < 50) {
      changes.push(`Grand composite crossed above 50 (now ${current.grandComposite.toFixed(1)})`);
    } else if (current.grandComposite < 50 && previous.grandComposite >= 50) {
      changes.push(`Grand composite crossed below 50 (now ${current.grandComposite.toFixed(1)})`);
    }
  }

  // 5. FRED availability change
  if (current.fredAvailable !== previous.fredAvailable) {
    if (current.fredAvailable) {
      changes.push(`FRED macro data now available (full regime coverage)`);
    } else {
      changes.push(`FRED macro data unavailable (crypto-native signals only)`);
    }
  }

  return changes;
}

/**
 * Convenience: compute changes against the stored previous snapshot,
 * then save current as the new "previous" for next time.
 *
 * @param {object} current - current regime
 * @returns {Array<string>} change messages (may be empty)
 */
export function diffAndPersist(current) {
  const previous = loadLastSnapshot();
  const changes = computeChanges(current, previous);
  saveSnapshot(current);
  return changes;
}

/**
 * Clear the stored snapshot (e.g. when user dismisses the banner).
 */
export function clearSnapshot() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_TS_KEY);
  } catch {}
}
