/**
 * Change Banner — displays day-over-day regime changes.
 *
 * Borrowed from factorwatch.ai's SNAPSHOT.changes pattern.
 * Shows a dismissible banner at the top of the MacroRegime page:
 *   "⚠ Since last visit (2h ago): growth crossed +2σ · regime shifted NEUTRAL → EXPANSION"
 */

import React, { useState, useEffect } from 'react';
import { diffAndPersist, timeAgo, getLastSnapshotTime } from '@/lib/regime/changeLog';

export default function ChangeBanner({ regime }) {
  const [changes, setChanges] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [lastVisit, setLastVisit] = useState(null);

  useEffect(() => {
    if (!regime) return;
    // Capture the previous timestamp BEFORE diffAndPersist overwrites it
    const prevTs = getLastSnapshotTime();
    const newChanges = diffAndPersist(regime);
    setChanges(newChanges);
    setLastVisit(timeAgo(prevTs));
  }, [regime]);

  if (dismissed || changes.length === 0) return null;

  return (
    <div
      className="rounded-lg p-3 flex items-start gap-3 mb-4"
      style={{
        background: 'rgba(245,158,11,0.06)',
        border: '1px solid rgba(245,158,11,0.25)',
      }}
    >
      <span className="text-[14px] mt-0.5" style={{ color: 'var(--scanner-accent)' }}>⚠</span>
      <div className="flex-1">
        <div className="text-[10px] font-bold tracking-wide mb-1" style={{ color: 'var(--scanner-accent)' }}>
          Since last visit ({lastVisit})
        </div>
        <ul className="text-[10px] space-y-0.5" style={{ color: 'var(--scanner-text2)' }}>
          {changes.map((change, i) => (
            <li key={i}>· {change}</li>
          ))}
        </ul>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-[14px] leading-none px-2 py-0.5"
        style={{ color: 'var(--scanner-text3)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
