/**
 * EMA — industry-standard (TradingView / SierraCharts compatible)
 * Seed: SMA of first `period` bars
 * Multiplier: k = 2 / (period + 1)
 * Recurrence: EMA_i = close_i * k + EMA_(i-1) * (1 - k)
 */
export function calcEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  // Seed with simple average of first `period` candles
  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i];
  ema /= period;
  // Iterate remaining candles
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Rolling VWAP over N days — industry-standard (TradingView compatible)
 * Typical Price = (High + Low + Close) / 3
 * VWAP = Σ(TP * Volume) / Σ(Volume)
 * @param {Array} candles  — OHLCV candles sorted oldest→newest
 * @param {number} days    — lookback window in days
 * @param {number} candlesPerDay — how many candles equal one trading day
 */
export function calcVWAP(candles, days, candlesPerDay = 6) {
  if (!candles || candles.length < candlesPerDay) return null;
  const numCandles = Math.min(candles.length, days * candlesPerDay);
  let totalTPV = 0;
  let totalVol = 0;

  for (let i = candles.length - numCandles; i < candles.length; i++) {
    const c = candles[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    totalTPV += typicalPrice * c.vol;
    totalVol += c.vol;
  }
  return totalVol > 0 ? totalTPV / totalVol : null;
}

export function fmtPrice(p) {
  if (p == null || isNaN(p)) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.0001) return p.toFixed(6);
  return p.toExponential(3);
}

/**
 * RSI (Relative Strength Index) — Wilder's smoothing (TradingView-compatible)
 * Seed: simple average of first `period` gains/losses
 * Recurrence: avg = (prevAvg * (period - 1) + current) / period
 * RSI = 100 - (100 / (1 + avgGain / avgLoss))
 * @param {number[]} closes — closing prices, oldest→newest
 * @param {number} period — lookback period (standard: 14)
 * @returns {number|null} RSI value 0–100, or null if insufficient data
 */
export function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;

  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gainSum += delta;
    else lossSum += -delta;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function fmtPct(p) {
  if (p == null || isNaN(p)) return '—';
  const s = p >= 0 ? '+' : '';
  return `${s}${p.toFixed(2)}%`;
}