/**
 * FreshnessBanner — shows a dismissible alert when snapshot data is stale
 *
 * Snapshot refreshes 4× daily (04:00, 10:00, 16:00, 22:00 UTC). When the most
 * recent scheduled refresh has missed, the snapshot.json served to clients
 * is stale. Without this banner, users see "current" verdicts and signals
 * that are actually hours or days old — leading to bad decisions.
 *
 * Visual states:
 *   FRESH    (< 6h)   → banner not rendered (silent)
 *   STALE    (6-12h)  → amber banner with dismiss button
 *   CRITICAL (> 12h)  → red banner with dismiss button + GitHub Actions link
 *
 * Dismiss behavior:
 *   - Dismissed per-session (sessionStorage) — reappears on next visit
 *   - Dismissal is per-status (dismissing STALE doesn't suppress CRITICAL
 *     if the data ages further)
 *   - Auto-reappears when status escalates (STALE→CRITICAL)
 *
 * The banner uses live time polling via setInterval so it escalates while
 * the page is open (the user doesn't need to refresh to see CRITICAL).
 */

import React, { useState, useEffect } from 'react';
import { useSnapshotFreshness } from '../hooks/useSnapshotFreshness';

const REPO_URL = 'https://github.com/trend-scan/trend-scan.github.io';
const ACTIONS_URL = `${REPO_URL}/actions/workflows/refresh-snapshot.yml`;

function statusConfig(status) {
  if (status === 'critical') {
    return {
      icon: '⚠',
      title: 'Stale data — multiple refresh failures',
      color: 'var(--scanner-red)',
      bg: 'rgba(255,68,68,0.06)',
      border: 'rgba(255,68,68,0.3)',
    };
  }
  if (status === 'stale') {
    return {
      icon: '◈',
      title: 'Snapshot is aging — last refresh may have missed',
      color: '#f5c842',
      bg: 'rgba(245,200,66,0.06)',
      border: 'rgba(245,200,66,0.3)',
    };
  }
  return null;
}

/**
 * @param {object} props
 * @param {string} [props.generatedAt] ISO timestamp from snapshot.generated_at
 * @param {string} [props.contextLabel] e.g. "Signal Engine" or "Macro Regime" (for dismiss key)
 */
export default function FreshnessBanner({ generatedAt, contextLabel = 'global' }) {
  // Poll every 60s so the banner escalates while the page is open.
  // Re-mounting useSnapshotFreshness isn't enough — we need a tick state.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const { status, ageLabel, generatedAt: genDate, nextRefreshLabel } = useSnapshotFreshness(generatedAt);
  const cfg = statusConfig(status);

  // Per-session dismissal, keyed by status + context.
  // Dismissing STALE doesn't suppress CRITICAL (different status key).
  const dismissKey = `trendscan_freshness_dismissed_${contextLabel}_${status}`;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(dismissKey) === '1');
    } catch {
      setDismissed(false);
    }
    // Reset dismissal when status changes (escalation auto-reopens)
  }, [dismissKey]);

  if (!cfg || dismissed || !genDate) return null;

  const handleDismiss = () => {
    try { sessionStorage.setItem(dismissKey, '1'); } catch {}
    setDismissed(true);
  };

  const formattedTime = genDate.toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short',
  });

  return (
    <div
      className="font-mono rounded-md px-4 py-3 flex items-start gap-3 mb-4"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.color,
      }}
      role="alert"
    >
      <span className="text-[14px] flex-shrink-0 mt-0.5">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold tracking-[0.08em] uppercase mb-1">
          {cfg.title}
        </div>
        <div className="text-[10px] leading-relaxed" style={{ color: 'var(--scanner-text2)' }}>
          Snapshot data is <strong style={{ color: cfg.color }}>{ageLabel}</strong> old
          (generated {formattedTime}).{' '}
          {status === 'critical' ? (
            <>
              Two or more scheduled refreshes have been missed — this usually means a CI
              failure or upstream API outage. Check the{' '}
              <a
                href={ACTIONS_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: cfg.color,
                  textDecoration: 'underline',
                }}
              >
                workflow run history
              </a>{' '}
              to verify.
            </>
          ) : (
            <>
              The last scheduled refresh may have missed. Next refresh in{' '}
              <strong style={{ color: cfg.color }}>{nextRefreshLabel}</strong>.
              If it doesn't update, check the{' '}
              <a
                href={ACTIONS_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: cfg.color, textDecoration: 'underline' }}
              >
                Actions log
              </a>
              .
            </>
          )}
          {' '}
          <span style={{ color: 'var(--scanner-text3)' }}>
            Until then, treat verdicts and signals as potentially outdated.
          </span>
        </div>
      </div>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss freshness banner"
        className="text-[14px] flex-shrink-0 mt-0.5 cursor-pointer"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--scanner-text3)',
          lineHeight: 1,
          padding: '0 4px',
        }}
        title="Dismiss for this session (reappears on next visit or if status escalates)"
      >
        ×
      </button>
    </div>
  );
}
