/**
 * priceFormat.js — shared Price-column formatter for the Board's crypto tables.
 *
 * History: the crypto tables (Watchlist, Crypto all-assets, DailyBoard mirror,
 * Themes constituents) formatted prices with a 2-decimal cap, which renders
 * sub-cent assets as "0" — PEPE (~$0.0000085) literally displayed as 0.
 * User request (2026-09-29): support up to 7 decimal places.
 *
 * fmtCryptoPrice — Board crypto tables (no $ prefix, matching their look):
 *    v ≥ 0.01   → toLocaleString max 2   (unchanged: 83,912.5 / 265.4 / 0.55)
 *    v < 0.01   → up to 7 decimal places, trailing zeros trimmed:
 *                 PUMP 0.0037 → "0.0037", PEPE 0.0000085 → "0.0000085",
 *                 SHIB 0.000017 → "0.000017"
 *   Replaces ThemesTab's toPrecision(4), which went exponential for majors
 *   (83912 → "8.391e+4") and padded sub-cents with zeros ("0.000008500").
 *
 * fmtDollarPrice — $-prefixed, the Watchlist TradFi table's conventions
 * (thousands separators ≥ $1000, 2dp ≥ $1, 4dp ≥ $0.01) + the same sub-cent
 * band, so OKX tooltip prices (24h H/L) and any low-priced instrument stay
 * honest too.
 *
 * Both: null / NaN / non-finite → '—'. Never exponential notation.
 */

/** Trim trailing zeros of a fixed-point string, keeping at least the integer part. */
function trimTrailingZeros(s) {
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Format a crypto price for Board table display (no $ prefix). */
export function fmtCryptoPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 0.01) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  // Sub-cent (PEPE, PUMP, SHIB, BONK …): up to 7 decimal places.
  return trimTrailingZeros(v.toFixed(7));
}

/** Format a dollar-denominated price for Board table display ($ prefix). */
export function fmtDollarPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(2);
  if (v >= 0.01) return '$' + v.toFixed(4);
  return '$' + trimTrailingZeros(v.toFixed(7));
}
