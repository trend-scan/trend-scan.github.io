/**
 * Regime Signals - Growth, Inflation, Liquidity Composites + TOTAL3ES Allocation
 */

import {
  adaptiveZ,
  sma,
  pctROC,
  yoyROC,
  pointChange,
  computeRSI,
  computeOBV,
} from './regimeCalculations.js';

// ─── Growth Composite ─────────────────────────────────────────────────────────

export function computeGrowthSignals(data) {
  const {
    btcPrice = [],
    ethPrice = [],
    ethBtcRatio = [],
    fearGreed = [],
    totalVolume = 0,
    btcDominance = [],
    fred = {},
    fredAvailable = false,
  } = data;

  const signals = [];

  // G1: BTC 90d Momentum
  const btcROC90 = pctROC(btcPrice, 90);
  signals.push({ name: 'BTC 90D ROC', value: adaptiveZ(btcROC90 > 0 ? btcPrice : btcPrice.map(v => -v), 52, 180), weight: 1.75, raw: btcROC90 });

  // G2: Altcoin Market Cap Trend (ETH price as proxy)
  const ethTrend = ethPrice.length > 30 ? pctROC(ethPrice, 30) : 0;
  signals.push({ name: 'ETH Momentum', value: adaptiveZ(ethPrice, 60, 180), weight: 1.50, raw: ethTrend });

  // G3: ETH/BTC Ratio Trend
  if (ethBtcRatio.length > 90) {
    const ethBtcZ = adaptiveZ(ethBtcRatio, 60, 180);
    signals.push({ name: 'ETH/BTC Ratio', value: ethBtcZ, weight: 1.25, raw: pctROC(ethBtcRatio, 30) });
  }

  // G4: Fear & Greed Level
  if (fearGreed.length > 30) {
    signals.push({ name: 'Fear & Greed', value: adaptiveZ(fearGreed, 30, 90), weight: 1.00, raw: fearGreed.at(-1) });
  }

  // G5: Total Crypto Volume ROC
  // Use BTC volume as proxy for total volume
  if (data.btcVolume?.length > 30) {
    const volZ = adaptiveZ(data.btcVolume, 30, 90);
    signals.push({ name: 'Volume Trend', value: volZ, weight: 0.75, raw: pctROC(data.btcVolume, 13) });
  }

  // G6: USDT Dominance (inverse - high = risk-off)
  if (data.usdtDominance?.length > 30) {
    signals.push({ name: 'USDT.D (inv)', value: adaptiveZ(data.usdtDominance, 30, 90) * -1, weight: 1.25 });
  }

  // G7: BTC above 200-day MA
  if (btcPrice.length > 200) {
    const btc200MA = sma(btcPrice, 200);
    const btcAbove = btcPrice.at(-1) > btc200MA ? 1 : -1;
    signals.push({ name: 'BTC > 200MA', value: btcAbove, weight: 1.00 });
  }

  // G8: HY Spread (FRED, inverse)
  if (fredAvailable && fred.BAMLH0A0HYM2?.length > 30) {
    const hyZ = adaptiveZ(fred.BAMLH0A0HYM2.map(d => d.value), 52, 104);
    signals.push({ name: 'HY Spread (inv)', value: hyZ * -1, weight: 1.50, raw: fred.BAMLH0A0HYM2.at(-1)?.value , requiresFred: true });
  }

  // G9: Initial Jobless Claims (FRED, inverse)
  if (fredAvailable && fred.ICSA?.length > 13) {
    const claimsZ = adaptiveZ(fred.ICSA.map(d => d.value), 13, 52);
    signals.push({ name: 'Claims (inv)', value: claimsZ * -1, weight: 1.50, raw: pctROC(fred.ICSA.map(d => d.value), 13) , requiresFred: true });
  }

  return signals;
}

export function classifyGrowthRegime(growthZ) {
  if (growthZ >= 1.00) return 'BOOM';
  if (growthZ >= 0.50) return 'EXPANSION';
  if (growthZ <= -0.50) return 'RECESSIONARY';
  return 'NEUTRAL';
}

// ─── Inflation Composite ───────────────────────────────────────────────────────

export function computeInflationSignals(data) {
  const {
    btcPrice = [],
    goldPrice = [],
    usdtDominance = [],
    fearGreed = [],
    fred = {},
    fredAvailable = false,
  } = data;

  const signals = [];

  // I1: BTC/Gold Ratio ROC
  if (btcPrice.length > 90 && goldPrice.length > 90) {
    const minLen = Math.min(btcPrice.length, goldPrice.length);
    const btcSlice = btcPrice.slice(-minLen);
    const goldSlice = goldPrice.slice(-minLen);
    const btcGoldRatio = btcSlice.map((b, i) => b / (goldSlice[i] || 1));
    const btcGoldROC = pctROC(btcGoldRatio, 90);
    signals.push({ name: 'BTC/Gold ROC', value: adaptiveZ(btcGoldRatio, 60, 180), weight: 1.50, raw: btcGoldROC });
  }

  // I2: Gold Price ROC (YoY) - Key signal
  if (goldPrice.length > 365) {
    const goldYoY = yoyROC(goldPrice, 365);
    signals.push({ name: 'Gold YoY', value: adaptiveZ(goldPrice, 90, 365), weight: 1.75, raw: goldYoY });
  }

  // I3: BTC Volatility as oil proxy
  if (btcPrice.length > 90) {
    const btcVolZ = adaptiveZ(btcPrice, 30, 90);
    signals.push({ name: 'BTC Volatility', value: btcVolZ, weight: 0.75 });
  }

  // I4: USDT Dominance - high = inflation fear
  if (usdtDominance.length > 30) {
    signals.push({ name: 'USDT.D', value: adaptiveZ(usdtDominance, 30, 90), weight: 1.00, raw: usdtDominance.at(-1) });
  }

  // I5: Fear & Greed (inverse for inflation)
  if (fearGreed.length > 30) {
    signals.push({ name: 'F&G (inv)', value: adaptiveZ(fearGreed, 30, 90) * -1, weight: 0.75 });
  }

  // I6: 10Y Breakeven Inflation (FRED)
  if (fredAvailable && fred.T10YIE?.length > 30) {
    const t10yZ = adaptiveZ(fred.T10YIE.map(d => d.value), 52, 104);
    signals.push({ name: '10Y Breakeven', value: t10yZ, weight: 1.75, raw: fred.T10YIE.at(-1)?.value , requiresFred: true });
  }

  // I7: 5Y5Y Forward Inflation (FRED)
  if (fredAvailable && fred.T5YIFR?.length > 30) {
    const t5yZ = adaptiveZ(fred.T5YIFR.map(d => d.value), 52, 104);
    signals.push({ name: '5Y5Y Fwd', value: t5yZ, weight: 1.50, raw: fred.T5YIFR.at(-1)?.value , requiresFred: true });
  }

  // I8: CPI YoY Point Change (FRED)
  if (fredAvailable && fred.CPIAUCSL?.length > 13) {
    const cpiSeries = fred.CPIAUCSL.map(d => d.value);
    const cpiChange = pointChange(cpiSeries, 12); // 12 months
    signals.push({ name: 'CPI Change', value: adaptiveZ(cpiSeries, 13, 52) * (cpiChange > 0 ? 1 : -1), weight: 1.00, raw: cpiChange , requiresFred: true });
  }

  return signals;
}

export function classifyInflationRegime(inflZ) {
  if (inflZ >= 1.00) return 'HOT';
  if (inflZ >= 0.50) return 'REINFLATION';
  if (inflZ <= -0.50) return 'DISINFLATION';
  return 'NEUTRAL';
}

// ─── Liquidity Composite ───────────────────────────────────────────────────────

export function computeLiquiditySignals(data) {
  const {
    btcDominance = [],
    usdtDominance = [],
    totalMarketCap = 0,
    fearGreed = [],
    ethBtcRatio = [],
    btcPrice = [],
    btcVolume = [],
    fred = {},
    fredAvailable = false,
  } = data;

  const signals = [];

  // L1: BTC Dominance ROC (inverse)
  if (btcDominance.length > 30) {
    signals.push({ name: 'BTC.D ROC (inv)', value: adaptiveZ(btcDominance, 30, 90) * -1, weight: 1.25, raw: pctROC(btcDominance, 30) });
  }

  // L2: USDT Dominance (inverse - falling = money deploying)
  if (usdtDominance.length > 30) {
    signals.push({ name: 'USDT.D (inv)', value: adaptiveZ(usdtDominance, 30, 90) * -1, weight: 1.50, raw: pctROC(usdtDominance, 30) });
  }

  // L3: Total Crypto Market Cap ROC
  if (btcPrice.length > 30) {
    const capZ = adaptiveZ(btcPrice, 30, 90); // Use BTC price as proxy for market cap trend
    signals.push({ name: 'Market Cap Trend', value: capZ, weight: 1.50, raw: pctROC(btcPrice, 30) });
  }

  // L4: Fear & Greed
  if (fearGreed.length > 30) {
    signals.push({ name: 'Fear & Greed', value: adaptiveZ(fearGreed, 30, 90), weight: 1.00 });
  }

  // L5: ETH/BTC Ratio (risk-on proxy)
  if (ethBtcRatio.length > 30) {
    signals.push({ name: 'ETH/BTC Ratio', value: adaptiveZ(ethBtcRatio, 30, 90), weight: 1.25, raw: pctROC(ethBtcRatio, 13) });
  }

  // L6: Volume/Market Cap Ratio
  if (btcVolume.length > 30 && btcPrice.length > 30) {
    // Volume relative to price - high volume with flat price = distribution
    const volROC = pctROC(btcVolume, 13);
    signals.push({ name: 'Vol/Cap Ratio', value: volROC > 0 ? 1 : -1, weight: 0.75 });
  }

  // L7: Fed Net Liquidity YoY (FRED)
  if (fredAvailable && fred.FED_NET_LIQ?.length > 365) {
    const fedNetLiqSeries = fred.FED_NET_LIQ.map(d => d.value);
    const fedZ = adaptiveZ(fedNetLiqSeries, 52, 104);
    signals.push({ name: 'Fed Net Liq', value: fedZ, weight: 2.00, raw: yoyROC(fedNetLiqSeries, 52) , requiresFred: true });
  }

  // L8: US M2 ROC (FRED)
  if (fredAvailable && fred.M2SL?.length > 13) {
    const m2Series = fred.M2SL.map(d => d.value);
    const m2Z = adaptiveZ(m2Series, 13, 52);
    signals.push({ name: 'M2 ROC', value: m2Z, weight: 1.75, raw: pctROC(m2Series, 13) , requiresFred: true });
  }

  // L9: NFCI (inverse)
  if (fredAvailable && fred.NFCI?.length > 13) {
    const nfciZ = adaptiveZ(fred.NFCI.map(d => d.value), 13, 52);
    signals.push({ name: 'NFCI (inv)', value: nfciZ * -1, weight: 1.50, raw: fred.NFCI.at(-1)?.value , requiresFred: true });
  }

  return signals;
}

export function classifyLiquidityRegime(liqZ) {
  if (liqZ >= 1.00) return 'VERY LOOSE';
  if (liqZ >= 0.50) return 'LOOSE';
  if (liqZ <= -0.50) return 'TIGHT';
  return 'NEUTRAL';
}

// ─── TOTAL3ES Allocation Signals ───────────────────────────────────────────────

export function computeUltra6(data, growthNowcast, liqMeZ, quadrant, liquidity) {
  const { btcPrice = [], ethPrice = [], btcDominance = [], ethBtcRatio = [] } = data;

  const btcClose = btcPrice.at(-1) ?? 0;
  const btcSMA50 = sma(btcPrice, 50);
  const btcDomROC = pctROC(btcDominance, 8);
  const ethBtcROC = pctROC(ethBtcRatio, 8);

  const signals = {
    U1_macroFavorable: ['GOLDILOCKS', 'OVERHEAT'].includes(quadrant),
    U2_liqLoose: liqMeZ > 0,
    U3_btcAbove50ma: btcClose > btcSMA50,
    U4_ethBtcPositive: ethBtcROC > -1,
    U5_growthPositive: growthNowcast > 50,
    U6_btcDomDecline: btcDomROC < 0,
  };

  const score = Object.values(signals).filter(Boolean).length;
  return { signals, score, on: score >= 4 };
}

export function computeOB1Signals(data) {
  const {
    ethPrice = [],
    btcPrice = [],
    btcVolume = [],
    usdtDominance = [],
    ethBtcRatio = [],
  } = data;

  // OBV for ETH (proxy for total3es)
  const ethObv = computeOBV(ethPrice, btcVolume);
  const obvSlope13 = ethObv.length > 14 ? ethObv.at(-1) - ethObv.at(-14) : 0;

  // Volume acceleration
  const volROC4 = pctROC(btcVolume, 4);
  const volROC13 = pctROC(btcVolume, 13);

  // BTC volume vs MA
  const btcVol20ma = sma(btcVolume, 20);
  const btcVolCurrent = btcVolume.at(-1) ?? 0;

  // USDT.D ROC
  const usdtDomROC = pctROC(usdtDominance, 8);

  // ETH/BTC ROC
  const ethBtcROC = pctROC(ethBtcRatio, 8);

  // RSI of ETH
  const ethRSI = computeRSI(ethPrice, 14);
  const ethRSIPrev = ethPrice.length > 15 ? computeRSI(ethPrice.slice(0, -1), 14) : 50;

  const signals = {
    OB1_obvRising: obvSlope13 > 0,
    OB1_volAccel: volROC4 > volROC13,
    OB1_btcVolAbove20ma: btcVolCurrent > btcVol20ma,
    OB1_usdtDomFalling: usdtDomROC < 0,
    OB1_rsiRecovering: ethRSI > ethRSIPrev,
    OB1_ethBtcStable: ethBtcROC >= -1,
  };

  const score = Object.values(signals).filter(Boolean).length;
  return { signals, score, on: score >= 3 };
}

export function computeAllocation(ultra6, ob1, core9Score, btcPrice) {
  const btcAbove50MA = btcPrice?.length > 50
    ? btcPrice.at(-1) > sma(btcPrice, 50)
    : false;
  const bothOn = ultra6.on && ob1.on;

  if (!bothOn) {
    return {
      status: 'STABLECOINS',
      vehicle: null,
      conviction: 'NONE',
      icon: '◆',
      description: 'No crypto allocation. Wait for signal.',
    };
  }

  if (core9Score >= 8 && btcAbove50MA) {
    return {
      status: 'ALLOCATE',
      vehicle: 'T3 BASKET',
      conviction: 'MAXIMUM',
      icon: '★',
      description: 'Maximum conviction. Execute via BTC or alt basket.',
    };
  }

  if (core9Score >= 7) {
    return {
      status: 'ALLOCATE',
      vehicle: 'BTC',
      conviction: 'HIGH',
      icon: '★',
      description: 'High conviction. Execute via BTC.',
    };
  }

  return {
    status: 'ALLOCATE',
    vehicle: 'BTC',
    conviction: 'STANDARD',
    icon: '●',
    description: 'Standard conviction. Execute via BTC.',
  };
}

// ─── Core Score Helpers ────────────────────────────────────────────────────────

export function computeCore8Score(ultra6) {
  return ultra6.score; // Core8 shares signals with Ultra6
}

export function computeCore9Score(data, growthSignals) {
  // Core9 = Ultra6 + additional quality signals
  const base = growthSignals.filter(s => s.value > 0).length;
  return Math.min(9, base + 3); // Simplified: base + BTC momentum
}
