/**
 * FactorSignals — unified cross-asset signal computation from FactorWatch data.
 *
 * Phase 1b: Now uses the shared computeFactorStance from compositeEngine.js
 * so both FactorWatch (TradFi) and self-computed (crypto) factors speak the
 * same signal language: CONSTRUCTIVE / SELECTIVE / DEFENSIVE / WAIT.
 *
 * Phase 3 update: Now reads factor_watch_leader_history from the snapshot
 * to compute real rotation detection (3-session confirm). Previously
 * passed rotation: null which made all stances always resolve to WAIT.
 *
 * The legacy boolean signals (isShakeout, isJunkRally) are retained for
 * backward compatibility with MacroNarrativeBanner, but are now derived
 * from the unified stance output rather than standalone heuristics.
 */

import { computeFactorStance } from '../factors/compositeEngine';
import { detectRotation } from '../factors/rotationDetector';

export const SIGNAL_THRESHOLDS = {
  SHAKEOUT_MOM_SIGMA: -2.0,
  SHAKEOUT_REV_SPREAD: 20,
  JUNK_RALLY_SIZE_SPREAD: -20,
  FUNNEL_DEADZONE: 0.3,
};

/**
 * Compute unified factor signals from FactorWatch data.
 *
 * @param {object|null} fwData - the factor_watch object from snapshot.json
 * @param {Array} [leaderHistory] - factor_watch_leader_history from snapshot
 * @returns {object|null} unified signal state
 */
export function computeFactorSignals(fwData, leaderHistory = []) {
  if (!fwData?.sp500?.factors?.momentum) return null;

  const spMom = fwData.sp500.factors.momentum;
  const spMomSigma5d = spMom['5d_sigma'];
  const spMomRevSpread = fwData.sp500.revisions?.momentum?.spread;
  const sizeRevSpread = fwData.sp500.revisions?.size?.spread;
  const fw3000MomSigma5d = fwData.fw3000?.factors?.momentum?.['5d_sigma'];
  const sigmaDiff = (spMomSigma5d != null && fw3000MomSigma5d != null)
    ? spMomSigma5d - fw3000MomSigma5d : null;

  // Liquidity Funnel (S&P vs FW3000 divergence)
  let liquidityFunnel = 'NEUTRAL';
  if (sigmaDiff != null) {
    if (Math.abs(sigmaDiff) < SIGNAL_THRESHOLDS.FUNNEL_DEADZONE) liquidityFunnel = 'NEUTRAL';
    else if (sigmaDiff > 0) liquidityFunnel = 'MEGA_CAP_SHIELDING';
    else liquidityFunnel = 'BROAD_RISK_ON';
  }

  // ── Rotation detection from server-side leader history ──────────────────
  // Same pattern as crypto factors: detectRotation() uses 3-session confirm
  // + 10-session fresh rule on the {date, leader} history.
  const fwRotation = detectRotation(leaderHistory);

  // ── Unified stance via computeFactorStance ──────────────────────────────
  // Map FactorWatch data to the stance engine's inputs:
  //   spreadZ      = momentum 5d σ (the factor's z-scored spread)
  //   spreadPctile = approximated from σ (σ=2 ≈ 97th pctile, σ=-2 ≈ 3rd)
  //   confirmation = revision spread / 100 (normalized to 0-1 scale)
  //   rotation     = real rotation from server-side leader history

  const momentumStance = computeFactorStance({
    spreadZ: spMomSigma5d,
    spreadPctile: spMomSigma5d != null
      ? Math.max(0.5, Math.min(99.5, 50 + spMomSigma5d * 15))
      : 50,
    rotation: fwRotation,
    crowdingScore: null,  // FW crowding would need cross-factor correlation
    confirmation: spMomRevSpread != null
      ? Math.max(0, Math.min(1, spMomRevSpread / 100))
      : null,
    factorName: 'momentum',
  });

  // Compute size stance (for junk rally detection)
  const sizeStance = computeFactorStance({
    spreadZ: fwData.sp500.factors.size?.['5d_sigma'],
    spreadPctile: fwData.sp500.factors.size?.['5d_sigma'] != null
      ? Math.max(0.5, Math.min(99.5, 50 + fwData.sp500.factors.size['5d_sigma'] * 15))
      : 50,
    rotation: fwRotation,
    crowdingScore: null,
    confirmation: sizeRevSpread != null
      ? Math.max(0, Math.min(1, Math.abs(sizeRevSpread) / 100))
      : null,
    factorName: 'size',
  });

  // ── Legacy boolean signals (derived from unified stances) ───────────────
  const isShakeout = spMomSigma5d != null
    && spMomSigma5d <= SIGNAL_THRESHOLDS.SHAKEOUT_MOM_SIGMA
    && spMomRevSpread != null
    && spMomRevSpread >= SIGNAL_THRESHOLDS.SHAKEOUT_REV_SPREAD;

  const isJunkRally = sizeRevSpread != null
    && sizeRevSpread <= SIGNAL_THRESHOLDS.JUNK_RALLY_SIZE_SPREAD;

  return {
    isShakeout,
    isJunkRally,
    liquidityFunnel,

    // Unified stances (now with real rotation detection)
    momentumStance,
    sizeStance,
    fwRotation,

    primaryStance: [momentumStance, sizeStance]
      .sort((a, b) => b.confidence - a.confidence)[0],

    raw: {
      sp500_mom_5d_sigma: spMomSigma5d,
      sp500_mom_rev_spread: spMomRevSpread,
      size_rev_spread: sizeRevSpread,
      fw3000_mom_5d_sigma: fw3000MomSigma5d,
      sigma_diff: sigmaDiff,
    },
    factorWatch: fwData,
  };
}

export const BASKET_TO_CRYPTO_THEME = {
  'AI Software & Platforms': 'AI & Compute',
  'AI Infrastructure Leaders': 'AI & Compute',
  'AI Displacement Risk': null,
  'Cybersecurity': 'Privacy',
  'Payments & Fintech': 'RWA & Payments',
  'US Energy Complex': 'DePIN',
  'Regional Banks': null,
  'Fortress Balance Sheets': null,
  'Managed Care & Health Insurers': null,
  'Retail': null,
  'GLP-1 Pressure': null,
  'Defensives': null,
  'Magnificent Seven': 'Layer 1',
  'Capital Markets Cycle': 'DeFi',
  'Housing Chain': 'RWA',
};

export function basketToCryptoTheme(basketName) {
  return BASKET_TO_CRYPTO_THEME[basketName] ?? null;
}
