/**
 * Signal.jsx — /signal route
 *
 * Shows STRONG/WEAK/NEUTRAL verdicts for BTC, Majors (ETH/SOL/HYPE), and Cash.
 * Reads pre-computed signal_metrics from snapshot.json (server-side computed).
 *
 * No client-side computation — all math runs in build_snapshot.js via
 * compute_signal_metrics.js (which uses the backtested compute.js module).
 */

import React, { useState, useEffect } from 'react';

const SIGNAL_ENABLED = import.meta.env.VITE_ENABLE_SIGNAL_PAGE === 'true';

function fmtPrice(p) {
  if (p == null || !isFinite(p)) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

function verdictColor(v) {
  if (v === 'STRONG') return 'var(--scanner-green)';
  if (v === 'WEAK') return 'var(--scanner-red)';
  return 'var(--scanner-text3)';
}

function verdictIcon(v) {
  if (v === 'STRONG') return '▲';
  if (v === 'WEAK') return '▼';
  return '▬';
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
      {right != null && <div className="ml-auto">{right}</div>}
    </div>
  );
}

function AssetCard({ symbol, name, verdict, confidence, drivers }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const color = verdictColor(verdict);
  const icon = verdictIcon(verdict);

  const driverLines = [];
  if (drivers) {
    if (drivers.zScore != null) driverLines.push(`Z-Score: ${drivers.zScore > 0 ? '+' : ''}${drivers.zScore}`);
    if (drivers.trendTenure != null) driverLines.push(`Trend Tenure: ${drivers.trendTenure}d`);
    if (drivers.atrExt != null) driverLines.push(`ATR Ext: ${drivers.atrExt > 0 ? '+' : ''}${drivers.atrExt}`);
    if (drivers.rsVsBtc) driverLines.push(`RS vs BTC: ${drivers.rsVsBtc}`);
    if (drivers.fundingZ != null) driverLines.push(`Funding Z: ${drivers.fundingZ > 0 ? '+' : ''}${drivers.fundingZ}`);
    if (drivers.rsi != null) driverLines.push(`RSI: ${drivers.rsi}`);
    if (drivers.macroZ != null) driverLines.push(`Macro Z: ${drivers.macroZ > 0 ? '+' : ''}${drivers.macroZ}`);
  }

  return (
    <div className="rounded p-3" style={{ background: 'var(--scanner-bg1)', border: `1px solid ${color}33` }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-[13px] font-bold" style={{ color: 'var(--scanner-text)' }}>{symbol}</span>
          <span className="text-[8px] ml-1.5" style={{ color: 'var(--scanner-text3)' }}>{name}</span>
        </div>
        <div className="text-right">
          <span className="text-[14px] font-bold" style={{ color }}>{icon} {verdict}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold" style={{ color: 'var(--scanner-text2)' }}>
          Confidence: {confidence}/10
        </span>
        <span
          className="text-[9px] cursor-help"
          style={{ color: 'var(--scanner-text3)', textDecoration: 'underline dotted' }}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >(?)</span>
        {showTooltip && (
          <div className="absolute z-50 p-2 rounded text-[9px] leading-relaxed" style={{
            background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)',
            color: 'var(--scanner-text2)', maxWidth: 220, marginTop: '20px',
          }}>
            {driverLines.map((line, i) => <div key={i}>{line}</div>)}
            {driverLines.length === 0 && <div>No driver data</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function CashAllocation({ verdict, suggestedPct, ultra6Gates, rationale }) {
  const color = verdictColor(verdict);
  return (
    <div className="rounded p-4" style={{ background: 'var(--scanner-bg1)', border: `1px solid ${color}33` }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-[14px] font-bold" style={{ color }}>{verdictIcon(verdict)} {verdict}</span>
          <span className="text-[11px] ml-2" style={{ color: 'var(--scanner-text2)' }}>{suggestedPct}% cash</span>
        </div>
        <div className="text-right">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Ultra6 Gates</span>
          <div className="text-[14px] font-bold" style={{ color: ultra6Gates >= 4 ? 'var(--scanner-green)' : ultra6Gates >= 3 ? 'var(--scanner-text2)' : 'var(--scanner-red)' }}>
            {ultra6Gates}/6
          </div>
        </div>
      </div>
      <div className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>{rationale}</div>
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--scanner-bg2)' }}>
        <div className="h-full rounded-full" style={{ width: `${100 - suggestedPct}%`, background: color }} />
      </div>
    </div>
  );
}

function SignalHistory({ history }) {
  const [expanded, setExpanded] = useState(false);
  if (!history || history.length === 0) return null;

  const recent = expanded ? history.slice(-90).reverse() : history.slice(-7).reverse();

  return (
    <div>
      <SectionLabel right={
        <button onClick={() => setExpanded(!expanded)} className="text-[8px] underline" style={{ color: 'var(--scanner-text3)' }}>
          {expanded ? 'Show Less' : 'Show All'}
        </button>
      }>
        Signal History · {history.length} days
      </SectionLabel>
      <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
        <table className="w-full border-collapse min-w-[400px]">
          <thead>
            <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
              {['Date', 'BTC', 'Majors', 'Cash', '5D Ret', 'Hit'].map(h => (
                <th key={h} className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2 px-3 text-left" style={{ color: 'var(--scanner-text3)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map((h, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--scanner-border)' }}>
                <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--scanner-text2)' }}>{h.date}</td>
                <td className="py-2 px-3 text-[10px] font-semibold" style={{ color: verdictColor(h.btc_verdict) }}>{h.btc_verdict}</td>
                <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--scanner-text2)' }}>{h.majors_strong_count ?? '—'}</td>
                <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--scanner-text2)' }}>{h.cash_pct}%</td>
                <td className="py-2 px-3 text-[10px] tabular-nums" style={{ color: h.btc_5d_return != null ? (h.btc_5d_return >= 0 ? 'var(--scanner-green)' : 'var(--scanner-red)') : 'var(--scanner-text3)' }}>
                  {h.btc_5d_return != null ? `${h.btc_5d_return > 0 ? '+' : ''}${h.btc_5d_return.toFixed(2)}%` : '—'}
                </td>
                <td className="py-2 px-3 text-[10px]" style={{ color: h.btc_5d_hit === true ? 'var(--scanner-green)' : h.btc_5d_hit === false ? 'var(--scanner-red)' : 'var(--scanner-text3)' }}>
                  {h.btc_5d_hit === true ? '✓' : h.btc_5d_hit === false ? '✗' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Signal() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/snapshot.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (!SIGNAL_ENABLED) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono">
        <div className="text-center">
          <div className="text-4xl mb-4 opacity-20">◈</div>
          <div className="text-sm" style={{ color: 'var(--scanner-text2)' }}>Signal page is not enabled</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono">
        <div className="text-[10px] tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Loading signal data…</div>
      </div>
    );
  }

  const sm = data?.signal_metrics;
  const history = data?.signal_history || [];

  if (!sm) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono">
        <div className="text-center">
          <div className="text-4xl mb-4 opacity-20">◈</div>
          <div className="text-sm" style={{ color: 'var(--scanner-text2)' }}>No signal data available yet</div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--scanner-text3)' }}>Signals compute on the next snapshot refresh</div>
        </div>
      </div>
    );
  }

  return (
    <div className="font-mono space-y-6 px-5 md:px-8 py-5 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-bold tracking-[0.05em]" style={{ color: 'var(--scanner-text)' }}>SIGNAL ENGINE</h1>
          <div className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>
            As of {new Date(sm.as_of).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            {sm.is_weekend && <span className="ml-2 opacity-60">(Weekend — TradFi data flat)</span>}
          </div>
        </div>
      </div>

      {/* BTC */}
      <div>
        <SectionLabel>Bitcoin</SectionLabel>
        <AssetCard
          symbol="BTC"
          name="Bitcoin"
          verdict={sm.btc_stance.verdict}
          confidence={sm.btc_stance.confidence}
          drivers={sm.btc_stance.drivers}
        />
      </div>

      {/* Majors */}
      <div>
        <SectionLabel right={
          <span className="text-[9px] font-semibold" style={{ color: 'var(--scanner-text2)' }}>{sm.majors.sector_summary}</span>
        }>
          Majors
        </SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {sm.majors.assets.map(a => (
            <AssetCard
              key={a.symbol}
              symbol={a.symbol}
              name={a.name}
              verdict={a.verdict}
              confidence={a.confidence}
              drivers={a.drivers}
            />
          ))}
        </div>
      </div>

      {/* Cash */}
      <div>
        <SectionLabel>Cash / Stables</SectionLabel>
        <CashAllocation
          verdict={sm.cash_weight.verdict}
          suggestedPct={sm.cash_weight.suggested_pct}
          ultra6Gates={sm.cash_weight.ultra6_gates}
          rationale={sm.cash_weight.rationale}
        />
      </div>

      {/* History */}
      <SignalHistory history={history} />

      {/* Backtest stats (if available) */}
      {history.length >= 10 && (
        <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
          <strong style={{ color: 'var(--scanner-text2)' }}>Backtest reference:</strong>{' '}
          STRONG 62.0% hit rate · WEAK 54.1% hit rate · 10-day forward window · Tuned on 2023-10 to 2025-07 data
        </div>
      )}
    </div>
  );
}
