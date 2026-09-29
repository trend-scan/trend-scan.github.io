/**
 * priceFormat.js — shared Price-column formatter for the Board's crypto tables.
 *
 * History:
 *   2026-09-29 (Task 32): the crypto tables' 2-decimal cap rendered sub-cent
 *   assets as "0" (PEPE ~$0.0000085) — fixed with up to 7 decimal places.
 *   2026-09-30 (Task 33): user asked for MORE — "9 decimals, or let the native
 *   exchange price just pass through despite the decimal number". OKX's
 *   deepest native quote is 12 decimals (SATS-USDT-SWAP ticks at
 *   0.000000012431 — which the 7dp cap rendered as "0"!), Hyperliquid's is 6.
 *   So the sub-dollar band now renders the exchange's OWN precision exactly.
 *
 * fmtCryptoPrice — Board crypto tables (no $ prefix, matching their look):
 *    v ≥ 1    → toLocaleString max 2   (majors unchanged: 83,912.5 / 265.4)
 *    v < 1    → NATIVE PASS-THROUGH: toFixed(12) + trailing zeros trimmed —
 *               PUMP 0.005872 → "0.005872", PEPE 0.0000085 → "0.0000085",
 *               SATS 0.000000012431 → "0.000000012431" (was "0" under 7dp),
 *               XRP-class 0.014 → "0.014" (the old 2dp band rounded to "0.01")
 *   Why toFixed(12) is EXACT pass-through here: every venue sends prices as
 *   strings with ≤ 12 decimals (verified live 2026-09-30: OKX bulk SWAP
 *   tickers' max = 12, HL markPx max = 6; Binance/Kraken/Bybit are coarser),
 *   a ≤ 12-decimal string parses to a double that round-trips exactly, and
 *   toFixed(12) therefore recovers the venue's digits verbatim. The 12-cap
 *   also absorbs arithmetic dust (0.1 + 0.2 → "0.3", not
 *   "0.30000000000000004") and bounds cell width.
 *
 * fmtDollarPrice — $-prefixed, the Watchlist TradFi table's conventions
 * (thousands separators ≥ $1000, 2dp ≥ $1) + the same native pass-through
 * below $1, so OKX tooltip prices (24h H/L) and any low-priced instrument
 * stay honest too.
 *
 * Both: null / NaN / non-finite → '—'. Never exponential notation.
 */

/** Trim trailing zeros of a fixed-point string, keeping at least the integer part. */
function trimTrailingZeros(s) {
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * Native-precision fixed-point string for a finite number < 1 (the pass-through
 * band). toFixed never goes exponential below 1e21, and 12 decimals covers the
 * deepest tick size of any venue we display (see header note).
 */
function nativePassThrough(v) {
  return trimTrailingZeros(v.toFixed(12));
}

/** Format a crypto price for Board table display (no $ prefix). */
export function fmtCryptoPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  // Sub-dollar: the exchange's own precision (PEPE, PUMP, SATS, XRP-class …)
  return nativePassThrough(v);
}

/** Format a dollar-denominated price for Board table display ($ prefix). */
export function fmtDollarPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return '$' + v.toFixed(2);
  return '$' + nativePassThrough(v);
}
