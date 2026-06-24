/**
 * MacroRegime Page - MMM Macro Regime Suite
 * Three-composite nowcasting engine with TOTAL3ES allocation
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import RegimeCard from '../components/regime/RegimeCard';
import CompositeGauge from '../components/regime/CompositeGauge';
import AllocationPanel from '../components/regime/AllocationPanel';
import SignalTable from '../components/regime/SignalTable';
import MacroCharts from '../components/regime/MacroCharts';
import ChangeBanner from '../components/regime/ChangeBanner';
import { computeSeasonality, getCurrentMonthBaseline, formatSeasonalityBaseline } from '../lib/regime/seasonality';
import { fetchAllRegimeData } from '../lib/regime/regimeSources';
import {
  computeGrowthSignals,
  computeInflationSignals,
  computeLiquiditySignals,
  classifyGrowthRegime,
  classifyInflationRegime,
  classifyLiquidityRegime,
  computeUltra6,
  computeOB1Signals,
  computeCore8Score,
  computeCore9Score,
  computeAllocation,
} from '../lib/regime/regimeSignals';
import {
  weightedComposite,
  computeNowcast,
  computeGrandComposite,
  classifyRegime,
  adaptiveZ,
} from '../lib/regime/regimeCalculations';

// Loading skeleton
function LoadingState() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-lg p-5 h-48" style={{ background: 'var(--scanner-bg2)' }} />
        ))}
      </div>
    </div>
  );
}

// Error state
function ErrorState({ error }) {
  return (
    <div
      className="rounded-lg p-6 text-center"
      style={{ background: 'rgba(255,68,68,0.05)', border: '1px solid rgba(255,68,68,0.2)' }}
    >
      <div className="text-[14px] font-bold mb-2" style={{ color: 'var(--scanner-red)' }}>
        Data Fetch Error
      </div>
      <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>
        {error?.message || 'Failed to load regime data'}
      </div>
      <div className="text-[9px] mt-4" style={{ color: 'var(--scanner-text3)' }}>
        Refresh the page to retry
      </div>
    </div>
  );
}

// Fred Notice
function FredNotice({ fredAvailable, activeSignals }) {
  if (fredAvailable) return null;

  return (
    <div
      className="rounded-lg p-4 flex items-start gap-3"
      style={{ background: 'rgba(240,165,0,0.08)', border: '1px solid rgba(240,165,0,0.2)' }}
    >
      <span className="text-[14px]">⚠</span>
      <div>
        <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--scanner-accent)' }}>
          FRED macro data unavailable
        </div>
        <div className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>
          Showing crypto-native signals only ({activeSignals}/44 inputs active).
          Register for free at fred.stlouisfed.org for full regime coverage.
        </div>
      </div>
    </div>
  );
}

// Data Source Badge
function SourceBadge({ sources }) {
  const primary = sources?.fred ? 'FRED' : sources?.gold ? 'KRAKEN' : 'BINANCE';

  return (
    <div className="flex items-center gap-2">
      <span className="text-[8px] px-1.5 py-0.5 rounded" style={{
        background: 'rgba(0,230,118,0.1)',
        color: 'var(--scanner-green)',
      }}>
        ● {primary}
      </span>
      <span className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
        {sources?.fred === false ? 'Crypto-native only' : 'Full data'}
      </span>
    </div>
  );
}

export default function MacroRegime() {
  // Fetch all regime data
  const {
    data: rawData,
    isLoading,
    error,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['regime'],
    queryFn: fetchAllRegimeData,
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    staleTime: 4 * 60 * 1000,
    retry: 2,
  });

  // Compute regime state from raw data
  const regime = useMemo(() => {
    if (!rawData) return null;

    const {
      btcPrice = [],
      ethPrice = [],
      ethBtcRatio = [],
      goldPrice = [],
      fearGreed = [],
      btcDominance = [],
      usdtDominance = [],
      btcVolume = [],
      fred = {},
      fredAvailable = false,
      sources = {},
    } = rawData;

    // Compute growth signals
    const growthSignals = computeGrowthSignals({
      btcPrice,
      ethPrice,
      ethBtcRatio,
      fearGreed,
      btcVolume,
      btcDominance,
      usdtDominance,
      fred,
      fredAvailable,
    });
    const growthZ = weightedComposite(growthSignals);
    const growthNowcast = computeNowcast([growthZ]);
    const growthLabel = classifyGrowthRegime(growthZ);

    // Top growth drivers
    const topGrowthDrivers = growthSignals
      .filter(s => s.value != null)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 3)
      .map(s => ({ name: s.name, value: s.value }));

    // Compute inflation signals
    const inflationSignals = computeInflationSignals({
      btcPrice,
      goldPrice,
      usdtDominance,
      fearGreed,
      fred,
      fredAvailable,
    });
    const inflationZ = weightedComposite(inflationSignals);
    const inflationNowcast = computeNowcast([inflationZ]);
    const inflationLabel = classifyInflationRegime(inflationZ);

    // Top inflation drivers
    const topInflationDrivers = inflationSignals
      .filter(s => s.value != null)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 3)
      .map(s => ({ name: s.name, value: s.value }));

    // Compute liquidity signals
    const liquiditySignals = computeLiquiditySignals({
      btcDominance,
      usdtDominance,
      btcPrice,
      fearGreed,
      ethBtcRatio,
      btcVolume,
      fred,
      fredAvailable,
    });
    const liquidityZ = weightedComposite(liquiditySignals);
    const liquidityNowcast = computeNowcast([liquidityZ]);
    const liquidityLabel = classifyLiquidityRegime(liquidityZ);

    // Top liquidity drivers
    const topLiquidityDrivers = liquiditySignals
      .filter(s => s.value != null)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 3)
      .map(s => ({ name: s.name, value: s.value }));

    // Classify regime
    const { quadrant, liquidity, label } = classifyRegime(
      growthNowcast.nowcast,
      inflationNowcast.nowcast,
      liquidityNowcast.nowcast
    );

    // Grand composite
    const grandComposite = computeGrandComposite(
      growthNowcast.nowcast,
      inflationNowcast.nowcast,
      liquidityNowcast.nowcast
    );

    // TOTAL3ES signals
    const ultra6 = computeUltra6(
      { btcPrice, ethPrice, btcDominance, ethBtcRatio },
      growthNowcast.nowcast,
      growthNowcast.meZ,
      quadrant,
      liquidity
    );

    const ob1 = computeOB1Signals({
      ethPrice,
      btcPrice,
      btcVolume,
      usdtDominance,
      ethBtcRatio,
    });

    const core8Score = computeCore8Score(ultra6);
    const core9Score = computeCore9Score({ btcPrice, ethPrice }, growthSignals);
    const allocation = computeAllocation(ultra6, ob1, core9Score, btcPrice);

    // Total signal count
    const totalSignals = growthSignals.length + inflationSignals.length + liquiditySignals.length;
    const fredSignals = fredAvailable ? totalSignals : growthSignals.filter(s => !s.raw?.includes?.('FRED') || true).length;

    return {
      quadrant,
      liquidity,
      label,
      grandComposite,
      growth: {
        ...growthNowcast,
        label: growthLabel,
        signals: growthSignals,
        topDrivers: topGrowthDrivers,
      },
      inflation: {
        ...inflationNowcast,
        label: inflationLabel,
        signals: inflationSignals,
        topDrivers: topInflationDrivers,
      },
      liquidityData: {
        ...liquidityNowcast,
        label: liquidityLabel,
        signals: liquiditySignals,
        topDrivers: topLiquidityDrivers,
      },
      ultra6,
      ob1,
      core8Score,
      core9Score,
      allocation,
      fredAvailable,
      totalSignals,
      sources,
      btcPrice,
      lastUpdated: new Date().toISOString(),
    };
  }, [rawData]);

  // Seasonality (from Ken French data in snapshot)
  const seasonality = useMemo(() => {
    if (!rawData?.kenFrench) return null;
    return computeSeasonality(rawData.kenFrench);
  }, [rawData]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen pb-16" style={{ background: 'var(--scanner-bg)', fontFamily: 'IBM Plex Mono, monospace' }}>
        <div className="px-5 md:px-8 pt-4">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-1 h-5 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
              <h1 className="text-[14px] font-bold tracking-[0.15em]" style={{ color: 'var(--scanner-text)' }}>
                MACRO REGIME
              </h1>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>
              MMM Macro Suite · Growth × Inflation × Liquidity · 8-Regime Classifier
            </p>
          </div>
          <LoadingState />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen pb-16" style={{ background: 'var(--scanner-bg)', fontFamily: 'IBM Plex Mono, monospace' }}>
        <div className="px-5 md:px-8 pt-4">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-1 h-5 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
              <h1 className="text-[14px] font-bold tracking-[0.15em]" style={{ color: 'var(--scanner-text)' }}>
                MACRO REGIME
              </h1>
            </div>
          </div>
          <ErrorState error={error} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16" style={{ background: 'var(--scanner-bg)', fontFamily: 'IBM Plex Mono, monospace' }}>
      <div className="px-5 md:px-8 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-1 h-5 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
              <h1 className="text-[14px] font-bold tracking-[0.15em]" style={{ color: 'var(--scanner-text)' }}>
                MACRO REGIME
              </h1>
            </div>
            <p className="text-[10px]" style={{ color: 'var(--scanner-text3)' }}>
              MMM Macro Suite · Growth × Inflation × Liquidity · 8-Regime Classifier
            </p>
          </div>
          <SourceBadge sources={regime?.sources} />
        </div>

        {/* Day-over-day change banner (shows what shifted since last visit) */}
        <ChangeBanner regime={regime} />

        {/* Data coverage notice */}
        {!regime?.fredAvailable && (
          <FredNotice
            fredAvailable={regime?.fredAvailable}
            activeSignals={regime?.totalSignals || 0}
          />
        )}

        {/* Top row: Regime Card + Allocation Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <RegimeCard regime={regime} />
          <AllocationPanel regime={regime} />
          {/* Grand Composite Card */}
          <div
            className="rounded-lg p-5"
            style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}
          >
            <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--scanner-text3)' }}>
              GRAND COMPOSITE
            </div>
            <div className="text-center mb-4">
              <span className="text-[48px] font-bold tabular-nums" style={{ color: 'var(--scanner-accent)' }}>
                {regime?.grandComposite?.toFixed(1) ?? '—'}
              </span>
              <span className="text-[18px]" style={{ color: 'var(--scanner-text3)' }}>/100</span>
            </div>
            {/* Nowcast bar */}
            <div className="h-2 rounded-sm overflow-hidden mb-4" style={{ background: 'var(--scanner-border)' }}>
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, regime?.grandComposite || 50)}%`,
                  background: 'var(--scanner-accent)',
                }}
              />
            </div>
            {/* Weights */}
            <div className="text-[9px] space-y-2" style={{ color: 'var(--scanner-text3)' }}>
              <div className="flex justify-between">
                <span>Growth (33%)</span>
                <span className="tabular-nums">{regime?.growth?.nowcast?.toFixed(1) ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Inflation (33%)</span>
                <span className="tabular-nums">{regime?.inflation?.nowcast?.toFixed(1) ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Liquidity (34%)</span>
                <span className="tabular-nums">{regime?.liquidityData?.nowcast?.toFixed(1) ?? '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Three Composite Gauges */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <CompositeGauge
            label="GROWTH"
            data={regime?.growth || {}}
            regimeBand={['RECESSIONARY', 'NEUTRAL', 'EXPANSION', 'BOOM']}
          />
          <CompositeGauge
            label="INFLATION"
            data={regime?.inflation || {}}
            regimeBand={['DISINFLATION', 'NEUTRAL', 'REINFLATION', 'HOT']}
          />
          <CompositeGauge
            label="LIQUIDITY"
            data={regime?.liquidityData || {}}
            regimeBand={['TIGHT', 'NEUTRAL', 'LOOSE', 'VERY LOOSE']}
          />
        </div>

        {/* Charts */}
        <div className="mb-6">
          <MacroCharts regime={regime} />
        </div>

        {/* Seasonality Baselines (Ken French) */}
        {seasonality && (
          <div className="mb-6 rounded-lg p-5" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
            <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--scanner-text3)' }}>
              Seasonality Baselines (Ken French, current month)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {['market', 'smb', 'hml'].map(factor => {
                const baseline = getCurrentMonthBaseline(seasonality, factor);
                const factorName = { market: 'US Market', smb: 'Size (SMB)', hml: 'Value (HML)' }[factor];
                return (
                  <div key={factor} className="text-[10px]">
                    <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--scanner-text3)' }}>{factorName}</div>
                    <div style={{ color: 'var(--scanner-text2)' }}>
                      {formatSeasonalityBaseline(baseline, 'trailing_30y')}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-[8px] mt-3" style={{ color: 'var(--scanner-text3)', opacity: 0.6 }}>
              Source: Ken French Data Library (F-F Research Data Factors). Trailing 30y window.
              Definition differs from our crypto universe; for seasonal baseline context only.
            </div>
          </div>
        )}

        {/* Signal Table */}
        <div className="mb-6">
          <SignalTable regime={regime} />
        </div>

        {/* Footer */}
        <div className="text-[8px] leading-relaxed pt-4 border-t" style={{ borderColor: 'var(--scanner-border2)', color: 'var(--scanner-text3)', opacity: 0.6 }}>
          <strong>Methodology:</strong> Adaptive Z-Score (60% short-term / 40% long-term, 90/365 day lookback) ·
          0-100 Nowcast conversion (z→50+(z×10)) ·
          8-Regime Classifier (Growth × Inflation × Liquidity) ·
          TOTAL3ES Allocation (Ultra6 ≥4 AND OB1 ≥3) ·
          Season aliases: SPRING=GOLDILOCKS, SUMMER=OVERHEAT, FALL=STAGFLATION, WINTER=CONTRACTION ·
          Data: FRED + Binance + Kraken + CoinGecko + Alternative.me
        </div>

        {/* Last updated */}
        {dataUpdatedAt && (
          <div className="text-[8px] mt-2" style={{ color: 'var(--scanner-text3)', opacity: 0.4 }}>
            Last refresh: {new Date(dataUpdatedAt).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
