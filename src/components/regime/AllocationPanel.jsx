/**
 * AllocationPanel - TOTAL3ES Crypto Allocation Status
 */

import React from 'react';

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
  if (!regime) {
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

  const {
    ultra6 = { score: 0, on: false },
    ob1 = { score: 0, on: false },
    core8Score = 0,
    core9Score = 0,
    allocation = {},
    quadrant = 'FLUX',
    liquidity = 'NEUTRAL',
  } = regime;

  const bothOn = ultra6.on && ob1.on;
  const isAllocate = allocation.status === 'ALLOCATE';

  return (
    <div
      className="rounded-lg p-5"
      style={{
        background: bothOn ? 'rgba(0,230,118,0.06)' : 'var(--scanner-bg2)',
        border: `1px solid ${bothOn ? 'rgba(0,230,118,0.25)' : 'var(--scanner-border2)'}`,
      }}
    >
      {/* Header */}
      <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--scanner-text3)' }}>
        ALLOCATION STATUS
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
        <ScoreBar score={core8Score} total={8} threshold={5} label="Core8" />
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
