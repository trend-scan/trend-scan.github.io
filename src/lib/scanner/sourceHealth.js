/**
 * Source Health — tracks globally-blocked sources.
 *
 * When a source returns HTTP 451 (Unavailable For Legal Reasons = geo-block),
 * it's marked as globally blocked for BLOCK_DURATION. The resolver then skips
 * it for all subsequent symbols, avoiding 1000+ wasted requests per session.
 *
 * IMPORTANT: Only HTTP 451 triggers a global block. We do NOT block on:
 *   - 403 (Forbidden) — can be a temporary WAF block, rate limit, or
 *     symbol-specific issue, NOT necessarily a geo-block. False-positive
 *     blocking would hurt coverage. OKX, for example, is NOT geo-blocked
 *     in most regions but may occasionally return 403 for other reasons.
 *   - 429 (Too Many Requests) — transient rate limit, handled by retry
 *   - 5xx (Server Error) — transient, handled by retry
 *
 * The block is time-limited (default 10 min) so users who toggle VPN mid-session
 * will auto-recover without a page reload.
 *
 * Usage from a source module:
 *   import { markGloballyBlocked } from '../sourceHealth';
 *   if (res.status === 451) {
 *     markGloballyBlocked('binance_perps');
 *     return null;
 *   }
 *
 * Usage from the resolver:
 *   import { isGloballyBlocked, getBlockedSources } from './sourceHealth';
 *   if (isGloballyBlocked(src.id)) continue;
 */

const BLOCK_DURATION_MS = 10 * 60 * 1000;  // 10 minutes

// sourceId → unblockAt (timestamp)
const _blockedUntil = new Map();

/**
 * Mark a source as globally blocked for BLOCK_DURATION_MS.
 * Called when a source returns HTTP 451 (definitive geo-block).
 *
 * @param {string} sourceId  e.g. 'binance_perps', 'okx_perps', 'bybit'
 */
export function markGloballyBlocked(sourceId) {
  const now = Date.now();
  const previous = _blockedUntil.get(sourceId);
  // Don't re-log if already blocked (avoid console spam)
  if (!previous || previous < now) {
    const until = now + BLOCK_DURATION_MS;
    _blockedUntil.set(sourceId, until);
    console.warn(
      `[sourceHealth] "${sourceId}" globally blocked for ${BLOCK_DURATION_MS / 1000}s ` +
      `(HTTP 451 — geo-restricted in this region). ` +
      `Resolver will skip it for all symbols until ${new Date(until).toLocaleTimeString()}.`
    );
  }
}

/**
 * Check if a source is currently globally blocked.
 * Auto-expires if the block duration has passed.
 *
 * @param {string} sourceId
 * @returns {boolean}
 */
export function isGloballyBlocked(sourceId) {
  const until = _blockedUntil.get(sourceId);
  if (!until) return false;
  if (Date.now() >= until) {
    _blockedUntil.delete(sourceId);
    return false;
  }
  return true;
}

/**
 * Get the timestamp when a source will unblock (or null if not blocked).
 * @param {string} sourceId
 * @returns {number|null}
 */
export function getUnblockTime(sourceId) {
  const until = _blockedUntil.get(sourceId);
  if (!until || Date.now() >= until) {
    _blockedUntil.delete(sourceId);
    return null;
  }
  return until;
}

/**
 * List all currently-blocked sources with their unblock timestamps.
 * Used by the UI to show "Source X geo-blocked, retrying at HH:MM:SS".
 *
 * @returns {Array<{sourceId: string, unblockAt: number, secondsLeft: number}>}
 */
export function getBlockedSources() {
  const now = Date.now();
  const out = [];
  for (const [sourceId, until] of _blockedUntil.entries()) {
    if (until <= now) {
      _blockedUntil.delete(sourceId);
      continue;
    }
    out.push({
      sourceId,
      unblockAt: until,
      secondsLeft: Math.ceil((until - now) / 1000),
    });
  }
  return out;
}

/**
 * Manually unblock a source (e.g. when user toggles VPN).
 * @param {string} sourceId
 */
export function unblockSource(sourceId) {
  _blockedUntil.delete(sourceId);
}

/**
 * Unblock all sources (e.g. when user clicks "Refresh with VPN").
 */
export function unblockAll() {
  _blockedUntil.clear();
}
