/**
 * Factor Monitor — crypto factor spread monitor (factorwatch-style table).
 *
 * For each factor: shows 1d/5d/20d/60d/ytd returns for both:
 *   - rel = long-only minus benchmark
 *   - spread = Q5 - Q1 (cleaner factor signal)
 *
 * Cells show: return %, z-score, percentile.
 * |z| >= 2 cells are highlighted.
 */

import React, { useState, useEffect } from 'react';
import { computeFactorScores, buildQuintilePortfolios, computeSpreadMonitor, detectFactorRotation } from '@/lib/scanner/factorEngine';
import { fetchCandlesBatch } from '@/lib/scanner/sourceResolver';
import { fetchMarketData } from '@/lib/scanner/sources/coingecko';

const HORIZONS = [
  { days: 1,  label: '1D' },
  { days: 5,  label: '5D' },
  { days: 20, label: '20D' },
  { days: 60, label: '60D' },
];

const FACTORS = ['momentum', 'size', 'volatility', 'beta', 'liquidity'];

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
}
function fmtZ(z) {
  if (z == null || !Number.isFinite(z)) return '—';
  return (z >= 0 ? '+' : '') + z.toFixed(2) + 'σ';
}

function ZCell({ ret, z, pctile }) {
  if (ret == null) {
    return <td className="text-center text-[10px]" style={{ color: 'var(--scanner-text3)' }}>—</td>;
  }
  const isBreached = Math.abs(z) >= 2;
  const bg = isBreached
    ? (z > 0 ? 'rgba(0,230,118,0.12)' : 'rgba(255,68,68,0.12)')
    : 'transparent';
  const color = z > 0 ? 'var(--scanner-green)' : z < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
  return (
    <td
      className="text-center text-[10px] tabular-nums px-2 py-1.5"
      style={{ background: bg, color, fontWeight: isBreached ? 600 : 400 }}
      title={`Return: ${fmtPct(ret)}\nZ-score: ${fmtZ(z)}\nPercentile: ${pctile?.toFixed(1)}%`}
    >
      <div>{fmtPct(ret)}</div>
      <div className="text-[9px] opacity-70">{fmtZ(z)} · {(pctile || 50).toFixed(0)}p</div>
    </td>
  );
}

export default function FactorMonitor() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        // 1. Fetch top 100 crypto by market cap
        const marketData = await fetchMarketData([]);
        const topSymbols = Object.entries(marketData)
          .sort((a, b) => b[1].marketCap - a[1].marketCap)
          .slice(0, 100)
          .map(([sym]) => sym);

        if (topSymbols.length < 10) {
          throw new Error('Not enough market data available');
        }

        // 2. Fetch 1 year of daily candles for each (via resolver)
        const candlesResult = await fetchCandlesBatch(topSymbols, { timeframe: '1D', limit: 365 }, 5);

        // 3. Build universe with market cap + 24h volume (for liquidity factor)
        // CoinGecko OHLC endpoint returns vol=0, so we inject volume from /markets data
        const universe = topSymbols
          .map(sym => {
            const candles = candlesResult.get(sym)?.candles || [];
            const md = marketData[sym] || {};
            // If candles have vol=0 (CoinGecko OHLC limitation), estimate daily vol from 24h vol
            const dailyVolUsd = md.volume24h || 0;
            if (dailyVolUsd > 0 && candles.length > 0) {
              // Distribute 24h volume equally across the most recent candle
              // (better than 0 — gives the liquidity factor something to work with)
              const lastCandle = candles[candles.length - 1];
              if (lastCandle && lastCandle.vol === 0) {
                lastCandle.vol = dailyVolUsd / (lastCandle.close || 1);
              }
            }
            return {
              symbol: sym,
              candles,
              marketCap: md.marketCap || 0,
              volume24h: dailyVolUsd,
            };
          })
          .filter(u => u.candles && u.candles.length >= 60);

        if (universe.length < 10) {
          throw new Error('Not enough candle data available');
        }

        // 4. Compute factor scores
        const scored = computeFactorScores(universe);

        // 5. Build quintile portfolios for each factor
        const portfoliosByFactor = {};
        for (const factor of FACTORS) {
          portfoliosByFactor[factor] = buildQuintilePortfolios(scored, factor);
        }

        // 6. Build candles-by-symbol map for spread monitor
        const candlesBySymbol = {};
        for (const u of universe) candlesBySymbol[u.symbol] = u.candles;

        // 7. Compute spread monitor
        // Pass array of symbol STRINGS (not objects) — buildEqualWeightSeries expects strings
        const benchmarkSymbols = universe.map(u => u.symbol);
        const spreadMonitor = computeSpreadMonitor(portfoliosByFactor, candlesBySymbol, benchmarkSymbols);

        // 8. Compute rotation
        const rotation = detectFactorRotation(portfoliosByFactor, candlesBySymbol);

        // Diagnostic: log Q5 composition per factor to console
        console.log('[FactorMonitor] Universe size:', universe.length);
        for (const factor of FACTORS) {
          const q5 = portfoliosByFactor[factor].longOnly;
          const q1 = portfoliosByFactor[factor].shortOnly;
          console.log(`[FactorMonitor] ${factor}:`, {
            q5Size: q5.length,
            q5: q5.slice(0, 10),
            q1Size: q1.length,
            q1: q1.slice(0, 10),
          });
        }

        if (!cancelled) {
          setData({
            spreadMonitor: Object.values(spreadMonitor),
            rotation,
            universeSize: universe.length,
            q5Size: Math.floor(universe.length / 5),
          });
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="font-mono text-center py-12 px-5">
        <div className="text-3xl mb-4 animate-pulse opacity-30">◈</div>
        <div className="text-sm" style={{ color: 'var(--scanner-text2)' }}>Computing factor scores…</div>
        <div className="text-[11px] mt-2" style={{ color: 'var(--scanner-text3)' }}>
          Fetching 1y of daily candles for top 100 crypto assets
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="font-mono text-center py-12 px-5">
        <div className="text-3xl mb-4 opacity-20">⚠</div>
        <div className="text-sm mb-2" style={{ color: 'var(--scanner-red)' }}>{error}</div>
        <div className="text-[11px] mb-4" style={{ color: 'var(--scanner-text3)' }}>
          Market data sources may be rate-limited. Try again in a minute.
        </div>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
            // Force re-render by toggling state; the useEffect will re-run
            setTimeout(() => window.location.reload(), 100);
          }}
          className="font-mono text-[10px] font-bold tracking-wide px-4 py-2 rounded"
          style={{
            background: 'var(--scanner-accent)',
            color: '#000',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          ↻ RETRY
        </button>
      </div>
    );
  }

  const { spreadMonitor, rotation, universeSize, q5Size } = data;

  return (
    <div className="font-mono px-5 md:px-8 py-5 space-y-5">
      {/* Header strip */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
            Crypto Factor Monitor
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--scanner-text2)' }}>
            Quintile portfolios · top {universeSize} by mcap · Q5={q5Size} assets · monthly rebalance
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>20D Leader</div>
          <div className="text-[14px] font-bold capitalize" style={{ color: 'var(--scanner-accent)' }}>
            {rotation.leader_20d || '—'}
          </div>
        </div>
      </div>

      {/* Spread Monitor Table */}
      <div className="overflow-x-auto" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
        <table className="w-full text-left">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--scanner-border2)' }}>
              <th className="text-[9px] uppercase tracking-wider px-3 py-2" style={{ color: 'var(--scanner-text3)' }}>Factor</th>
              {HORIZONS.map(h => (
                <th key={h.label} className="text-[9px] uppercase tracking-wider text-center px-2 py-2" style={{ color: 'var(--scanner-text3)' }}>
                  {h.label}
                </th>
              ))}
              <th className="text-[9px] uppercase tracking-wider text-center px-2 py-2" style={{ color: 'var(--scanner-text3)' }}>YTD</th>
            </tr>
          </thead>
          <tbody>
            {spreadMonitor.map(factorData => (
              <React.Fragment key={factorData.factor}>
                {/* rel row (long-only minus benchmark) */}
                <tr style={{ borderBottom: '1px solid var(--scanner-border)' }}>
                  <td className="px-3 py-2">
                    <div className="text-[11px] font-bold" style={{ color: 'var(--scanner-text)' }}>
                      {factorData.label}
                    </div>
                    <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>vs benchmark</div>
                  </td>
                  {HORIZONS.map(h => (
                    <ZCell key={h.label} {...factorData[`rel_${h.days}d`]} />
                  ))}
                  <td className="text-center text-[10px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
                    {fmtPct(factorData.rel_ytd?.ret)}
                  </td>
                </tr>
                {/* spread row (Q5 - Q1) */}
                <tr style={{ borderBottom: '1px solid var(--scanner-border2)' }}>
                  <td className="px-3 py-2">
                    <div className="text-[10px]" style={{ color: 'var(--scanner-text3)' }}>spread</div>
                    <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>Q5 − Q1</div>
                  </td>
                  {HORIZONS.map(h => (
                    <ZCell key={h.label} {...factorData[`spread_${h.days}d`]} />
                  ))}
                  <td className="text-center text-[10px] tabular-nums" style={{ color: 'var(--scanner-text2)' }}>
                    {fmtPct(factorData.spread_ytd?.ret)}
                  </td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* 20d Returns Bar */}
      <div>
        <div className="text-[9px] uppercase tracking-wider mb-2" style={{ color: 'var(--scanner-text3)' }}>
          Trailing 20D Returns (Long-Only)
        </div>
        <div className="space-y-1">
          {Object.entries(rotation.trailing_20d_returns || {})
            .sort((a, b) => b[1] - a[1])
            .map(([factor, ret]) => {
              const maxAbs = Math.max(...Object.values(rotation.trailing_20d_returns).map(v => Math.abs(v))) || 1;
              // Clamp width to max 48% so bars never overlap the percentage text
              const widthPct = Math.min(48, (Math.abs(ret) / maxAbs) * 48);
              const isLeader = factor === rotation.leader_20d;
              const color = ret >= 0 ? 'var(--scanner-green)' : 'var(--scanner-red)';
              return (
                <div key={factor} className="flex items-center gap-2">
                  <span className="text-[10px] w-20 capitalize flex-shrink-0" style={{ color: isLeader ? 'var(--scanner-accent)' : 'var(--scanner-text2)', fontWeight: isLeader ? 600 : 400 }}>
                    {factor}
                  </span>
                  <div className="flex-1 relative h-4 overflow-hidden" style={{ background: 'var(--scanner-bg)', border: '1px solid var(--scanner-border)' }}>
                    <div
                      className="absolute inset-y-0"
                      style={{
                        width: `${widthPct}%`,
                        background: color,
                        opacity: isLeader ? 1 : 0.6,
                        left: ret >= 0 ? '50%' : `${50 - widthPct}%`,
                      }}
                    />
                    <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: 'var(--scanner-border2)' }} />
                  </div>
                  <span className="text-[10px] tabular-nums w-16 text-right flex-shrink-0" style={{ color }}>
                    {fmtPct(ret)}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {/* Methodology footer */}
      <div className="text-[8px] leading-relaxed pt-3 border-t" style={{ borderColor: 'var(--scanner-border2)', color: 'var(--scanner-text3)', opacity: 0.6 }}>
        <strong>Methodology:</strong> Top 100 by market cap · quintile portfolios rebalanced monthly ·
        long-only (Q5, equal-weighted) · spread (Q5 − Q1, equal-weighted) ·
        z-scores vs trailing 252 overlapping h-day windows ·
        |z| ≥ 2 highlighted · Factor scores winsorized at 2.5%/97.5% then z-scored ·
        Inspired by <a href="https://factorwatch.ai/methodology.html" target="_blank" rel="noopener" style={{ color: 'var(--scanner-accent)' }}>factorwatch.ai</a>
      </div>
    </div>
  );
}
