/**
 * useSnapshotFreshness — hook for assessing snapshot data staleness
 *
 * Snapshot refreshes 4× daily (04:00, 10:00, 16:00, 22:00 UTC). The banner uses
 * the snapshot's `generated_at` timestamp to determine how stale the data is.
 *
 * Staleness thresholds:
 *   FRESH    → < 6h old   → no banner (silent)
 *   STALE    → 6–12h old  → amber banner ("last refresh may have missed")
 *   CRITICAL → > 12h old  → red banner ("multiple scheduled refreshes missed")
 *
 * The 6h threshold gives one scheduled refresh worth of buffer (refreshes
 * are 6h apart). The 12h threshold means two consecutive refreshes have
 * been missed — strong signal of CI failure or upstream API outage.
 */

import { useMemo } from 'react';

const REFRESH_HOURS_UTC = [4, 10, 16, 22];  // 04:00, 10:00, 16:00, 22:00 UTC

/**
 * Compute hours until the next scheduled refresh.
 * @param {Date} now
 * @returns {number}
 */
function hoursUntilNextRefresh(now) {
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const nowUtcHours = utcHour + utcMin / 60;

  for (const h of REFRESH_HOURS_UTC) {
    if (h > nowUtcHours) return h - nowUtcHours;
  }
  // All today's refreshes have passed — next is tomorrow at 04:00 UTC
  return 24 - nowUtcHours + 4;
}

/**
 * Format an age in milliseconds as a human-readable string.
 *   < 60min   → "Xm"
 *   < 24h     → "Xh Ym"
 *   otherwise → "Xd Yh"
 */
function formatAge(ageMs) {
  const totalMin = Math.floor(ageMs / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const totalHours = Math.floor(ageMs / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * @param {string|null} generatedAt — ISO timestamp from snapshot.generated_at
 * @returns {{
 *   status: 'fresh'|'stale'|'critical'|'unknown',
 *   ageMs: number|null,
 *   ageLabel: string,
 *   generatedAt: Date|null,
 *   hoursUntilNextRefresh: number,
 *   nextRefreshLabel: string,
 * }}
 */
export function useSnapshotFreshness(generatedAt) {
  return useMemo(() => {
    if (!generatedAt) {
      return {
        status: 'unknown',
        ageMs: null,
        ageLabel: '—',
        generatedAt: null,
        hoursUntilNextRefresh: 0,
        nextRefreshLabel: '—',
      };
    }

    const genDate = new Date(generatedAt);
    const now = new Date();
    const ageMs = now.getTime() - genDate.getTime();
    const ageHours = ageMs / 3600000;

    // Use a ternary so TypeScript infers the literal union type
    // 'fresh' | 'stale' | 'critical' (rather than widening to `string`).
    // Thresholds: <6h=fresh (1 refresh buffer), 6-12h=stale (1 missed),
    // >12h=critical (2+ missed). Refreshes are 6h apart.
    const status = ageHours < 6 ? 'fresh' : ageHours < 12 ? 'stale' : 'critical';

    const hoursLeft = hoursUntilNextRefresh(now);
    const nextRefreshLabel = hoursLeft < 1
      ? `${Math.round(hoursLeft * 60)}m`
      : `${Math.floor(hoursLeft)}h ${Math.round((hoursLeft % 1) * 60)}m`;

    return {
      status,
      ageMs,
      ageLabel: formatAge(ageMs),
      generatedAt: genDate,
      hoursUntilNextRefresh: hoursLeft,
      nextRefreshLabel,
    };
  }, [generatedAt]);
}
