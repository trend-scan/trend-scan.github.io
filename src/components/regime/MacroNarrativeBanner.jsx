/**
 * MacroNarrativeBanner — dismissible alert banner showing unified FactorWatch signals.
 *
 * Phase 1b: Now displays the unified stance (CONSTRUCTIVE/SELECTIVE/DEFENSIVE/WAIT)
 * alongside the legacy boolean signals (shakeout, junk rally). Both derive from
 * the same computeFactorStance engine that powers the crypto Factor Monitor.
 *
 * Placed at the top of the MacroRegime page, above the RegimeCard.
 * Dismissible per session (state resets on page reload).
 */

import { useState } from 'react';
import { useFactorSignals } from '@/hooks/useFactorSignals';

export default function MacroNarrativeBanner() {
  const signals = useFactorSignals();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !signals) return null;

  // Show if any legacy signal is active OR the primary stance is actionable
  const hasLegacySignal = signals.isShakeout || signals.isJunkRally;
  const hasActionableStance = signals.primaryStance
    && signals.primaryStance.confidence >= 3
    && signals.primaryStance.stance !== 'WAIT';
  if (!hasLegacySignal && !hasActionableStance) return null;

  const banners = [];

  // Unified stance banner (always shown if actionable)
  if (signals.primaryStance && hasActionableStance) {
    const ps = signals.primaryStance;
    banners.push({
      color: ps.stance === 'CONSTRUCTIVE' ? 'green'
           : ps.stance === 'SELECTIVE' ? 'amber'
           : ps.stance === 'DEFENSIVE' ? 'red'
           : 'neutral',
      icon: ps.stance === 'CONSTRUCTIVE' ? '🟢'
          : ps.stance === 'SELECTIVE' ? '🟠'
          : ps.stance === 'DEFENSIVE' ? '🔴'
          : '⚪',
      title: `TradFi Factors — ${ps.stance} (${ps.confidence}/10)`,
      message: ps.rationale.join(' · '),
    });
  }

  // Legacy shakeout banner (shown alongside the stance)
  if (signals.isShakeout) {
    const momSigma = signals.raw.sp500_mom_5d_sigma;
    const revSpread = signals.raw.sp500_mom_rev_spread;
    banners.push({
      color: 'green',
      icon: '🟢',
      title: 'Institutional Shakeout Detected',
      message: `Price is flushing (${momSigma?.toFixed(1)}σ on 5d momentum), but analysts are upgrading top quintiles (+${revSpread}%). Favor accumulation on high-quality pullbacks.`,
    });
  }

  // Legacy junk rally banner
  if (signals.isJunkRally) {
    const sizeSpread = signals.raw.size_rev_spread;
    banners.push({
      color: 'amber',
      icon: '🟠',
      title: 'Low-Quality Rotation',
      message: `Analysts are upgrading lagging/small caps while cutting leaders (Size spread: ${sizeSpread}%). Mean-reversion strategies favored over breakouts.`,
    });
  }

  const colorMap = {
    green: { bg: 'rgba(0,230,118,0.06)', border: 'rgba(0,230,118,0.25)', text: 'var(--scanner-green)' },
    amber: { bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.25)', text: 'var(--scanner-accent)' },
    red: { bg: 'rgba(255,68,68,0.06)', border: 'rgba(255,68,68,0.25)', text: 'var(--scanner-red)' },
    neutral: { bg: 'rgba(163,186,216,0.04)', border: 'rgba(163,186,216,0.15)', text: 'var(--scanner-text3)' },
  };

  return (
    <div className="space-y-2 mb-4">
      {banners.map((banner, i) => {
        const c = colorMap[banner.color];
        return (
          <div
            key={i}
            className="flex items-start gap-3 px-4 py-3 rounded font-mono text-[11px]"
            style={{ background: c.bg, border: `1px solid ${c.border}` }}
          >
            <span className="flex-shrink-0">{banner.icon}</span>
            <div className="flex-1">
              <div className="font-bold mb-0.5" style={{ color: c.text }}>{banner.title}</div>
              <div style={{ color: 'var(--scanner-text2)' }}>{banner.message}</div>
              <div className="text-[8px] mt-1.5" style={{ color: 'var(--scanner-text3)' }}>
                Data: <a href="https://factorwatch.ai" target="_blank" rel="noopener" style={{ color: 'var(--scanner-text3)', textDecoration: 'underline' }}>factorwatch.ai</a>
              </div>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="flex-shrink-0 text-[14px] leading-none"
              style={{ color: 'var(--scanner-text3)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
