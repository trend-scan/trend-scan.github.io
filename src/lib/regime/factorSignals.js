/**
 * FactorSignals — pure functions that compute actionable cross-asset signals
 * from FactorWatch equity factor data.
 */

export const SIGNAL_THRESHOLDS = {
  SHAKEOUT_MOM_SIGMA: -2.0,
  SHAKEOUT_REV_SPREAD: 20,
  JUNK_RALLY_SIZE_SPREAD: -20,
  FUNNEL_DEADZONE: 0.3,
};

export function computeFactorSignals(fwData) {
  if (!fwData?.sp500?.factors?.momentum) return null;

  const spMom = fwData.sp500.factors.momentum;
  const spMomSigma5d = spMom['5d_sigma'];
  const spMomRevSpread = fwData.sp500.revisions?.momentum?.spread;
  const sizeRevSpread = fwData.sp500.revisions?.size?.spread;
  const fw3000MomSigma5d = fwData.fw3000?.factors?.momentum?.['5d_sigma'];
  const sigmaDiff = (spMomSigma5d != null && fw3000MomSigma5d != null)
    ? spMomSigma5d - fw3000MomSigma5d : null;

  let liquidityFunnel = 'NEUTRAL';
  if (sigmaDiff != null) {
    if (Math.abs(sigmaDiff) < SIGNAL_THRESHOLDS.FUNNEL_DEADZONE) liquidityFunnel = 'NEUTRAL';
    else if (sigmaDiff > 0) liquidityFunnel = 'MEGA_CAP_SHIELDING';
    else liquidityFunnel = 'BROAD_RISK_ON';
  }

  return {
    isShakeout: spMomSigma5d != null && spMomSigma5d <= SIGNAL_THRESHOLDS.SHAKEOUT_MOM_SIGMA
             && spMomRevSpread != null && spMomRevSpread >= SIGNAL_THRESHOLDS.SHAKEOUT_REV_SPREAD,
    isJunkRally: sizeRevSpread != null && sizeRevSpread <= SIGNAL_THRESHOLDS.JUNK_RALLY_SIZE_SPREAD,
    liquidityFunnel,
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
