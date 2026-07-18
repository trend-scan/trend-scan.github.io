/**
 * Rotation Detector — generalized from regimeRotation.js
 *
 * Implements factorwatch.ai's 3-session-confirm + 10-session-fresh rotation
 * detection pattern. Works with any {date, leader} or {date, quadrant} shaped
 * history — asset-class-agnostic.
 *
 * The original regimeRotation.js detected macro regime quadrant flips.
 * This generalization works for:
 *   - Crypto factor leadership (momentum vs size vs volatility etc.)
 *   - Equity factor leadership (same factors, different universe)
 *   - Macro regime quadrants (backward compatible)
 *
 * Usage:
 *   const history = loadFactorHistory();  // [{date, leader: 'momentum'}, ...]
 *   const rotation = detectRotation(history);
 *   if (rotation.flipFlag) { ... }
 */

const CONFIRM_SESSIONS = 3;       // new leader must hold this many sessions
const FLIP_FRESH_SESSIONS = 10;   // flag stays visible for this many sessions

/**
 * Detect leadership rotation from a history of daily classifications.
 *
 * @param {Array<{date: string, leader: string}|{date: string, quadrant: string}>} history
 *   - chronological, oldest first
 *   - one entry per session (day)
 *   - 'leader' and 'quadrant' are both accepted as the label key
 *
 * @returns {object} rotation state
 */
export function detectRotation(history) {
  if (!history || history.length < 4) {
    return {
      currentLabel: null,
      previousLabel: null,
      heldSessions: 0,
      flipped: false,
      flipFlag: false,
      flipConfirmedAt: null,
      previousHeldSessions: 0,
      confirmed: false,
      confirmSessions: CONFIRM_SESSIONS,
      freshSessions: FLIP_FRESH_SESSIONS,
    };
  }

  // Extract label from either 'leader' or 'quadrant' key
  const getLabel = (entry) => entry?.leader || entry?.quadrant || null;

  const today = history[history.length - 1];
  const yesterday = history[history.length - 2];

  const currentLabel = getLabel(today);
  const previousLabel = getLabel(yesterday);
  const flipped = currentLabel !== previousLabel;

  // Count how many consecutive sessions the current label has held
  let heldSessions = 1;
  for (let i = history.length - 2; i >= 0; i--) {
    if (getLabel(history[i]) === currentLabel) heldSessions++;
    else break;
  }

  // Count how many sessions the PREVIOUS label held before being displaced
  let previousHeldSessions = 0;
  if (flipped) {
    for (let i = history.length - 2; i >= 0; i--) {
      if (getLabel(history[i]) === previousLabel) previousHeldSessions++;
      else break;
    }
  }

  // Flip is confirmed only when:
  //   1. Current label has held >= CONFIRM_SESSIONS sessions
  //   2. The displaced label was itself established for >= CONFIRM_SESSIONS sessions
  const confirmed = flipped
    && heldSessions >= CONFIRM_SESSIONS
    && previousHeldSessions >= CONFIRM_SESSIONS;

  // Flag stays "fresh" for FLIP_FRESH_SESSIONS after confirmation
  let flipFlag = false;
  let flipConfirmedAt = null;

  if (confirmed) {
    flipFlag = true;
    flipConfirmedAt = today.date;
  } else if (flipped) {
    // Walk back to find if there was a recent confirmed flip
    for (let i = history.length - 1; i >= Math.max(0, history.length - FLIP_FRESH_SESSIONS); i--) {
      const h = history[i];
      const prevH = history[i - 1];
      if (!prevH) continue;
      if (getLabel(h) !== getLabel(prevH)) {
        let heldFromFlip = 0;
        for (let j = i; j < history.length; j++) {
          if (getLabel(history[j]) === getLabel(h)) heldFromFlip++;
          else break;
        }
        if (heldFromFlip >= CONFIRM_SESSIONS && heldFromFlip <= FLIP_FRESH_SESSIONS) {
          flipFlag = true;
          flipConfirmedAt = h.date;
          break;
        }
      }
    }
  }

  return {
    currentLabel,
    previousLabel,
    heldSessions,
    flipped,
    flipFlag,
    flipConfirmedAt,
    previousHeldSessions,
    confirmed,
    confirmSessions: CONFIRM_SESSIONS,
    freshSessions: FLIP_FRESH_SESSIONS,
  };
}

/**
 * Build a factor leadership history entry from the current snapshot.
 * Call this once per session and append to a history array.
 *
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {string} leader - the current leading factor name
 * @returns {{date: string, leader: string}}
 */
export function buildHistoryEntry(date, leader) {
  return { date, leader };
}

/**
 * Load factor leadership history from localStorage.
 * Used as a client-side persistence layer (same pattern as trendscan_regime_history).
 *
 * @param {string} key - localStorage key (e.g. 'trendscan_crypto_factor_history')
 * @returns {Array} history array, oldest first
 */
export function loadFactorHistory(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Save factor leadership history to localStorage.
 * Caps at 90 entries (same as trendscan_regime_history).
 *
 * @param {string} key - localStorage key
 * @param {Array} history - history array
 */
export function saveFactorHistory(key, history) {
  try {
    const pruned = history.slice(-90);
    localStorage.setItem(key, JSON.stringify(pruned));
  } catch {
    // localStorage may be full or disabled — silently ignore
  }
}

/**
 * Append today's leader to the history if not already present.
 *
 * @param {Array} history - existing history
 * @param {string} date - today's date (YYYY-MM-DD)
 * @param {string} leader - today's leading factor
 * @returns {Array} updated history (capped at 90 entries)
 */
export function appendToHistory(history, date, leader) {
  if (!leader) return history;
  // Don't duplicate if today's entry already exists
  if (history.length > 0 && history[history.length - 1].date === date) {
    return history;
  }
  const updated = [...history, { date, leader }];
  return updated.slice(-90);
}
