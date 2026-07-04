/**
 * CompositeGauge - Shows Growth/Inflation/Liquidity composite with nowcast bar
 */

import React from 'react';

const COMPOSITE_CONFIG = {
  GROWTH: {
    label: 'GROWTH',
    bands: ['RECESSIONARY', 'NEUTRAL', 'EXPANSION', 'BOOM'],
    bandColors: ['var(--scanner-red)', 'var(--scanner-text2)', 'var(--scanner-green)', 'var(--scanner-green)'],
  },
  INFLATION: {
    label: 'INFLATION',
    bands: ['DISINFLATION', 'NEUTRAL', 'REINFLATION', 'HOT'],
    bandColors: ['var(--scanner-green)', 'var(--scanner-text2)', 'var(--scanner-accent)', 'var(--scanner-red)'],
  },
  LIQUIDITY: {
    label: 'LIQUIDITY',
    bands: ['TIGHT', 'NEUTRAL', 'LOOSE', 'VERY LOOSE'],
    bandColors: ['var(--scanner-red)', 'var(--scanner-text2)', 'var(--scanner-green)', 'var(--scanner-green)'],
  },
};

function getNowcastColor(value) {
  if (value < 35) return 'var(--scanner-red)';
  if (value < 45) return 'rgba(239,68,68,0.8)';
  if (value < 55) return 'var(--scanner-text2)';
  if (value < 65) return 'rgba(0,230,118,0.8)';
  return 'var(--scanner-green)';
}

function getRegimeBand(value, bands) {
  if (value < 35) return { index: 0, label: bands[0] };
  if (value < 45) return { index: 1, label: bands[1] };
  if (value < 55) return { index: 1, label: bands[1] };
  if (value < 65) return { index: 2, label: bands[2] };
  return { index: 3, label: bands[3] };
}

/**
 * @param {object} props
 * @param {string} [props.label='GROWTH']
 * @param {object} [props.data={}] Nowcast data with meZ, impulseZ, nowcast, score, signals, topDrivers
 * @param {Array} [props.regimeBand=[]]
 */
export default function CompositeGauge({ label = 'GROWTH', data = {}, regimeBand = [] }) {
  const config = COMPOSITE_CONFIG[label] || COMPOSITE_CONFIG.GROWTH;
  const bands = regimeBand.length > 0 ? regimeBand : config.bands;

  const {
    meZ = 0,
    impulseZ = 0,
    nowcast = 50,
    score = 50,
    signals = [],
    topDrivers = [],
  } = data;

  const color = getNowcastColor(nowcast);
  const band = getRegimeBand(nowcast, bands);
  const bandColor = config.bandColors[band.index];

  // Top signals by absolute z-score
  const topSignals = signals
    .filter(s => s && s.name)
    .sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0))
    .slice(0, 3);

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
          {config.label}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold" style={{ color: bandColor }}>
            {band.label}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: 'var(--scanner-text3)' }}>
            z = {meZ >= 0 ? '+' : ''}{meZ.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Nowcast bar */}
      <div className="mb-3">
        <div className="h-2 rounded-sm overflow-hidden" style={{ background: 'var(--scanner-border)' }}>
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${Math.min(100, nowcast)}%`,
              background: color,
            }}
          />
        </div>
        {/* Band markers */}
        <div className="flex justify-between mt-1">
          <div className="text-[6px]" style={{ color: 'var(--scanner-red)' }}>TIGHT</div>
          <div className="text-[6px]" style={{ color: 'var(--scanner-text3)' }}>50</div>
          <div className="text-[6px]" style={{ color: 'var(--scanner-green)' }}>EXPAND</div>
        </div>
      </div>

      {/* Score breakdown */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-[8px]">
        <div>
          <div className="uppercase tracking-wider mb-0.5" style={{ color: 'var(--scanner-text3)' }}>Nowcast</div>
          <div className="font-bold tabular-nums" style={{ color }}>{nowcast.toFixed(1)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider mb-0.5" style={{ color: 'var(--scanner-text3)' }}>Comp</div>
          <div className="font-bold tabular-nums" style={{ color: bandColor }}>{score.toFixed(1)}</div>
        </div>
        <div>
          <div className="uppercase tracking-wider mb-0.5" style={{ color: 'var(--scanner-text3)' }}>Impulse</div>
          <div
            className="font-bold tabular-nums"
            style={{ color: impulseZ > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)' }}
          >
            {impulseZ > 0 ? '+' : ''}{impulseZ.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Impulse trend indicator */}
      <div className="flex items-center gap-1 mb-3 text-[8px]">
        <span style={{ color: 'var(--scanner-text3)' }}>Impulse z:</span>
        <span style={{ color: impulseZ > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)' }}>
          {impulseZ > 0 ? '+' : ''}{impulseZ.toFixed(2)}
        </span>
        <span style={{ color: impulseZ > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)' }}>
          {impulseZ > 0 ? '↑' : '↓'}
        </span>
      </div>

      {/* Top Drivers */}
      {topSignals.length > 0 && (
        <div>
          <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: 'var(--scanner-text3)' }}>
            Top Drivers
          </div>
          <div className="space-y-0.5">
            {topSignals.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-[8px]">
                <span style={{ color: 'var(--scanner-text2)' }}>{s.name}</span>
                <span
                  className="font-bold tabular-nums"
                  style={{ color: (s.value || 0) > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)' }}
                >
                  {(s.value || 0) >= 0 ? '+' : ''}{(s.value || 0).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Signal count */}
      {signals.length > 0 && (
        <div className="mt-2 pt-2 border-t text-[8px]" style={{ borderColor: 'var(--scanner-border2)', color: 'var(--scanner-text3)' }}>
          Diffusion: {signals.filter(s => (s.value || 0) > 0).length}/{signals.length} signals
        </div>
      )}
    </div>
  );
}
