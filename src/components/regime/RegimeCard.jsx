/**
 * RegimeCard - Primary regime display card for MMM Macro Suite
 * Shows SPRING/SUMMER/FALL/WINTER + Liquidity overlay
 */

import React from 'react';

const SEASON_CONFIG = {
  SPRING: {
    label: 'SPRING',
    season: 'Goldilocks',
    color: 'var(--scanner-green)',
    bg: 'rgba(0,230,118,0.06)',
    border: 'rgba(0,230,118,0.25)',
  },
  SUMMER: {
    label: 'SUMMER',
    season: 'Overheat',
    color: 'var(--scanner-red)',
    bg: 'rgba(239,68,68,0.06)',
    border: 'rgba(239,68,68,0.25)',
  },
  FALL: {
    label: 'FALL',
    season: 'Stagflation',
    color: '#f5c842',
    bg: 'rgba(245,200,66,0.06)',
    border: 'rgba(245,200,66,0.25)',
  },
  WINTER: {
    label: 'WINTER',
    season: 'Contraction',
    color: 'var(--scanner-blue)',
    bg: 'rgba(77,159,255,0.06)',
    border: 'rgba(77,159,255,0.25)',
  },
  FLUX: {
    label: 'FLUX',
    season: 'Transitional',
    color: 'var(--scanner-text3)',
    bg: 'rgba(156,163,175,0.06)',
    border: 'rgba(156,163,175,0.25)',
  },
};

const LIQ_COLORS = {
  LOOSE: 'var(--scanner-green)',
  NEUTRAL: 'var(--scanner-text2)',
  TIGHT: 'var(--scanner-red)',
};

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export default function RegimeCard({ regime }) {
  if (!regime) {
    return (
      <div
        className="rounded-lg p-5 border"
        style={{ background: 'var(--scanner-bg2)', borderColor: 'var(--scanner-border2)' }}
      >
        <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--scanner-text3)' }}>
          MACRO REGIME
        </div>
        <div className="text-center py-8" style={{ color: 'var(--scanner-text3)' }}>
          Loading regime data...
        </div>
      </div>
    );
  }

  const {
    quadrant = 'FLUX',
    liquidity = 'NEUTRAL',
    grandComposite = 50,
    growth = {},
    inflation = {},
    liquidity: liqData = {},
    lastUpdated = null,
    fredAvailable = true,
  } = regime;

  const seasonConfig = SEASON_CONFIG[quadrant] || SEASON_CONFIG.FLUX;
  const liqColor = LIQ_COLORS[liquidity] || LIQ_COLORS.NEUTRAL;

  // Next execution: first Friday of next month
  const now = new Date();
  const firstOfNext = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  let dayOfWeek = firstOfNext.getDay();
  let daysToFriday = dayOfWeek <= 5 ? (5 - dayOfWeek) : (12 - dayOfWeek);
  firstOfNext.setDate(firstOfNext.getDate() + daysToFriday);

  return (
    <div
      className="rounded-lg p-5"
      style={{
        background: seasonConfig.bg,
        border: `1px solid ${seasonConfig.border}`,
      }}
    >
      {/* Header */}
      <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--scanner-text3)' }}>
        MACRO REGIME
      </div>

      {/* Season Label */}
      <div className="mb-3">
        <div className="text-[24px] font-bold mb-0.5" style={{ color: 'var(--scanner-accent)' }}>
          {seasonConfig.label}
        </div>
        <div className="text-[11px]" style={{ color: seasonConfig.color }}>
          {seasonConfig.season} + {liquidity}
        </div>
      </div>

      {/* Grand Composite */}
      <div className="mb-4">
        <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: 'var(--scanner-text3)' }}>
          Grand Composite
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[32px] font-bold tabular-nums" style={{ color: seasonConfig.color }}>
            {grandComposite.toFixed(1)}
          </span>
          <span className="text-[14px]" style={{ color: 'var(--scanner-text3)' }}>/100</span>
        </div>
        {/* Nowcast bar */}
        <div className="h-1.5 rounded-sm mt-2 overflow-hidden" style={{ background: 'var(--scanner-border2)' }}>
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${Math.min(100, grandComposite)}%`,
              background: seasonConfig.color,
            }}
          />
        </div>
      </div>

      {/* Z-Scores Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <div className="text-[8px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--scanner-text3)' }}>
            Macro z
          </div>
          <span
            className="text-[14px] font-bold tabular-nums"
            style={{ color: growth.meZ > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)' }}
          >
            {growth.meZ > 0 ? '+' : ''}{growth.meZ?.toFixed(2) ?? '0.00'}
          </span>
        </div>
        <div>
          <div className="text-[8px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--scanner-text3)' }}>
            Impulse z
          </div>
          <span
            className="text-[14px] font-bold tabular-nums"
            style={{ color: growth.impulseZ > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)' }}
          >
            {growth.impulseZ > 0 ? '+' : ''}{growth.impulseZ?.toFixed(2) ?? '0.00'}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t my-4" style={{ borderColor: 'var(--scanner-border2)' }} />

      {/* Footer info */}
      <div className="space-y-1 text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
        {lastUpdated && (
          <div>Updated: {new Date(lastUpdated).toLocaleTimeString()}</div>
        )}
        <div>Next exec: {fmtDate(firstOfNext)}</div>
        <div style={{ opacity: 0.6 }}>
          {fredAvailable ? (
            <span>via FRED + Binance + Kraken</span>
          ) : (
            <span>Crypto-native signals only</span>
          )}
        </div>
      </div>
    </div>
  );
}
