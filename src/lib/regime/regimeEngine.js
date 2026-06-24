/**
 * Regime Engine — Classifies market regime as RISK-ON / RISK-OFF / MIXED
 * Based on composite score from multiple regime indicators
 */

export const REGIME_LABELS = {
  RISK_ON: { label: 'RISK-ON',  color: 'risk-on',  bgColor: 'rgba(0,230,118,0.08)',  borderColor: 'rgba(0,230,118,0.25)' },
  RISK_OFF: { label: 'RISK-OFF', color: 'risk-off', bgColor: 'rgba(239,68,68,0.08)',   borderColor: 'rgba(239,68,68,0.25)' },
  MIXED:   { label: 'MIXED',    color: 'neutral',  bgColor: 'rgba(156,163,175,0.08)', borderColor: 'rgba(156,163,175,0.25)' },
};

/**
 * Compute regime classification from multiple signals
 * @param {Object} signals - Object containing regime indicator values
 * @returns {Object} Regime label and score
 */
export function computeRegime(signals) {
  const {
    btcTrend = 0,          // -1 to 1 (bearish to bullish)
    ethTrend = 0,          // -1 to 1
    altBreadth = 0.5,      // 0 to 1 (0% to 100% above MAs)
    btcDominance = 0.5,    // 0 to 1 (low = alt season)
    marketBreadth = 0.5,   // 0 to 1 (% of assets in uptrend)
    dollarFlow = 0,        // -1 to 1 (inflow/outflow proxy)
    volatility = 0.5,      // 0 to 1 (low to high)
  } = signals;

  // Composite score: weighted average of normalized signals
  // Positive = RISK-ON, Negative = RISK-OFF
  const weights = {
    btcTrend: 0.20,
    ethTrend: 0.15,
    altBreadth: 0.20,
    btcDominance: 0.15,   // Inverted: low dominance = alt season = risk-on
    marketBreadth: 0.15,
    dollarFlow: 0.10,
    volatility: 0.05,      // Inverted: high volatility often = risk-off
  };

  let score = 0;
  score += btcTrend * weights.btcTrend;
  score += ethTrend * weights.ethTrend;
  score += (altBreadth - 0.5) * 2 * weights.altBreadth;
  score += (1 - btcDominance - 0.5) * 2 * weights.btcDominance;
  score += (marketBreadth - 0.5) * 2 * weights.marketBreadth;
  score += dollarFlow * weights.dollarFlow;
  score += (1 - volatility - 0.5) * 2 * weights.volatility;

  // Classify based on composite score
  if (score > 0.15) {
    return { regime: 'RISK_ON', score, label: REGIME_LABELS.RISK_ON };
  } else if (score < -0.15) {
    return { regime: 'RISK_OFF', score, label: REGIME_LABELS.RISK_OFF };
  } else {
    return { regime: 'MIXED', score, label: REGIME_LABELS.MIXED };
  }
}

/**
 * Build regime signals from board data
 */
export function buildRegimeSignals(data) {
  const { benchmarks, themes, regime } = data || {};

  if (!benchmarks || !themes) {
    return { regime: 'MIXED', score: 0, label: REGIME_LABELS.MIXED, signals: {} };
  }

  // BTC trend signal
  const btc = benchmarks.find(b => b.symbol === 'BTC');
  const btcTrend = (btc?.distMa20 ?? 0) > 0 && (btc?.distMa50 ?? 0) > 0 ? 1
    : (btc?.distMa20 ?? 0) < 0 && (btc?.distMa50 ?? 0) < 0 ? -1
    : 0;

  // ETH trend signal
  const eth = benchmarks.find(b => b.symbol === 'ETH');
  const ethTrend = (eth?.distMa20 ?? 0) > 0 && (eth?.distMa50 ?? 0) > 0 ? 1
    : (eth?.distMa20 ?? 0) < 0 && (eth?.distMa50 ?? 0) < 0 ? -1
    : 0;

  // Alt breadth from regime object
  const altBreadth = (regime?.pctAbove50 ?? 50) / 100;

  // BTC dominance (simplified - would need external data)
  // Default to 0.5 (neutral) if not provided
  const btcDominance = 0.5;

  // Market breadth
  const marketBreadth = (regime?.pctAbove50 ?? 50) / 100;

  // Dollar flow proxy (simplified - based on new highs vs new lows)
  const newHighs = regime?.newHigh20d ?? 0;
  const upBig = regime?.upBig ?? 0;
  const dollarFlow = newHighs > 5 && upBig > 10 ? 0.5 : newHighs === 0 ? -0.5 : 0;

  // Volatility proxy (simplified - based on large moves)
  const downBig = regime?.downBig ?? 0;
  const volatility = downBig > 10 ? 0.8 : downBig > 5 ? 0.6 : 0.4;

  const signals = {
    btcTrend,
    ethTrend,
    altBreadth,
    btcDominance,
    marketBreadth,
    dollarFlow,
    volatility,
  };

  const result = computeRegime(signals);
  return { ...result, signals };
}

/**
 * Compute composite gauge value for visualization
 * @param {number} score - Raw composite score (-1 to 1)
 * @returns {number} Gauge value (0 to 100)
 */
export function scoreToGauge(score) {
  // Map -1 to 1 to 0 to 100
  return Math.round(((score + 1) / 2) * 100);
}