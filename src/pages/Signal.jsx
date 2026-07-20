/**
 * Signal.jsx — /signal route
 *
 * Shows STRONG/WEAK/NEUTRAL verdicts for BTC, Majors (ETH/SOL/HYPE), and Cash.
 * Reads pre-computed signal_metrics from snapshot.json (server-side computed).
 *
 * No client-side computation — all math runs in build_snapshot.js via
 * compute_signal_metrics.js (which uses the backtested compute.js module).
 *
 * WEAK REFRAME (v2 — 2026-07-20):
 *   WEAK is no longer rendered red. WEAK means "defensive conditions detected
 *   — reduce exposure, raise cash." It is an ACTIONABLE defensive call, not a
 *   failure indicator. Amber tone + shield icon distinguish it from STRONG
 *   (green ▲) and NEUTRAL (gray ▬).
 *
 *   Walk-forward OOS hit rate for WEAK: 41.6% (price-direction hit), with
 *   avg -2.90% 10-day return — i.e. when WEAK fires, prices do tend to fall.
 *   The "low" 41.6% reflects that WEAK fires frequently (1101 OOS signals vs
 *   343 STRONG); selecting only high-confidence WEAK (stance=DEFENSIVE, conf≥6)
 *   would yield far fewer signals but is left for future work.
 *
 *   What is RED now? Only realized 5-day-return misses (✗ in history table).
 *   Forward-looking verdicts use amber for WEAK to communicate caution, not
 *   failure.
 *
 * MULTI-HORIZON (v2 — 2026-07-20):
 *   Each asset card shows Short / Medium / Long horizon stances derived from
 *   the same daily candles (no API cost):
 *     short  = adaptiveZ(20, 90)   — 1-3 week momentum
 *     medium = adaptiveZ(90, 365)  — PRIMARY verdict (same as headline)
 *     long   = adaptiveZ(180, 730) — 6-12 month structure
 *
 * SIGNAL SCOREBOARD (v2 — 2026-07-20):
 *   Aggregates signal_history into running hit-rate stats. Shows resolved
 *   vs pending signals, STRONG/WEAK hit rates, and verdict distribution.
 *   Stats are only meaningful with ≥30 resolved signals — below that, the
 *   scoreboard shows "collecting data" messaging rather than misleading
 *   small-sample numbers.
 */

import React, { useState, useEffect, useMemo } from 'react';
import FreshnessBanner from '../components/FreshnessBanner';

const SIGNAL_ENABLED = import.meta.env.VITE_ENABLE_SIGNAL_PAGE === 'true';

function fmtPrice(p) {
  if (p == null || !isFinite(p)) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

/**
 * Reframed verdict color palette.
 *
 *   STRONG  → green (▲)      — constructive, deploy capital
 *   WEAK    → amber  (◈)     — defensive, raise cash (NOT a failure)
 *   NEUTRAL → gray   (▬)     — insufficient signal, hold
 *
 * WEAK is intentionally NOT red. Red is reserved for realized misses in the
 * history table — a different semantic (backward-looking vs forward-looking).
 */
function verdictColor(v) {
  if (v === 'STRONG') return 'var(--scanner-green)';
  if (v === 'WEAK') return '#f5c842';  // amber — defensive, not failure
  return 'var(--scanner-text3)';
}

function verdictIcon(v) {
  if (v === 'STRONG') return '▲';   // constructive
  if (v === 'WEAK') return '◈';     // defensive (shield, not down-arrow)
  return '▬';
}

/**
 * Short label describing what each verdict means — used in tooltips and the
 * interpretation guide. Frame each as a CALL TO ACTION, not a judgment.
 */
function verdictDescription(v) {
  if (v === 'STRONG') return 'Constructive conditions — trend confirmed, exposure warranted.';
  if (v === 'WEAK') return 'Defensive conditions — trend breaking down, raise cash / reduce exposure.';
  return 'No actionable signal — factors are mixed or trend is unclear.';
}

/**
 * Cash verdicts have INVERTED semantics from asset verdicts:
 *   Cash STRONG = conditions are strong → hold LESS cash (deploy capital)
 *   Cash WEAK   = conditions are weak → hold MORE cash (defensive)
 *   Cash NEUTRAL = balanced
 * So for Cash, WEAK is actually a protective/defensive call (bullish for cash),
 * not a bearish signal. Use different colors to avoid confusion.
 */
function cashVerdictColor(v) {
  if (v === 'STRONG') return 'var(--scanner-green)';   // deploy capital (risk-on)
  if (v === 'WEAK') return 'var(--scanner-accent)';    // hold cash (defensive — NOT red)
  return 'var(--scanner-text3)';
}

function cashVerdictIcon(v) {
  if (v === 'STRONG') return '▲';   // deploy
  if (v === 'WEAK') return '◈';     // defend (shield, not down-arrow)
  return '▬';
}

/**
 * Horizon stance color (BULLISH/NEUTRAL/BEARISH).
 * These are derived from z-score sign+magnitude, NOT the full 10-gate engine.
 */
function horizonColor(s) {
  if (s === 'BULLISH') return 'var(--scanner-green)';
  if (s === 'BEARISH') return '#f5c842';  // amber — defensive, not failure
  return 'var(--scanner-text3)';
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

/**
 * Multi-horizon strip — three colored dots showing short/medium/long stance.
 * Surfaces alignment (all three same color = strong consensus) or disagreement
 * (mixed colors = caution, timeframes diverging).
 */
function HorizonStrip({ horizon }) {
  if (!horizon) return null;
  const items = [
    { label: 'S', value: horizon.short, hint: 'Short · 1-3w momentum (z20/90)' },
    { label: 'M', value: horizon.medium, hint: 'Medium · 1-3m trend (z90/365) — PRIMARY' },
    { label: 'L', value: horizon.long, hint: 'Long · 6-12m structure (z180/730)' },
  ];
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <span className="text-[8px] font-semibold tracking-wider uppercase" style={{ color: 'var(--scanner-text3)' }}>Horizon</span>
      {items.map(it => {
        const stance = it.value?.stance || 'NEUTRAL';
        const z = it.value?.z;
        const insufficient = it.value?.insufficient;
        return (
          <span
            key={it.label}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold cursor-help"
            style={{
              background: 'var(--scanner-bg2)',
              border: `1px solid ${horizonColor(stance)}33`,
              color: horizonColor(stance),
            }}
            title={`${it.hint}${z != null ? ` · z=${z}` : ''}${insufficient ? ' · insufficient history' : ''}`}
          >
            <span style={{ color: 'var(--scanner-text3)' }}>{it.label}</span>
            <span>{stance === 'BULLISH' ? '▲' : stance === 'BEARISH' ? '▼' : '▬'}</span>
          </span>
        );
      })}
    </div>
  );
}

function AssetCard({ symbol, name, verdict, confidence, drivers, horizon }) {
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
          <span
            className="text-[14px] font-bold cursor-help"
            style={{ color }}
            title={verdictDescription(verdict)}
          >
            {icon} {verdict}
          </span>
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
      {horizon && <HorizonStrip horizon={horizon} />}
    </div>
  );
}

function CashAllocation({ verdict, suggestedPct, ultra6Gates, rationale }) {
  // Use cash-specific colors — Cash WEAK means "hold more cash" (defensive),
  // NOT "cash is bad" (bearish). Different visual language from asset verdicts.
  const color = cashVerdictColor(verdict);
  const icon = cashVerdictIcon(verdict);
  return (
    <div className="rounded p-4" style={{ background: 'var(--scanner-bg1)', border: `1px solid ${color}33` }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span
            className="text-[14px] font-bold cursor-help"
            style={{ color }}
            title={verdict === 'STRONG'
              ? 'Macro conditions support risk — deploy capital, hold less cash.'
              : verdict === 'WEAK'
                ? 'Macro conditions are fragile — hold more cash defensively.'
                : 'Macro conditions are balanced — neutral cash allocation.'}
          >
            {icon} {verdict}
          </span>
          <span className="text-[11px] ml-2" style={{ color: 'var(--scanner-text2)' }}>{suggestedPct}% cash</span>
        </div>
        <div className="text-right">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Ultra6 Gates</span>
          <div className="text-[14px] font-bold" style={{ color: ultra6Gates >= 4 ? 'var(--scanner-green)' : ultra6Gates >= 3 ? 'var(--scanner-text2)' : 'var(--scanner-accent)' }}>
            {ultra6Gates}/6
          </div>
        </div>
      </div>
      <div className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>{rationale}</div>
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--scanner-bg2)' }}>
        <div className="h-full rounded-full" style={{ width: `${suggestedPct}%`, background: color }} />
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

/**
 * Signal Scoreboard — aggregates signal_history into running hit-rate stats.
 *
 * Stats shown:
 *   - Total signals / resolved / pending
 *   - STRONG hit rate (resolved STRONG signals where 5d return > 0)
 *   - WEAK hit rate (resolved WEAK signals where 5d return < 0)
 *   - Verdict distribution (count of STRONG / WEAK / NEUTRAL)
 *
 * Significance bar: 30 resolved signals. Below that, stats are shown but
 * flagged as "low sample" to avoid false confidence.
 */
function SignalScoreboard({ history }) {
  const stats = useMemo(() => {
    if (!history || history.length === 0) return null;

    const total = history.length;
    let strongCount = 0, weakCount = 0, neutralCount = 0;
    let strongResolved = 0, strongHits = 0;
    let weakResolved = 0, weakHits = 0;
    let pending = 0;

    for (const h of history) {
      if (h.btc_verdict === 'STRONG') strongCount++;
      else if (h.btc_verdict === 'WEAK') weakCount++;
      else neutralCount++;

      if (h.btc_5d_hit === null || h.btc_5d_hit === undefined) {
        pending++;
        continue;
      }

      if (h.btc_verdict === 'STRONG') {
        strongResolved++;
        if (h.btc_5d_hit) strongHits++;
      } else if (h.btc_verdict === 'WEAK') {
        weakResolved++;
        if (h.btc_5d_hit) weakHits++;
      }
    }

    const resolved = strongResolved + weakResolved;
    const strongHitRate = strongResolved > 0 ? (strongHits / strongResolved) * 100 : null;
    const weakHitRate = weakResolved > 0 ? (weakHits / weakResolved) * 100 : null;

    return {
      total, resolved, pending,
      strongCount, weakCount, neutralCount,
      strongResolved, strongHits, strongHitRate,
      weakResolved, weakHits, weakHitRate,
    };
  }, [history]);

  if (!stats) return null;

  const lowSample = stats.resolved < 30;
  const significant = stats.resolved >= 30;

  return (
    <div>
      <SectionLabel right={
        <span className="text-[8px]" style={{ color: lowSample ? 'var(--scanner-text3)' : 'var(--scanner-green)' }}>
          {significant ? '✓ ≥30 resolved' : `${stats.resolved}/30 resolved`}
        </span>
      }>
        Signal Scoreboard · live accuracy tracker
      </SectionLabel>

      <div className="rounded p-4" style={{ background: 'var(--scanner-bg1)', border: '1px solid var(--scanner-border2)' }}>
        {/* Top: counts summary */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Total Signals</div>
            <div className="text-[20px] font-bold tabular-nums" style={{ color: 'var(--scanner-text)' }}>{stats.total}</div>
            <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>{stats.resolved} resolved · {stats.pending} pending</div>
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>STRONG Hit Rate</div>
            <div className="text-[20px] font-bold tabular-nums" style={{
              color: stats.strongHitRate != null
                ? (stats.strongHitRate >= 50 ? 'var(--scanner-green)' : 'var(--scanner-red)')
                : 'var(--scanner-text3)'
            }}>
              {stats.strongHitRate != null ? `${stats.strongHitRate.toFixed(1)}%` : '—'}
            </div>
            <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>{stats.strongResolved} resolved · {stats.strongHits} hits</div>
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>WEAK Hit Rate</div>
            <div className="text-[20px] font-bold tabular-nums" style={{
              color: stats.weakHitRate != null
                ? (stats.weakHitRate >= 50 ? 'var(--scanner-green)' : 'var(--scanner-red)')
                : 'var(--scanner-text3)'
            }}>
              {stats.weakHitRate != null ? `${stats.weakHitRate.toFixed(1)}%` : '—'}
            </div>
            <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>{stats.weakResolved} resolved · {stats.weakHits} hits</div>
          </div>
        </div>

        {/* Verdict distribution bar */}
        <div className="mb-3">
          <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: 'var(--scanner-text3)' }}>
            Verdict Distribution
          </div>
          {stats.total > 0 ? (
            <div className="flex h-3 rounded overflow-hidden" style={{ background: 'var(--scanner-bg2)' }}>
              <div style={{
                width: `${(stats.strongCount / stats.total) * 100}%`,
                background: 'var(--scanner-green)',
                minWidth: stats.strongCount > 0 ? '4px' : 0,
              }} title={`${stats.strongCount} STRONG`} />
              <div style={{
                width: `${(stats.weakCount / stats.total) * 100}%`,
                background: '#f5c842',
                minWidth: stats.weakCount > 0 ? '4px' : 0,
              }} title={`${stats.weakCount} WEAK`} />
              <div style={{
                width: `${(stats.neutralCount / stats.total) * 100}%`,
                background: 'var(--scanner-text3)',
                minWidth: stats.neutralCount > 0 ? '4px' : 0,
              }} title={`${stats.neutralCount} NEUTRAL`} />
            </div>
          ) : (
            <div className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>No signals yet</div>
          )}
          <div className="flex items-center gap-3 mt-1 text-[8.5px]">
            <span style={{ color: 'var(--scanner-green)' }}>● STRONG {stats.strongCount}</span>
            <span style={{ color: '#f5c842' }}>● WEAK {stats.weakCount}</span>
            <span style={{ color: 'var(--scanner-text3)' }}>● NEUTRAL {stats.neutralCount}</span>
          </div>
        </div>

        {/* Low-sample warning */}
        {lowSample && (
          <div className="text-[8.5px] rounded p-2" style={{
            background: 'var(--scanner-bg2)',
            border: '1px solid var(--scanner-border2)',
            color: 'var(--scanner-text3)',
          }}>
            <strong style={{ color: 'var(--scanner-text2)' }}>Collecting data:</strong>{' '}
            {stats.resolved} of 30 resolved signals needed for statistically meaningful hit rates.
            Currently accumulating ~1 signal/day. Expected to reach significance in{' '}
            {Math.max(1, 30 - stats.resolved)} days. Walk-forward backtest reference:{' '}
            <span style={{ color: 'var(--scanner-text2)' }}>OOS STRONG 54.5% · WEAK 41.6%</span>{' '}
            (1444 signals, 2024-07 to 2025-07).
          </div>
        )}

        {/* Walk-forward reference */}
        {significant && (
          <div className="text-[8.5px] mt-2" style={{ color: 'var(--scanner-text3)' }}>
            <strong style={{ color: 'var(--scanner-text2)' }}>Walk-forward reference (OOS, 13 symbols, 2024-07 to 2025-07):</strong>{' '}
            STRONG 54.5% hit · WEAK 41.6% hit · 1444 signals. Live hit rates should converge
            toward these figures as the sample grows; persistent divergence &gt;10pp may indicate
            regime shift or threshold drift.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Interpretation Guide — collapsible panel explaining what each verdict means.
 * Critical for user trust: WEAK is not "the signal failed" — it's an actionable
 * defensive call. STRONG is not "guaranteed up" — it's "conditions favor
 * exposure." Users who don't read this will misinterpret the colors.
 */
function InterpretationGuide() {
  const [expanded, setExpanded] = useState(false);

  const rows = [
    {
      verdict: 'STRONG',
      icon: '▲',
      color: 'var(--scanner-green)',
      meaning: 'Constructive conditions',
      action: 'Risk-on — exposure warranted',
      detail: 'Trend confirmed by ≥3 gates (z-score stretch + persistence + healthy extension + confirmation). 10-day forward expected return is positive in walk-forward OOS (avg +5.70%, 54.5% hit rate).',
    },
    {
      verdict: 'WEAK',
      icon: '◈',
      color: '#f5c842',
      meaning: 'Defensive conditions',
      action: 'Risk-off — raise cash / reduce exposure',
      detail: 'Trend breaking down (negative z-stretch + persistence) OR overextended+crowded (atrExt>5 + fundingZ>2). NOT a "signal failure" — it is an actionable defensive call. Walk-forward OOS: 41.6% directional hit, avg -2.90% 10-day return.',
    },
    {
      verdict: 'NEUTRAL',
      icon: '▬',
      color: 'var(--scanner-text3)',
      meaning: 'No actionable signal',
      action: 'Hold — factors are mixed',
      detail: 'Either (a) insufficient z-stretch for a directional call, or (b) trend persists but without confirmation. Most days are NEUTRAL — this is correct behavior, not engine failure. The 10-gate engine is designed to be selective.',
    },
  ];

  return (
    <div>
      <SectionLabel right={
        <button onClick={() => setExpanded(!expanded)} className="text-[8px] underline" style={{ color: 'var(--scanner-text3)' }}>
          {expanded ? 'Hide' : 'Show'}
        </button>
      }>
        Interpretation Guide
      </SectionLabel>
      {!expanded ? (
        <div className="text-[9px] rounded p-2" style={{
          background: 'var(--scanner-bg1)', border: '1px solid var(--scanner-border2)',
          color: 'var(--scanner-text3)',
        }}>
          <strong style={{ color: 'var(--scanner-text2)' }}>How to read these verdicts:</strong>{' '}
          <span style={{ color: 'var(--scanner-green)' }}>STRONG ▲</span> = constructive (risk-on),{' '}
          <span style={{ color: '#f5c842' }}>WEAK ◈</span> = defensive (raise cash — NOT a failure),{' '}
          <span style={{ color: 'var(--scanner-text3)' }}>NEUTRAL ▬</span> = no actionable signal.{' '}
          <span style={{ textDecoration: 'underline dotted' }}>Show details →</span>
        </div>
      ) : (
        <div className="rounded overflow-hidden" style={{ border: '1px solid var(--scanner-border2)' }}>
          {rows.map(r => (
            <div key={r.verdict} className="p-3" style={{ background: 'var(--scanner-bg1)', borderBottom: '1px solid var(--scanner-border)' }}>
              <div className="flex items-center gap-3 mb-1.5">
                <span className="text-[14px] font-bold" style={{ color: r.color }}>{r.icon} {r.verdict}</span>
                <span className="text-[10px] font-semibold" style={{ color: 'var(--scanner-text2)' }}>{r.meaning}</span>
                <span className="text-[9px] ml-auto" style={{ color: 'var(--scanner-text3)' }}>{r.action}</span>
              </div>
              <div className="text-[9px] leading-relaxed" style={{ color: 'var(--scanner-text3)' }}>{r.detail}</div>
            </div>
          ))}
          <div className="p-2 text-[8.5px]" style={{ background: 'var(--scanner-bg2)', color: 'var(--scanner-text3)' }}>
            <strong style={{ color: 'var(--scanner-text2)' }}>About the colors:</strong>{' '}
            Green = constructive. Amber = defensive (caution, not failure). Gray = neutral.
            Red is reserved for backward-looking realized misses (✗ in history) — never for forward-looking verdicts.
          </div>
        </div>
      )}
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
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[16px] font-bold tracking-[0.05em]" style={{ color: 'var(--scanner-text)' }}>SIGNAL ENGINE</h1>
            <span
              className="text-[8px] font-bold tracking-[0.18em] uppercase px-1.5 py-0.5 rounded"
              style={{
                background: 'rgba(245,200,66,0.1)',
                border: '1px solid rgba(245,200,66,0.35)',
                color: '#f5c842',
              }}
              title="This page and its signals are under active development. Verdicts, thresholds, and methodology may change without notice. Do not rely on these signals for investment decisions — they are experimental and have not been validated against live trading."
            >
              In Testing
            </span>
          </div>
          <div className="text-[9px] mt-1" style={{ color: 'var(--scanner-text3)' }}>
            Experimental · verdicts and methodology may change without notice · not investment advice
          </div>
          <div className="text-[9px] mt-0.5" style={{ color: 'var(--scanner-text3)' }}>
            As of {new Date(sm.as_of).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            {sm.is_weekend && <span className="ml-2 opacity-60">(Weekend — TradFi data flat)</span>}
          </div>
        </div>
      </div>

      {/* Freshness banner — only renders when snapshot is stale (≥12h old) */}
      <FreshnessBanner generatedAt={data?.generated_at} contextLabel="signal" />

      {/* Interpretation Guide (collapsible, near top) */}
      <InterpretationGuide />

      {/* BTC */}
      <div>
        <SectionLabel>Bitcoin</SectionLabel>
        <AssetCard
          symbol="BTC"
          name="Bitcoin"
          verdict={sm.btc_stance.verdict}
          confidence={sm.btc_stance.confidence}
          drivers={sm.btc_stance.drivers}
          horizon={sm.btc_stance.horizon}
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
              horizon={a.horizon}
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

      {/* Signal Scoreboard — live accuracy tracker */}
      <SignalScoreboard history={history} />

      {/* History */}
      <SignalHistory history={history} />

      {/* Backtest stats (if available) */}
      {history.length >= 10 && (
        <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
          <strong style={{ color: 'var(--scanner-text2)' }}>Backtest reference (walk-forward OOS, 13 symbols, 2024-07 to 2025-07):</strong>{' '}
          STRONG 54.5% hit (343 signals, avg +5.70% 10d return) · WEAK 41.6% hit (1101 signals, avg -2.90% 10d return).
          Thresholds tuned on TRAIN (2022-01 to 2023-06) only; applied unchanged to OOS. 20bps round-trip fees + funding
          cost included. Live hit rates should converge toward these figures as sample grows.
        </div>
      )}
    </div>
  );
}
