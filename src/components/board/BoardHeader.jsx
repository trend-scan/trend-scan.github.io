/**
 * BoardHeader — Board page top banner with spectrum bar + signal overview
 *
 * Shows three perspectives side by side:
 *   1. Crypto Breadth — spectrum bar showing % above 50-MA (where the old
 *      RISK-OFF/RISK-ON label came from). Now a visual spectrum, not binary.
 *   2. Macro Regime — quadrant from the Macro page (GOLDILOCKS/OVERHEAT/etc.)
 *   3. BTC Signal — STRONG/WEAK/NEUTRAL from the Signal page
 *
 * All three measure different things:
 *   - Breadth = how many cryptos are above their moving averages (price action)
 *   - Macro = growth + inflation + liquidity nowcasts (macro fundamentals)
 *   - Signal = per-asset z-score + trend + funding (trend strength)
 *
 * They can disagree, and that's informative — not confusing.
 */

import React from 'react';
import { RefreshCw } from 'lucide-react';

const EXCHANGE_NAMES = {
  okx: 'OKX Spot',
  kraken: 'Kraken',
  binance: 'Binance Spot',
  binance_perps: 'Binance Perps',
};

const REGIME_COLORS = {
  GOLDILOCKS: 'var(--scanner-green)',
  OVERHEAT: 'var(--scanner-red)',
  STAGFLATION: '#f5c842',
  CONTRACTION: 'var(--scanner-blue)',
  TRANSITIONAL: 'var(--scanner-text3)',
};

function verdictColor(v) {
  if (v === 'STRONG') return 'var(--scanner-green)';
  if (v === 'WEAK') return '#f5c842';  // amber — defensive, not failure
  return 'var(--scanner-text3)';
}

function verdictIcon(v) {
  if (v === 'STRONG') return '▲';
  if (v === 'WEAK') return '◈';  // shield — defensive (not down-arrow)
  return '▬';
}

/**
 * Spectrum bar showing crypto breadth (% above 50-MA).
 * 0-35% = bearish zone (red), 35-50% = transitional (yellow), 50%+ = bullish (green)
 * Shows where the current % is on the spectrum and how far from each threshold.
 */
function BreadthSpectrum({ pct50, pct200, total, newHigh20d, upBig, downBig }) {
  const pct = pct50 ?? 0;
  const isNum = typeof pct50 === 'number';

  // Spectrum zones
  // 0-35%: Bearish (red zone)
  // 35-50%: Transitional (amber zone)
  // 50-60%: Improving (blue zone)
  // 60%+: Bullish (green zone)

  return (
    <div className="flex flex-col gap-1.5 min-w-[180px]">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
          Crypto Breadth ({'>50MA'})
        </span>
        <span className="text-[9px] font-bold tabular-nums" style={{
          color: pct >= 50 ? 'var(--scanner-green)' : pct >= 35 ? '#f5c842' : 'var(--scanner-red)'
        }}>
          {isNum ? `${pct}%` : '—'}
        </span>
      </div>
      {/* Spectrum bar */}
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--scanner-bg1)' }}>
        {/* Zone backgrounds */}
        <div className="absolute inset-y-0 left-0" style={{ width: '35%', background: 'rgba(255,68,68,0.15)' }} />
        <div className="absolute inset-y-0" style={{ left: '35%', width: '15%', background: 'rgba(245,200,66,0.15)' }} />
        <div className="absolute inset-y-0" style={{ left: '50%', width: '10%', background: 'rgba(121,168,255,0.15)' }} />
        <div className="absolute inset-y-0" style={{ left: '60%', right: 0, background: 'rgba(61,219,169,0.15)' }} />
        {/* Current position marker */}
        {isNum && (
          <div
            className="absolute top-0 bottom-0 w-0.5"
            style={{
              left: `${Math.min(pct, 100)}%`,
              background: pct >= 50 ? 'var(--scanner-green)' : pct >= 35 ? '#f5c842' : 'var(--scanner-red)',
              boxShadow: '0 0 4px currentColor',
            }}
          />
        )}
        {/* Threshold lines */}
        <div className="absolute top-0 bottom-0 w-px" style={{ left: '35%', background: 'rgba(255,255,255,0.15)' }} />
        <div className="absolute top-0 bottom-0 w-px" style={{ left: '50%', background: 'rgba(255,255,255,0.15)' }} />
        <div className="absolute top-0 bottom-0 w-px" style={{ left: '60%', background: 'rgba(255,255,255,0.15)' }} />
      </div>
      {/* Mini stats */}
      <div className="flex items-center gap-2 text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
        <span>▲200MA: {pct200 ?? '—'}%</span>
        <span>NH20: {newHigh20d ?? '—'}</span>
        <span style={{ color: 'var(--scanner-green)' }}>▲4%+: {upBig ?? '—'}</span>
        <span style={{ color: 'var(--scanner-red)' }}>▼4%+: {downBig ?? '—'}</span>
      </div>
    </div>
  );
}

/**
 * TradFi breadth spectrum — same visual language as Crypto BreadthSpectrum
 * but reads from tradData.tradRegime (computed by MacroTab's data source).
 *
 * Shows what % of the TradFi universe (indices, sectors, commodities, FX,
 * rates — ~80 assets) is above its 50-MA. Same 4-zone color scheme as
 * crypto so users can compare crypto vs TradFi breadth at a glance.
 *
 * Layout decision: rendered BELOW the Crypto spectrum in the BoardHeader
 * to form a stacked pair. This makes the cross-asset breadth comparison
 * the dominant visual element of the header — appropriate since breadth
 * is the single most predictive macro signal for crypto regime shifts.
 */
function TradFiBreadthSpectrum({ tradRegime }) {
  const pct = tradRegime?.pctAbove50 ?? 0;
  const pct200 = tradRegime?.pctAbove200;
  const pct20 = tradRegime?.pctAbove20;
  const total = tradRegime?.total ?? 0;
  const avgRet5d = tradRegime?.avgRet5d;
  const avgRet20d = tradRegime?.avgRet20d;
  const isNum = typeof tradRegime?.pctAbove50 === 'number' && total > 0;

  const pctColor = pct >= 50 ? 'var(--scanner-green)' : pct >= 35 ? '#f5c842' : 'var(--scanner-red)';

  return (
    <div className="flex flex-col gap-1.5 min-w-[180px]">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
          TradFi Breadth ({'>50MA'})
        </span>
        <span className="text-[9px] font-bold tabular-nums" style={{ color: isNum ? pctColor : 'var(--scanner-text3)' }}>
          {isNum ? `${pct}%` : '—'}
        </span>
      </div>
      {/* Spectrum bar */}
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--scanner-bg1)' }}>
        <div className="absolute inset-y-0 left-0" style={{ width: '35%', background: 'rgba(255,68,68,0.15)' }} />
        <div className="absolute inset-y-0" style={{ left: '35%', width: '15%', background: 'rgba(245,200,66,0.15)' }} />
        <div className="absolute inset-y-0" style={{ left: '50%', width: '10%', background: 'rgba(121,168,255,0.15)' }} />
        <div className="absolute inset-y-0" style={{ left: '60%', right: 0, background: 'rgba(61,219,169,0.15)' }} />
        {isNum && (
          <div
            className="absolute top-0 bottom-0 w-0.5"
            style={{
              left: `${Math.min(pct, 100)}%`,
              background: pctColor,
              boxShadow: '0 0 4px currentColor',
            }}
          />
        )}
        <div className="absolute top-0 bottom-0 w-px" style={{ left: '35%', background: 'rgba(255,255,255,0.15)' }} />
        <div className="absolute top-0 bottom-0 w-px" style={{ left: '50%', background: 'rgba(255,255,255,0.15)' }} />
        <div className="absolute top-0 bottom-0 w-px" style={{ left: '60%', background: 'rgba(255,255,255,0.15)' }} />
      </div>
      {/* Mini stats — mirror Crypto layout for visual alignment */}
      <div className="flex items-center gap-2 text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
        <span>▲20MA: {isNum && pct20 != null ? `${pct20}%` : '—'}</span>
        <span>▲200MA: {isNum && pct200 != null ? `${pct200}%` : '—'}</span>
        <span style={{ color: avgRet5d != null ? (avgRet5d >= 0 ? 'var(--scanner-green)' : 'var(--scanner-red)') : 'var(--scanner-text3)' }}>
          5D: {avgRet5d != null ? `${avgRet5d > 0 ? '+' : ''}${avgRet5d.toFixed(1)}%` : '—'}
        </span>
        <span style={{ color: avgRet20d != null ? (avgRet20d >= 0 ? 'var(--scanner-green)' : 'var(--scanner-red)') : 'var(--scanner-text3)' }}>
          20D: {avgRet20d != null ? `${avgRet20d > 0 ? '+' : ''}${avgRet20d.toFixed(1)}%` : '—'}
        </span>
      </div>
    </div>
  );
}

/**
 * Compact signal overview showing all three perspectives.
 */
function SignalOverview({ regime, signalMetrics, macroQuadrant, globalMetrics }) {
  const btcVerdict = signalMetrics?.btc_stance?.verdict;
  const btcConfidence = signalMetrics?.btc_stance?.confidence;
  const quadrant = macroQuadrant || signalMetrics?.macro_quadrant;
  const btcDominance = globalMetrics?.btcDominance;

  const macroColor = quadrant ? (REGIME_COLORS[quadrant] || 'var(--scanner-text3)') : 'var(--scanner-text3)';

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Divider */}
      <div className="w-px h-8 flex-shrink-0" style={{ background: 'var(--scanner-border2)' }} />

      {/* Macro Regime */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
          Macro
        </span>
        <span className="text-[11px] font-bold" style={{ color: macroColor }}>
          {quadrant || '—'}
        </span>
      </div>

      <div className="w-px h-8 flex-shrink-0" style={{ background: 'var(--scanner-border2)' }} />

      {/* BTC Signal */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
          BTC Signal
        </span>
        <div className="flex items-center gap-1.5">
          {btcVerdict && (
            <span
              className="text-[11px] font-bold cursor-help"
              style={{ color: verdictColor(btcVerdict) }}
              title={btcVerdict === 'STRONG'
                ? 'Constructive conditions — exposure warranted'
                : btcVerdict === 'WEAK'
                  ? 'Defensive conditions — raise cash (NOT a failure)'
                  : 'No actionable signal — factors mixed'}
            >
              {verdictIcon(btcVerdict)} {btcVerdict}
            </span>
          )}
          {btcConfidence != null && btcConfidence > 0 && (
            <span className="text-[9px] tabular-nums" style={{ color: 'var(--scanner-text3)' }}>
              {btcConfidence}/10
            </span>
          )}
          {!btcVerdict && (
            <span className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>—</span>
          )}
        </div>
      </div>

      <div className="w-px h-8 flex-shrink-0" style={{ background: 'var(--scanner-border2)' }} />

      {/* BTC Dominance — from CMC global metrics (snapshot) */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
          BTC Dom
        </span>
        <span
          className="text-[11px] font-bold tabular-nums cursor-help"
          style={{ color: btcDominance != null ? 'var(--scanner-accent)' : 'var(--scanner-text3)' }}
          title={btcDominance != null
            ? `BTC dominance: ${btcDominance.toFixed(1)}% of total crypto market cap (CMC). High dominance = BTC leading altcoins; low dominance = altcoin season.`
            : 'BTC dominance unavailable — CMC global metrics not in snapshot'}
        >
          {btcDominance != null ? `${btcDominance.toFixed(1)}%` : '—'}
        </span>
      </div>
    </div>
  );
}

export default function BoardHeader({ regime, regimeLabel, updatedAt, exchange, isLoading, onRefresh, signalMetrics, macroQuadrant, tradRegime, globalMetrics }) {
  const pct20  = regime?.pctAbove20  ?? '—';
  const pct50  = regime?.pctAbove50  ?? '—';
  const pct200 = regime?.pctAbove200 ?? '—';

  return (
    <div className="font-mono px-5 md:px-8 py-3" style={{
      background: 'var(--scanner-bg2)',
      borderBottom: '1px solid var(--scanner-border2)'
    }}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Left: Breadth spectra (Crypto + TradFi stacked) + signal overview */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Stacked breadth spectra: Crypto on top, TradFi directly below */}
          <div className="flex flex-col gap-2">
            <BreadthSpectrum
              pct50={pct50}
              pct200={pct200}
              total={regime?.total}
              newHigh20d={regime?.newHigh20d}
              upBig={regime?.upBig}
              downBig={regime?.downBig}
            />
            <TradFiBreadthSpectrum tradRegime={tradRegime} />
          </div>

          <SignalOverview
            regime={regime}
            signalMetrics={signalMetrics}
            macroQuadrant={macroQuadrant}
            globalMetrics={globalMetrics}
          />

          {/* Exchange + asset count */}
          <div className="flex flex-col gap-0.5 ml-2">
            <span className="text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
              Source
            </span>
            <span className="text-[9px] tracking-wider" style={{ color: 'var(--scanner-text3)' }}>
              {EXCHANGE_NAMES[exchange] || exchange} · {regime?.total ?? 0} assets · {updatedAt ?? '—'}
            </span>
          </div>
        </div>

        {/* Right: Refresh */}
        <button
          className="font-mono flex items-center gap-2 text-[10px] font-bold tracking-[0.12em] uppercase px-4 py-2"
          style={{
            background: isLoading ? 'var(--scanner-border2)' : 'var(--scanner-accent)',
            color: isLoading ? 'var(--scanner-text3)' : '#000',
            border: 'none',
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
          disabled={isLoading}
          onClick={onRefresh}
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
