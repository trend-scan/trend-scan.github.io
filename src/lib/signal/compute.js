/**
 * compute.js — Pure signal computation module (v3.1 — backtested & tuned)
 *
 * Shared between:
 *   - scripts/signal/backtest.js (historical replay)
 *   - scripts/compute_signal_metrics.js (production snapshot builder)
 *
 * No React, no fetch, no browser APIs. Pure functions only.
 *
 * Backtest results (2023-10 to 2025-07, 10-day forward, BTC/ETH/SOL):
 *   STRONG: 62.0% hit rate, +5.02% avg 10-day return (363 signals)
 *   WEAK:   54.1% hit rate, -1.37% avg 10-day return (61 signals)
 *   NEUTRAL baseline: +2.99% avg
 *
 * Signal stack:
 *   1. adaptiveZ (90/365 blend) — price z-score, regime-aware
 *   2. adaptiveZWithPctile — non-parametric percentile (fat-tail detection)
 *   3. trendTenure — consecutive days closing above 50-MA
 *   4. atrExt50ma — extension from 50-MA in ATR units (volatility-normalized)
 *   5. RS vs BTC — 7-day return ratio (for majors)
 *   6. fundingZ — funding rate z-score (crowding/reversal risk)
 *   7. RSI (penalty only) — overbought penalty (>80 reduces STRONG)
 *   8. impulseZ (penalty only) — decelerating penalty (falling momentum)
 *   9. macroZ (boost) — external signal, boosts conf 7→8 when macroZ > 1.5
 */

// ─── Statistical primitives ──────────────────────────────────────────────────

export function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function stddev(arr, mu) {
  if (!arr || arr.length === 0) return 1;
  const m = mu ?? mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance) || 1;
}

export function sma(arr, period) {
  if (!arr || arr.length < period) return arr && arr.length ? mean(arr) : null;
  return mean(arr.slice(-period));
}

export function ema(arr, period) {
  if (!arr || arr.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    out[i] = arr[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/**
 * Adaptive Z-Score: blends short-term (responsive) z with long-term (structural) z.
 * shortZ * shortWeight + longZ * (1 - shortWeight)
 */
export function adaptiveZ(series, shortLen = 90, longLen = 365, shortWeight = 0.6) {
  if (!series || series.length < 10) return 0;
  const current = series[series.length - 1];
  const shortSlice = series.slice(-shortLen);
  const shortMean = mean(shortSlice);
  const shortStd = stddev(shortSlice, shortMean);
  const shortZ = shortStd > 0 ? (current - shortMean) / shortStd : 0;
  const longSlice = series.slice(-longLen);
  const longMean = mean(longSlice);
  const longStd = stddev(longSlice, longMean);
  const longZ = longStd > 0 ? (current - longMean) / longStd : 0;
  return shortZ * shortWeight + longZ * (1 - shortWeight);
}

/**
 * Adaptive Z-Score + percentile vs trailing lookback windows.
 */
export function adaptiveZWithPctile(series, shortLen = 90, longLen = 365, lookback = 252) {
  const z = adaptiveZ(series, shortLen, longLen);
  if (series.length < shortLen + lookback) return { z, pctile: 50 };
  const historicalZ = [];
  for (let i = series.length - lookback; i < series.length; i++) {
    const slice = series.slice(0, i + 1);
    if (slice.length >= shortLen + 10) historicalZ.push(adaptiveZ(slice, shortLen, longLen));
  }
  if (historicalZ.length === 0) return { z, pctile: 50 };
  const below = historicalZ.filter(h => h < z).length;
  return { z, pctile: (below / historicalZ.length) * 100 };
}

// ─── Additional signals ──────────────────────────────────────────────────────

export function computeRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

export function computeOBVSlope(candles, period = 13) {
  if (!candles || candles.length < period + 1) return 0;
  const obv = [0];
  for (let i = 1; i < candles.length; i++) {
    const dir = candles[i].close > candles[i - 1].close ? 1 :
                candles[i].close < candles[i - 1].close ? -1 : 0;
    obv.push(obv[i - 1] + dir * candles[i].volume);
  }
  const slice = obv.slice(-period);
  const n = slice.length;
  const xMean = (n - 1) / 2;
  const yMean = slice.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xMean) * (slice[i] - yMean); den += (i - xMean) ** 2; }
  const slope = den > 0 ? num / den : 0;
  const avgVol = mean(candles.slice(-period).map(c => c.volume)) || 1;
  return slope / avgVol;
}

export function computeImpulseZ(closes, deltaPeriod = 13, normPeriod = 52) {
  if (!closes || closes.length < deltaPeriod + normPeriod) return 0;
  const deltas = [];
  for (let i = closes.length - normPeriod; i < closes.length; i++) {
    if (i >= deltaPeriod) deltas.push(closes[i] - closes[i - deltaPeriod]);
  }
  if (deltas.length < 10) return 0;
  const current = deltas[deltas.length - 1];
  const mu = mean(deltas);
  const sd = stddev(deltas, mu);
  return sd > 0 ? Math.max(-3, Math.min(3, (current - mu) / sd)) : 0;
}

export function computeReturns(closes) {
  const n = closes.length;
  return {
    ret1d: n >= 2 ? closes[n - 1] / closes[n - 2] - 1 : 0,
    ret5d: n >= 6 ? closes[n - 1] / closes[n - 6] - 1 : 0,
    ret20d: n >= 21 ? closes[n - 1] / closes[n - 21] - 1 : 0,
    ret60d: n >= 61 ? closes[n - 1] / closes[n - 61] - 1 : 0,
  };
}

/**
 * Multi-Horizon Momentum Alignment — checks if returns across 6 timeframes
 * (1d, 3d, 5d, 10d, 20d, 60d) all point the same direction.
 *
 * Walk-forward validated (2024-07 to 2025-07 OOS):
 *   Bull alignment (all returns > +2%): price continues UP (momentum)
 *     → 52.4% OOS hit, +4.14% avg 10d return
 *   Bear alignment (all returns < -2%): price BOUNCES UP (mean reversion)
 *     → 57.1% OOS reversal hit, +2.66% avg 10d return
 *   Combined "expect price up": 55.2% at 10d, 55.4% at 20d, +7.27% avg
 *
 * The asymmetry is the key insight: bull alignment = momentum continuation,
 * bear alignment = mean reversion. Both are bullish for forward returns.
 *
 * @param {Array} closes — price series
 * @param {number} threshold — minimum return magnitude (default 0.02 = 2%)
 * @returns {object} { bullAligned, bearAligned, aligned }
 */
export function computeMultiHorizonAlignment(closes, threshold = 0.02) {
  const n = closes.length;
  if (n < 61) return { bullAligned: false, bearAligned: false, aligned: false };

  const ret1d = closes[n-1] / closes[n-2] - 1;
  const ret3d = closes[n-1] / closes[n-4] - 1;
  const ret5d = closes[n-1] / closes[n-6] - 1;
  const ret10d = closes[n-1] / closes[n-11] - 1;
  const ret20d = closes[n-1] / closes[n-21] - 1;
  const ret60d = closes[n-1] / closes[n-61] - 1;

  const returns = [ret1d, ret3d, ret5d, ret10d, ret20d, ret60d];

  // Bull alignment: all returns > +threshold (consistent uptrend → momentum continuation)
  const bullAligned = returns.every(r => r > threshold);

  // Bear alignment: all returns < -threshold (consistent downtrend → mean reversion bounce)
  const bearAligned = returns.every(r => r < -threshold);

  // Combined: either alignment predicts upward forward return (different mechanisms)
  const aligned = bullAligned || bearAligned;

  return { bullAligned, bearAligned, aligned };
}

/**
 * Macro Z-Score — log-price EMA crossover normalized by volatility.
 *
 * Provenance: Originates from the v9 trading system documented in
 * "BTCUSDT 4h Pattern Analytics v11 — OOS & Cross-Asset Validation"
 * (QR-2026-06 V11), where it appears as the `macro_z2` feature — one of
 * 146 engineered features in a multi-filter ensemble system.
 *
 * IMPORTANT — what is and isn't validated:
 *   The v11 report validates the FULL v9 system (5-filter pivot-low + 3-filter
 *   trend-continuation with MAE stops, on 4H bars). It does NOT validate
 *   macroZ as a standalone feature, on daily data, or as a confidence boost.
 *   TrendScan extracts this one feature, converts it from 4H to daily, and
 *   uses it in a completely different way than the v9 system did.
 *
 *   The v11 report's "walk-forward" test is pseudo-OOS (filters were selected
 *   on the full sample including the test period — the report itself says so).
 *   The only genuinely clean OOS test (June 2026) produced a negative Sharpe
 *   (-0.32). No transaction costs are modeled in any v11 numbers.
 *
 *   The ONLY test of macroZ in its actual TrendScan form (daily, standalone,
 *   as a confidence boost) is our own in-sample backtest (2023-10 to 2025-07),
 *   which showed 60.0% standalone bull hit rate and improved overall STRONG
 *   hit rate from 60.9% to 62.0% when used as a tiebreaker boost. This is
 *   in-sample and not walk-forward validated.
 *
 * Original 4H parameters (21/100/42) converted to daily equivalents:
 *   21×4H = 3.5 days → 4, 100×4H = 16.7 days → 17, 42×4H = 7 days → 7
 *
 * Integration: Used as a tiebreaker boost only (conf 7→8 when macroZ > 1.5).
 */
export function computeMacroZ(candles, params = {}) {
  const {
    fastLen = 4, slowLen = 17, volLen = 7,
    bullThreshold = 0.5, bearThreshold = -0.3,
  } = params;
  if (!candles || candles.length < slowLen + volLen) {
    return { macroZ: 0, bullSignal: false, bearSignal: false };
  }
  const logCloses = candles.map(c => Math.log(c.close));
  const logEmaFast = ema(logCloses, fastLen);
  const logEmaSlow = ema(logCloses, slowLen);
  const maDiff = logEmaFast[logEmaFast.length - 1] - logEmaSlow[logEmaSlow.length - 1];
  const logReturns = [];
  for (let i = 1; i < logCloses.length; i++) logReturns.push(logCloses[i] - logCloses[i - 1]);
  const volStd = stddev(logReturns.slice(-volLen)) || 0.001;
  const macroZ = maDiff / volStd;
  return {
    macroZ: round(macroZ, 3),
    bullSignal: macroZ >= bullThreshold,
    bearSignal: macroZ <= bearThreshold,
  };
}

// ─── Trend metrics ───────────────────────────────────────────────────────────

export function computeTrendTenure(closes) {
  if (!closes || closes.length < 51) return 0;
  const ma50Series = [];
  let sum = closes.slice(0, 50).reduce((a, b) => a + b, 0);
  ma50Series[49] = sum / 50;
  for (let i = 50; i < closes.length; i++) { sum += closes[i] - closes[i - 50]; ma50Series[i] = sum / 50; }
  let tenure = 0;
  for (let i = closes.length - 1; i >= 49; i--) {
    if (closes[i] > ma50Series[i]) tenure++; else break;
  }
  return tenure;
}

export function computeAtr(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const alpha = 1 / period;
  for (let i = period; i < trs.length; i++) atr = trs[i] * alpha + atr * (1 - alpha);
  return atr;
}

export function computeAtrExt50ma(candles) {
  if (!candles || candles.length < 50) return null;
  const closes = candles.map(c => c.close);
  const ma50 = sma(closes, 50);
  const atr = computeAtr(candles, 14);
  if (!ma50 || !atr || atr <= 0) return null;
  return (closes[closes.length - 1] - ma50) / atr;
}

// ─── RS vs BTC ───────────────────────────────────────────────────────────────

export function computeRsVsBtc(candles, btcCandles, days = 7) {
  if (!candles || !btcCandles || candles.length < days + 1 || btcCandles.length < days + 1) {
    return { value: 1.0, label: 'NEUTRAL' };
  }
  const assetRet = candles[candles.length - 1].close / candles[candles.length - 1 - days].close - 1;
  const btcRet = btcCandles[btcCandles.length - 1].close / btcCandles[btcCandles.length - 1 - days].close - 1;
  if (Math.abs(btcRet) < 0.001) return { value: 1.0, label: 'NEUTRAL' };
  const value = assetRet / btcRet;
  let label = 'NEUTRAL';
  if (btcRet > 0) {
    if (value > 1.05) label = 'OUTPERFORMING';
    else if (value < 0.95) label = 'LAGGING';
  } else {
    if (assetRet > btcRet * 0.95) label = 'OUTPERFORMING';
    else if (assetRet < btcRet * 1.05) label = 'LAGGING';
  }
  return { value, label };
}

// ─── Funding rate ────────────────────────────────────────────────────────────

export function getCurrentFunding(fundingHistory, asOfTs) {
  if (!fundingHistory || fundingHistory.length === 0) return null;
  let latest = null;
  for (let i = fundingHistory.length - 1; i >= 0; i--) {
    if (fundingHistory[i].ts <= asOfTs) { latest = fundingHistory[i]; break; }
  }
  if (!latest) return null;
  return { rate: latest.rate, annualizedPct: latest.rate * 3 * 365 * 100 };
}

export function fundingZScore(fundingHistory, asOfTs, lookback = 90) {
  if (!fundingHistory || fundingHistory.length < 10) return 0;
  // Accept either .ts (production format from compute_signal_metrics.js / Hyperliquid / OKX)
  // or .t (cached format in data/historical/*/funding.json from Binance archive).
  // Before 2026-07-21 this function only checked .ts, which silently returned 0
  // for every backtest using cached funding data — walk_forward_backtest.js,
  // ortho_integration_test.js, etc. — making gate 6 (fundingZ) effectively dead
  // in all backtests. The production snapshot was unaffected because live data
  // uses .ts. See /home/z/my-project/download/ORTHOSYS_INTEGRATION_TEST_FINDINGS.md
  // for the discovery trail.
  const ts = (f) => (f.ts != null ? f.ts : f.t);
  const window = fundingHistory.filter(f => ts(f) <= asOfTs).slice(-lookback);
  if (window.length < 10) return 0;
  const current = window[window.length - 1].rate;
  const rates = window.map(f => f.rate);
  const mu = mean(rates);
  const sd = stddev(rates, mu);
  return sd > 0 ? (current - mu) / sd : 0;
}

// ─── Multi-horizon context ───────────────────────────────────────────────────
//
// The primary stance uses adaptiveZ(90, 365) — a medium-term daily horizon.
// Multi-horizon context shows how the signal looks at three different
// lookback scales, using the SAME daily candles (no extra API calls):
//
//   short  — adaptiveZ(20, 90)   → 1-3 week momentum (RSI-like sensitivity)
//   medium — adaptiveZ(90, 365)  → 1-3 month trend (PRIMARY stance)
//   long   — adaptiveZ(180, 730) → 6-12 month structure (macro alignment)
//
// Each horizon returns a simplified stance: BULLISH / NEUTRAL / BEARISH
// based on z-score sign and magnitude (not the full 10-gate engine — that
// requires percentile lookback which exceeds long-horizon data length).
//
// Purpose: surface disagreement between timeframes. A STRONG medium-term
// verdict that conflicts with long-term BEARISH is materially different
// from one aligned with long-term BULLISH — without this, users see only
// the medium-term call.

export function computeHorizonStance(closes, shortLen, longLen) {
  if (!closes || closes.length < longLen + 10) {
    return { stance: 'NEUTRAL', z: null, insufficient: true };
  }
  const z = adaptiveZ(closes, shortLen, longLen);
  if (z >= 1.0) return { stance: 'BULLISH', z: round(z, 2), insufficient: false };
  if (z <= -1.0) return { stance: 'BEARISH', z: round(z, 2), insufficient: false };
  return { stance: 'NEUTRAL', z: round(z, 2), insufficient: false };
}

export function computeMultiHorizon(closes) {
  return {
    short:  computeHorizonStance(closes, 20, 90),
    medium: computeHorizonStance(closes, 90, 365),
    long:   computeHorizonStance(closes, 180, 730),
  };
}

// ─── Composite stance engine ────────────────────────────────────────────────

export function computeAssetStance({
  zScore, zPctile, trendTenure, atrExt, rsVsBtc, fundingZ,
  rsi, obvSlope, impulseZ, returns, macroZ, mhAlignment, isBtc = false,
  ablations = null,
}) {
  // Ablation support (optional — null/empty = no change, fully backward compatible).
  // Disabling a gate neutralizes its contribution to the stance/confidence calc.
  const ab = ablations instanceof Set ? ablations : new Set(Array.isArray(ablations) ? ablations : []);
  const zScoreEff     = ab.has('adaptiveZ')       ? 0                       : zScore;
  const zPctileEff    = ab.has('adaptiveZ')       ? 50                      : zPctile;
  const trendTenureEff= ab.has('trendTenure')     ? 0                       : trendTenure;
  const atrExtEff     = ab.has('atrExt50ma')      ? null                    : atrExt;
  const rsVsBtcEff    = ab.has('rsVsBtc')         ? { label: 'NEUTRAL', value: 1.0 } : rsVsBtc;
  const fundingZEff   = ab.has('fundingZ')        ? 0                       : fundingZ;
  const macroZEff     = ab.has('macroZBoost')     ? null                    : macroZ;
  const mhAlignmentEff= ab.has('mhAlignment')     ? { aligned: false, bullAligned: false, bearAligned: false } : mhAlignment;
  const returnsEff    = ab.has('returns')         ? null                    : returns;
  const skipRsiPenalty    = ab.has('rsiPenalty');
  const skipImpulsePenalty= ab.has('impulseZPenalty');

  const drivers = {
    zScore: round(zScoreEff, 2), zPctile: round(zPctileEff, 1), trendTenure: trendTenureEff,
    atrExt: atrExtEff != null ? round(atrExtEff, 2) : null,
    rsVsBtc: isBtc ? null : rsVsBtcEff?.label,
    rsVsBtcValue: isBtc ? null : round(rsVsBtcEff?.value, 3),
    fundingZ: round(fundingZEff, 2), rsi: round(rsi, 1),
    obvSlope: round(obvSlope, 3), impulseZ: round(impulseZ, 2),
    ret5d: returnsEff ? round(returnsEff.ret5d * 100, 2) : null,
    ret20d: returnsEff ? round(returnsEff.ret20d * 100, 2) : null,
    macroZ: macroZEff ? round(macroZEff.macroZ, 3) : null,
    mhAlignment: mhAlignment ? (mhAlignment.bullAligned ? 'BULL' : mhAlignment.bearAligned ? 'BEAR' : 'NONE') : null,
  };

  const stretchPositive = zScoreEff >= 1.0;
  const stretchNegative = zScoreEff <= -1.0;
  const stretchPresent = stretchPositive || stretchNegative;
  const persistent = trendTenureEff >= 3;
  const extremePctile = zPctileEff >= 80 || zPctileEff <= 20;
  const persistentOrExtreme = persistent || extremePctile;
  const healthyExtension = atrExtEff != null && atrExtEff >= 0 && atrExtEff <= 5;
  const overextended = atrExtEff != null && atrExtEff > 5;
  const deeplyOversold = atrExtEff != null && atrExtEff < -3;

  let confirmed = false, crowdingRisk = false;
  if (isBtc) { confirmed = fundingZEff < 1.0; crowdingRisk = fundingZEff > 2.0; }
  else { confirmed = rsVsBtcEff?.label === 'OUTPERFORMING'; crowdingRisk = fundingZEff > 2.0; }

  const rsiBullish = rsi > 60;
  const rsiBearish = rsi < 40;
  const rsiOverbought = rsi > 80;
  const rsiOversold = rsi < 20;
  const obvBullish = obvSlope > 0.1;
  const obvBearish = obvSlope < -0.1;
  const accelerating = impulseZ > 0.5;
  const decelerating = impulseZ < -0.5;
  const momAlignedBullish = returnsEff && returnsEff.ret5d > 0 && returnsEff.ret20d > 0;
  const momAlignedBearish = returnsEff && returnsEff.ret5d < 0 && returnsEff.ret20d < 0;

  let stance, confidence;

  if (stretchPositive && persistentOrExtreme && healthyExtension) {
    stance = 'CONSTRUCTIVE';
    confidence = 6;
    if (confirmed) confidence += 2;
    if (zPctileEff >= 80) confidence += 1;
    if (overextended) confidence -= 2;
    if (crowdingRisk) confidence -= 2;
    if (rsiOverbought && !skipRsiPenalty) confidence -= 1;
    if (decelerating && !skipImpulsePenalty) confidence -= 1;
    // Boosts fire at 7→8 (walk-forward validated: threshold 8 + 7→8 boosts = 54.5% OOS hit).
    // The 8→9 restructure was tested and REJECTED — it starved the boost of candidates
    // (only 36 OOS signals vs 343) and dropped hit rate to 47.2%. The walk-forward
    // "optimal threshold 9" was misleading because the threshold sweep tested WITHOUT
    // boosts active. With boosts, threshold 8 captures the boosted signals and they
    // perform well OOS.
    if (macroZEff) {
      if (confidence === 7 && macroZEff.macroZ > 2.5) confidence = 9;
      else if (confidence === 7 && macroZEff.macroZ > 1.5) confidence = 8;
    }
    if (confidence === 7 && mhAlignmentEff?.aligned) {
      confidence = 8;
    }
  } else if (stretchNegative && !isBtc) {
    stance = 'DEFENSIVE';
    confidence = 5;
    if (persistent) confidence += 2;
    if (zPctileEff <= 20) confidence += 1;
    if (deeplyOversold) confidence += 1;
    if (confirmed) confidence += 1;
    let bearishGateCount = 0;
    if (rsiBearish) bearishGateCount++;
    if (obvBearish) bearishGateCount++;
    if (momAlignedBearish) bearishGateCount++;
    if (bearishGateCount >= 2) confidence += 1;
    if (rsiOversold) confidence -= 2;
    if (accelerating) confidence -= 1;
  } else if (stretchNegative && isBtc) {
    // DESIGN CHOICE (not empirical finding): BTC negative stretch → SELECTIVE, not DEFENSIVE.
    // Backtest showed BTC WEAK signals on negative stretch fired at major bottoms
    // (Feb/Jul/Aug 2024 — all had +13-19% forward returns). Rather than presenting
    // this as "BTC WEAK is correctly silent," we explicitly disable the DEFENSIVE
    // path for BTC price dips. BTC can still reach DEFENSIVE via overextended+crowded.
    stance = 'SELECTIVE';
    confidence = 4;
    if (persistent) confidence += 1;
    if (deeplyOversold) confidence += 1;
  } else if (overextended && crowdingRisk) {
    stance = 'DEFENSIVE';
    confidence = 6;
    if (rsiOverbought) confidence += 1;
    if (obvBearish) confidence += 1;
  } else if (stretchPositive && !persistent) {
    stance = 'SELECTIVE';
    confidence = 4;
    if (confirmed) confidence += 1;
    if (rsiBullish) confidence += 1;
  } else if (!stretchPresent && persistent && healthyExtension) {
    stance = 'SELECTIVE';
    confidence = 5;
    if (confirmed) confidence += 1;
    if (obvBullish) confidence += 1;
  } else {
    stance = 'WAIT';
    confidence = 2;
  }

  confidence = Math.max(1, Math.min(10, confidence));
  return { stance, confidence, drivers };
}

// ─── Verdict mapper ──────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS = {
  STRONG: 8,  // Walk-forward validated: 54.5% OOS hit, +5.70% avg (343 signals)
  WEAK: 8,    // OOS 41.6% hit — directional but below coin flip (expected for crypto)
};

export function mapStanceToVerdict(stance, confidence, thresholds = DEFAULT_THRESHOLDS) {
  if (stance === 'CONSTRUCTIVE' && confidence >= thresholds.STRONG) return 'STRONG';
  if (stance === 'DEFENSIVE' && confidence >= thresholds.WEAK) return 'WEAK';
  return 'NEUTRAL';
}

// ─── Main computation entry point ───────────────────────────────────────────

export function computeSignal({
  candles, fundingHistory = [], btcCandles = null,
  isBtc = false, thresholds = DEFAULT_THRESHOLDS, ablations = null,
}) {
  if (!candles || candles.length < 90) {
    return {
      verdict: 'NEUTRAL', confidence: 0, stance: 'WAIT',
      close: candles?.[candles.length - 1]?.close ?? null,
      drivers: { error: 'Insufficient data' },
    };
  }

  const closes = candles.map(c => c.close);
  const asOfTs = candles[candles.length - 1].ts;

  const { z, pctile } = adaptiveZWithPctile(closes, 90, 365, 252);
  const trendTenure = computeTrendTenure(closes);
  const atrExt = computeAtrExt50ma(candles);
  const rsVsBtc = !isBtc && btcCandles ? computeRsVsBtc(candles, btcCandles, 7) : null;
  const fundingZ = fundingZScore(fundingHistory, asOfTs, 90);
  const rsi = computeRSI(closes, 14);
  const obvSlope = computeOBVSlope(candles, 13);
  const impulseZ = computeImpulseZ(closes, 13, 52);
  const returns = computeReturns(closes);
  const macroZ = computeMacroZ(candles, { fastLen: 4, slowLen: 17, volLen: 7, bullThreshold: 0.5, bearThreshold: -0.3 });
  const mhAlignment = computeMultiHorizonAlignment(closes, 0.02);

  const stance = computeAssetStance({
    zScore: z, zPctile: pctile, trendTenure, atrExt, rsVsBtc, fundingZ,
    rsi, obvSlope, impulseZ, returns, macroZ, mhAlignment, isBtc, ablations,
  });

  const horizon = computeMultiHorizon(closes);

  const verdict = mapStanceToVerdict(stance.stance, stance.confidence, thresholds);
  return {
    verdict, confidence: stance.confidence, stance: stance.stance,
    close: closes[closes.length - 1], drivers: stance.drivers,
    horizon,
  };
}

function round(v, decimals) {
  if (v == null || !isFinite(v)) return null;
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}
