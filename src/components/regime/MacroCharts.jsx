/**
 * MacroCharts - Nowcast history charts using recharts
 */

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from 'recharts';

const CHART_COLORS = {
  growth: 'var(--scanner-green)',
  inflation: 'var(--scanner-red)',
  liquidity: 'var(--scanner-blue)',
  btc: 'var(--scanner-accent)',
  grid: 'var(--scanner-border)',
  text: 'var(--scanner-text3)',
  bg: 'var(--scanner-bg2)',
};

const CustomTooltip = ({ active, payload, label }) => {
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

  const { history = {}, btcPrice = [], quadrant = 'FLUX' } = regime;

  // Generate mock history if not available (for demo)
  const hasHistory = history.dates?.length > 0
  const chartData = hasHistory
    ? history.dates.map((date, i) => ({
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        growth: history.growthNowcast?.[i] ?? 50,
        inflation: history.inflationNowcast?.[i] ?? 50,
        liquidity: history.liquidityNowcast?.[i] ?? 50,
        btc: btcPrice[i] ?? null,
      }))
    : null;  // History not yet available — shows 'collecting data' message

  // BTC chart data (last 180 days)
  const btcChartData = btcPrice.length > 0
    ? btcPrice.slice(-180).map((price, i) => ({
        date: new Date(Date.now() - (180 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        price: price,
      }))
    : [];

  return (
    <div className="space-y-4">
      {/* Nowcast History Chart */}
      <div
        className="rounded-lg p-4"
        style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}
      >
        <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--scanner-text3)' }}>
          NOWCAST HISTORY · 90D
        </div>
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
      </div>

      {/* BTC Price Chart */}
      {btcChartData.length > 0 && (
        <div
          className="rounded-lg p-4"
          style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}
        >
          <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--scanner-text3)' }}>
            BTC PRICE · {btcChartData.length}D
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={btcChartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="btcGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.btc} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.btc} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 2" stroke={CHART_COLORS.grid} />
              <XAxis
                dataKey="date"
                tick={{ fill: CHART_COLORS.text, fontSize: 8 }}
                tickLine={{ stroke: CHART_COLORS.grid }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: CHART_COLORS.text, fontSize: 8 }}
                tickLine={{ stroke: CHART_COLORS.grid }}
                width={60}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                content={<CustomTooltip />}
                formatter={(value) => [`$${value.toLocaleString()}`, 'BTC']}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={CHART_COLORS.btc}
                strokeWidth={1.5}
                fill="url(#btcGradient)"
                name="BTC"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

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

// Generate mock history for demo
function generateMockHistory(days = 90) {
  const data = [];
  let growth = 50;
  let inflation = 50;
  let liquidity = 50;

  for (let i = 0; i < days; i++) {
    growth += (Math.random() - 0.5) * 4;
    growth = Math.max(20, Math.min(80, growth));

    inflation += (Math.random() - 0.5) * 4;
    inflation = Math.max(20, Math.min(80, inflation));

    liquidity += (Math.random() - 0.5) * 4;
    liquidity = Math.max(20, Math.min(80, liquidity));

    data.push({
      date: new Date(Date.now() - (days - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      growth: Math.round(growth * 10) / 10,
      inflation: Math.round(inflation * 10) / 10,
      liquidity: Math.round(liquidity * 10) / 10,
    });
  }

  return data;
}

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
