/**
 * Regime Data Sources — Mock data generators for regime indicators
 * In production, these would fetch from external APIs
 */

import { buildRegimeSignals } from './regimeEngine.js';

/**
 * Get regime data by combining board data with external signals
 * This is a simplified version that uses only board data
 */
export function getRegimeData(data) {
  const { regimeLabel, signals, score } = buildRegimeSignals(data) || {};

  return {
    regime: regimeLabel || { label: 'MIXED', color: 'neutral' },
    score: score || 0,
    signals: signals || {},
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build regime history for charts (mock data for demo)
 * In production, this would fetch historical regime data
 */
export function buildRegimeHistory(days = 30) {
  const history = [];
  const now = Date.now();

  for (let i = days; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dayOffset = days - i;

    // Generate somewhat realistic regime history with some persistence
    let regime = 'MIXED';
    const rand = Math.random();

    if (i === days) {
      // First day starts mixed
      regime = rand > 0.5 ? 'RISK_ON' : rand > 0.3 ? 'RISK_OFF' : 'MIXED';
    } else {
      // Subsequent days have some persistence
      const prev = history[history.length - 1]?.regime || 'MIXED';
      const persistence = 0.7; // 70% chance of staying in same regime

      if (Math.random() < persistence) {
        regime = prev;
      } else {
        regime = rand > 0.5 ? 'RISK_ON' : rand > 0.3 ? 'RISK_OFF' : 'MIXED';
      }
    }

    const score = regime === 'RISK_ON' ? 0.2 + Math.random() * 0.6
      : regime === 'RISK_OFF' ? -0.2 - Math.random() * 0.6
      : (Math.random() - 0.5) * 0.3;

    history.push({
      day: dayOffset,
      date: date.toISOString().split('T')[0],
      regime,
      score: Math.round(score * 100) / 100,
    });
  }

  return history;
}

/**
 * Regime indicator definitions with thresholds
 */
export const REGIME_INDICATORS = [
  {
    id: 'btc_trend',
    name: 'BTC Trend',
    description: 'Bitcoin above/below key moving averages',
    positive: 'BTC in uptrend (above 20+50MA)',
    negative: 'BTC in downtrend (below 20+50MA)',
    weight: 0.20,
  },
  {
    id: 'eth_trend',
    name: 'ETH Trend',
    description: 'Ethereum above/below key moving averages',
    positive: 'ETH in uptrend',
    negative: 'ETH in downtrend',
    weight: 0.15,
  },
  {
    id: 'alt_breadth',
    name: 'Alt Breadth',
    description: 'Percentage of alts above 50-day MA',
    positive: '>60% alts above MA',
    negative: '<40% alts above MA',
    weight: 0.20,
  },
  {
    id: 'btc_dominance',
    name: 'BTC Dominance',
    description: 'Bitcoin dominance trend (inverted: low = alt season)',
    positive: 'Alt season (low dominance)',
    negative: 'BTC season (high dominance)',
    weight: 0.15,
  },
  {
    id: 'market_breadth',
    name: 'Market Breadth',
    description: 'Overall market participation',
    positive: 'Broad participation (>60%)',
    negative: 'Weak participation (<40%)',
    weight: 0.15,
  },
  {
    id: 'dollar_flow',
    name: 'Flow Signal',
    description: 'Net new highs and strong movers',
    positive: 'Strong inflows (many new highs)',
    negative: 'Weak inflows (few new highs)',
    weight: 0.10,
  },
  {
    id: 'volatility',
    name: 'Volatility',
    description: 'Market volatility regime (inverted)',
    positive: 'Low volatility (calm markets)',
    negative: 'High volatility (turbulent markets)',
    weight: 0.05,
  },
];

/**
 * Get color for regime indicator signal
 */
export function getSignalColor(value, inverted = false) {
  const actual = inverted ? -value : value;
  if (actual > 0.3) return 'var(--scanner-green)';
  if (actual < -0.3) return 'var(--scanner-red)';
  return 'var(--scanner-text2)';
}