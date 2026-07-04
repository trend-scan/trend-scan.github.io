import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const TOOLTIP_STYLE = {
  background: 'var(--scanner-bg2)',
  border: '1px solid var(--scanner-border2)',
  borderRadius: 0,
  fontSize: 11,
  fontFamily: 'IBM Plex Mono, monospace',
  color: 'var(--scanner-text)',
};

const REGIME_COLORS = {
  RISK_ON: 'var(--scanner-green)',
  RISK_OFF: 'var(--scanner-red)',
  MIXED: 'var(--scanner-text2)',
};

export default function RegimeHistory({ history = [] }) {
  const [lookback, setLookback] = useState(30);

  if (!history?.length) {
    return (
      <div className="text-center py-8 text-[11px]" style={{ color: 'var(--scanner-text3)' }}>
        No regime history available
      </div>
    );
  }

  const filtered = history.slice(-lookback);

  // Transform data for chart
  const chartData = filtered.map(d => ({
    ...d,
    scoreChart: d.score * 50 + 50, // -1 to 1 -> 0 to 100
  }));

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-1 h-3 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
          <span className="text-[9px] font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
            Regime History
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>Lookback:</span>
          {[15, 30, 60].map(d => (
            <button
              key={d}
              className="text-[9px] font-bold px-2 py-1 transition-all"
              style={{
                background: lookback === d ? 'rgba(245,158,11,0.12)' : 'transparent',
                border: `1px solid ${lookback === d ? 'var(--scanner-accent)' : 'var(--scanner-border2)'}`,
                color: lookback === d ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                cursor: 'pointer',
              }}
              onClick={() => setLookback(d)}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <XAxis
              dataKey="day"
              tick={false}
              axisLine={{ stroke: 'var(--scanner-border2)' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 9, fill: 'var(--scanner-text3)', fontFamily: 'IBM Plex Mono' }}
              axisLine={false}
              tickLine={false}
              width={30}
            />
            {/* Zone backgrounds */}
            <ReferenceLine y={75} stroke="var(--scanner-green)" strokeOpacity={0.2} strokeDasharray="4 4" />
            <ReferenceLine y={25} stroke="var(--scanner-red)" strokeOpacity={0.2} strokeDasharray="4 4" />
            <ReferenceLine y={50} stroke="var(--scanner-border2)" strokeWidth={1} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name, props) => [
                `${Math.round((Number(value) - 50) / 50 * 100)}%`,
                `Score`,
              ]}
              labelFormatter={(label, payload) => {
                if (payload?.[0]) {
                  return `${payload[0].payload.date} — ${payload[0].payload.regime}`;
                }
                return label;
              }}
            />
            <Line
              type="monotone"
              dataKey="scoreChart"
              stroke="var(--scanner-accent)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: 'var(--scanner-accent)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-3">
        {Object.entries(REGIME_COLORS).map(([regime, color]) => (
          <div key={regime} className="flex items-center gap-1.5">
            <div className="w-3 h-0.5" style={{ background: color }} />
            <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>
              {regime.replace('_', '-')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}