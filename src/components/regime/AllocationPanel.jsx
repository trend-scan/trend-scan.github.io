/**
 * AllocationPanel - TOTAL3ES Crypto Allocation Status
 *
 * Reads allocation data from two sources (prefers server-side):
 *   1. Server-side snapshot (regime_history latest entry) — unified with
 *      Signal page's cash weight. Every user sees the same value.
 *   2. Client-side computed (from live Macro page data) — fallback for
 *      intraday updates between snapshot refreshes.
 */

import React, { useState, useEffect } from 'react';

function ScoreBar({ score, total, threshold, label }) {
  const pct = (score / total) * 100;
  const isOn = score >= threshold;
  const color = isOn ? 'var(--scanner-green)' : 'var(--scanner-text3)';

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-bold w-14" style={{ color: 'var(--scanner-text3)' }}>
        {label}
      </span>
      <div className="flex-1 h-1.5 rounded-sm overflow-hidden" style={{ background: 'var(--scanner-border2)' }}>
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[9px] font-bold tabular-nums w-10 text-right" style={{ color }}>
        {score}/{total}
      </span>
      <span
        className="text-[8px] px-1.5 py-0.5 rounded"
        style={{
          background: isOn ? 'rgba(0,230,118,0.1)' : 'rgba(156,163,175,0.1)',
          color: isOn ? 'var(--scanner-green)' : 'var(--scanner-text3)',
        }}
      >
        {isOn ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}

export default function AllocationPanel({ regime }) {
  // Fetch server-side snapshot for unified allocation data
  const [serverData, setServerData] = useState(null);
  useEffect(() => {
    fetch('/snapshot.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => setServerData(d))
      .catch(() => {});
  }, []);

  if (!regime && !serverData) {
    return (
      <div
        className="rounded-lg p-5 border"
        style={{ background: 'var(--scanner-bg2)', borderColor: 'var(--scanner-border2)' }}
      >
        <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--scanner-text3)' }}>
          ALLOCATION STATUS
        </div>
        <div className="text-center py-8" style={{ color: 'var(--scanner-text3)' }}>
          Loading allocation data...
        </div>
      </div>
    );
  }

  // Prefer server-side data (unified with Signal page), fall back to client-side
  const latestServerRegime = serverData?.regime_history?.[serverData.regime_history.length - 1];

  const {
    ultra6 = { score: latestServerRegime?.ultra6_score ?? 0, on: latestServerRegime?.ultra6_on ?? false },
    ob1 = { score: latestServerRegime?.ob1_score ?? 0, on: latestServerRegime?.ob1_on ?? false },
    core8Score = 0,
    core9Score = 0,
    allocation = latestServerRegime ? {
      status: latestServerRegime.allocation_status || 'STABLECOINS',
      vehicle: latestServerRegime.allocation_vehicle,
      conviction: latestServerRegime.allocation_conviction || 'NONE',
      icon: latestServerRegime.allocation_status === 'ALLOCATE' ? '★' : '◆',
      description: latestServerRegime.allocation_status === 'ALLOCATE'
        ? `${latestServerRegime.allocation_conviction} conviction. Execute via ${latestServerRegime.allocation_vehicle || 'BTC'}.`
        : 'No crypto allocation. Wait for signal.',
    } : {},
    quadrant = latestServerRegime?.quadrant || regime?.quadrant || 'FLUX',
    liquidity = latestServerRegime?.liquidity || regime?.liquidity || 'NEUTRAL',
  } = regime || {};

  const bothOn = ultra6.on && ob1.on;
  const isAllocate = allocation.status === 'ALLOCATE';

  // Show "server-side" badge when reading from snapshot
  const dataSource = latestServerRegime ? 'server' : 'live';

  return (
    <div
      className="rounded-lg p-5"
      style={{
        background: bothOn ? 'rgba(0,230,118,0.06)' : 'var(--scanner-bg2)',
        border: `1px solid ${bothOn ? 'rgba(0,230,118,0.25)' : 'var(--scanner-border2)'}`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
          ALLOCATION STATUS
        </div>
        <span className="text-[7px] px-1.5 py-0.5 rounded" style={{
          background: dataSource === 'server' ? 'rgba(61,219,169,0.1)' : 'rgba(121,168,255,0.1)',
          color: dataSource === 'server' ? 'var(--scanner-green)' : 'var(--scanner-blue)',
        }}>
          {dataSource === 'server' ? 'SERVER' : 'LIVE'}
        </span>
      </div>

      {/* Master Status */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-[18px]"
            style={{ color: bothOn ? 'var(--scanner-accent)' : 'var(--scanner-text3)' }}
          >
            {allocation.icon || '◆'}
          </span>
          <span
            className="text-[14px] font-bold"
            style={{ color: bothOn ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}
          >
            {bothOn ? 'BOTH ON — ALLOCATE TO CRYPTO' : 'WAIT — NO SIGNAL'}
          </span>
        </div>
        <div className="text-[10px] mb-2" style={{ color: 'var(--scanner-text2)' }}>
          U6 {ultra6.score}/6 (≥4) {ultra6.on ? '✓' : '✗'} AND OB1 {ob1.score}/6 (≥3) {ob1.on ? '✓' : '✗'}
        </div>
        {allocation.description && (
          <div className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>
            {allocation.description}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t my-4" style={{ borderColor: 'var(--scanner-border2)' }} />

      {/* Strategy Scores */}
      <div className="space-y-2 mb-4">
        <ScoreBar score={ultra6.score} total={6} threshold={4} label="Ultra6" />
        <ScoreBar score={core8Score || ultra6.score} total={8} threshold={5} label="Core8" />
        <ScoreBar score={core9Score} total={9} threshold={6} label="Core9" />
        <ScoreBar score={ob1.score} total={6} threshold={3} label="OB1" />
      </div>

      {/* Conviction Level */}
      <div className="grid grid-cols-2 gap-2">
        <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
          Vehicle
        </div>
        <div
          className="text-[10px] font-bold text-right"
          style={{ color: isAllocate ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}
        >
          {allocation.vehicle || '—'}
        </div>
        <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
          Conviction
        </div>
        <div
          className="text-[10px] font-bold text-right"
          style={{ color: isAllocate ? 'var(--scanner-accent)' : 'var(--scanner-text3)' }}
        >
          {allocation.conviction || 'NONE'}
        </div>
      </div>

      {/* FALL Basket indicator */}
      {quadrant === 'FALL' && (
        <div className="mt-4 p-2 rounded" style={{ background: 'rgba(245,200,66,0.1)', border: '1px solid rgba(245,200,66,0.2)' }}>
          <div className="text-[8px] font-bold mb-1" style={{ color: '#f5c842' }}>
            FALL BASKET ACTIVE
          </div>
          <div className="text-[8px] space-y-0.5" style={{ color: 'var(--scanner-text2)' }}>
            <div>GLD 25% · IEF 25%</div>
            <div>UUP 25% · XLP 25%</div>
            <div className="opacity-60">Fixed allocation, no momentum</div>
          </div>
        </div>
      )}

      {/* Momentum Blend indicator for non-FALL */}
      {quadrant !== 'FALL' && bothOn && (
        <div className="mt-4 p-2 rounded" style={{ background: 'rgba(0,230,118,0.05)', border: '1px solid var(--scanner-border2)' }}>
          <div className="text-[8px] font-bold mb-1" style={{ color: 'var(--scanner-green)' }}>
            MOMENTUM BLEND ACTIVE
          </div>
          <div className="text-[8px] space-y-0.5" style={{ color: 'var(--scanner-text2)' }}>
            <div>Framework A: Relative momentum</div>
            <div>Framework B: Trend / quality</div>
            <div className="opacity-60">50/50 weighted blend</div>
          </div>
        </div>
      )}
    </div>
  );
}
