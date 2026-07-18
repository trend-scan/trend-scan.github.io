/**
 * FactorSignals — pure functions that compute actionable cross-asset signals
 * from FactorWatch equity factor data.
 *
 * These signals translate descriptive equity factor data into predictive
 * crypto/TradFi signals:
 *
 * 1. Shakeout: momentum is flushing (≤ -2.0σ) but analysts are still
 *    upgrading top-quintile names (spread ≥ +20%). Historically preceded
 *    recoveries (Oct 2023, Aug 2024). Favor accumulation on quality pullbacks.
 *
 * 2. Junk Rally: analysts are upgrading small/size names while cutting
 *    leaders (Size spread ≤ -20%). Indicates mean-reversion regime —
 *    lagging assets outperforming leaders.
 *
 * 3. Liquidity Funnel: compares S&P 500 vs FW 3000 momentum σ to detect
 *    whether liquidity is hiding in mega-caps (S&P shielding) or flowing
 *    broadly (risk-on). Includes a deadzone to prevent noise.
 *
 * All thresholds are configurable constants documented below.
 */

// ─── Signal Thresholds ───────────────────────────────────────────────────────
// These are heuristic thresholds based on historical observation, not
// formal backtests. They can be tuned without changing the signal logic.

export const SIGNAL_THRESHOLDS = {
  // Shakeout: momentum σ ≤ -2.0 AND revision spread ≥ +20%
  // Rationale: -2σ is a 2-standard-deviation event (~2.5% probability).
  // +20% revision spread means analysts are net-upgrading leaders despite
  // the price flush — a classic "smart money accumulating on weakness" signal.
  SHAKEOUT_MOM_SIGMA: -2.0,
  SHAKEOUT_REV_SPREAD: 20,

  // Junk Rally: Size revision spread ≤ -20%
  // Rationale: negative Size spread means analysts are upgrading small-caps
  // (bottom quintile) while cutting large-caps (top quintile). This is a
  // mean-reversion signal — money rotating from leaders to laggards.
  JUNK_RALLY_SIZE_SPREAD: -20,

  // Liquidity Funnel deadzone: if |S&P σ - FW3000 σ| < 0.3, signal is noise
  // Rationale: within 0.3σ, the two universes are moving in lockstep —
  // no meaningful divergence to signal.
  FUNNEL_DEADZONE: 0.3,
};

/**
 * Compute cross-asset factor signals from FactorWatch data.
 *
 * @param {object|null} fwData — the factor_watch object from snapshot.json
 * @returns {object|null} signal state, or null if data is unavailable
 */
export function computeFactorSignals(fwData) {
  if (!fwData?.sp500?.factors?.momentum) return null;

  const spMom = fwData.sp500.factors.momentum;
  const spMomSigma5d = spMom['5d_sigma'];
  const spMomRevSpread = fwData.sp500.revisions?.momentum?.spread;
  const sizeRevSpread = fwData.sp500.revisions?.size?.spread;

  const fw3000MomSigma5d = fwData.fw3000?.factors?.momentum?.['5d_sigma'];
  const sigmaDiff = (spMomSigma5d != null && fw3000MomSigma5d != null)
    ? spMomSigma5d - fw3000MomSigma5d
    : null;

  let liquidityFunnel = 'NEUTRAL';
  if (sigmaDiff != null) {
    if (Math.abs(sigmaDiff) < SIGNAL_THRESHOLDS.FUNNEL_DEADZONE) {
      liquidityFunnel = 'NEUTRAL';
    } else if (sigmaDiff > 0) {
      // S&P momentum is less negative (or more positive) than FW3000
      // → liquidity concentrating in mega-caps
      liquidityFunnel = 'MEGA_CAP_SHIELDING';
    } else {
      // FW3000 momentum is less negative (or more positive) than S&P
      // → risk flowing broadly down the cap spectrum
      liquidityFunnel = 'BROAD_RISK_ON';
    }
  }

  return {
    // Signal 1: Institutional Shakeout
    // Price is flushing but analysts are upgrading quality → accumulation zone
    isShakeout: spMomSigma5d != null
             && spMomSigma5d <= SIGNAL_THRESHOLDS.SHAKEOUT_MOM_SIGMA
             && spMomRevSpread != null
             && spMomRevSpread >= SIGNAL_THRESHOLDS.SHAKEOUT_REV_SPREAD,

    // Signal 2: Junk Rally / Mean Reversion
    // Analysts upgrading lagging assets over leaders → rotation to laggards
    isJunkRally: sizeRevSpread != null
              && sizeRevSpread <= SIGNAL_THRESHOLDS.JUNK_RALLY_SIZE_SPREAD,

    // Signal 3: Liquidity Funnel
    // S&P vs FW3000 divergence → where is liquidity flowing?
    liquidityFunnel,

    // Raw values for UI display
    raw: {
      sp500_mom_5d_sigma: spMomSigma5d,
      sp500_mom_rev_spread: spMomRevSpread,
      size_rev_spread: sizeRevSpread,
      fw3000_mom_5d_sigma: fw3000MomSigma5d,
      sigma_diff: sigmaDiff,
    },

    // Pass-through for UI components that need the full dataset
    factorWatch: fwData,
  };
}

/**
 * Map FactorWatch thematic baskets to cryptoUniverse themes.
 * Used by the TradFiThematicProxy component to show cross-asset context.
 *
 * Baskets without a clean crypto equivalent are included with cryptoTheme: null.
 */
export const BASKET_TO_CRYPTO_THEME = {
  'AI Software & Platforms': 'AI & Compute',
  'AI Infrastructure Leaders': 'AI & Compute',
  'AI Displacement Risk': null,           // no clean crypto equivalent
  'Cybersecurity': 'Privacy',
  'Payments & Fintech': 'RWA & Payments',
  'US Energy Complex': 'DePIN',           // loose — energy/commodity DePIN
  'Regional Banks': null,                 // no crypto equivalent
  'Fortress Balance Sheets': null,        // no crypto equivalent
  'Managed Care & Health Insurers': null, // no crypto equivalent
  'Retail': null,                         // no crypto equivalent
  'GLP-1 Pressure': null,                 // no crypto equivalent
  'Defensives': null,                     // no crypto equivalent
  'Magnificent Seven': 'Layer 1',         // loose — mega-cap proxy
  'Capital Markets Cycle': 'DeFi',        // loose — financial markets
  'Housing Chain': 'RWA',                 // loose — real-world assets
};

/**
 * Get the crypto theme mapping for a basket name.
 * @param {string} basketName
 * @returns {string|null} the crypto theme, or null if no mapping exists
 */
export function basketToCryptoTheme(basketName) {
  return BASKET_TO_CRYPTO_THEME[basketName] ?? null;
}
