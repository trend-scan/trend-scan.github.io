import React, { useState } from 'react';

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}

function pctColor(v) {
  if (v == null) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}

export default function MomentumTab({ cleanMomentum }) {
  const [sortBy, setSortBy] = useState('ret20d');

  if (!cleanMomentum?.length) {
    return (
      <div className="font-mono text-center py-20 px-5">
        <div className="text-4xl mb-4 opacity-20">◈</div>
        <div className="text-sm" style={{ color: 'var(--scanner-text2)' }}>No assets currently meet clean momentum criteria</div>
        <div className="text-[11px] mt-2" style={{ color: 'var(--scanner-text3)' }}>Requires: above 20+50MA · positive 5D · ATR ext 1–5 · vol ratio &gt;1</div>
      </div>
    );
  }

  // Sort items based on selected criteria
  const sortedItems = [...cleanMomentum].sort((a, b) => {
    if (sortBy === 'rs_btc') return (b.rs_btc_20d ?? -999) - (a.rs_btc_20d ?? -999);
    if (sortBy === 'ret20d') return (b.ret20d ?? -999) - (a.ret20d ?? -999);
    if (sortBy === 'ret5d') return (b.ret5d ?? -999) - (a.ret5d ?? -999);
    if (sortBy === 'vol') return (b.volRatio ?? 0) - (a.volRatio ?? 0);
    return 0;
  });

  return (
    <div className="font-mono px-5 md:px-8 py-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1 h-3 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
        <span className="text-[9px] font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
          Clean Momentum — {cleanMomentum.length} assets
        </span>
      </div>

      {/* Calculation criteria description */}
      <div className="mb-4 p-3 rounded text-[10px] leading-relaxed" style={{
        background: 'var(--scanner-bg2)',
        border: '1px solid var(--scanner-border2)',
        color: 'var(--scanner-text3)',
      }}>
        <span style={{ color: 'var(--scanner-text2)', fontWeight: 600 }}>Criteria:</span>{' '}
        Price above <span style={{ color: 'var(--scanner-accent)' }}>20MA</span> and{' '}
        <span style={{ color: 'var(--scanner-accent)' }}>50MA</span> ·{' '}
        Positive <span style={{ color: 'var(--scanner-green)' }}>5D return</span> ·{' '}
        ATR extension <span style={{ color: 'var(--scanner-accent)' }}>1.0–5.0</span> (not overextended) ·{' '}
        Volume ratio <span style={{ color: 'var(--scanner-accent)' }}>&gt;1.0</span> (above 20d avg) ·{' '}
        Ranked by <span style={{ color: 'var(--scanner-text2)' }}>relative strength vs BTC (20D)</span> ·{' '}
        Top 25 from Core/Active tier assets only.

        {/* Sort controls */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>Sort:</span>
          {[
            { key: 'ret20d', label: '20D' },
            { key: 'rs_btc', label: 'RS 20D' },
            { key: 'ret5d', label: '5D' },
            { key: 'vol', label: 'Vol' },
          ].map(opt => (
            <button
              key={opt.key}
              className="text-[9px] font-bold px-2 py-1 transition-all"
              style={{
                background: sortBy === opt.key ? 'rgba(245,158,11,0.12)' : 'transparent',
                border: `1px solid ${sortBy === opt.key ? 'var(--scanner-accent)' : 'var(--scanner-border2)'}`,
                color: sortBy === opt.key ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                cursor: 'pointer',
              }}
              onClick={() => setSortBy(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
        <table className="w-full border-collapse min-w-[900px]">
          <thead>
            <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
              {['Ticker', 'Name', 'Theme', 'RS 20D', '5D Ret', '20D Ret', '60D Ret', 'ATR Ext', 'Vol Ratio', 'vs50MA', 'Tier', ''].map(h => (
                <th key={h} className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2.5 px-3 text-left" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item, i) => (
              <tr key={item.symbol}
                style={{ borderBottom: '1px solid var(--scanner-border)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td className="py-3 px-3">
                  <span className="text-[12px] font-bold" style={{ color: 'var(--scanner-text)' }}>{item.symbol}</span>
                </td>
                <td className="py-3 px-3 text-[10px]" style={{ color: 'var(--scanner-text3)', maxWidth: 120 }}>
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
                </td>
                <td className="py-3 px-3 text-[9px]" style={{ color: 'var(--scanner-text2)' }}>{item.theme}</td>
                <td className="py-3 px-3">
                  <span className="tabular-nums text-[11px] font-bold" style={{ color: pctColor(item.rs_btc_20d) }}>
                    {item.rs_btc_20d != null ? (item.rs_btc_20d >= 0 ? '+' : '') + (item.rs_btc_20d * 100).toFixed(1) + '%' : '—'}
                  </span>
                </td>
                <td className="py-3 px-3"><span className="tabular-nums text-[11px] font-semibold" style={{ color: pctColor(item.ret5d) }}>{fmtPct(item.ret5d)}</span></td>
                <td className="py-3 px-3"><span className="tabular-nums text-[11px] font-semibold" style={{ color: pctColor(item.ret20d) }}>{fmtPct(item.ret20d)}</span></td>
                <td className="py-3 px-3"><span className="tabular-nums text-[11px]" style={{ color: pctColor(item.ret60d) }}>{fmtPct(item.ret60d)}</span></td>
                <td className="py-3 px-3">
                  <span className="tabular-nums text-[11px] font-semibold" style={{ color: 'var(--scanner-accent)' }}>
                    {item.atrExt50ma != null ? item.atrExt50ma.toFixed(1) : '—'}
                  </span>
                </td>
                <td className="py-3 px-3 tabular-nums text-[11px]" style={{ color: 'var(--scanner-text2)' }}>
                  {item.volRatio != null ? item.volRatio.toFixed(2) + 'x' : '—'}
                </td>
                <td className="py-3 px-3">
                  <span className="tabular-nums text-[11px]" style={{ color: item.distMa50 != null ? (item.distMa50 > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)') : 'var(--scanner-text3)' }}>
                    {item.distMa50 != null ? (item.distMa50 >= 0 ? '+' : '') + item.distMa50.toFixed(1) + '%' : '—'}
                  </span>
                </td>
                <td className="py-3 px-3">
                  <span className="text-[8px] px-1.5 py-0.5" style={{
                    background: item.tier === 'Core' ? 'rgba(0,230,118,0.1)' : 'rgba(77,159,255,0.1)',
                    color: item.tier === 'Core' ? 'var(--scanner-green)' : 'var(--scanner-blue)',
                    border: item.tier === 'Core' ? '1px solid rgba(0,230,118,0.25)' : '1px solid rgba(77,159,255,0.25)',
                  }}>
                    {item.tier}
                  </span>
                </td>
                <td className="py-3 px-3">
                  <span className="text-[8px] px-1.5 py-0.5 font-bold" style={{
                    background: 'rgba(0,230,118,0.08)',
                    color: 'var(--scanner-green)',
                    border: '1px solid rgba(0,230,118,0.2)'
                  }}>CLEAN</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
