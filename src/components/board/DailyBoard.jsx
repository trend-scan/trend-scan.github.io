import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const STATUS_COLORS = {
  'DOMINANT':      { bg: 'rgba(0,230,118,0.10)', border: 'rgba(0,230,118,0.30)', text: 'var(--scanner-green)' },
  'STRONG / HOT':  { bg: 'rgba(255,165,0,0.12)',  border: 'rgba(255,165,0,0.35)',  text: '#ff9800' },
  'EMERGING':      { bg: 'rgba(77,159,255,0.10)', border: 'rgba(77,159,255,0.30)', text: 'var(--scanner-blue)' },
  'STRONG':        { bg: 'rgba(0,230,118,0.07)',  border: 'rgba(0,230,118,0.20)', text: 'var(--scanner-green)' },
  'IMPROVING':     { bg: 'rgba(77,159,255,0.07)', border: 'rgba(77,159,255,0.20)', text: 'var(--scanner-blue)' },
  'NEUTRAL':       { bg: 'rgba(120,120,150,0.08)',border: 'rgba(120,120,150,0.20)',text: 'var(--scanner-text3)' },
  'DETERIORATING': { bg: 'rgba(255,68,68,0.07)',  border: 'rgba(255,68,68,0.18)',  text: 'var(--scanner-red)' },
  'FADING':        { bg: 'rgba(255,68,68,0.10)',  border: 'rgba(255,68,68,0.28)',  text: 'var(--scanner-red)' },
  'WEAK':          { bg: 'rgba(255,68,68,0.07)',  border: 'rgba(255,68,68,0.18)', text: 'var(--scanner-red)' },
};

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}

function fmtPctRaw(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function retColor(v) {
  if (v == null) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}

function DeltaArrow({ delta }) {
  if (delta == null) return null;
  if (delta > 1) return <TrendingUp size={11} color="var(--scanner-green)" />;
  if (delta < -1) return <TrendingDown size={11} color="var(--scanner-red)" />;
  return <Minus size={11} color="var(--scanner-text3)" />;
}

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-3 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
      <span className="text-[9px] font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--scanner-text3)' }}>{children}</span>
    </div>
  );
}

// ── Section 1: Benchmark Snapshot ───────────────────────────────────────────

function BenchmarkSnapshot({ benchmarks }) {
  return (
    <section>
      <SectionLabel>Benchmark Snapshot</SectionLabel>
      <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
        <table className="w-full border-collapse min-w-[500px]">
          <thead>
            <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
              {['Asset', 'Subtheme', '1D', '5D', '20D', 'vs 50MA', 'ATR Ext'].map(h => (
                <th key={h} className="text-[8.5px] font-semibold tracking-[0.12em] uppercase py-2 px-4 text-left" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {benchmarks.map(b => (
              <tr key={b.symbol} style={{ borderBottom: '1px solid var(--scanner-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td className="py-2.5 px-4">
                  <span className="text-[12px] font-bold" style={{ color: 'var(--scanner-text)' }}>{b.symbol}</span>
                </td>
                <td className="py-2.5 px-4 text-[9px]" style={{ color: 'var(--scanner-text3)' }}>{b.subtheme}</td>
                <td className="py-2.5 px-4"><span className="tabular-nums text-[11px] font-semibold" style={{ color: retColor(b.metrics?.ret1d) }}>{fmtPct(b.metrics?.ret1d)}</span></td>
                <td className="py-2.5 px-4"><span className="tabular-nums text-[11px] font-semibold" style={{ color: retColor(b.metrics?.ret5d) }}>{fmtPct(b.metrics?.ret5d)}</span></td>
                <td className="py-2.5 px-4"><span className="tabular-nums text-[11px] font-semibold" style={{ color: retColor(b.metrics?.ret20d) }}>{fmtPct(b.metrics?.ret20d)}</span></td>
                <td className="py-2.5 px-4">
                  <span className="tabular-nums text-[11px]" style={{ color: retColor(b.metrics?.distMa50) }}>
                    {b.metrics?.distMa50 != null ? fmtPctRaw(b.metrics.distMa50) : '—'}
                  </span>
                </td>
                <td className="py-2.5 px-4">
                  <span className="tabular-nums text-[11px]" style={{ color: 'var(--scanner-text2)' }}>
                    {b.metrics?.atrExt50ma != null ? b.metrics.atrExt50ma.toFixed(1) : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Section 2: Theme Status ───────────────────────────────────────────────────

function ThemeStatus({ themes }) {
  const dominant  = themes.filter(t => t.status === 'DOMINANT' || t.status === 'STRONG / HOT');
  const emerging  = themes.filter(t => t.status === 'EMERGING' || t.status === 'IMPROVING');
  const fading    = themes.filter(t => t.status === 'FADING' || t.status === 'WEAK' || t.status === 'DETERIORATING');

  return (
    <section>
      <SectionLabel>Theme Status</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatusGroup label="DOMINANT / HOT" items={dominant} accent="var(--scanner-green)" />
        <StatusGroup label="EMERGING / IMPROVING" items={emerging} accent="var(--scanner-blue)" />
        <StatusGroup label="FADING / WEAK" items={fading} accent="var(--scanner-red)" />
      </div>
    </section>
  );
}

function StatusGroup({ label, items, accent }) {
  return (
    <div className="rounded" style={{ border: '1px solid var(--scanner-border2)', background: 'var(--scanner-bg1)' }}>
      <div className="px-3 py-2 text-[8.5px] font-bold tracking-[0.14em] uppercase" style={{
        color: accent, borderBottom: '1px solid var(--scanner-border2)', background: `${accent}0d`
      }}>
        {label} <span className="ml-1 opacity-50">({items.length})</span>
      </div>
      <div className="p-2 space-y-1.5">
        {items.length === 0
          ? <div className="text-[9px] py-3 text-center" style={{ color: 'var(--scanner-text3)' }}>None</div>
          : items.map(t => {
              const sc = STATUS_COLORS[t.status] || STATUS_COLORS['NEUTRAL'];
              return (
                <div key={t.name} className="flex items-center justify-between px-2 py-1.5 rounded" style={{
                  background: sc.bg, border: `1px solid ${sc.border}`
                }}>
                  <span className="text-[10px] font-semibold" style={{ color: 'var(--scanner-text)' }}>{t.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold tabular-nums" style={{ color: sc.text }}>{t.score.toFixed(0)}</span>
                    <DeltaArrow delta={t.delta} />
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

// ── Section 3: Theme Rotation ─────────────────────────────────────────────────

function ThemeRotation({ themeRotation }) {
  const { climbers = [], fallers = [], lookbackDays = 5 } = themeRotation;

  return (
    <section>
      <SectionLabel>Theme Rotation · {lookbackDays}D change</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded overflow-hidden" style={{ border: '1px solid var(--scanner-border2)' }}>
          <div className="px-3 py-2 text-[8.5px] font-bold tracking-[0.14em] uppercase" style={{
            color: 'var(--scanner-green)', borderBottom: '1px solid var(--scanner-border2)',
            background: 'rgba(0,230,118,0.06)'
          }}>
            TOP CLIMBERS
          </div>
          <div className="p-2">
            {climbers.length === 0
              ? <div className="text-[9px] py-2 text-center" style={{ color: 'var(--scanner-text3)' }}>No significant changes</div>
              : climbers.map((t, i) => (
                  <div key={t.theme} className="flex items-center justify-between px-2 py-1.5 rounded mb-1" style={{ background: 'rgba(0,230,118,0.05)', border: '1px solid rgba(0,230,118,0.15)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold" style={{ color: 'var(--scanner-green)' }}>#{i+1}</span>
                      <span className="text-[10px]" style={{ color: 'var(--scanner-text)' }}>{t.theme}</span>
                    </div>
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--scanner-green)' }}>
                      {t.scoreDelta >= 0 ? '+' : ''}{t.scoreDelta.toFixed(1)}
                    </span>
                  </div>
                ))
            }
          </div>
        </div>

        <div className="rounded overflow-hidden" style={{ border: '1px solid var(--scanner-border2)' }}>
          <div className="px-3 py-2 text-[8.5px] font-bold tracking-[0.14em] uppercase" style={{
            color: 'var(--scanner-red)', borderBottom: '1px solid var(--scanner-border2)',
            background: 'rgba(255,68,68,0.06)'
          }}>
            TOP FALLERS
          </div>
          <div className="p-2">
            {fallers.length === 0
              ? <div className="text-[9px] py-2 text-center" style={{ color: 'var(--scanner-text3)' }}>No significant changes</div>
              : fallers.map((t, i) => (
                  <div key={t.theme} className="flex items-center justify-between px-2 py-1.5 rounded mb-1" style={{ background: 'rgba(255,68,68,0.05)', border: '1px solid rgba(255,68,68,0.15)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold" style={{ color: 'var(--scanner-red)' }}>#{i+1}</span>
                      <span className="text-[10px]" style={{ color: 'var(--scanner-text)' }}>{t.theme}</span>
                    </div>
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--scanner-red)' }}>
                      {t.scoreDelta >= 0 ? '+' : ''}{t.scoreDelta.toFixed(1)}
                    </span>
                  </div>
                ))
            }
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Section 4: Starting to Move ───────────────────────────────────────────────

function StartingToMove({ startingToMove = [] }) {
  if (!startingToMove.length) return null;
  return (
    <section>
      <div className="text-[11px] font-bold tracking-wide uppercase mb-2" style={{ color: 'var(--scanner-text2)' }}>
        Starting to Move
      </div>
      <div className="text-[9px] mb-3" style={{ color: 'var(--scanner-text3)' }}>
        RS rank inflecting over the past month, still within 15% of the 50MA — not yet extended.
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--scanner-border)' }}>
            {['Ticker', 'RS Δ/1M', 'RS 20D', 'vs 50MA', 'ADR%', 'D>50MA', 'Vol'].map(h => (
              <th key={h} className="text-left py-2 px-3 font-normal" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {startingToMove.map(t => (
            <tr key={t.symbol} style={{ borderBottom: '1px solid var(--scanner-border)' }}>
              <td className="py-2 px-3 font-bold" style={{ color: 'var(--scanner-text)' }}>{t.symbol}</td>
              <td className="py-2 px-3 tabular-nums" style={{ color: 'var(--scanner-green)' }}>
                +{(t.rsDelta * 100).toFixed(1)}%
              </td>
              <td className="py-2 px-3 tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
                {(t.rsNow * 100).toFixed(1)}%
              </td>
              <td className="py-2 px-3 tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
                +{t.distMa50.toFixed(1)}%
              </td>
              <td className="py-2 px-3 tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
                {t.adrPct != null ? t.adrPct.toFixed(1) + '%' : '—'}
              </td>
              <td className="py-2 px-3 tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
                {t.trendTenure ?? '—'}
              </td>
              <td className="py-2 px-3 tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
                {t.volRatio != null ? t.volRatio.toFixed(2) + 'x' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── Section 5: Style Rotation ─────────────────────────────────────────────────

function StyleRotation({ styleRotation }) {
  return (
    <section>
      <SectionLabel>Style Rotation</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {styleRotation.map(pair => (
          <div key={pair.label} className="p-3 rounded" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
            <div className="text-[9px] font-bold tracking-widest uppercase mb-2" style={{ color: 'var(--scanner-accent)' }}>{pair.label}</div>
            <div className="text-[8.5px] mb-2" style={{ color: 'var(--scanner-text3)' }}>{pair.desc}</div>
            <div className="flex justify-between">
              <div>
                <div className="text-[7.5px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>1D</div>
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: retColor(pair.ret1d) }}>
                  {fmtPct(pair.ret1d)}
                </span>
              </div>
              <div>
                <div className="text-[7.5px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>5D</div>
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: retColor(pair.ret5d) }}>
                  {fmtPct(pair.ret5d)}
                </span>
              </div>
              <div>
                <div className="text-[7.5px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>20D</div>
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: retColor(pair.ret20d) }}>
                  {fmtPct(pair.ret20d)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Section 5: Risk Pulse ─────────────────────────────────────────────────────

function RiskPulse({ riskPulse }) {
  return (
    <section>
      <SectionLabel>Risk Pulse</SectionLabel>
      <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
        <table className="w-full border-collapse min-w-[600px]">
          <thead>
            <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
              {['Signal', 'Context', '1D', '5D', '20D', 'vs 50MA'].map(h => (
                <th key={h} className="text-[8.5px] font-semibold tracking-[0.12em] uppercase py-2 px-4 text-left" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {riskPulse.map(p => (
              <tr key={p.label} style={{ borderBottom: '1px solid var(--scanner-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td className="py-2.5 px-4">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--scanner-text)' }}>{p.label}</span>
                </td>
                <td className="py-2.5 px-4 text-[9px]" style={{ color: 'var(--scanner-text3)' }}>{p.context}</td>
                <td className="py-2.5 px-4"><span className="tabular-nums text-[11px] font-semibold" style={{ color: retColor(p.ret1d) }}>{fmtPct(p.ret1d)}</span></td>
                <td className="py-2.5 px-4"><span className="tabular-nums text-[11px] font-semibold" style={{ color: retColor(p.ret5d) }}>{fmtPct(p.ret5d)}</span></td>
                <td className="py-2.5 px-4"><span className="tabular-nums text-[11px] font-semibold" style={{ color: retColor(p.ret20d) }}>{fmtPct(p.ret20d)}</span></td>
                <td className="py-2.5 px-4">
                  <span className="tabular-nums text-[11px]" style={{ color: retColor(p.distMa50) }}>
                    {p.distMa50 != null ? fmtPctRaw(p.distMa50) : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Section 6: Theme Sector Rotation (RS BTC) ─────────────────────────────────

function ThemeSectorRotation({ themeSectorRotation }) {
  return (
    <section>
      <SectionLabel>Theme RS vs BTC · 20D · sorted by RS</SectionLabel>
      <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
        <table className="w-full border-collapse min-w-[500px]">
          <thead>
            <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
              {['Theme', 'RS 20D', '5D', '20D', 'Score', 'Status'].map(h => (
                <th key={h} className="text-[8.5px] font-semibold tracking-[0.12em] uppercase py-2 px-4 text-left" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {themeSectorRotation.map((t, i) => {
              const sc = STATUS_COLORS[t.status] || STATUS_COLORS['NEUTRAL'];
              return (
                <tr key={t.theme} style={{ borderBottom: '1px solid var(--scanner-border)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold" style={{ color: 'var(--scanner-text3)', minWidth: 16 }}>#{i+1}</span>
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--scanner-text)' }}>{t.theme}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="tabular-nums text-[11px] font-bold" style={{ color: t.rs_btc_20d > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)' }}>
                      {t.rs_btc_20d != null ? (t.rs_btc_20d >= 0 ? '+' : '') + (t.rs_btc_20d * 100).toFixed(2) + '%' : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4"><span className="tabular-nums text-[11px]" style={{ color: retColor(t.ret5d) }}>{fmtPct(t.ret5d)}</span></td>
                  <td className="py-2.5 px-4"><span className="tabular-nums text-[11px]" style={{ color: retColor(t.ret20d) }}>{fmtPct(t.ret20d)}</span></td>
                  <td className="py-2.5 px-4"><span className="tabular-nums text-[11px] font-semibold" style={{ color: 'var(--scanner-accent)' }}>{t.score.toFixed(0)}</span></td>
                  <td className="py-2.5 px-4">
                    <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Section: ETF Flows (from snapshot.json) ───────────────────────────────────

function ETFFlowTable() {
  const [flows, setFlows] = useState(null);
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState(null);

  useEffect(() => {
    fetch('/snapshot.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setFlows(d?.etf_flows || null);
        setSnapshotGeneratedAt(d?.generated_at || null);
      })
      .catch(() => {
        setFlows(null);
        setSnapshotGeneratedAt(null);
      });
  }, []);

  if (!flows || Object.keys(flows).length === 0) return null;

  const assets = ['BTC', 'ETH', 'SOL', 'HYPE'].filter(a => flows[a] && flows[a].length > 0);
  if (assets.length === 0) return null;

  // Get the last 7 dates across all assets (use BTC as reference since it has the most data)
  const refAsset = flows['BTC'] || flows[Object.keys(flows)[0]];
  const dates = refAsset.slice(-7).map(d => d.date);

  // Compute 7-day total for each asset
  const totals = {};
  for (const asset of assets) {
    totals[asset] = flows[asset].reduce((sum, d) => sum + d.total, 0);
  }

  // Latest data date = the most recent date across all assets' latest entries.
  // Used to show "last published by Farside" hint so users can tell whether
  // the displayed data is current or stale (e.g. before US market close on
  // a weekday, Farside won't have today's flows yet — that's expected, not a bug).
  const latestDataDate = assets
    .map(a => flows[a][flows[a].length - 1]?.date)
    .filter(Boolean)
    .sort()
    .pop();

  // Compute freshness hint
  let freshnessHint = '';
  let freshnessColor = 'var(--scanner-text3)';
  if (latestDataDate) {
    const latestMs = Date.parse(latestDataDate + 'T00:00:00Z');
    const nowMs = Date.now();
    const ageHours = (nowMs - latestMs) / 3600000;
    const todayUtc = new Date().toISOString().slice(0, 10);
    const yesterdayUtc = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    if (latestDataDate >= todayUtc) {
      freshnessHint = `latest: today`;
      freshnessColor = 'var(--scanner-green)';
    } else if (latestDataDate >= yesterdayUtc) {
      freshnessHint = `latest: yesterday`;
      freshnessColor = 'var(--scanner-text2)';
    } else if (ageHours < 72) {
      freshnessHint = `latest: ${Math.floor(ageHours / 24)}d ago`;
      freshnessColor = 'var(--scanner-warning, #f5c842)';
    } else {
      freshnessHint = `latest: ${Math.floor(ageHours / 24)}d ago ⚠`;
      freshnessColor = 'var(--scanner-red, #ff4444)';
    }
  }

  // Snapshot build timestamp (when build_snapshot.js ran)
  let snapshotBuildHint = '';
  if (snapshotGeneratedAt) {
    const buildMs = Date.parse(snapshotGeneratedAt);
    const ageMin = Math.floor((Date.now() - buildMs) / 60000);
    if (ageMin < 60) {
      snapshotBuildHint = `snapshot built ${ageMin}m ago`;
    } else if (ageMin < 1440) {
      snapshotBuildHint = `snapshot built ${Math.floor(ageMin / 60)}h ago`;
    } else {
      snapshotBuildHint = `snapshot built ${Math.floor(ageMin / 1440)}d ago`;
    }
  }

  function fmtFlow(v) {
    if (v == null || isNaN(v)) return '—';
    const sign = v >= 0 ? '+' : '';
    return `${sign}$${Math.abs(v).toFixed(1)}M`;
  }

  function flowColor(v) {
    if (v == null || isNaN(v)) return 'var(--scanner-text3)';
    return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text3)';
  }

  return (
    <section>
      <SectionLabel>ETF Flows · 7D Net (Farside)</SectionLabel>
      <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
        <table className="w-full border-collapse min-w-[500px]">
          <thead>
            <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
              <th className="text-[8.5px] font-semibold tracking-[0.12em] uppercase py-2 px-3 text-left" style={{ color: 'var(--scanner-text3)' }}>Asset</th>
              {dates.map(d => (
                <th key={d} className="text-[8.5px] font-semibold tracking-[0.12em] uppercase py-2 px-3 text-right" style={{ color: 'var(--scanner-text3)' }}>
                  {new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                </th>
              ))}
              <th className="text-[8.5px] font-semibold tracking-[0.12em] uppercase py-2 px-3 text-right" style={{ color: 'var(--scanner-accent)' }}>7D Total</th>
            </tr>
          </thead>
          <tbody>
            {assets.map(asset => (
              <tr key={asset} style={{ borderBottom: '1px solid var(--scanner-border)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td className="py-2.5 px-3">
                  <span className="text-[12px] font-bold" style={{ color: 'var(--scanner-text)' }}>{asset}</span>
                </td>
                {dates.map(d => {
                  const flow = flows[asset]?.find(f => f.date === d);
                  return (
                    <td key={d} className="py-2.5 px-3 text-right">
                      <span className="tabular-nums text-[11px] font-semibold" style={{ color: flowColor(flow?.total) }}>
                        {fmtFlow(flow?.total)}
                      </span>
                    </td>
                  );
                })}
                <td className="py-2.5 px-3 text-right">
                  <span className="tabular-nums text-[11px] font-bold" style={{ color: flowColor(totals[asset]) }}>
                    {fmtFlow(totals[asset])}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[8px] mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: 'var(--scanner-text3)' }}>
        <span>Source: Farside Investors · US$ millions · Total net flow across all ETFs · '-' = market closed</span>
        {freshnessHint && (
          <span style={{ color: freshnessColor, fontWeight: 600 }}>
            · {freshnessHint}
          </span>
        )}
        {snapshotBuildHint && (
          <span>· {snapshotBuildHint}</span>
        )}
      </div>
    </section>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DailyBoard({
  themes, benchmarks, themeRotation, startingToMove, styleRotation, riskPulse, themeSectorRotation
}) {
  return (
    <div className="font-mono space-y-8 px-5 md:px-8 py-5">
      <ETFFlowTable />
      <BenchmarkSnapshot benchmarks={benchmarks} />
      <StartingToMove startingToMove={startingToMove} />
      <ThemeStatus themes={themes} />
      <ThemeRotation themeRotation={themeRotation} />
      <StyleRotation styleRotation={styleRotation} />
      <RiskPulse riskPulse={riskPulse} />
      <ThemeSectorRotation themeSectorRotation={themeSectorRotation} />
    </div>
  );
}