/**
 * MacroCharts - Nowcast history charts using recharts
 */

import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

const CHART_COLORS = {
  growth: 'var(--scanner-green)',
  inflation: 'var(--scanner-red)',
  liquidity: 'var(--scanner-blue)',
  grid: 'var(--scanner-border)',
  text: 'var(--scanner-text3)',
  bg: 'var(--scanner-bg2)',
};

/**
 * Custom recharts tooltip. Recharts passes `active`, `payload`, and `label`
 * props at runtime, but TypeScript can't infer them from the JSX context.
 *
 * @param {object} props
 * @param {boolean} [props.active]
 * @param {Array} [props.payload]
 * @param {any} [props.label]
 */
const CustomTooltip = ({ active, payload, label } = {}) => {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="rounded p-2 text-[9px]"
      style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}
    >
      <div className="mb-1" style={{ color: 'var(--scanner-text3)' }}>
        {label}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  );
};

export default function MacroCharts({ regime }) {
  // ── Nowcast history: server-side snapshot first, localStorage as fallback ──
  // The server (build_snapshot.js) appends today's nowcast to a 90-day rolling
  // array in snapshot.json. This ensures ALL users see the same history
  // regardless of device/cache state (fixes Incognito + cache-clear issues).
  //
  // localStorage is still checked for today's entry (which may be newer than
  // the server's 3×-daily snapshot). We merge: server history + today's local
  // entry if it exists and is newer.
  //
  // Hooks MUST be called before any early return (rules of hooks).
  const [chartData, setChartData] = useState(null);
  const [historyDays, setHistoryDays] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch server-side history from snapshot.json
        const snapRes = await fetch('/snapshot.json');
        const snap = snapRes.ok ? await snapRes.json() : null;
        const serverHistory = snap?.regime_history || [];

        // Read localStorage for today's intraday entry
        const localHistory = JSON.parse(localStorage.getItem('trendscan_regime_history') || '[]');

        // Merge: server history (authoritative) + any newer local entry for today
        const today = new Date().toISOString().split('T')[0];
        const localToday = localHistory.find(h => h.date === today);
        const serverHasToday = serverHistory.some(h => h.date === today);

        let merged;
        if (localToday && !serverHasToday) {
          merged = [...serverHistory, localToday];
        } else if (localToday && serverHasToday) {
          merged = serverHistory;  // server is authoritative
        } else {
          merged = serverHistory.length > 0 ? serverHistory : localHistory;
        }

        // Sort by date and cap at 90 days
        merged = merged
          .slice()
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .slice(-90);

        if (!cancelled && merged.length > 0) {
          setHistoryDays(merged.length);
          setChartData(merged.map(h => ({
            date: new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
            growth: typeof h.growthNowcast === 'number' ? h.growthNowcast : 50,
            inflation: typeof h.inflationNowcast === 'number' ? h.inflationNowcast : 50,
            liquidity: typeof h.liquidityNowcast === 'number' ? h.liquidityNowcast : 50,
          })));
        }
      } catch {
        // fetch or parse failed — leave chartData as null
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!regime) {
    return (
      <div
        className="rounded-lg p-4 border"
        style={{ background: 'var(--scanner-bg2)', borderColor: 'var(--scanner-border2)' }}
      >
        <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--scanner-text3)' }}>
          REGIME HISTORY
        </div>
        <div className="h-64 flex items-center justify-center" style={{ color: 'var(--scanner-text3)' }}>
          Loading charts...
        </div>
      </div>
    );
  }

  const { quadrant = 'FLUX' } = regime;

  return (
    <div className="space-y-4">
      {/* Nowcast History Chart */}
      <div
        className="rounded-lg p-4"
        style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-[9px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
            NOWCAST HISTORY{historyDays > 0 ? ` · ${historyDays}D` : ''}
          </div>
          {historyDays > 0 && historyDays < 30 && (
            <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
              collecting data ({historyDays}/90 days)
            </div>
          )}
        </div>
        {chartData && chartData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="2 2" stroke={CHART_COLORS.grid} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: CHART_COLORS.text, fontSize: 8 }}
                  tickLine={{ stroke: CHART_COLORS.grid }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: CHART_COLORS.text, fontSize: 8 }}
                  tickLine={{ stroke: CHART_COLORS.grid }}
                  width={30}
                />
                <Tooltip content={<CustomTooltip />} />
                {/* Reference lines */}
                <ReferenceLine y={55} stroke="var(--scanner-border)" strokeDasharray="3 3" />
                <ReferenceLine y={45} stroke="var(--scanner-border)" strokeDasharray="3 3" />
                <ReferenceLine y={50} stroke="var(--scanner-text3)" strokeDasharray="1 1" />
                {/* Data lines */}
                <Line
                  type="monotone"
                  dataKey="growth"
                  stroke={CHART_COLORS.growth}
                  strokeWidth={1.5}
                  dot={false}
                  name="Growth"
                />
                <Line
                  type="monotone"
                  dataKey="inflation"
                  stroke={CHART_COLORS.inflation}
                  strokeWidth={1.5}
                  dot={false}
                  name="Inflation"
                />
                <Line
                  type="monotone"
                  dataKey="liquidity"
                  stroke={CHART_COLORS.liquidity}
                  strokeWidth={1.5}
                  dot={false}
                  name="Liquidity"
                />
              </LineChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div className="flex items-center justify-center gap-6 mt-2 text-[8px]">
              <div className="flex items-center gap-1">
                <div className="w-3 h-0.5" style={{ background: CHART_COLORS.growth }} />
                <span style={{ color: CHART_COLORS.growth }}>Growth</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-0.5" style={{ background: CHART_COLORS.inflation }} />
                <span style={{ color: CHART_COLORS.inflation }}>Inflation</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-0.5" style={{ background: CHART_COLORS.liquidity }} />
                <span style={{ color: CHART_COLORS.liquidity }}>Liquidity</span>
              </div>
            </div>
          </>
        ) : (
          // First-visit empty state: show a clear "collecting data" message
          // instead of an empty chart. The history fills in as the user
          // visits daily.
          <div className="h-[200px] flex flex-col items-center justify-center text-center px-4">
            <div className="text-2xl mb-3 opacity-30">📊</div>
            <div className="text-[10px] mb-1" style={{ color: 'var(--scanner-text2)' }}>
              Collecting nowcast history
            </div>
            <div className="text-[9px] leading-relaxed max-w-xs" style={{ color: 'var(--scanner-text3)' }}>
              This chart fills in over time as you visit daily. Each visit records
              today's growth/inflation/liquidity nowcast scores to your browser's
              local storage. After 7+ days you'll see a meaningful trend line.
            </div>
          </div>
        )}
      </div>

      {/* Current Regime Badge */}
      <div
        className="rounded-lg p-4 flex items-center justify-between"
        style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}
      >
        <div>
          <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: 'var(--scanner-text3)' }}>
            Current Regime
          </div>
          <div className="text-[16px] font-bold" style={{ color: 'var(--scanner-accent)' }}>
            {quadrant}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: 'var(--scanner-text3)' }}>
            Season
          </div>
          <div className="text-[16px] font-bold" style={{ color: 'var(--scanner-accent)' }}>
            {getSeasonEmoji(quadrant)}
          </div>
        </div>
      </div>
    </div>
  );
}

// Note: previously had a generateMockHistory() function for demo data.
// Removed — the Nowcast History chart now reads real data from
// localStorage ('trendscan_regime_history'), which MacroRegime.jsx
// populates with one entry per day containing the actual computed
// growth/inflation/liquidity nowcast scores.

function getSeasonEmoji(quadrant) {
  const map = {
    GOLDILOCKS: '🌸 SPRING',
    OVERHEAT: '☀️ SUMMER',
    STAGFLATION: '🍂 FALL',
    CONTRACTION: '❄️ WINTER',
    TRANSITIONAL: '🔄 FLUX',
  };
  return map[quadrant] || '🔄 FLUX';
}
