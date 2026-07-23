import React, { useState, useMemo } from 'react';

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
}
function fmtPctRaw(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function pctColor(v) {
  if (v == null || !Number.isFinite(v)) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}
function fmtPrice(p) {
  if (p == null || !Number.isFinite(p)) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(2);
  return p.toFixed(4);
}
function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (sec < 60) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleDateString('en-US');
}

function MiniSparkline({ data }) {
  if (!data || data.length < 2) return <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>—</span>;
  const w = 80, h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? 'var(--scanner-green)' : 'var(--scanner-red)';
  const last = pts[pts.length - 1].split(',');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <path d={`M${pts.join(' L')}`} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.85" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
    </svg>
  );
}

/**
 * @param {object} props
 * @param {any} props.children
 * @param {any} [props.right]
 */
function SectionLabel({ children, right }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-3 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
      <span className="text-[9px] font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--scanner-text3)' }}>{children}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

const SORT_OPTIONS = [
  { key: 'ret20d', label: '20D' },
  { key: 'ret5d',  label: '5D'  },
  { key: 'ret1d',  label: '1D'  },
  { key: 'ret60d', label: '60D' },
  { key: 'rsi14',  label: 'RSI' },
  { key: 'pctFrom52wHigh', label: '52W%' },
  { key: 'name',   label: 'Name' },
];

function rsiColor(v) {
  if (v == null) return 'var(--scanner-text3)';
  if (v >= 70) return 'var(--scanner-red)';      // overbought
  if (v <= 30) return 'var(--scanner-green)';    // oversold
  return 'var(--scanner-text2)';
}

export default function MacroTab({ tradData, isLoading, snapshotLoading, onRefresh }) {
  const [sortKey, setSortKey] = useState('ret20d');
  const [filterCat, setFilterCat] = useState('All');
  const [search, setSearch] = useState('');

  // useMemo MUST be called before any early returns (Rules of Hooks)
  const assets = tradData?.assets || [];
  const categories = tradData?.categories || [];
  const tradRegime = tradData?.tradRegime || { total: 0, pctAbove20: 0, pctAbove50: 0, pctAbove200: 0, avgRet1d: 0, avgRet5d: 0, avgRet20d: 0 };
  const startingToMove = tradData?.startingToMove || [];
  const sourceCounts = tradData?.sourceCounts || {};
  const fetchedAt = tradData?.fetchedAt || null;

  const filtered = useMemo(() => {
    return assets.filter(a => {
      if (filterCat !== 'All' && a.category !== filterCat) return false;
      if (search && !`${a.symbol} ${a.name}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [assets, filterCat, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'rsi14') return (a.rsi14 ?? 200) - (b.rsi14 ?? 200);
      if (sortKey === 'pctFrom52wHigh') return (a.pctFrom52wHigh ?? 999) - (b.pctFrom52wHigh ?? 999);
      return (b[sortKey] ?? -99) - (a[sortKey] ?? -99);
    });
  }, [filtered, sortKey]);

  // If the snapshot is still loading (page just mounted), show a loading spinner.
  // This prevents the "No macro data loaded" flash before the snapshot resolves.
  if (snapshotLoading && !tradData) {
    return (
      <div className="font-mono text-center py-20 px-5">
        <div className="text-3xl mb-4 animate-pulse opacity-30">◈</div>
        <div className="text-sm mb-1" style={{ color: 'var(--scanner-text2)' }}>Loading traditional market data…</div>
        <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>Reading from pre-built snapshot</div>
      </div>
    );
  }

  // If we have no data at all AND we're loading (live refresh, no snapshot), show the full-page spinner.
  // If we have data (snapshot or partial live), show it with a loading
  // indicator in the header — don't replace the entire view with a spinner.
  if (isLoading && !tradData) {
    return (
      <div className="font-mono text-center py-20 px-5">
        <div className="text-3xl mb-4 animate-pulse opacity-30">◈</div>
        <div className="text-sm mb-1" style={{ color: 'var(--scanner-text2)' }}>Loading traditional market data…</div>
        <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>Fetching candles via multi-source resolver</div>
      </div>
    );
  }

  if (!tradData) {
    return (
      <div className="font-mono text-center py-20 px-5">
        <div className="text-3xl mb-4 opacity-20">◈</div>
        <div className="text-sm mb-1" style={{ color: 'var(--scanner-text2)' }}>No macro data loaded</div>
        <div className="text-[11px] mb-4" style={{ color: 'var(--scanner-text3)' }}>Click Refresh to fetch tradfi market data</div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="font-mono text-[10px] font-bold tracking-wide px-4 py-2 rounded"
            style={{ background: 'var(--scanner-accent)', color: '#000', border: 'none', cursor: 'pointer' }}
          >
            ↻ REFRESH
          </button>
        )}
      </div>
    );
  }

  const categories_list = ['All', ...categories.map(c => c.name)];

  return (
    <div className="font-mono px-5 md:px-8 py-5 space-y-6">

      {/* Loading banner — shown when refreshing with existing data */}
      {isLoading && (
        <div className="flex items-center gap-2 px-3 py-2 rounded text-[10px]" style={{
          background: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.2)',
          color: 'var(--scanner-accent)',
        }}>
          <span className="animate-pulse">⟳</span>
          <span>Refreshing live data… showing last cached results</span>
        </div>
      )}

      {/* Header strip — last updated + refresh + sources */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-3" style={{ borderBottom: '1px solid var(--scanner-border2)' }}>
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <span className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Last Updated</span>
            <div className="text-[11px] font-semibold" style={{
              color: tradRegime.total > 0
                ? (fetchedAt && (Date.now() - new Date(fetchedAt).getTime() > 3 * 24 * 60 * 60 * 1000)
                   ? 'var(--scanner-red)'  // stale: > 3 days old
                   : 'var(--scanner-text)')
                : 'var(--scanner-red)'
            }}>
              {tradRegime.total > 0 ? timeAgo(fetchedAt) : '—'}
              {fetchedAt && (Date.now() - new Date(fetchedAt).getTime() > 3 * 24 * 60 * 60 * 1000) && (
                <span className="ml-1 text-[8px]" style={{ color: 'var(--scanner-red)' }}>⚠ stale</span>
              )}
            </div>
          </div>
          <div>
            <span className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Assets</span>
            <div className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--scanner-text)' }}>
              {tradRegime.total}/{assets.length}
            </div>
          </div>
          {sourceCounts && Object.keys(sourceCounts).length > 0 && (
            <div>
              <span className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Sources</span>
              <div className="text-[10px] flex gap-2">
                {Object.entries(sourceCounts).map(([src, count]) => (
                  <span key={src} className="px-1.5 py-0.5 rounded" style={{
                    background: 'rgba(245,158,11,0.08)',
                    color: 'var(--scanner-accent)',
                    border: '1px solid rgba(245,158,11,0.2)',
                  }}>
                    {src}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="font-mono text-[10px] font-bold tracking-wide px-3 py-1.5 rounded transition-all"
            style={{
              background: 'var(--scanner-accent)',
              color: '#000',
              border: 'none',
              cursor: isLoading ? 'wait' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
            }}
            disabled={isLoading}
          >
            {isLoading ? '⟳ Refreshing…' : '↻ REFRESH'}
          </button>
        )}
      </div>

      {/* Summary stats bar */}
      <section>
        <SectionLabel>Traditional Market Breadth</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <StatCard label="Avg 1D" value={fmtPct(tradRegime.avgRet1d)} color={pctColor(tradRegime.avgRet1d)} />
          <StatCard label="Avg 5D" value={fmtPct(tradRegime.avgRet5d)} color={pctColor(tradRegime.avgRet5d)} />
          <StatCard label="Avg 20D" value={fmtPct(tradRegime.avgRet20d)} color={pctColor(tradRegime.avgRet20d)} />
          <StatCard label="▲ 20MA" value={`${tradRegime.pctAbove20}%`} color={tradRegime.pctAbove20 >= 60 ? 'var(--scanner-green)' : tradRegime.pctAbove20 <= 35 ? 'var(--scanner-red)' : 'var(--scanner-text2)'} />
          <StatCard label="▲ 50MA" value={`${tradRegime.pctAbove50}%`} color={tradRegime.pctAbove50 >= 60 ? 'var(--scanner-green)' : tradRegime.pctAbove50 <= 35 ? 'var(--scanner-red)' : 'var(--scanner-text2)'} />
          <StatCard label="▲ 200MA" value={tradRegime.pctAbove200 != null ? `${tradRegime.pctAbove200}%` : '—'} color={tradRegime.pctAbove200 >= 60 ? 'var(--scanner-green)' : tradRegime.pctAbove200 <= 35 ? 'var(--scanner-red)' : 'var(--scanner-text2)'} />
          <StatCard label="Assets" value={tradRegime.total} color="var(--scanner-text2)" />
        </div>
      </section>

      {/* Category summary */}
      <section>
        <SectionLabel>Category Summary</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
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
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: pctColor(cat.avgRet20d) }}>
                  {fmtPct(cat.avgRet20d)}
                </span>
                <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>{cat.count} assets</span>
              </div>
              <div className="flex gap-2 mb-1">
                <BreadthBar pct={cat.pctAbove20}  color="var(--scanner-green)" label="20" />
                <BreadthBar pct={cat.pctAbove50}  color="var(--scanner-blue)"  label="50" />
              </div>
              {cat.pctAbove200 != null && (
                <div className="text-[8px] mt-1" style={{ color: 'var(--scanner-text3)' }}>
                  60D: <span style={{ color: pctColor(cat.avgRet60d) }}>{fmtPct(cat.avgRet60d)}</span> · 200MA: {cat.pctAbove200}%
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Starting to Move — tradfi */}
      {startingToMove.length > 0 && (
        <section>
          <div className="text-[11px] font-bold tracking-wide uppercase mb-2" style={{ color: 'var(--scanner-text2)' }}>
            Starting to Move · TradFi
          </div>
          <div className="text-[9px] mb-3" style={{ color: 'var(--scanner-text3)' }}>
            RS vs QQQ positive, still within 15% of the 50MA — not yet extended.
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--scanner-border)' }}>
                {['Ticker', 'RS vs QQQ', 'vs 50MA', 'ADR%', 'D>50MA', 'Vol'].map(h => (
                  <th key={h} className="text-left py-2 px-3 font-normal" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {startingToMove.map(t => (
                <tr key={t.symbol} style={{ borderBottom: '1px solid var(--scanner-border)' }}>
                  <td className="py-2 px-3 font-bold" style={{ color: 'var(--scanner-text)' }}>{t.symbol}</td>
                  <td className="py-2 px-3 tabular-nums" style={{ color: 'var(--scanner-green)' }}>
                    +{(t.rsNow * 100).toFixed(1)}%
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
      )}

      {/* Individual asset table */}
      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <SectionLabel>
            {filterCat === 'All' ? 'All Assets' : filterCat} — {sorted.length} assets
          </SectionLabel>
          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="font-mono text-[10px] px-2 py-1 outline-none"
              style={{
                background: 'var(--scanner-bg2)',
                border: '1px solid var(--scanner-border2)',
                color: 'var(--scanner-text)',
                width: 100,
              }}
            />
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
          <table className="w-full border-collapse min-w-[1100px]">
            <thead>
              <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
                {['Ticker', 'Name', 'Price', '14D', '1D', '5D', '20D', '60D', 'vs20MA', 'vs50MA', 'ATR', 'RSI', '52W%', 'RS/QQQ', 'Src', 'Cat'].map(h => (
                  <th key={h} className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2.5 px-2.5 text-left" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, i) => (
                <tr key={item.symbol}
                  style={{ borderBottom: '1px solid var(--scanner-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td className="py-2 px-2.5">
                    <span className="text-[11px] font-bold" style={{ color: 'var(--scanner-text)' }}>{item.symbol}</span>
                  </td>
                  <td className="py-2 px-2.5 text-[10px]" style={{ color: 'var(--scanner-text3)', maxWidth: 100 }}>
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
                  </td>
                  <td className="py-2 px-2.5 text-[11px] font-semibold tabular-nums" style={{ color: 'var(--scanner-text)' }}>
                    {fmtPrice(item.price)}
                  </td>
                  <td className="py-2 px-2.5">
                    <MiniSparkline data={item.sparkline?.slice(-14)} />
                  </td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: pctColor(item.ret1d) }}>{fmtPct(item.ret1d)}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: pctColor(item.ret5d) }}>{fmtPct(item.ret5d)}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: pctColor(item.ret20d) }}>{fmtPct(item.ret20d)}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: pctColor(item.ret60d) }}>{fmtPct(item.ret60d)}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: pctColor(item.distMa20 != null ? item.distMa20 / 100 : null) }}>{fmtPctRaw(item.distMa20)}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: pctColor(item.distMa50 != null ? item.distMa50 / 100 : null) }}>{fmtPctRaw(item.distMa50)}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: 'var(--scanner-text2)' }}>{item.atrExt50ma != null ? item.atrExt50ma.toFixed(1) : '—'}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: rsiColor(item.rsi14) }}>{item.rsi14 != null ? item.rsi14.toFixed(0) : '—'}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: pctColor(item.pctFrom52wHigh != null ? item.pctFrom52wHigh / 100 : null) }}>{item.pctFrom52wHigh != null ? fmtPctRaw(item.pctFrom52wHigh) : '—'}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: pctColor(item.rs_qqq_20d != null ? item.rs_qqq_20d / 100 : null) }}>{item.rs_qqq_20d != null ? fmtPctRaw(item.rs_qqq_20d) : '—'}</span></td>
                  <td className="py-2 px-2.5">
                    <span className="text-[8px] px-1 py-0.5 rounded" style={{
                      background: 'var(--scanner-bg3, rgba(22,22,30,1))',
                      color: 'var(--scanner-text3)',
                    }}>{item.source || '?'}</span>
                  </td>
                  <td className="py-2 px-2.5">
                    <span className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>{item.category}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="text-center py-8 text-[11px]" style={{ color: 'var(--scanner-text3)' }}>
            No assets match the current filter
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="p-2.5 rounded" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
      <div className="text-[8px] font-semibold tracking-wider uppercase mb-1" style={{ color: 'var(--scanner-text3)' }}>{label}</div>
      <div className="text-[14px] font-bold tabular-nums" style={{ color }}>{value}</div>
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
