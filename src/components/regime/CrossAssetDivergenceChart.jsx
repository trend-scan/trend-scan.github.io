/**
 * CrossAssetDivergenceChart — SVG sparkline showing S&P 500 vs FW 3000
 * momentum σ divergence over time.
 *
 * Uses a lightweight SVG chart (no Recharts dependency) to visualize whether
 * liquidity is hiding in mega-caps (S&P outperforming FW3000) or flowing
 * broadly down the risk curve.
 *
 * Data source: factor_watch_history array in snapshot.json (accumulated
 * server-side, capped at 90 days).
 *
 * Only renders when history has ≥ 5 data points.
 */

import { useFactorWatchHistory } from '@/hooks/useFactorSignals';
import { useFactorSignals } from '@/hooks/useFactorSignals';

function fmtSigma(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + 'σ';
}

function sigmaColor(v) {
  if (v == null || !Number.isFinite(v)) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < -2 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}

export default function CrossAssetDivergenceChart() {
  const history = useFactorWatchHistory();
  const signals = useFactorSignals();

  // Need at least 2 data points to draw a line. With fewer, show a
  // "collecting data" message so the user knows the chart exists and
  // is accumulating history (1 entry per day, capped at 90 days).
  if (!history || history.length < 2) {
    return (
      <section className="rounded p-4" style={{
        background: 'var(--scanner-bg1)',
        border: '1px solid var(--scanner-border2)',
      }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-bold tracking-[0.1em] uppercase" style={{ color: 'var(--scanner-text2)' }}>
              Cross-Asset Divergence
            </div>
            <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
              S&P 500 vs FW 3000 Momentum σ (5d) · collecting data
            </div>
          </div>
        </div>
        <div className="h-20 flex items-center justify-center text-[9px]" style={{ color: 'var(--scanner-text3)' }}>
          ⟳ Collecting FactorWatch history ({history?.length || 0}/90 days) — chart appears with ≥2 data points
        </div>
      </section>
    );
  }

  const W = 600;
  const H = 140;
  const PAD = { top: 20, right: 70, bottom: 25, left: 40 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Extract series — use 5d sigma as the primary divergence metric
  const sp500Data = history.map(h => h.sp500_mom_5d_sigma);
  const fw3000Data = history.map(h => h.fw3000_mom_5d_sigma);
  const dates = history.map(h => h.date);

  // Y-axis range: symmetric around 0, with padding
  const allVals = [...sp500Data, ...fw3000Data].filter(v => v != null && Number.isFinite(v));
  if (allVals.length === 0) return null;
  const maxAbs = Math.max(3, Math.ceil(Math.max(...allVals.map(Math.abs))));
  const yMin = -maxAbs;
  const yMax = maxAbs;

  // Scale functions
  const xScale = (i) => PAD.left + (i / (history.length - 1)) * chartW;
  const yScale = (v) => PAD.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  // Build SVG path strings
  const sp500Path = sp500Data.map((v, i) =>
    v != null ? `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}` : ''
  ).filter(Boolean).join(' ');

  const fw3000Path = fw3000Data.map((v, i) =>
    v != null ? `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}` : ''
  ).filter(Boolean).join(' ');

  // Zero line
  const zeroY = yScale(0);

  // Y-axis ticks
  const yTicks = [];
  for (let v = yMin; v <= yMax; v += 1) {
    yTicks.push({ v, y: yScale(v) });
  }

  // X-axis labels (first, middle, last date)
  const xLabels = [
    { i: 0, label: dates[0]?.slice(5) },
    { i: Math.floor((history.length - 1) / 2), label: dates[Math.floor((history.length - 1) / 2)]?.slice(5) },
    { i: history.length - 1, label: dates[history.length - 1]?.slice(5) },
  ];

  const funnelLabel = signals?.liquidityFunnel === 'MEGA_CAP_SHIELDING'
    ? 'MEGA-CAP SHIELDING'
    : signals?.liquidityFunnel === 'BROAD_RISK_ON'
    ? 'BROAD RISK-ON'
    : 'NEUTRAL';
  const funnelColor = signals?.liquidityFunnel === 'MEGA_CAP_SHIELDING'
    ? 'var(--scanner-accent)'
    : signals?.liquidityFunnel === 'BROAD_RISK_ON'
    ? 'var(--scanner-green)'
    : 'var(--scanner-text3)';

  return (
    <section className="rounded p-4" style={{
      background: 'var(--scanner-bg1)',
      border: '1px solid var(--scanner-border2)',
    }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.1em] uppercase" style={{ color: 'var(--scanner-text2)' }}>
            Cross-Asset Divergence
          </div>
          <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
            S&P 500 vs FW 3000 Momentum σ (5d) · {history.length} days
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Liquidity Funnel</div>
          <div className="text-[10px] font-bold" style={{ color: funnelColor }}>{funnelLabel}</div>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxHeight: '180px' }}>
        {/* Grid lines */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={PAD.left} y1={tick.y} x2={W - PAD.right} y2={tick.y}
              stroke="var(--scanner-border)" strokeWidth="0.5"
              strokeDasharray={tick.v === 0 ? '' : '2,3'}
            />
            <text
              x={PAD.left - 5} y={tick.y + 3}
              textAnchor="end" fontSize="8"
              fill="var(--scanner-text3)"
              fontFamily="IBM Plex Mono, monospace"
            >
              {tick.v > 0 ? '+' : ''}{tick.v}σ
            </text>
          </g>
        ))}

        {/* Zero line emphasis */}
        <line
          x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY}
          stroke="var(--scanner-border2)" strokeWidth="1"
        />

        {/* S&P 500 line (accent/blue) */}
        <path d={sp500Path} fill="none" stroke="#79a8ff" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* FW 3000 line (green/red based on direction) */}
        <path d={fw3000Path} fill="none" stroke="#3ddba9" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* End-point dots + labels */}
        {sp500Data[sp500Data.length - 1] != null && (
          <>
            <circle
              cx={xScale(history.length - 1)} cy={yScale(sp500Data[sp500Data.length - 1])}
              r="2.5" fill="#79a8ff"
            />
            <text
              x={W - PAD.right + 4} y={yScale(sp500Data[sp500Data.length - 1]) + 3}
              fontSize="8" fill="#79a8ff" fontFamily="IBM Plex Mono, monospace"
            >
              {fmtSigma(sp500Data[sp500Data.length - 1])}
            </text>
          </>
        )}
        {fw3000Data[fw3000Data.length - 1] != null && (
          <>
            <circle
              cx={xScale(history.length - 1)} cy={yScale(fw3000Data[fw3000Data.length - 1])}
              r="2.5" fill="#3ddba9"
            />
            <text
              x={W - PAD.right + 4} y={yScale(fw3000Data[fw3000Data.length - 1]) + 3}
              fontSize="8" fill="#3ddba9" fontFamily="IBM Plex Mono, monospace"
            >
              {fmtSigma(fw3000Data[fw3000Data.length - 1])}
            </text>
          </>
        )}

        {/* X-axis labels */}
        {xLabels.map((xl, i) => (
          <text
            key={i}
            x={xScale(xl.i)} y={H - 8}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            fontSize="7" fill="var(--scanner-text3)"
            fontFamily="IBM Plex Mono, monospace"
          >
            {xl.label}
          </text>
        ))}

        {/* Legend */}
        <g transform={`translate(${PAD.left}, 8)`}>
          <line x1="0" y1="0" x2="12" y2="0" stroke="#79a8ff" strokeWidth="1.5" />
          <text x="16" y="3" fontSize="8" fill="var(--scanner-text2)" fontFamily="IBM Plex Mono, monospace">S&P 500</text>
          <line x1="70" y1="0" x2="82" y2="0" stroke="#3ddba9" strokeWidth="1.5" />
          <text x="86" y="3" fontSize="8" fill="var(--scanner-text2)" fontFamily="IBM Plex Mono, monospace">FW 3000</text>
        </g>
      </svg>

      <div className="text-[8px] mt-2" style={{ color: 'var(--scanner-text3)' }}>
        S&P σ &gt; FW3000 σ → mega-cap shielding · S&P σ &lt; FW3000 σ → broad risk-on · Data: <a href="https://factorwatch.ai" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>factorwatch.ai</a>
      </div>
    </section>
  );
}
