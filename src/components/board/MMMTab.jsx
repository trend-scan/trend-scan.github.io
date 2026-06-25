import React, { useState } from 'react';
import { getRegimeColor, isMonthEndHold } from '@/lib/board/mmmDashboardEngine';

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
}

function fmtScore(v) {
  if (v == null) return '—';
  return Math.round(v);
}

function ScoreBar({ score, maxScore = 100 }) {
  const pct = Math.min(100, (score / maxScore) * 100);
  const color = score >= 65 ? 'var(--scanner-green)' : score >= 45 ? 'var(--scanner-blue)' : 'var(--scanner-red)';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-sm overflow-hidden" style={{ background: 'var(--scanner-border2)' }}>
        <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold tabular-nums w-8 text-right" style={{ color }}>{score}</span>
    </div>
  );
}

function SignalRow({ signal }) {
  const isOn = signal.on === 1;
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded text-[9px]" style={{
      background: isOn ? 'rgba(0,230,118,0.06)' : 'transparent',
      opacity: isOn ? 1 : 0.5,
    }}>
      <span style={{ color: 'var(--scanner-text2)' }}>{signal.name}</span>
      <span className="font-bold" style={{ color: isOn ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}>
        {isOn ? '● ON' : '○ OFF'}
      </span>
    </div>
  );
}

function DashboardCard({ title, subtitle, score, signals, regime, color }) {
  const onCount = signals.filter(s => s.on === 1).length;
  const total = signals.length;
  return (
    <div className="rounded p-3" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-text3)' }}>{title}</div>
          <div className="text-[8px]" style={{ color: 'var(--scanner-text3)', opacity: 0.7 }}>{subtitle}</div>
        </div>
        <div className="text-right">
          <div className="text-[14px] font-bold" style={{ color }}>{regime}</div>
          <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>{onCount}/{total} signals</div>
        </div>
      </div>
      <ScoreBar score={score} />
      <div className="mt-2 space-y-0.5">
        {signals.slice(0, 6).map((s, i) => (
          <SignalRow key={i} signal={s} />
        ))}
        {signals.length > 6 && (
          <div className="text-[8px] text-center py-1" style={{ color: 'var(--scanner-text3)' }}>
            +{signals.length - 6} more signals
          </div>
        )}
      </div>
    </div>
  );
}

function RegimeBadge({ label, confidence }) {
  const color = getRegimeColor(label);
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
      <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: color }} />
      <span className="text-[11px] font-bold" style={{ color }}>{label}</span>
      <span className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
        {(confidence * 100).toFixed(0)}% confidence
      </span>
    </div>
  );
}

function TOTAL3ESCard({ total3es }) {
  const { ultra6, core8, core9, ob1, master, tier } = total3es;

  return (
    <div className="rounded p-3" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-accent)' }}>TOTAL3ES Allocation</div>
          <div className="text-[8px]" style={{ color: 'var(--scanner-text3)', opacity: 0.7 }}>Crypto regime signals</div>
        </div>
        <div className={`text-[12px] font-bold px-2 py-1 rounded ${master ? 'bg-green-900/30' : ''}`}
          style={{ color: master ? 'var(--scanner-green)' : 'var(--scanner-text2)' }}>
          {tier}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <SignalIndicator label="Ultra6" count={ultra6.onCount} total={6} isOn={ultra6.isOn} score={ultra6.score} />
        <SignalIndicator label="Core8" count={core8.onCount} total={8} isOn={core8.isOn} score={core8.score} />
        <SignalIndicator label="Core9" count={core9.onCount} total={9} isOn={core9.isOn} score={core9.score} />
        <SignalIndicator label="OB1" count={ob1.onCount} total={6} isOn={ob1.isOn} score={ob1.score} />
      </div>

      <div className="border-t pt-2" style={{ borderColor: 'var(--scanner-border2)' }}>
        <div className="text-[8px] font-bold tracking-[0.1em] uppercase mb-1" style={{ color: 'var(--scanner-text3)' }}>
          Master Rule: Ultra6 ON AND OB1 ON
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: ultra6.isOn ? 'var(--scanner-green)' : 'var(--scanner-red)' }}>
            Ultra6 {ultra6.isOn ? '✓' : '✗'}
          </span>
          <span style={{ color: 'var(--scanner-text3)' }}>AND</span>
          <span className="text-[11px]" style={{ color: ob1.isOn ? 'var(--scanner-green)' : 'var(--scanner-red)' }}>
            OB1 {ob1.isOn ? '✓' : '✗'}
          </span>
          <span style={{ color: 'var(--scanner-text3)' }}>=</span>
          <span className="text-[11px] font-bold" style={{ color: master ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}>
            {master ? 'FULL ALLOCATION' : 'REDUCED'}
          </span>
        </div>
      </div>
    </div>
  );
}

function SignalIndicator({ label, count, total, isOn, score }) {
  return (
    <div className="p-2 rounded" style={{ background: isOn ? 'rgba(0,230,118,0.06)' : 'transparent', border: '1px solid var(--scanner-border2)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] font-bold" style={{ color: 'var(--scanner-text3)' }}>{label}</span>
        <span className={`text-[10px] font-bold ${isOn ? 'text-green-400' : ''}`} style={{ color: isOn ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}>
          {count}/{total}
        </span>
      </div>
      <ScoreBar score={score} maxScore={100} />
    </div>
  );
}

export default function MMMTab({ mmmData, isLoading }) {
  const [activeTab, setActiveTab] = useState('overview');
  const monthEnd = isMonthEndHold();

  if (isLoading) {
    return (
      <div className="font-mono text-center py-20 px-5">
        <div className="text-3xl mb-4 animate-pulse opacity-30">◈</div>
        <div className="text-sm mb-1" style={{ color: 'var(--scanner-text2)' }}>Computing MMM Regime Dashboard...</div>
        <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>Adaptive Z-Score Framework · 8-Regime Classifier</div>
      </div>
    );
  }

  if (!mmmData) {
    return (
      <div className="font-mono text-center py-20 px-5">
        <div className="text-3xl mb-4 opacity-20">◈</div>
        <div className="text-sm mb-1" style={{ color: 'var(--scanner-text2)' }}>MMM Regime Data Unavailable</div>
        <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>Click Refresh on the board to compute regimes</div>
      </div>
    );
  }

  const { growth, inflation, liquidity, regime, total3es, timestamp } = mmmData;

  return (
    <div className="font-mono px-5 md:px-8 py-5 space-y-5">

      {/* Header with regime badge and month-end indicator */}
      <section className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[9px] font-bold tracking-[0.2em] uppercase" style={{ color: 'var(--scanner-accent)' }}>
            MMM Macro Regime Suite
          </div>
          <RegimeBadge label={regime.label} confidence={regime.confidence} />
          {monthEnd && (
            <div className="px-2 py-1 rounded text-[8px] font-bold tracking-wider" style={{
              background: 'rgba(240,165,0,0.15)',
              color: 'var(--scanner-accent)',
              border: '1px solid rgba(240,165,0,0.3)',
            }}>
              MONTH-END HOLD
            </div>
          )}
        </div>
        <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
          Updated: {new Date(timestamp).toLocaleString()}
        </div>
      </section>

      {/* Regime Dimensions Summary */}
      <section className="grid grid-cols-3 gap-3">
        <div className="rounded p-3 text-center" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
          <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: 'var(--scanner-text3)' }}>Growth</div>
          <div className="text-[16px] font-bold" style={{ color: getRegimeColor(growth.regime) }}>{growth.regime}</div>
          <div className="text-[9px] mt-1" style={{ color: 'var(--scanner-text2)' }}>{growth.compositeScore}/100</div>
        </div>
        <div className="rounded p-3 text-center" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
          <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: 'var(--scanner-text3)' }}>Inflation</div>
          <div className="text-[16px] font-bold" style={{ color: inflation.regime === 'Hot' ? 'var(--scanner-red)' : inflation.regime === 'Reflation' ? 'var(--scanner-accent)' : 'var(--scanner-blue)' }}>{inflation.regime}</div>
          <div className="text-[9px] mt-1" style={{ color: 'var(--scanner-text2)' }}>{inflation.compositeScore}/100</div>
        </div>
        <div className="rounded p-3 text-center" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
          <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: 'var(--scanner-text2)' }}>Liquidity</div>
          <div className="text-[16px] font-bold" style={{ color: liquidity.regime === 'Loose' ? 'var(--scanner-green)' : liquidity.regime === 'Tight' ? 'var(--scanner-red)' : 'var(--scanner-text2)' }}>{liquidity.regime}</div>
          <div className="text-[9px] mt-1" style={{ color: 'var(--scanner-text2)' }}>{liquidity.compositeScore}/100</div>
        </div>
      </section>

      {/* Tab Navigation */}
      <section className="flex items-center gap-1">
        {['overview', 'growth', 'inflation', 'liquidity', 'crypto'].map(tab => (
          <button key={tab}
            className="font-mono text-[9px] font-bold px-3 py-1.5 uppercase tracking-wider"
            style={{
              background: activeTab === tab ? 'rgba(240,165,0,0.12)' : 'transparent',
              color: activeTab === tab ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
              borderBottom: activeTab === tab ? '2px solid var(--scanner-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </section>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <DashboardCard
              title="Growth Dashboard"
              subtitle="15 proxy signals"
              score={growth.compositeScore}
              signals={growth.signals}
              regime={growth.regime}
              color="var(--scanner-green)"
            />
            <DashboardCard
              title="Inflation Dashboard"
              subtitle="13 proxy signals"
              score={inflation.compositeScore}
              signals={inflation.signals}
              regime={inflation.regime}
              color={inflation.regime === 'Hot' ? 'var(--scanner-red)' : 'var(--scanner-accent)'}
            />
            <DashboardCard
              title="Liquidity Dashboard"
              subtitle="7 proxy signals"
              score={liquidity.compositeScore}
              signals={liquidity.signals}
              regime={liquidity.regime}
              color={liquidity.regime === 'Loose' ? 'var(--scanner-green)' : liquidity.regime === 'Tight' ? 'var(--scanner-red)' : 'var(--scanner-blue)'}
            />
          </div>
          <TOTAL3ESCard total3es={total3es} />
        </section>
      )}

      {activeTab === 'growth' && (
        <section className="rounded p-4" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-green)' }}>Growth Dashboard</div>
              <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>15 proxy signals · Market-implied growth regime</div>
            </div>
            <ScoreBar score={growth.compositeScore} />
          </div>
          <div className="space-y-1">
            {growth.signals.map((s, i) => (
              <SignalRow key={i} signal={s} />
            ))}
          </div>
        </section>
      )}

      {activeTab === 'inflation' && (
        <section className="rounded p-4" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-accent)' }}>Inflation Dashboard</div>
              <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>13 proxy signals · Bond/commodity implied inflation</div>
            </div>
            <ScoreBar score={inflation.compositeScore} />
          </div>
          <div className="space-y-1">
            {inflation.signals.map((s, i) => (
              <SignalRow key={i} signal={s} />
            ))}
          </div>
        </section>
      )}

      {activeTab === 'liquidity' && (
        <section className="rounded p-4" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-blue)' }}>Liquidity Dashboard</div>
              <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>7 proxy signals · Risk-on/risk-off regime</div>
            </div>
            <ScoreBar score={liquidity.compositeScore} />
          </div>
          <div className="space-y-1">
            {liquidity.signals.map((s, i) => (
              <SignalRow key={i} signal={s} />
            ))}
          </div>
        </section>
      )}

      {activeTab === 'crypto' && (
        <section className="space-y-4">
          <TOTAL3ESCard total3es={total3es} />

          {/* Detailed Crypto Signals */}
          <div className="rounded p-4" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
            <div className="text-[10px] font-bold tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--scanner-accent)' }}>
              Ultra6 Signal Breakdown
            </div>
            <div className="space-y-1">
              {total3es.ultra6.signals.map((s, i) => (
                <SignalRow key={i} signal={s} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Footer with methodology note */}
      <section className="text-[7px] leading-relaxed" style={{ color: 'var(--scanner-text3)', opacity: 0.6 }}>
        <strong>Methodology:</strong> Adaptive Z-Score (60% short-term / 40% long-term, 104/260 bar lookback) · Month-End Hold for regime stability ·
        0-100 Nowcast conversion (z→50+(z×10)) · 8-Regime Classifier (Growth × Inflation × Liquidity) ·
        NO FRED data · Market-implied signals only via Massive API + Kraken xStocks
      </section>
    </div>
  );
}
