import React, { useState, useMemo } from 'react';
import TradingViewChart from '@/components/scanner/TradingViewChart';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import CopyCsvButtons from './CopyCsvButtons';
import { fmtCryptoPrice } from '@/lib/board/priceFormat';

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}
function fmtPctRaw(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function retColor(v) {
  if (v == null || !Number.isFinite(v)) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text3)';
}
function rsiColor(v) {
  if (v == null) return 'var(--scanner-text3)';
  return v < 30 ? 'var(--scanner-green)' : v > 70 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
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
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <path d={`M${pts.join(' L')}`} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.85" />
    </svg>
  );
}

function ChartButton({ symbol, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(symbol); }}
      title={`View ${symbol} chart`}
      style={{
        background: 'transparent',
        border: '1px solid var(--scanner-border2)',
        borderRadius: '4px',
        width: '24px',
        height: '20px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        color: 'var(--scanner-text3)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--scanner-accent)';
        e.currentTarget.style.color = 'var(--scanner-accent)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--scanner-border2)';
        e.currentTarget.style.color = 'var(--scanner-text3)';
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="5" width="2.5" height="6" rx="0.5" fill="currentColor" opacity="0.7" />
        <line x1="3.25" y1="3" x2="3.25" y2="5" stroke="currentColor" strokeWidth="0.75" opacity="0.7" />
        <line x1="3.25" y1="11" x2="3.25" y2="13" stroke="currentColor" strokeWidth="0.75" opacity="0.7" />
        <rect x="6.75" y="3" width="2.5" height="9" rx="0.5" fill="currentColor" />
        <line x1="8" y1="1.5" x2="8" y2="3" stroke="currentColor" strokeWidth="0.75" />
        <line x1="8" y1="12" x2="8" y2="14.5" stroke="currentColor" strokeWidth="0.75" />
        <rect x="11.5" y="6" width="2.5" height="5" rx="0.5" fill="currentColor" opacity="0.5" />
        <line x1="12.75" y1="4" x2="12.75" y2="6" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
        <line x1="12.75" y1="11" x2="12.75" y2="13" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
      </svg>
    </button>
  );
}

export default function CryptoTab({ cryptoAssets }) {
  const [sortKey, setSortKey] = useState('ret20d');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [search, setSearch] = useState('');

  const sorted = useMemo(() => {
    if (!cryptoAssets) return [];
    const filtered = search
      ? cryptoAssets.filter(a => `${a.symbol} ${a.name}`.toLowerCase().includes(search.toLowerCase()))
      : cryptoAssets;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [cryptoAssets, sortKey, sortDir, search]);

  const headers = [
    { key: null, label: '' },
    { key: 'symbol', label: 'Ticker' },
    { key: null, label: 'Name' },
    { key: 'price', label: 'Price' },
    // Audit F-14-f-9 (2026-08-26): sparkline column was previously labeled
    // '20D' — same as the ret20d column at line 111 — making both headers
    // visually identical and confusing. Renamed to 'Trend' to distinguish
    // (sparkline visual vs. sortable % return column).
    { key: null, label: 'Trend' },
    { key: 'ret1d', label: '1D' },
    { key: 'ret5d', label: '5D' },
    { key: 'ret20d', label: '20D' },
    { key: 'ret60d', label: '60D' },
    { key: 'distMa20', label: 'vs20MA' },
    { key: 'distMa50', label: 'vs50MA' },
    { key: 'atrExt50ma', label: 'ATR' },
    { key: 'rsi14', label: 'RSI' },
    { key: 'rs_btc_20d', label: 'RS/BTC' },
    { key: 'volRatio', label: 'rVOL' },
    { key: 'adrUsedPct', label: 'ADR%' },
    { key: 'oiRatio', label: 'OI/MC' },
  ];

  if (!cryptoAssets || cryptoAssets.length === 0) {
    return (
      <div className="text-center py-24 font-mono">
        <div className="text-4xl mb-4 opacity-20">◈</div>
        <div className="text-sm" style={{ color: 'var(--scanner-text2)' }}>No crypto data loaded</div>
        <div className="text-[11px] mt-1" style={{ color: 'var(--scanner-text3)' }}>Click Refresh to fetch market data</div>
      </div>
    );
  }

  return (
    <div className="font-mono">
      <div className="px-5 md:px-8 py-4">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-[9px] font-bold tracking-[0.12em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
            Crypto Universe · {sorted.length} assets
          </span>
          <input
            type="text"
            placeholder="Search ticker or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="font-mono text-[10px] px-2 py-1 outline-none"
            style={{
              background: 'var(--scanner-bg2)',
              border: '1px solid var(--scanner-border2)',
              color: 'var(--scanner-text)',
              borderRadius: '4px',
              width: '180px',
            }}
          />
          <CopyCsvButtons tableId="crypto-tab-table" />
        </div>
        <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
          <table id="crypto-tab-table" className="board-table w-full border-collapse min-w-[1400px]">
            <thead>
              <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
                {headers.map((h, hi) => (
                  <th
                    key={hi}
                    className={`text-[8.5px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap py-2 px-2.5 ${h.key ? 'cursor-pointer' : ''} text-left`}
                    style={{
                      color: sortKey === h.key ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                      ...(hi <= 1 ? { position: 'sticky', left: hi === 0 ? 0 : '32px', zIndex: 10, background: 'var(--scanner-bg2)' } : {}),
                    }}
                    onClick={() => {
                      if (!h.key) return;
                      if (sortKey === h.key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
                      else { setSortKey(h.key); setSortDir('desc'); }
                    }}
                  >
                    {h.label}
                    {sortKey === h.key && <span className="ml-0.5 opacity-60">{sortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.symbol}
                  style={{ borderBottom: '1px solid var(--scanner-border)' }}
                  onClick={() => setSelectedSymbol(item.symbol)}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  {/* Chart button (sticky col 0) */}
                  <td className="py-2 px-1.5 text-center" style={{ width: '32px', position: 'sticky', left: 0, zIndex: 5, background: 'var(--scanner-bg1)' }}>
                    <ChartButton symbol={item.symbol} onClick={setSelectedSymbol} />
                  </td>
                  {/* Ticker (sticky col 1) */}
                  <td className="py-2 px-2.5" style={{ position: 'sticky', left: '32px', zIndex: 5, background: 'var(--scanner-bg1)', cursor: 'pointer' }}>
                    <span className="text-[11px] font-bold" style={{ color: 'var(--scanner-text)' }}>{item.symbol}</span>
                  </td>
                  {/* Name */}
                  <td className="py-2 px-2.5 text-[10px]" style={{ color: 'var(--scanner-text3)', maxWidth: 100 }}>
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
                  </td>
                  {/* Price */}
                  <td className="py-2 px-2.5 text-[11px] font-semibold tabular-nums" style={{ color: 'var(--scanner-text)' }}>
                    {fmtCryptoPrice(item.price)}
                  </td>
                  {/* 20D sparkline */}
                  <td className="py-2 px-2.5">
                    <MiniSparkline data={item.sparkline?.slice(-20)} />
                  </td>
                  {/* Returns */}
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.ret1d) }}>{fmtPct(item.ret1d)}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.ret5d) }}>{fmtPct(item.ret5d)}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.ret20d) }}>{fmtPct(item.ret20d)}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.ret60d) }}>{fmtPct(item.ret60d)}</span></td>
                  {/* vs MA */}
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.distMa20 != null ? item.distMa20 / 100 : null) }}>{item.distMa20 != null ? fmtPctRaw(item.distMa20) : '—'}</span></td>
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.distMa50 != null ? item.distMa50 / 100 : null) }}>{item.distMa50 != null ? fmtPctRaw(item.distMa50) : '—'}</span></td>
                  {/* ATR */}
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: 'var(--scanner-text2)' }}>{item.atrExt50ma != null ? item.atrExt50ma.toFixed(1) : '—'}</span></td>
                  {/* RSI */}
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: rsiColor(item.rsi14) }}>{item.rsi14 != null ? item.rsi14.toFixed(0) : '—'}</span></td>
                  {/* RS/BTC */}
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.rs_btc_20d) }}>{item.rs_btc_20d != null ? fmtPctRaw(item.rs_btc_20d * 100) : '—'}</span></td>
                  {/* Vol Ratio (rVOL) */}
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: item.volRatio >= 2 ? 'var(--scanner-accent)' : item.volRatio >= 1.5 ? 'var(--scanner-green)' : 'var(--scanner-text2)' }}>{item.volRatio != null ? item.volRatio.toFixed(1) + 'x' : '—'}</span></td>
                  {/* ADR Used % (exhaustion read: today's range / trailing 20D ADR$) */}
                  <td className="py-2 px-2.5"><span className="tabular-nums text-[10px]" style={{ color: item.adrUsedPct >= 150 ? 'var(--scanner-accent)' : item.adrUsedPct <= 50 ? 'var(--scanner-text3)' : 'var(--scanner-text2)' }} title="ADR Used: today's range / trailing 20D avg range. 150%+ = stretched, 50%- = room left.">{item.adrUsedPct != null ? item.adrUsedPct.toFixed(0) + '%' : '—'}</span></td>
                  {/* OI/MC */}
                  <td className="py-2 px-2.5">
                    <span
                      className="text-[10px] font-semibold tabular-nums cursor-help"
                      style={{
                        color: item.oiRatio == null ? 'var(--scanner-text3)' :
                               item.oiRatio >= 0.30 ? 'var(--scanner-red)' :
                               item.oiRatio >= 0.15 ? 'var(--scanner-accent)' :
                               'var(--scanner-text2)'
                      }}
                      title={item.oiRatio != null
                        ? `OI/MC: ${(item.oiRatio * 100).toFixed(1)}% of market cap in open interest. >30% = extreme, >15% = elevated.`
                        : 'OI/MC unavailable'}
                    >
                      {item.oiRatio != null ? `${(item.oiRatio * 100).toFixed(1)}%` : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* TradingView chart sheet */}
      <Sheet open={!!selectedSymbol} onOpenChange={(open) => !open && setSelectedSymbol(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl p-0 flex flex-col"
          style={{ background: 'var(--scanner-bg)', border: 'none', overflow: 'hidden', maxWidth: '672px' }}
        >
          <SheetHeader className="p-4 border-b flex-shrink-0" style={{ borderColor: 'var(--scanner-border)' }}>
            <SheetTitle style={{ color: 'var(--scanner-text)' }}>
              {selectedSymbol} · 1D
            </SheetTitle>
          </SheetHeader>
          <div className="tradingview-chart-container flex-1" style={{ minHeight: '300px', position: 'relative' }}>
            {selectedSymbol && (
              <TradingViewChart
                symbol={selectedSymbol}
                exchange="binance_perps"
                timeframe="1D"
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
