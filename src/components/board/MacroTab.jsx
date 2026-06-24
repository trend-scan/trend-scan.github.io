import React, { useState } from 'react';

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
}
function fmtPctRaw(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function pctColor(v) {
  if (v == null) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}
function fmtPrice(p) {
  if (p == null) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(2);
  return p.toFixed(4);
}

function MiniSparkline({ data }) {
  if (!data || data.length < 2) return null;
  const w = 64, h = 20;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });
  const isUp = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <polyline points={pts.join(' ')} stroke={isUp ? 'var(--scanner-green)' : 'var(--scanner-red)'}
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.85" />
    </svg>
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

const SORT_OPTIONS = [
  { key: 'ret20d', label: '20D Ret' },
  { key: 'ret5d',  label: '5D Ret'  },
  { key: 'ret1d',  label: '1D Ret'  },
  { key: 'name',   label: 'Name'    },
];

export default function MacroTab({ tradData, isLoading }) {
  const [sortKey, setSortKey] = useState('ret20d');
  const [filterCat, setFilterCat] = useState('All');

  if (isLoading) {
    return (
      <div className="font-mono text-center py-20 px-5">
        <div className="text-3xl mb-4 animate-pulse opacity-30">◈</div>
        <div className="text-sm mb-1" style={{ color: 'var(--scanner-text2)' }}>Loading traditional market data…</div>
        <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>Fetching xStocks candles from Kraken</div>
      </div>
    );
  }

  if (!tradData) {
    return (
      <div className="font-mono text-center py-20 px-5">
        <div className="text-3xl mb-4 opacity-20">◈</div>
        <div className="text-sm mb-1" style={{ color: 'var(--scanner-text2)' }}>No macro data loaded</div>
        <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>Click Refresh on the board to fetch Kraken xStocks data</div>
      </div>
    );
  }

  const { assets, categories, tradRegime } = tradData;

  const categories_list = ['All', ...categories.map(c => c.name)];

  const filtered = assets.filter(a => filterCat === 'All' || a.category === filterCat);

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'name')   return a.name.localeCompare(b.name);
    if (sortKey === 'ret1d')  return (b.ret1d  ?? -99) - (a.ret1d  ?? -99);
    if (sortKey === 'ret5d')  return (b.ret5d  ?? -99) - (a.ret5d  ?? -99);
    if (sortKey === 'ret20d') return (b.ret20d ?? -99) - (a.ret20d ?? -99);
    return 0;
  });

  return (
    <div className="font-mono px-5 md:px-8 py-5 space-y-7">

      {/* Regime breadth strip */}
      <section>
        <SectionLabel>Traditional Market Breadth (Kraken xStocks · Daily)</SectionLabel>
        <div className="flex items-center gap-6 flex-wrap py-2 px-3 rounded" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
          <BreadthChip label="▲ 20MA" value={`${tradRegime.pctAbove20}%`} color={tradRegime.pctAbove20 >= 60 ? 'var(--scanner-green)' : tradRegime.pctAbove20 <= 35 ? 'var(--scanner-red)' : 'var(--scanner-text2)'} />
          <BreadthChip label="▲ 50MA" value={`${tradRegime.pctAbove50}%`} color={tradRegime.pctAbove50 >= 60 ? 'var(--scanner-green)' : tradRegime.pctAbove50 <= 35 ? 'var(--scanner-red)' : 'var(--scanner-text2)'} />
          <BreadthChip label="▲200MA" value={tradRegime.pctAbove200 != null ? `${tradRegime.pctAbove200}%` : '—'} color={tradRegime.pctAbove200 >= 60 ? 'var(--scanner-green)' : tradRegime.pctAbove200 <= 35 ? 'var(--scanner-red)' : 'var(--scanner-text2)'} />
          <div className="w-px h-4 flex-shrink-0" style={{ background: 'var(--scanner-border2)' }} />
          <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>{tradRegime.total} assets · Kraken xStocks (tokenized, 24/5)</span>
        </div>
      </section>

      {/* Category summary */}
      <section>
        <SectionLabel>Category Summary</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {categories.map(cat => (
            <div
              key={cat.name}
              className="p-3 rounded cursor-pointer transition-all"
              style={{
                background: filterCat === cat.name ? 'rgba(240,165,0,0.08)' : 'var(--scanner-bg2)',
                border: `1px solid ${filterCat === cat.name ? 'var(--scanner-accent)' : 'var(--scanner-border2)'}`,
              }}
              onClick={() => setFilterCat(filterCat === cat.name ? 'All' : cat.name)}
            >
              <div className="text-[9px] font-bold tracking-wider uppercase mb-1.5" style={{ color: filterCat === cat.name ? 'var(--scanner-accent)' : 'var(--scanner-text3)' }}>{cat.name}</div>
              <div className="flex justify-between items-baseline mb-1.5">
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: pctColor(cat.avgRet20d) }}>
                  {fmtPct(cat.avgRet20d)} <span className="text-[8px] opacity-60">20D avg</span>
                </span>
                <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>{cat.count} assets</span>
              </div>
              <div className="flex gap-2">
                <BreadthBar pct={cat.pctAbove20}  color="var(--scanner-green)" label="20" />
                <BreadthBar pct={cat.pctAbove50}  color="var(--scanner-blue)"  label="50" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Individual asset table */}
      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <SectionLabel>{filterCat === 'All' ? 'All Assets' : filterCat} — {sorted.length} assets</SectionLabel>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[8px] tracking-wider uppercase" style={{ color: 'var(--scanner-text3)' }}>Sort</span>
            {SORT_OPTIONS.map(o => (
              <button key={o.key} className="font-mono text-[9px] font-semibold px-2 py-1"
                style={{
                  background: sortKey === o.key ? 'rgba(240,165,0,0.12)' : 'var(--scanner-bg2)',
                  border: `1px solid ${sortKey === o.key ? 'var(--scanner-accent)' : 'var(--scanner-border2)'}`,
                  color: sortKey === o.key ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                  cursor: 'pointer'
                }}
                onClick={() => setSortKey(o.key)}>{o.label}</button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
          <table className="w-full border-collapse min-w-[760px]">
            <thead>
              <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
                {['Ticker', 'Name', 'Price', '30D Chart', '1D', '5D', '20D', 'vs20MA', 'vs50MA', 'ATR Ext', 'RS/QQQ', 'Category', 'Type'].map(h => (
                  <th key={h} className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2.5 px-3 text-left" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, i) => (
                <tr key={item.symbol}
                  style={{ borderBottom: '1px solid var(--scanner-border)', animationDelay: `${i * 0.01}s` }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td className="py-2.5 px-3">
                    <span className="text-[12px] font-bold" style={{ color: 'var(--scanner-text)' }}>{item.symbol}</span>
                  </td>
                  <td className="py-2.5 px-3 text-[10px]" style={{ color: 'var(--scanner-text3)', maxWidth: 120 }}>
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
                  </td>
                  <td className="py-2.5 px-3 text-[11px] font-semibold tabular-nums" style={{ color: 'var(--scanner-text)' }}>
                    {fmtPrice(item.price)}
                  </td>
                  <td className="py-2.5 px-3">
                    <MiniSparkline data={item.sparkline} />
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="tabular-nums text-[11px] font-semibold" style={{ color: pctColor(item.ret1d) }}>{fmtPct(item.ret1d)}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="tabular-nums text-[11px] font-semibold" style={{ color: pctColor(item.ret5d) }}>{fmtPct(item.ret5d)}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="tabular-nums text-[11px] font-semibold" style={{ color: pctColor(item.ret20d) }}>{fmtPct(item.ret20d)}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="tabular-nums text-[11px]" style={{ color: pctColor(item.distMa20 != null ? item.distMa20 / 100 : null) }}>
                      {item.distMa20 != null ? fmtPctRaw(item.distMa20) : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="tabular-nums text-[11px]" style={{ color: pctColor(item.distMa50 != null ? item.distMa50 / 100 : null) }}>
                      {item.distMa50 != null ? fmtPctRaw(item.distMa50) : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="tabular-nums text-[11px]" style={{ color: 'var(--scanner-text2)' }}>
                      {item.atrExt50ma != null ? item.atrExt50ma.toFixed(1) : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="tabular-nums text-[11px] font-semibold" style={{ color: pctColor(item.rs_qqq_20d) }}>
                      {item.rs_qqq_20d != null ? fmtPctRaw(item.rs_qqq_20d) : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="text-[8.5px] px-1.5 py-0.5" style={{
                      background: 'var(--scanner-bg3, rgba(22,22,30,1))', color: 'var(--scanner-text3)',
                      border: '1px solid var(--scanner-border2)'
                    }}>{item.category}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="text-[8.5px] px-1.5 py-0.5 font-semibold" style={{
                      background: item.type === 'ETF' ? 'rgba(77,159,255,0.08)' : 'rgba(0,230,118,0.06)',
                      color: item.type === 'ETF' ? 'var(--scanner-blue)' : 'var(--scanner-green)',
                      border: item.type === 'ETF' ? '1px solid rgba(77,159,255,0.2)' : '1px solid rgba(0,230,118,0.15)',
                    }}>{item.type}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function BreadthChip({ label, value, color }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: 'var(--scanner-text3)' }}>{label}</span>
      <span className="text-[13px] font-bold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

function BreadthBar({ pct, color, label }) {
  return (
    <div className="flex items-center gap-1 flex-1">
      <div className="flex-1 h-1.5 rounded-sm overflow-hidden" style={{ background: 'var(--scanner-border2)' }}>
        <div className="h-full" style={{ width: `${pct ?? 0}%`, background: color, opacity: 0.75 }} />
      </div>
      <span className="text-[7px]" style={{ color }}>{Math.round(pct ?? 0)}%</span>
    </div>
  );
}