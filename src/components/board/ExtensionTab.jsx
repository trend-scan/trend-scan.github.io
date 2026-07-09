import React from 'react';

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}

function pctColor(v) {
  if (v == null) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}

function AtrBar({ value, max = 12 }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = value >= 8 ? 'var(--scanner-red)' : value >= 5 ? 'var(--scanner-accent)' : 'var(--scanner-green)';
  return (
    <div className="flex items-center gap-2">
      <div className="w-10 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--scanner-border2)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="tabular-nums text-[11px] font-semibold" style={{ color }}>{value?.toFixed(1) ?? '—'}</span>
    </div>
  );
}

function SectionLabel({ children, count }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-3 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
      <span className="text-[9px] font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--scanner-text3)' }}>{children}</span>
      {count != null && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--scanner-bg2)', color: 'var(--scanner-text3)', border: '1px solid var(--scanner-border2)' }}>{count}</span>}
    </div>
  );
}

function AssetTable({ items, columns }) {
  if (!items?.length) {
    return <div className="text-center py-8 text-[11px]" style={{ color: 'var(--scanner-text3)', border: '1px solid var(--scanner-border2)' }}>No assets matched</div>;
  }
  return (
    <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
            {columns.map(c => (
              <th key={c.label} className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2.5 px-3 text-left" style={{ color: 'var(--scanner-text3)' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.symbol + i}
              style={{ borderBottom: '1px solid var(--scanner-border)', animationDelay: `${i * 0.02}s` }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {columns.map(c => (
                <td key={c.label} className="py-2.5 px-3">{c.render(item)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ExtensionTab({ tooHot, fading }) {
  const hotCols = [
    { label: 'Ticker', render: r => <span className="text-[12px] font-bold" style={{ color: 'var(--scanner-text)' }}>{r.symbol}</span> },
    { label: 'Name',   render: r => <span className="text-[10px]" style={{ color: 'var(--scanner-text3)' }}>{r.name}</span> },
    { label: 'Theme',  render: r => <span className="text-[9px]" style={{ color: 'var(--scanner-text2)' }}>{r.theme}</span> },
    { label: 'RS 20D', render: r => <span className="tabular-nums text-[11px]" style={{ color: pctColor(r.rs_btc_20d) }}>
      {r.rs_btc_20d != null ? (r.rs_btc_20d >= 0 ? '+' : '') + (r.rs_btc_20d * 100).toFixed(1) + '%' : '—'}
    </span> },
    { label: 'ATR Ext',render: r => <AtrBar value={r.atrExt50ma} /> },
    { label: 'ADR%', render: r => <span className="tabular-nums text-[11px]" style={{ color: 'var(--scanner-text2)' }}>
      {r.adrPct != null ? r.adrPct.toFixed(1) + '%' : '—'}
    </span> },
    { label: 'D>50MA', render: r => <span className="tabular-nums text-[11px]" style={{ color: 'var(--scanner-text2)' }}>
      {r.trendTenure ?? '—'}
    </span> },
    { label: 'vs50MA', render: r => <span className="tabular-nums text-[11px]" style={{ color: pctColor(r.distMa50 != null ? r.distMa50 / 100 : null) }}>{r.distMa50 != null ? (r.distMa50 >= 0 ? '+' : '') + r.distMa50.toFixed(1) + '%' : '—'}</span> },
    { label: '5D Ret',  render: r => <span className="tabular-nums text-[11px]" style={{ color: pctColor(r.ret5d) }}>{fmtPct(r.ret5d)}</span> },
    { label: 'Vol Ratio',render: r => <span className="tabular-nums text-[11px]" style={{ color: 'var(--scanner-text2)' }}>{r.volRatio != null ? r.volRatio.toFixed(2) + 'x' : '—'}</span> },
    { label: 'NH20',    render: r => <span style={{ color: r.newHigh20d ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}>{r.newHigh20d ? '✓' : '—'}</span> },
    { label: 'NH52',    render: r => <span style={{ color: r.newHigh52w ? 'var(--scanner-accent)' : 'var(--scanner-text3)' }}>{r.newHigh52w ? '✓' : '—'}</span> },
  ];

  const fadeCols = [
    { label: 'Ticker', render: r => <span className="text-[12px] font-bold" style={{ color: 'var(--scanner-text)' }}>{r.symbol}</span> },
    { label: 'Name',   render: r => <span className="text-[10px]" style={{ color: 'var(--scanner-text3)' }}>{r.name}</span> },
    { label: 'Theme',  render: r => <span className="text-[9px]" style={{ color: 'var(--scanner-text2)' }}>{r.theme}</span> },
    { label: 'RS 20D', render: r => <span className="tabular-nums text-[11px]" style={{ color: pctColor(r.rs_btc_20d) }}>
      {r.rs_btc_20d != null ? (r.rs_btc_20d >= 0 ? '+' : '') + (r.rs_btc_20d * 100).toFixed(1) + '%' : '—'}
    </span> },
    { label: '5D Ret', render: r => <span className="tabular-nums text-[11px] font-semibold" style={{ color: pctColor(r.ret5d) }}>{fmtPct(r.ret5d)}</span> },
    { label: 'vs20MA', render: r => <span className="tabular-nums text-[11px]" style={{ color: pctColor(r.distMa20 != null ? r.distMa20 / 100 : null) }}>{r.distMa20 != null ? (r.distMa20 >= 0 ? '+' : '') + r.distMa20.toFixed(1) + '%' : '—'}</span> },
    { label: 'vs50MA', render: r => <span className="tabular-nums text-[11px]" style={{ color: pctColor(r.distMa50 != null ? r.distMa50 / 100 : null) }}>{r.distMa50 != null ? (r.distMa50 >= 0 ? '+' : '') + r.distMa50.toFixed(1) + '%' : '—'}</span> },
    { label: 'Vol Ratio',render: r => <span className="tabular-nums text-[11px]" style={{ color: 'var(--scanner-text2)' }}>{r.volRatio != null ? r.volRatio.toFixed(2) + 'x' : '—'}</span> },
  ];

  return (
    <div className="font-mono px-5 md:px-8 py-5 space-y-8">
      <section>
        <SectionLabel count={tooHot?.length ?? 0}>Too Hot — Extended ≥ 4 ATRs above 50MA</SectionLabel>
        <AssetTable items={tooHot} columns={hotCols} />
      </section>
      <section>
        <SectionLabel count={fading?.length ?? 0}>Fading / Weak — Below 20MA + 5D Return &lt; −3%</SectionLabel>
        <AssetTable items={fading} columns={fadeCols} />
      </section>
    </div>
  );
}
