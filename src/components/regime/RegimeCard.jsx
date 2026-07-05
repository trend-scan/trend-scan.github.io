/**
 * RegimeCard - Primary regime display card for MMM Macro Suite
 * Shows SPRING/SUMMER/FALL/WINTER + Liquidity overlay
 */

import React from 'react';
import { detectRegimeRotation } from '@/lib/regime/regimeRotation';

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

  // Rotation: detect from localStorage history (if available)
  let rotationInfo = null;
  try {
    const historyRaw = localStorage.getItem('trendscan_regime_history');
    if (historyRaw) {
      const history = JSON.parse(historyRaw);
      if (Array.isArray(history) && history.length >= 4) {
        rotationInfo = detectRegimeRotation(history);
      }
    }
  } catch {}

  // Next scheduled FRED snapshot refresh.
  // The refresh-snapshot.yml workflow runs at 14:00, 18:00, 22:00 UTC on
  // weekdays (Mon-Fri). Compute the next upcoming run from now.
  function nextRefreshTime() {
    const now = new Date();
    const UTC_HOURS = [14, 18, 22]; // 10am, 2pm, 6pm ET
    // Iterate forward day-by-day up to 7 days
    for (let d = 0; d < 8; d++) {
      const candidate = new Date(now);
      candidate.setUTCDate(now.getUTCDate() + d);
      const dayOfWeek = candidate.getUTCDay(); // 0=Sun, 6=Sat
      if (dayOfWeek === 0 || dayOfWeek === 6) continue; // skip weekends
      for (const hr of UTC_HOURS) {
        candidate.setUTCHours(hr, 0, 0, 0);
        if (candidate.getTime() > now.getTime()) {
          return candidate;
        }
      }
    }
    return null;
  }
  const nextExec = nextRefreshTime();

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
        <div>Next data refresh: {nextExec ? nextExec.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—'}</div>
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
