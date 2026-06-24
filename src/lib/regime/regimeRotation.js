/**
 * Regime Rotation Detector — borrow factorwatch's 3-session-confirm + 10-session-cooldown pattern.
 *
 * From factorwatch.ai/methodology §6 (Rotation detector):
 *
 *   "On trailing-20d returns of the long-only series:
 *    Leadership flip: leader = top factor by trailing 20d return. A flip is
 *    flagged only after the new leader holds 3 consecutive sessions, and only
 *    if the leadership it displaced was itself established for 3+ sessions —
 *    a one-day wobble inside a longer run is churn, not rotation. Flagged
 *    flips stay visible while fresh (≤10 sessions)."
 *
 * Adapted for TrendScan's macro regime quadrants:
 *   - Each axis (growth / inflation / liquidity) has a regime label
 *   - Track daily quadrant classifications
 *   - Detect flips with the 3-session confirmation rule
 *   - Surface flips in the RegimeCard UI
 *
 * Usage:
 *   const history = loadQuadrantHistory();   // array of {date, quadrant, growth, inflation, liquidity}
 *   const rotation = detectRegimeRotation(history);
 *   if (rotation.flipFlag) {
 *     console.log(`Regime flipped: ${rotation.previousLabel} → ${rotation.currentLabel}`);
 *   }
 */

const CONFIRM_SESSIONS = 3;        // new leader must hold this many sessions
const FLIP_FRESH_SESSIONS = 10;    // flag stays visible for this many sessions after confirmation

/**
 * Detect regime rotation from a history of daily regime classifications.
 *
 * @param {Array<{date: string, quadrant: string, growth: string, inflation: string, liquidity: string}>} history
 *   - chronological, oldest first
 *   - one entry per session (day)
 *
 * @returns {object} rotation state
 */
export function detectRegimeRotation(history) {
  if (!history || history.length < 4) {
    return {
      currentLabel: null,
      previousLabel: null,
      heldSessions: 0,
      flipped: false,
      flipFlag: false,
      flipConfirmedAt: null,
      previousHeldSessions: 0,
    };
  }

  const today = history[history.length - 1];
  const yesterday = history[history.length - 2];

  const currentLabel = today.quadrant;
  const previousLabel = yesterday.quadrant;
  const flipped = currentLabel !== previousLabel;

  // Count how many consecutive sessions the current label has held
  let heldSessions = 1;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].quadrant === currentLabel) heldSessions++;
    else break;
  }

  // Count how many sessions the PREVIOUS label held before being displaced
  let previousHeldSessions = 0;
  if (flipped) {
    for (let i = history.length - 2; i >= 0; i--) {
      if (history[i].quadrant === previousLabel) previousHeldSessions++;
      else break;
    }
  }

  // Flip is confirmed only when:
  //   1. Current label has held >= CONFIRM_SESSIONS sessions
  //   2. The displaced label was itself established for >= CONFIRM_SESSIONS sessions
  //     (avoids flagging wobbles inside an unstable period)
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
    // Walk back to find if there was a recent confirmed flip in the past FLIP_FRESH_SESSIONS days
    for (let i = history.length - 1; i >= Math.max(0, history.length - FLIP_FRESH_SESSIONS); i--) {
      const h = history[i];
      const prevH = history[i - 1];
      if (!prevH) continue;
      if (h.quadrant !== prevH.quadrant) {
        // Found a recent flip — check if it was confirmed (held >= CONFIRM_SESSIONS from that point)
        let heldFromFlip = 0;
        for (let j = i; j < history.length; j++) {
          if (history[j].quadrant === h.quadrant) heldFromFlip++;
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
    confirmSessions: CONFIRM_SESSIONS,
    freshSessions: FLIP_FRESH_SESSIONS,
  };
}

/**
 * Detect per-axis (growth / inflation / liquidity) rotation.
 * Each axis has its own label (e.g. growth: 'EXPANSION' / 'NEUTRAL' / 'RECESSIONARY' / 'BOOM').
 *
 * @returns {object} per-axis rotation states
 */
export function detectAxisRotation(history) {
  if (!history || history.length < 4) return null;

  const axes = ['growth', 'inflation', 'liquidity'];
  const result = {};

  for (const axis of axes) {
    const axisHistory = history.map(h => ({
      date: h.date,
      quadrant: h[axis],
    }));
    result[axis] = detectRegimeRotation(axisHistory);
  }

  return result;
}
