import React, { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from 'recharts';

const TOOLTIP_STYLE = {
  background: 'var(--scanner-bg2)',
  border: '1px solid var(--scanner-border2)',
  borderRadius: 0,
  fontSize: 11,
  fontFamily: 'IBM Plex Mono, monospace',
  color: 'var(--scanner-text)',
};

export default function BreadthTab({ breadthSeries }) {
  const [activeMetric, setActiveMetric] = useState('adDiff');
  const [lookback, setLookback] = useState(30);

  if (!breadthSeries) {
    return <div className="text-center py-20 font-mono text-sm" style={{ color: 'var(--scanner-text3)' }}>No breadth data yet</div>;
  }

  const { themeBreadth, dailySeries, newHigh20dSeries } = breadthSeries;
  const sortedThemes = [...(themeBreadth || [])].sort((a, b) => b.pctAbove50 - a.pctAbove50);

  // Filter daily series based on lookback
  const filteredSeries = dailySeries?.slice(-lookback) || [];

  return (
    <div className="font-mono px-5 md:px-8 py-5 space-y-8">

      {/* Theme Breadth Heatmap */}
      <section>
        <SectionLabel>Theme Participation (% above MAs)</SectionLabel>
        <div className="space-y-1.5">
          {sortedThemes.map(t => (
            <div key={t.name} className="flex items-center gap-3">
              <span className="text-[10px] w-32 flex-shrink-0 text-right" style={{ color: 'var(--scanner-text2)' }}>{t.name}</span>
              <div className="flex-1 flex gap-1 items-center">
                <Bar20 pct={t.pctAbove20}  color="var(--scanner-green)" label="20" />
                <Bar20 pct={t.pctAbove50}  color="var(--scanner-blue)"  label="50" />
                <Bar20 pct={t.pctAbove200} color="#a78bfa"               label="200" />
              </div>
              <span className="text-[9px] w-10 text-right tabular-nums" style={{ color: 'var(--scanner-text3)' }}>{t.total} assets</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-5 mt-3">
          {[['20MA', 'var(--scanner-green)'], ['50MA', 'var(--scanner-blue)'], ['200MA', '#a78bfa']].map(([l, c]) => (
            <div key={l} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
              <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>% above {l}</span>
            </div>
          ))}
        </div>
      </section>

      {/* New Highs / Lows Series */}
      {newHigh20dSeries && newHigh20dSeries.length > 0 && (
        <section>
          <SectionLabel>New Highs / Lows — 20D (30-day sparkline)</SectionLabel>
          <div style={{ height: 140 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={newHigh20dSeries.slice(-30)} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="day" tick={false} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--scanner-text3)', fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={30} />
                <ReferenceLine y={0} stroke="var(--scanner-border2)" strokeWidth={1} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v, name) => [`${v}`, name]}
                  labelFormatter={l => `Day offset: ${l}`}
                />
                <Line type="monotone" dataKey="newHighs" stroke="var(--scanner-green)" strokeWidth={1.5} dot={false} name="New Highs" />
                <Line type="monotone" dataKey="newLows" stroke="var(--scanner-red)" strokeWidth={1.5} dot={false} name="New Lows" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-5 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5" style={{ background: 'var(--scanner-green)' }} />
              <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>New Highs</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5" style={{ background: 'var(--scanner-red)' }} />
              <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>New Lows</span>
            </div>
          </div>
        </section>
      )}

      {/* Daily A/D Impulse with Controls */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>Daily Advance / Decline Impulse</SectionLabel>
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
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredSeries} barSize={6} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="day" tick={false} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--scanner-text3)', fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={30} />
              <ReferenceLine y={0} stroke="var(--scanner-border2)" strokeWidth={1} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, name) => [`${v}`, name]}
                labelFormatter={l => `Day offset: ${l}`}
              />
              <Bar dataKey="adDiff" name="A-D">
                {filteredSeries.map((entry, i) => (
                  <Cell key={i} fill={entry.adDiff >= 0 ? 'var(--scanner-green)' : 'var(--scanner-red)'} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Cumulative A/D */}
      <section>
        <SectionLabel>Cumulative A/D Line</SectionLabel>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={dailySeries.map((d, i, arr) => ({
                ...d,
                cumAD: arr.slice(0, i + 1).reduce((s, x) => s + x.adDiff, 0)
              }))}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <XAxis dataKey="day" tick={false} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--scanner-text3)', fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} width={40} />
              <ReferenceLine y={0} stroke="var(--scanner-border2)" strokeWidth={1} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => [v?.toFixed(0), 'Cum A/D']} labelFormatter={l => `Day ${l}`} />
              <Line type="monotone" dataKey="cumAD" stroke="var(--scanner-blue)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function Bar20({ pct, color, label }) {
  return (
    <div className="flex items-center gap-1 flex-1">
      <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ background: 'var(--scanner-border2)' }}>
        <div className="h-full" style={{ width: `${pct ?? 0}%`, background: color, opacity: 0.75 }} />
      </div>
      <span className="text-[8px] w-8 tabular-nums" style={{ color }}>{pct ?? 0}%</span>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-3 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
      <span className="text-[9px] font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--scanner-text3)' }}>{children}</span>
    </div>
  );
}
