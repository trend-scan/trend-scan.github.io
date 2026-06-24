import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const STATUS_PILL = {
  'DOMINANT':      { bg: 'rgba(0,230,118,0.12)',  text: 'var(--scanner-green)', border: 'rgba(0,230,118,0.3)' },
  'STRONG / HOT':  { bg: 'rgba(255,165,0,0.12)',  text: '#ff9800',              border: 'rgba(255,165,0,0.3)' },
  'EMERGING':      { bg: 'rgba(77,159,255,0.12)', text: 'var(--scanner-blue)',  border: 'rgba(77,159,255,0.3)' },
  'STRONG':        { bg: 'rgba(0,230,118,0.08)',  text: 'var(--scanner-green)', border: 'rgba(0,230,118,0.2)' },
  'IMPROVING':     { bg: 'rgba(77,159,255,0.08)', text: 'var(--scanner-blue)',  border: 'rgba(77,159,255,0.2)' },
  'NEUTRAL':       { bg: 'rgba(120,120,150,0.08)',text: 'var(--scanner-text3)', border: 'rgba(120,120,150,0.2)' },
  'DETERIORATING': { bg: 'rgba(255,68,68,0.08)',  text: 'var(--scanner-red)',   border: 'rgba(255,68,68,0.2)' },
  'FADING':        { bg: 'rgba(255,68,68,0.12)',  text: 'var(--scanner-red)',   border: 'rgba(255,68,68,0.3)' },
  'WEAK':          { bg: 'rgba(255,68,68,0.08)',  text: 'var(--scanner-red)',   border: 'rgba(255,68,68,0.2)' },
};

function ScoreBadge({ score }) {
  const color = score >= 60 ? 'var(--scanner-green)' : score >= 40 ? 'var(--scanner-accent)' : 'var(--scanner-red)';
  return (
    <span className="text-[12px] font-bold tabular-nums px-2 py-0.5 rounded" style={{
      color, background: `${color}18`, border: `1px solid ${color}40`
    }}>
      {score.toFixed(0)}
    </span>
  );
}

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}

function PctCell({ v }) {
  const color = v == null ? 'var(--scanner-text3)' : v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
  return <span className="tabular-nums text-[11px]" style={{ color }}>{fmtPct(v)}</span>;
}

function ConstituentTable({ items }) {
  return (
    <div className="overflow-x-auto" style={{ borderTop: '1px solid var(--scanner-border2)' }}>
      <table className="w-full border-collapse min-w-[900px]">
        <thead>
          <tr style={{ background: 'var(--scanner-bg2)' }}>
            {['Ticker', 'Name', 'Subtheme', 'Price', '1D', '5D', '20D', 'RS 20D', 'vs50MA', 'ATR Ext', 'NH20', 'NH52', 'Tier'].map(h => (
              <th key={h} className="text-[8px] font-semibold tracking-[0.1em] uppercase py-2 px-3 text-left" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.sort((a, b) => (b.ret20d ?? -99) - (a.ret20d ?? -99)).map(item => (
            <tr key={item.symbol} style={{ borderTop: '1px solid var(--scanner-border)' }}>
              <td className="py-2 px-3 text-[11px] font-bold" style={{ color: 'var(--scanner-text)' }}>{item.symbol}</td>
              <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--scanner-text3)' }}>{item.name}</td>
              <td className="py-2 px-3 text-[9px]" style={{ color: 'var(--scanner-text2)' }}>{item.subtheme}</td>
              <td className="py-2 px-3 text-[11px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
                {item.price != null ? item.price.toPrecision(4) : '—'}
              </td>
              <td className="py-2 px-3"><PctCell v={item.ret1d} /></td>
              <td className="py-2 px-3"><PctCell v={item.ret5d} /></td>
              <td className="py-2 px-3"><PctCell v={item.ret20d} /></td>
              <td className="py-2 px-3">
                <span className="tabular-nums text-[11px] font-semibold" style={{ color: item.rs_btc_20d != null ? (item.rs_btc_20d > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)') : 'var(--scanner-text3)' }}>
                  {item.rs_btc_20d != null ? (item.rs_btc_20d >= 0 ? '+' : '') + (item.rs_btc_20d * 100).toFixed(2) + '%' : '—'}
                </span>
              </td>
              <td className="py-2 px-3">
                <span className="tabular-nums text-[11px]" style={{ color: item.distMa50 != null ? (item.distMa50 > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)') : 'var(--scanner-text3)' }}>
                  {item.distMa50 != null ? (item.distMa50 >= 0 ? '+' : '') + item.distMa50.toFixed(1) + '%' : '—'}
                </span>
              </td>
              <td className="py-2 px-3 text-[11px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>{item.atrExt50ma != null ? item.atrExt50ma.toFixed(1) : '—'}</td>
              <td className="py-2 px-3">
                <span style={{ color: item.newHigh20d ? 'var(--scanner-green)' : 'var(--scanner-text3)', fontSize: 11 }}>
                  {item.newHigh20d ? '✓' : '—'}
                </span>
              </td>
              <td className="py-2 px-3">
                <span style={{ color: item.newHigh52w ? 'var(--scanner-green)' : 'var(--scanner-text3)', fontSize: 11 }}>
                  {item.newHigh52w ? '✓' : '—'}
                </span>
              </td>
              <td className="py-2 px-3">
                <span className="text-[8px] px-1.5 py-0.5" style={{
                  background: item.tier === 'Core' ? 'rgba(0,230,118,0.1)' : item.tier === 'Active' ? 'rgba(77,159,255,0.1)' : 'rgba(120,120,150,0.08)',
                  color: item.tier === 'Core' ? 'var(--scanner-green)' : item.tier === 'Active' ? 'var(--scanner-blue)' : 'var(--scanner-text3)',
                  border: item.tier === 'Core' ? '1px solid rgba(0,230,118,0.25)' : item.tier === 'Active' ? '1px solid rgba(77,159,255,0.25)' : '1px solid rgba(120,120,150,0.15)',
                }}>
                  {item.tier}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ThemesTab({ themes, constituents }) {
  const [expanded, setExpanded] = useState(null);
  const [sortKey, setSortKey] = useState('score');

  const sorted = [...themes].sort((a, b) => {
    if (sortKey === 'score') return b.score - a.score;
    if (sortKey === 'momentum') return (b.avgRet20 ?? -99) - (a.avgRet20 ?? -99);
    if (sortKey === 'breadth') return b.pctAbove20 - a.pctAbove20;
    if (sortKey === 'rs') return (b.avg_rs_btc_20d ?? -99) - (a.avg_rs_btc_20d ?? -99);
    return 0;
  });

  return (
    <div className="font-mono px-5 md:px-8 py-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[9px] font-semibold tracking-widest uppercase" style={{ color: 'var(--scanner-text3)' }}>Sort</span>
        {[['score', 'Score'], ['breadth', 'Breadth'], ['momentum', '20D Momentum'], ['rs', 'RS 20D']].map(([k, l]) => (
          <button key={k} className="font-mono text-[9px] font-semibold px-2.5 py-1.5"
            style={{
              background: sortKey === k ? 'rgba(245,158,11,0.12)' : 'var(--scanner-bg2)',
              border: `1px solid ${sortKey === k ? 'var(--scanner-accent)' : 'var(--scanner-border2)'}`,
              color: sortKey === k ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
              cursor: 'pointer'
            }}
            onClick={() => setSortKey(k)}>{l}</button>
        ))}
      </div>

      <div className="rounded overflow-hidden" style={{ border: '1px solid var(--scanner-border2)' }}>
        <table className="w-full border-collapse min-w-[1000px]">
          <thead>
            <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
              {['#', 'Theme', 'Score', 'Status', 'N', 'RS 20D', '% >20', '% >50', '% NH20', 'NH52W', '20D Ret', 'Δ'].map(h => (
                <th key={h} className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2.5 px-3 text-left" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const sp = STATUS_PILL[t.status] || STATUS_PILL['NEUTRAL'];
              const isOpen = expanded === t.name;
              return (
                <React.Fragment key={t.name}>
                  <tr
                    style={{ borderBottom: '1px solid var(--scanner-border)', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => setExpanded(isOpen ? null : t.name)}
                  >
                    <td className="py-3 px-3 text-[10px]" style={{ color: 'var(--scanner-text3)' }}>{i + 1}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        {isOpen ? <ChevronDown size={11} color="var(--scanner-accent)" /> : <ChevronRight size={11} color="var(--scanner-text3)" />}
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--scanner-text)' }}>{t.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3"><ScoreBadge score={t.score} /></td>
                    <td className="py-3 px-3">
                      <span className="text-[8.5px] font-bold px-2 py-1" style={{ background: sp.bg, color: sp.text, border: `1px solid ${sp.border}` }}>
                        {t.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[11px]" style={{ color: 'var(--scanner-text3)' }}>{t.memberCount}</td>
                    <td className="py-3 px-3">
                      <span className="tabular-nums text-[11px] font-semibold" style={{ color: t.avg_rs_btc_20d != null ? (t.avg_rs_btc_20d > 0 ? 'var(--scanner-green)' : 'var(--scanner-red)') : 'var(--scanner-text3)' }}>
                        {t.avg_rs_btc_20d != null ? (t.avg_rs_btc_20d >= 0 ? '+' : '') + (t.avg_rs_btc_20d * 100).toFixed(2) + '%' : '—'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[11px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>{t.pctAbove20?.toFixed(0)}%</td>
                    <td className="py-3 px-3 text-[11px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>{t.pctAbove50?.toFixed(0)}%</td>
                    <td className="py-3 px-3 text-[11px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>{t.pctNewHigh?.toFixed(0)}%</td>
                    <td className="py-3 px-3 text-[11px] tabular-nums" style={{ color: t.pctNewHigh52w > 0 ? 'var(--scanner-green)' : 'var(--scanner-text2)' }}>
                      {t.pctNewHigh52w?.toFixed(0)}%
                    </td>
                    <td className="py-3 px-3">
                      <span className="tabular-nums text-[11px] font-semibold" style={{
                        color: t.avgRet20 > 0 ? 'var(--scanner-green)' : t.avgRet20 < 0 ? 'var(--scanner-red)' : 'var(--scanner-text3)'
                      }}>
                        {t.avgRet20 != null ? (t.avgRet20 >= 0 ? '+' : '') + (t.avgRet20 * 100).toFixed(1) + '%' : '—'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[11px] tabular-nums" style={{ color: t.delta > 0 ? 'var(--scanner-green)' : t.delta < 0 ? 'var(--scanner-red)' : 'var(--scanner-text3)' }}>
                      {t.delta >= 0 ? '+' : ''}{t.delta?.toFixed(1)}
                    </td>
                  </tr>
                  {isOpen && constituents[t.name] && (
                    <tr>
                      <td colSpan={12} style={{ background: 'var(--scanner-bg)', padding: 0 }}>
                        <ConstituentTable items={constituents[t.name]} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}