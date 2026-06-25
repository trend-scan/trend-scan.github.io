import React from 'react';
import { REGIME_INDICATORS, getSignalColor } from '../../lib/regime/index.js';

export default function IndicatorList({ signals = {} }) {
  const indicators = REGIME_INDICATORS.map(ind => {
    const value = signals[ind.id] ?? 0;
    const inverted = ['btc_dominance', 'volatility'].includes(ind.id);
    const color = getSignalColor(value, inverted);

    return {
      ...ind,
      value,
      color,
      inverted,
    };
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-3 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
        <span className="text-[9px] font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
          Regime Indicators
        </span>
      </div>

      {indicators.map(ind => (
        <IndicatorRow key={ind.id} indicator={ind} />
      ))}
    </div>
  );
}

function IndicatorRow({ indicator }) {
  const { name, description, positive, negative, weight, value, color, inverted } = indicator;

  // Normalize value display
  const displayValue = inverted ? -value : value;
  const barWidth = Math.min(100, Math.abs(displayValue) * 100);

  return (
    <div
      className="p-3 rounded border"
      style={{
        background: 'var(--scanner-bg2)',
        borderColor: 'var(--scanner-border2)',
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-[11px] font-semibold" style={{ color: 'var(--scanner-text)' }}>
            {name}
          </div>
          <div className="text-[9px] mt-0.5" style={{ color: 'var(--scanner-text3)' }}>
            {description}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold tabular-nums"
            style={{ color }}
          >
            {value > 0 ? '+' : ''}{(value * 100).toFixed(0)}%
          </span>
          <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'var(--scanner-bg)', color: 'var(--scanner-text3)' }}>
            {(weight * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Value bar */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--scanner-border)' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${barWidth}%`,
            background: color,
            marginLeft: value < 0 ? 'auto' : 0,
            marginRight: value >= 0 ? 'auto' : 0,
          }}
        />
      </div>

      {/* Signal labels */}
      <div className="flex justify-between mt-2">
        <span className="text-[8px]" style={{ color: 'var(--scanner-red)' }}>
          {negative}
        </span>
        <span className="text-[8px]" style={{ color: 'var(--scanner-green)' }}>
          {positive}
        </span>
      </div>
    </div>
  );
}