/**
 * Narrative Generator — turns factor stance data into plain-English sentences.
 *
 * Generalizes the pattern from changeLog.js's computeChanges():
 *   - Diff two states, emit human-readable strings
 *   - Template-based, no complex NLP
 *
 * The output is the difference between "a table someone has to read"
 * and "a sentence someone can act on."
 *
 * Example output:
 *   "Momentum confirmed leader (6 sessions), not crowded (max corr 0.31),
 *    z=2.1 (89th pctile) → CONSTRUCTIVE, confidence 7/10."
 *   "Value stretched (z=2.4, 91st pctile) but unconfirmed — flipped leadership
 *    1 session ago → WAIT, confidence 3/10."
 */

import { STANCE_COLORS } from './compositeEngine.js';

/**
 * Generate a narrative summary for a single factor stance.
 *
 * @param {object} stance - output of computeFactorStance
 * @param {string} factorName - display name of the factor
 * @returns {{headline: string, detail: string, color: string}}
 */
export function generateFactorNarrative(stance, factorName) {
  if (!stance) return { headline: '', detail: '', color: 'var(--scanner-text3)' };

  const { stance: label, confidence, rationale, raw } = stance;
  const color = STANCE_COLORS[label] || 'var(--scanner-text3)';

  // Headline: FACTOR — STANCE (confidence/10)
  const headline = `${factorName.toUpperCase()} — ${label} (${confidence}/10)`;

  // Detail: join rationale fragments into a sentence
  const detail = rationale.join(' · ');

  return { headline, detail, color };
}

/**
 * Generate a rotation narrative.
 *
 * @param {object} rotation - output of rotationDetector.detectRotation
 * @returns {string|null} narrative string, or null if no rotation
 */
export function generateRotationNarrative(rotation) {
  if (!rotation) return null;

  if (rotation.flipFlag && rotation.confirmed) {
    const prev = rotation.previousLabel || 'unknown';
    const curr = rotation.currentLabel || 'unknown';
    const held = rotation.heldSessions;
    return `Rotation confirmed: ${prev} → ${curr}, ${held} sessions ago`;
  }

  if (rotation.flipped && !rotation.confirmed) {
    const prev = rotation.previousLabel || 'unknown';
    const curr = rotation.currentLabel || 'unknown';
    const needed = rotation.confirmSessions - rotation.heldSessions;
    return `Unconfirmed flip: ${prev} → ${curr}, ${rotation.heldSessions}/${rotation.confirmSessions} sessions (${needed} more to confirm)`;
  }

  if (rotation.currentLabel && rotation.heldSessions > 0) {
    return `${rotation.currentLabel} leading for ${rotation.heldSessions} sessions`;
  }

  return null;
}

/**
 * Generate a complete signal card narrative combining stance + rotation.
 *
 * @param {object} params
 * @param {string} params.factorName
 * @param {object} params.stance - from computeFactorStance
 * @param {object} [params.rotation] - from detectRotation
 * @returns {{headline: string, lines: string[], color: string}}
 */
export function generateSignalCard({ factorName, stance, rotation }) {
  const narrative = generateFactorNarrative(stance, factorName);
  const lines = [narrative.detail];

  const rotNarrative = generateRotationNarrative(rotation);
  if (rotNarrative) {
    lines.push(rotNarrative);
  }

  return {
    headline: narrative.headline,
    lines,
    color: narrative.color,
  };
}

/**
 * Generate a change narrative (what changed since last visit).
 * Generalizes changeLog.js's pattern for factor data.
 *
 * @param {object} prev - previous factor state
 * @param {object} curr - current factor state
 * @returns {string[]} array of change strings
 */
export function generateChangeNarrative(prev, curr) {
  const changes = [];
  if (!prev || !curr) return changes;

  // Leader change
  if (prev.leader !== curr.leader) {
    changes.push(`Factor leadership: ${prev.leader || '—'} → ${curr.leader || '—'}`);
  }

  // Stance change for any factor
  for (const factor of Object.keys(curr.stances || {})) {
    const prevStance = prev.stances?.[factor]?.stance;
    const currStance = curr.stances?.[factor]?.stance;
    if (prevStance && currStance && prevStance !== currStance) {
      changes.push(`${factor} stance: ${prevStance} → ${currStance}`);
    }
  }

  // New stretch signal
  for (const factor of Object.keys(curr.stances || {})) {
    const prevZ = prev.stances?.[factor]?.raw?.spreadZ;
    const currZ = curr.stances?.[factor]?.raw?.spreadZ;
    if (prevZ != null && currZ != null) {
      if (Math.abs(prevZ) < 2 && Math.abs(currZ) >= 2) {
        changes.push(`${factor} new stretch signal (z=${currZ.toFixed(1)})`);
      }
    }
  }

  return changes;
}
