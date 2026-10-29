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
 *   What is RED now? Only realized directional misses (✗ in history table) —
 *   i.e. STRONG signals where BTC fell, or WEAK signals where BTC rose.
 *   NEUTRAL resolved signals show '·' (gray, no call made — correctly silent).
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
 *
 * TASK 36 S1/S2 (2026-10-29): the macroZ confidence boost was removed and the
 *   STRONG threshold raised 8 → 9 after 15 months of true OOS showed the old
 *   config inverted (41.9% hit / -0.60% avg vs 47.9% / +0.50% NEUTRAL baseline).
 *   Replaying the modified engine on the same window: 47.4% / +1.05% (n=154;
 *   in-sample improved to 66.1% / +7.07%), 113 old STRONGs demoted with zero
 *   promotions. Reference texts below cite the post-fix figures.
 *
 * TASK 36 S3: asset cards + history rows now show "Day N" run age; day-4+
 *   STRONGs are visually de-emphasized (OOS: 33.6% hit vs ~50% days 1-3).
 *
 * TASK 36 S5: 5-day exits are finalized from completed daily candles only
 *   (btc_5d_finalized) — the old partial-candle exits are re-finalized in
 *   place on the next refresh.
 *
 * TASK 36 S6: history persists per-asset ETH/SOL/HYPE verdicts (majors_verdicts)
 *   and keeps 365 days instead of 90.
 */

import React, { useState, useEffect, useMemo } from 'react';
import FreshnessBanner from '../components/FreshnessBanner';
import { SignalHitRateTable } from '../components/board/SMBFeatures';
import { useSnapshot, clearSnapshotCache } from '../hooks/useSnapshot';

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
 * WEAK is intentionally NOT red. Red is reserved for realized directional
 * misses (✗) in the history table — STRONG calls where BTC fell, or WEAK
 * calls where BTC rose. NEUTRAL resolved signals show '·' (gray, no call).
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
    <div className="flex items-center gap-1 mt-2 flex-wrap">
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

function AssetCard({ symbol, name, verdict, confidence, drivers, horizon, runDay }) {
  const [showDetails, setShowDetails] = useState(false);
  const color = verdictColor(verdict);
  const icon = verdictIcon(verdict);

  // Run-age (Task 36 S3): day-4+ STRONGs decayed hard OOS (33.6% hit /
  // -1.90% avg vs ~50% / ~+1% days 1-3) — visually de-emphasize stale runs.
  const staleRun = verdict === 'STRONG' && runDay != null && runDay >= 4;
  const chipOpacity = staleRun ? 0.55 : 1;

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
    <div className="rounded p-2 sm:p-3" style={{ background: 'var(--scanner-bg1)', border: `1px solid ${color}33` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13px] font-bold" style={{ color: 'var(--scanner-text)' }}>{symbol}</span>
          <span className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>{name}</span>
        </div>
        <span
          className="text-[14px] font-bold cursor-help"
          style={{ color, opacity: chipOpacity }}
          title={verdictDescription(verdict) + (staleRun
            ? ` — NOTE: day ${runDay} of this run. OOS STRONG run days 4+ hit 33.6% vs ~50% days 1-3.`
            : '')}
        >
          {icon} {verdict}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold" style={{ color: 'var(--scanner-text2)' }}>
          Confidence: {confidence}/10
        </span>
        {runDay != null && verdict !== 'NEUTRAL' && (
          <span
            className="text-[8.5px] font-bold px-1.5 py-0.5 rounded cursor-help"
            style={{
              background: 'var(--scanner-bg2)',
              border: `1px solid ${staleRun ? 'var(--scanner-border2)' : `${color}44`}`,
              color: staleRun ? 'var(--scanner-text3)' : color,
              opacity: staleRun ? 0.75 : 1,
            }}
            title={runDay === 1
              ? 'Day 1 of this verdict run (verdict changed from yesterday)'
              : `Day ${runDay} of this ${verdict} run (consecutive days with the same verdict).`
                + (staleRun
                  ? ' Out-of-sample, STRONG run days 4+ hit 33.6% (vs ~50% days 1-3) — treat stale-run STRONGs with reduced conviction.'
                  : '')}
          >
            {staleRun ? '⏳ ' : ''}Day {runDay}
          </span>
        )}
        <button
          className="text-[9px] cursor-pointer"
          style={{ color: 'var(--scanner-text3)', textDecoration: 'underline dotted', background: 'none', border: 'none', padding: 0 }}
          onClick={() => setShowDetails(true)}
        >
          (?)
        </button>
      </div>
      {horizon && <HorizonStrip horizon={horizon} />}

      {/* Click-to-open details popup */}
      {showDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setShowDetails(false)}
        >
          <div
            className="relative rounded-lg p-4"
            style={{
              background: 'var(--scanner-bg2)',
              border: '1px solid var(--scanner-border2)',
              color: 'var(--scanner-text2)',
              maxWidth: 360,
              width: '90vw',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setShowDetails(false)}
              className="absolute top-2 right-2 text-[16px] leading-none"
              style={{ color: 'var(--scanner-text3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
              aria-label="Close"
            >
              ×
            </button>
            {/* Header */}
            <div className="text-[12px] font-bold mb-3" style={{ color: 'var(--scanner-text)' }}>
              {symbol} · {name}
            </div>
            {/* Verdict + confidence */}
            <div className="text-[10px] mb-3" style={{ color }}>
              Verdict: {verdict} · Confidence: {confidence}/10
              {runDay != null && verdict !== 'NEUTRAL' && ` · Day ${runDay} of run`}
              {staleRun && ' — stale run (day 4+): historically weaker forward returns'}
            </div>
            {/* Driver details */}
            <div className="text-[10px] leading-relaxed space-y-1">
              {driverLines.length > 0 ? (
                driverLines.map((line, i) => <div key={i}>· {line}</div>)
              ) : (
                <div style={{ color: 'var(--scanner-text3)' }}>No driver data available</div>
              )}
            </div>
          </div>
        </div>
      )}
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
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
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
          <span className="text-[11px]" style={{ color: 'var(--scanner-text2)' }}>{suggestedPct}% cash</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Ultra6 Gates</span>
          <span className="text-[14px] font-bold" style={{ color: ultra6Gates >= 4 ? 'var(--scanner-green)' : ultra6Gates >= 3 ? 'var(--scanner-text2)' : 'var(--scanner-accent)' }}>
            {ultra6Gates}/6
          </span>
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

  const recent = expanded ? history.slice(-365).reverse() : history.slice(-7).reverse();

  // Per-asset majors verdicts (Task 36 S6) — E/S/H letters with verdict
  // colors, falling back to the pre-S6 strong-count for old entries.
  const MAJOR_SYMS = ['ETH', 'SOL', 'HYPE'];
  const renderMajors = h => {
    const mv = h.majors_verdicts;
    if (mv && MAJOR_SYMS.every(s => mv[s]?.verdict)) {
      return (
        <span className="whitespace-nowrap">
          {MAJOR_SYMS.map(s => {
            const v = mv[s].verdict;
            const day = mv[s].run_day;
            const stale = v === 'STRONG' && day != null && day >= 4;
            return (
              <span
                key={s}
                className="cursor-help font-bold"
                style={{ color: verdictColor(v), opacity: stale ? 0.5 : 1 }}
                title={`${s}: ${v}${day != null ? ` (day ${day} of run)` : ''}`}
              >
                {v === 'STRONG' ? '▲' : v === 'WEAK' ? '◈' : '·'}
              </span>
            );
          })}
        </span>
      );
    }
    return h.majors_strong_count ?? '—';
  };

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
        <table className="w-full border-collapse min-w-[400px] sm:min-w-0">
          <thead>
            <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
              {['Date', 'BTC', 'Majors', 'Cash', '5D Ret', 'Hit'].map((h, hi) => (
                <th key={h} className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2 px-3 text-left" style={{ color: 'var(--scanner-text3)', ...(hi === 0 ? { position: 'sticky', left: 0, zIndex: 10, background: 'var(--scanner-bg2)' } : {}) }}>
                  {h === 'Hit' ? (
                    <span title="✓ = directional call was correct · ✗ = directional call was wrong · · = NEUTRAL resolved (no call made, correctly silent) · — = pending (5d not elapsed)">Hit ℹ</span>
                  ) : h === 'Majors' ? (
                    <span title="Per-asset verdicts since 2026-10-29 (▲ = ETH/SOL/HYPE STRONG, ◈ = WEAK, · = NEUTRAL); hover a symbol for run age. Older entries show the STRONG count only.">Majors ℹ</span>
                  ) : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map((h, i) => {
              const btcStale = h.btc_verdict === 'STRONG' && h.btc_run_day != null && h.btc_run_day >= 4;
              return (
              <tr key={i} style={{ borderBottom: '1px solid var(--scanner-border)' }}>
                <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--scanner-text2)', position: 'sticky', left: 0, zIndex: 5, background: 'var(--scanner-bg1)' }}>{h.date}</td>
                <td className="py-2 px-3 text-[10px] font-semibold cursor-help whitespace-nowrap" style={{ color: verdictColor(h.btc_verdict), opacity: btcStale ? 0.55 : 1 }} title={h.btc_run_day != null && h.btc_verdict !== 'NEUTRAL' ? `Day ${h.btc_run_day} of this ${h.btc_verdict} run${btcStale ? ' — day 4+ STRONGs decayed OOS (33.6% hit vs ~50% days 1-3)' : ''}` : undefined}>
                  {h.btc_verdict}{h.btc_run_day != null && h.btc_verdict !== 'NEUTRAL' && h.btc_run_day > 1 ? <span style={{ color: 'var(--scanner-text3)', fontWeight: 400 }}>{` D${h.btc_run_day}`}</span> : null}
                </td>
                <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--scanner-text2)' }}>{renderMajors(h)}</td>
                <td className="py-2 px-3 text-[10px]" style={{ color: 'var(--scanner-text2)' }}>{h.cash_pct}%</td>
                <td className="py-2 px-3 text-[10px] tabular-nums" style={{ color: h.btc_5d_return != null ? (h.btc_5d_return >= 0 ? 'var(--scanner-green)' : 'var(--scanner-red)') : 'var(--scanner-text3)' }}>
                  {h.btc_5d_return != null ? `${h.btc_5d_return > 0 ? '+' : ''}${h.btc_5d_return.toFixed(2)}%` : '—'}
                </td>
                <td className="py-2 px-3 text-[10px]" style={{
                  color: h.btc_5d_hit === true ? 'var(--scanner-green)'
                       : h.btc_5d_hit === false && h.btc_verdict !== 'NEUTRAL' ? 'var(--scanner-red)'
                       : 'var(--scanner-text3)'
                }} title={
                  h.btc_5d_hit === true ? 'Directional call was correct'
                  : h.btc_5d_hit === false && h.btc_verdict !== 'NEUTRAL' ? 'Directional call was wrong'
                  : h.btc_5d_hit === false && h.btc_verdict === 'NEUTRAL' ? 'No directional call made — NEUTRAL is correctly silent, cannot hit or miss'
                  : 'Pending — 5d return not yet available'
                }>
                  {h.btc_5d_hit === true ? '✓'
                   : h.btc_5d_hit === false && h.btc_verdict !== 'NEUTRAL' ? '✗'
                   : h.btc_5d_hit === false && h.btc_verdict === 'NEUTRAL' ? '·'
                   : '—'}
                </td>
              </tr>
              );
            })}
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
 *   - Total signals / resolved / pending (resolved includes NEUTRAL)
 *   - STRONG hit rate (resolved STRONG signals where 5d return > 0)
 *   - WEAK hit rate (resolved WEAK signals where 5d return < 0)
 *   - Cash Alpha vs 40% baseline (how much cash% decisions helped/hurt)
 *   - Verdict distribution (count of STRONG / WEAK / NEUTRAL)
 *
 * Significance bar: 30 DIRECTIONAL (STRONG + WEAK) resolved signals. NEUTRAL
 * resolved signals don't count toward significance because they have no
 * directional call to hit or miss — they're correctly silent.
 */
function SignalScoreboard({ history }) {
  const stats = useMemo(() => {
    if (!history || history.length === 0) return null;

    const total = history.length;
    let strongCount = 0, weakCount = 0, neutralCount = 0;
    let strongResolved = 0, strongHits = 0;
    let weakResolved = 0, weakHits = 0;
    let neutralResolved = 0;
    let pending = 0;

    // Cash alpha: compares actual cash% to a constant 40% baseline.
    // For each resolved signal: alpha = (baseline_cash - signal_cash) * btc_5d_return
    //   signal raised cash (cash% > 40) + BTC fell → positive alpha (avoided losses)
    //   signal raised cash + BTC rose → negative alpha (gave up gains)
    //   signal at baseline (40%) → zero alpha
    const BASELINE_CASH_FRAC = 0.40;
    let cashAlpha = 0;
    let cashAlphaSignals = 0;

    for (const h of history) {
      if (h.btc_verdict === 'STRONG') strongCount++;
      else if (h.btc_verdict === 'WEAK') weakCount++;
      else neutralCount++;

      if (h.btc_5d_hit === null || h.btc_5d_hit === undefined) {
        pending++;
        continue;
      }

      // Resolved (5d elapsed)
      if (h.btc_verdict === 'STRONG') {
        strongResolved++;
        if (h.btc_5d_hit) strongHits++;
      } else if (h.btc_verdict === 'WEAK') {
        weakResolved++;
        if (h.btc_5d_hit) weakHits++;
      } else {
        neutralResolved++;
      }

      // Cash alpha contribution (only for signals with 5d return + cash% data)
      if (h.btc_5d_return != null && h.cash_pct != null) {
        const signalCashFrac = h.cash_pct / 100;
        cashAlpha += (BASELINE_CASH_FRAC - signalCashFrac) * h.btc_5d_return;
        cashAlphaSignals++;
      }
    }

    const resolved = strongResolved + weakResolved + neutralResolved;
    const directionalResolved = strongResolved + weakResolved;
    const strongHitRate = strongResolved > 0 ? (strongHits / strongResolved) * 100 : null;
    const weakHitRate = weakResolved > 0 ? (weakHits / weakResolved) * 100 : null;

    return {
      total, resolved, pending,
      directionalResolved,
      strongCount, weakCount, neutralCount,
      strongResolved, strongHits, strongHitRate,
      weakResolved, weakHits, weakHitRate,
      neutralResolved,
      cashAlpha, cashAlphaSignals,
    };
  }, [history]);

  if (!stats) return null;

  const lowSample = stats.directionalResolved < 30;
  const significant = stats.directionalResolved >= 30;

  return (
    <div>
      <SectionLabel right={
        <span className="text-[8px]" style={{ color: lowSample ? 'var(--scanner-text3)' : 'var(--scanner-green)' }}>
          {significant ? '✓ ≥30 directional' : `${stats.directionalResolved}/30 directional`}
        </span>
      }>
        Signal Scoreboard · live accuracy tracker
      </SectionLabel>

      <div className="rounded p-4" style={{ background: 'var(--scanner-bg1)', border: '1px solid var(--scanner-border2)' }}>
        {/* Top: counts summary — 4 columns on desktop, 2 on mobile */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Total Signals</div>
            <div className="text-[20px] font-bold tabular-nums" style={{ color: 'var(--scanner-text)' }}>{stats.total}</div>
            <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
              {stats.resolved} resolved · {stats.pending} pending
              {stats.neutralResolved > 0 && (
                <span title="NEUTRAL resolved signals have no directional call to hit or miss — they're correctly silent.">{' '}(incl. {stats.neutralResolved} NEUTRAL)</span>
              )}
            </div>
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
            <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
              {stats.strongResolved > 0
                ? `${stats.strongResolved} resolved · ${stats.strongHits} hits`
                : '0 resolved (no STRONG signals yet)'}
            </div>
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
            <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
              {stats.weakResolved > 0
                ? `${stats.weakResolved} resolved · ${stats.weakHits} hits`
                : '0 resolved (no WEAK signals yet)'}
            </div>
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>
              Cash Alpha <span style={{ opacity: 0.6 }}>vs 40% hold</span>
            </div>
            <div className="text-[20px] font-bold tabular-nums" style={{
              color: stats.cashAlpha > 0.01 ? 'var(--scanner-green)'
                   : stats.cashAlpha < -0.01 ? 'var(--scanner-red)'
                   : 'var(--scanner-text3)'
            }}>
              {stats.cashAlphaSignals > 0
                ? `${stats.cashAlpha >= 0 ? '+' : ''}${stats.cashAlpha.toFixed(2)}%`
                : '—'}
            </div>
            <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
              {stats.cashAlphaSignals > 0
                ? `${stats.cashAlphaSignals} signals · positive = cash calls helped`
                : 'awaiting resolved signals'}
            </div>
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
          <div className="flex items-center gap-2 sm:gap-3 mt-1 text-[8.5px] flex-wrap">
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
            {stats.directionalResolved} of 30 directional (STRONG + WEAK) resolved signals needed for
            statistically meaningful hit rates. NEUTRAL resolved signals ({stats.neutralResolved}) are
            correctly silent — they have no directional call to hit or miss, so they don't count toward
            significance. Currently accumulating ~1 signal/day in trending markets (zero in chop).
            Walk-forward backtest reference:{' '}
            <span style={{ color: 'var(--scanner-text2)' }}>OOS STRONG 47.4% · +1.05% avg 10d</span>{' '}
            (2025-08 to 2026-10, true OOS at the shipped thresholds — see below).
          </div>
        )}

        {/* OOS reference (post-S1/S2 configuration) */}
        {significant && (
          <div className="text-[8.5px] mt-2" style={{ color: 'var(--scanner-text3)' }}>
            <strong style={{ color: 'var(--scanner-text2)' }}>OOS reference (2025-08 to 2026-10, 4 assets, thresholds STRONG≥9 / macroZ boost removed):</strong>{' '}
            STRONG 47.4% hit · +1.05% avg 10-day return (n=154; the pre-fix config ran 41.9% / -0.60%
            on the same window). Live hit rates should converge toward these figures as the sample
            grows; persistent divergence &gt;10pp may indicate regime shift or threshold drift.
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
      detail: 'Trend confirmed by ≥3 gates (z-score stretch + persistence + healthy extension + confirmation). Requires confidence ≥9 (zPctile-confirmed) since 2026-10-29. True OOS 2025-08 to 2026-10: 47.4% hit, avg +1.05% 10-day return (n=154) at this configuration vs -0.60% pre-fix.',
    },
    {
      verdict: 'WEAK',
      icon: '◈',
      color: '#f5c842',
      meaning: 'Defensive conditions',
      action: 'Risk-off — raise cash / reduce exposure',
      detail: 'Trend breaking down (negative z-stretch + persistence) OR overextended+crowded (atrExt>5 + fundingZ>2). NOT a "signal failure" — it is an actionable defensive call. Never fired live in 100+ days (see Task 36 S7); treat as informational.',
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
              <div className="flex items-center gap-2 sm:gap-3 mb-1.5 flex-wrap">
                <span className="text-[14px] font-bold" style={{ color: r.color }}>{r.icon} {r.verdict}</span>
                <span className="text-[10px] font-semibold" style={{ color: 'var(--scanner-text2)' }}>{r.meaning}</span>
                <span className="text-[9px] sm:ml-auto" style={{ color: 'var(--scanner-text3)' }}>{r.action}</span>
              </div>
              <div className="text-[9px] leading-relaxed" style={{ color: 'var(--scanner-text3)' }}>{r.detail}</div>
            </div>
          ))}
          <div className="p-2 text-[8.5px]" style={{ background: 'var(--scanner-bg2)', color: 'var(--scanner-text3)' }}>
            <strong style={{ color: 'var(--scanner-text2)' }}>About the colors:</strong>{' '}
            Green = constructive. Amber = defensive (caution, not failure). Gray = neutral.
            Red is reserved for realized directional misses (✗ in history) — STRONG calls where BTC fell, or WEAK calls where BTC rose. NEUTRAL resolved signals show '·' (no call made).
          </div>
        </div>
      )}
    </div>
  );
}

export default function Signal() {
  // Audit F-14-g-3 + F-14-g-8 + F-14-g-10 (2026-08-26):
  // Previously Signal.jsx used a hand-rolled useEffect+fetch that:
  //   - Bypassed the shared useSnapshot hook (and its 5-min TTL +
  //     visibilitychange refetch + dedup-via-_fetchPromise).
  //   - Triggered a duplicate /snapshot.json fetch on mount alongside
  //     SignalHitRateTable's own useSnapshot() call (F-14-g-8). HTTP-
  //     cached so no network cost after first hit per 10min, but still
  //     an architectural smell.
  //   - Swallowed fetch errors silently (F-14-g-10): user couldn't
  //     distinguish 'snapshot fetch failed' from 'snapshot has no
  //     signal_metrics' — both produced the same 'No signal data
  //     available yet' message with no retry button.
  // Now uses the shared useSnapshot() hook + explicit error/retry UI.
  const snapshot = useSnapshot();
  const [retryNonce, setRetryNonce] = useState(0);
  const [fetchError, setFetchError] = useState(null);

  // Manual retry: clears the shared cache + bumps retryNonce to force
  // a refetch on next render. The useSnapshot() hook will see the
  // cleared cache and refetch automatically.
  const handleRetry = () => {
    clearSnapshotCache();
    setFetchError(null);
    setRetryNonce(n => n + 1);
  };

  // Detect fetch failure: if snapshot is null AND we've attempted at
  // least one fetch (retryNonce >= 0 always true), treat null as a
  // fetch failure rather than "no signal_metrics yet". The shared
  // hook returns null both when the fetch is in-flight AND when it
  // failed — we use the retryNonce to distinguish: if the hook has
  // had time to settle and snapshot is still null, that's a failure.
  useEffect(() => {
    if (snapshot === null) {
      // Give the shared hook's fetch a chance to complete first.
      // If after 3s snapshot is still null, flag as error.
      const t = setTimeout(() => {
        if (snapshot === null) setFetchError('snapshot_unreachable');
      }, 3000);
      return () => clearTimeout(t);
    }
    // Snapshot loaded — clear any prior error state.
    setFetchError(null);
  }, [snapshot, retryNonce]);

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

  // Snapshot is null but error not yet flagged → still loading.
  if (snapshot === null && !fetchError) {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono">
        <div className="text-[10px] tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Loading signal data…</div>
      </div>
    );
  }

  // Fetch failed → show error + retry button (F-14-g-10).
  if (fetchError === 'snapshot_unreachable') {
    return (
      <div className="min-h-screen flex items-center justify-center font-mono">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4 opacity-20">⚠</div>
          <div className="text-sm mb-2" style={{ color: 'var(--scanner-text2)' }}>
            Snapshot fetch failed
          </div>
          <div className="text-[10px] mb-4 leading-relaxed" style={{ color: 'var(--scanner-text3)' }}>
            TrendScan couldn't reach <code style={{ color: 'var(--scanner-accent)' }}>/snapshot.json</code>.
            This is usually a network issue, a Cloudflare Worker outage, or GitHub Pages being degraded.
            The Signal page can't render without the snapshot. Click retry below to attempt a refetch.
          </div>
          <button
            onClick={handleRetry}
            className="font-mono text-[10px] font-bold tracking-[0.14em] uppercase px-4 py-2 rounded transition-all"
            style={{
              background: 'var(--scanner-accent)',
              color: '#000',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ↻ Retry fetch
          </button>
        </div>
      </div>
    );
  }

  const sm = snapshot?.signal_metrics;
  const history = snapshot?.signal_history || [];

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
    <div className="font-mono min-h-screen pb-16" style={{ background: 'var(--scanner-bg)', color: 'var(--scanner-text)' }}>
      <div className="space-y-4 sm:space-y-6 px-3 sm:px-5 md:px-8 py-4 sm:py-5 max-w-6xl mx-auto">
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
      <FreshnessBanner generatedAt={snapshot?.generated_at} contextLabel="signal" />

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
          runDay={sm.btc_stance.run_day}
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
              runDay={a.run_day}
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

      {/* Signal hit-rate verification (from SMB) */}
      <SignalHitRateTable />

      {/* Backtest stats (if available) */}
      {history.length >= 10 && (
        <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
          <strong style={{ color: 'var(--scanner-text2)' }}>Backtest reference (true OOS, 4 assets, 2025-08 to 2026-10):</strong>{' '}
          STRONG 47.4% hit (154 signals, avg +1.05% 10d return) at the current configuration
          (STRONG≥9, macroZ boost removed 2026-10-29) vs 41.9% hit / -0.60% avg for the pre-fix
          configuration (STRONG≥8 + macroZ boost) on the same window — the fix demoted 113 of the
          old STRONGs (including the five worst episodes) with zero new promotions. In-sample
          (2023-10 to 2025-07) improved to 66.1% / +7.07% (n=183). Live hit rates should converge
          toward the OOS figures as the sample grows.
        </div>
      )}
      </div>
    </div>
  );
}
