import React, { useState } from 'react';
import { fmtPrice, fmtPct } from '@/lib/scanner/calculations';

function fmtChange(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtVolume(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

function fmtMarketCap(v) {
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

function indicatorLabel(type, emaVal, vwapVal) {
  return type === 'vwap' ? `VWAP(${vwapVal}d)` : `EMA(${emaVal})`;
}

function MiniSparkline({ data, positive }) {
  if (!data || data.length < 2) return <span style={{ color: 'var(--scanner-text3)' }}>—</span>;

  const w = 80, h = 22;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  const color = positive == null
    ? 'var(--scanner-text3)'
    : positive
    ? 'var(--scanner-green)'
    : 'var(--scanner-red)';

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" style={{ display: 'block' }}>
      <polyline
        points={pts.join(' ')}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.9"
      />
    </svg>
  );
}

const SORT_OPTIONS = [
  { key: 'rank', label: 'MCap Rank' },
  { key: 'change24h', label: '24h Change' },
  { key: 'pricePct', label: 'Δ Base Trend' },
  { key: 'emaPct', label: 'Δ MA Spread' },
  { key: 'volume24h', label: 'VOL 24H' },
  { key: 'marketCap', label: 'MKTCAP' },
];

export default function ResultsTable({ results, settings, isScanning }) {
  const [sortKey, setSortKey] = useState('rank');

  const sorted = [...results].sort((a, b) => {
    if (sortKey === 'rank') return a.rank - b.rank;
    if (sortKey === 'pricePct') return b.pricePct - a.pricePct;
    if (sortKey === 'emaPct') return b.emaPct - a.emaPct;
    if (sortKey === 'change24h') return (b.change24h ?? -999) - (a.change24h ?? -999);
    if (sortKey === 'volume24h') return (b.volume24h ?? 0) - (a.volume24h ?? 0);
    if (sortKey === 'marketCap') return (b.marketCap ?? 0) - (a.marketCap ?? 0);
    return 0;
  });

  const maxPricePct = Math.max(...sorted.map(r => r.pricePct), 1);
  const maxEmaPct = Math.max(...sorted.map(r => r.emaPct), 1);

  const fastLabel = indicatorLabel(settings.fastType, settings.emaFast, settings.vwapFastDays);
  const midLabel = indicatorLabel(settings.midType, settings.emaMid, settings.vwapMidDays);
  const slowLabel = indicatorLabel(settings.slowType, settings.emaSlow, settings.vwapDays);

  return (
    <div className="font-mono px-5 md:px-8 py-5">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-2xl font-bold leading-none" style={{
            color: results.length > 0 ? 'var(--scanner-green)' : 'var(--scanner-text3)'
          }}>
            {results.length || '0'}
          </span>
          <span className="text-[10px] font-semibold tracking-[0.1em] uppercase" style={{ color: 'var(--scanner-text2)' }}>
            assets matched
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[9px] font-semibold tracking-[0.1em] uppercase" style={{ color: 'var(--scanner-text3)' }}>Sort</span>
          <div className="flex gap-1">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.key}
                className="font-mono text-[9px] font-semibold tracking-[0.08em] px-2.5 py-1.5 rounded transition-all"
                style={{
                  background: sortKey === opt.key ? 'rgba(245,158,11,0.12)' : 'var(--scanner-bg2)',
                  border: `1px solid ${sortKey === opt.key ? 'var(--scanner-accent)' : 'var(--scanner-border2)'}`,
                  color: sortKey === opt.key ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                  cursor: 'pointer'
                }}
                onClick={() => setSortKey(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState isScanning={isScanning} />
      ) : (
        <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--scanner-border2)' }}>
          <table className="w-full min-w-[1000px] border-collapse">
            <thead>
              <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
                {[
                  { key: 'rank', label: '#', right: true },
                  { key: null, label: 'Asset' },
                  { key: null, label: 'Price', right: true },
                  { key: 'change24h', label: '7D / 24h Δ', right: true },
                  { key: null, label: `Fast ${fastLabel}`, right: true },
                  { key: null, label: `Slow ${midLabel}`, right: true },
                  { key: null, label: `Base ${slowLabel}`, right: true },
                  { key: 'pricePct', label: 'Δ Base', right: true },
                  { key: 'emaPct', label: 'Δ Spread', right: true },
                  { key: 'volume24h', label: 'VOL 24H', right: true },
                  { key: 'marketCap', label: 'MKTCAP', right: true },
                ].map((col, i) => (
                  <th
                    key={i}
                    className={`text-[8.5px] font-semibold tracking-[0.12em] uppercase whitespace-nowrap py-2.5 px-4 ${col.right ? 'text-right' : 'text-left'}`}
                    style={{
                      color: sortKey === col.key ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                      cursor: col.key ? 'pointer' : 'default',
                    }}
                    onClick={() => col.key && setSortKey(col.key)}
                  >
                    {col.label}
                    {sortKey === col.key && <span className="ml-0.5 opacity-60"> ↓</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <ResultRow
                  key={r.symbol}
                  row={r}
                  index={i}
                  maxPricePct={maxPricePct}
                  maxEmaPct={maxEmaPct}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultRow({ row, index, maxPricePct, maxEmaPct }) {
  const pBarW = Math.max(2, Math.round((row.pricePct / maxPricePct) * 40));
  const eBarW = Math.max(2, Math.round((row.emaPct / maxEmaPct) * 40));
  const isPositive = row.change24h != null ? row.change24h >= 0 : null;

  return (
    <tr
      style={{
        borderBottom: '1px solid var(--scanner-border)',
        animation: `rowIn 0.18s ease forwards`,
        animationDelay: `${Math.min(index * 0.015, 0.35)}s`,
        opacity: 0
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* Rank */}
      <td className="py-3 px-4 text-right text-[10px]" style={{ color: 'var(--scanner-text3)' }}>{row.rank}</td>

      {/* Asset */}
      <td className="py-3 px-4">
        <div className="text-[12px] font-bold leading-tight" style={{ color: 'var(--scanner-text)' }}>{row.symbol}</div>
        <div className="text-[9px] leading-tight max-w-[80px] overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: 'var(--scanner-text3)' }}>{row.name}</div>
      </td>

      {/* Price */}
      <td className="py-3 px-4 text-right">
        <span className="text-[12px] font-semibold tabular-nums" style={{ color: 'var(--scanner-text)' }}>{fmtPrice(row.price)}</span>
      </td>

      {/* 7D Sparkline + 24h Change */}
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-2">
          <MiniSparkline data={row.sparkline} positive={isPositive} />
          <span className="text-[11px] font-semibold tabular-nums min-w-[52px] text-right" style={{
            color: isPositive == null ? 'var(--scanner-text3)' : isPositive ? 'var(--scanner-green)' : 'var(--scanner-red)'
          }}>
            {fmtChange(row.change24h)}
          </span>
        </div>
      </td>

      {/* Fast EMA/VWAP */}
      <td className="py-3 px-4 text-right text-[11px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>{fmtPrice(row.emaFast)}</td>

      {/* Mid EMA/VWAP */}
      <td className="py-3 px-4 text-right text-[11px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>{fmtPrice(row.emaMid)}</td>

      {/* Base (slow) */}
      <td className="py-3 px-4 text-right text-[11px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>{fmtPrice(row.emaSlow)}</td>

      {/* Δ Base Trend */}
      <td className="py-3 px-4 text-right">
        <PctBarCell value={row.pricePct} barWidth={pBarW} color="var(--scanner-green)" />
      </td>

      {/* Δ Spread */}
      <td className="py-3 px-4 text-right">
        <PctBarCell value={row.emaPct} barWidth={eBarW} color="var(--scanner-blue)" />
      </td>

      {/* VOL 24H */}
      <td className="py-3 px-4 text-right">
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
          {row.volume24h > 0 ? fmtVolume(row.volume24h) : '—'}
        </span>
      </td>

      {/* MKTCAP */}
      <td className="py-3 px-4 text-right">
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
          {row.marketCap > 0 ? fmtMarketCap(row.marketCap) : '—'}
        </span>
      </td>
    </tr>
  );
}

function PctBarCell({ value, barWidth, color }) {
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="w-10 h-[3px] rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--scanner-border2)' }}>
        <div className="h-full rounded-full" style={{ background: color, width: `${barWidth}px`, minWidth: '2px' }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>{fmtPct(value)}</span>
    </div>
  );
}

function EmptyState({ isScanning }) {
  return (
    <div className="text-center py-20 rounded-lg" style={{ border: '1px solid var(--scanner-border2)', background: 'var(--scanner-bg1)' }}>
      <div className={`text-4xl mb-4 ${isScanning ? 'animate-pulse' : ''}`} style={{ opacity: 0.3 }}>◈</div>
      <div className="text-sm font-medium mb-1.5" style={{ color: 'var(--scanner-text2)' }}>
        {isScanning ? 'Scanning markets…' : 'No assets matched all conditions'}
      </div>
      <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>
        {isScanning
          ? 'Results will appear as matches are found'
          : 'Try adjusting indicator periods or selecting a different exchange'}
      </div>
    </div>
  );
}