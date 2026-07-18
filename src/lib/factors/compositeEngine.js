/**
 * Composite Engine — turns factor z-scores into an actionable stance.
 *
 * Generalizes the pattern from regimeSignals.js's computeAllocation():
 *   - Count how many "gate" checks pass
 *   - Map to a 0-10 confidence and one of four stance labels
 *   - Return a rationale array explaining the verdict
 *
 * Stance vocabulary (same as the Market Update Operating Framework):
 *   CONSTRUCTIVE — factor is leading, confirmed, not crowded → favor exposure
 *   SELECTIVE    — factor is stretched but with caveats → selective exposure
 *   DEFENSIVE    — factor is breaking down or crowded → reduce exposure
 *   WAIT         — insufficient confirmation or noise → no action
 *
 * Gate logic (inspired by factorwatch's rotation + crowding methodology):
 *   1. Stretch:    |spreadZ| >= 2.0 (factorwatch's flag threshold)
 *   2. Persistence: rotation.confirmed === true (3-session rule)
 *   3. Crowding:   crowdingScore < 0.7 (not too correlated with other factors)
 *   4. Breadth:    confirmation >= 0.5 (quintile members agreeing with the move)
 */

const STRETCH_THRESHOLD = 2.0;       // |z| >= 2 is a significant move
const CROWDING_THRESHOLD = 0.7;      // corr > 0.7 means factors are "one bet"
const CONFIRMATION_THRESHOLD = 0.5;  // >50% of quintile members confirming

const STANCE = {
  CONSTRUCTIVE: 'CONSTRUCTIVE',
  SELECTIVE: 'SELECTIVE',
  DEFENSIVE: 'DEFENSIVE',
  WAIT: 'WAIT',
};

const STANCE_COLORS = {
  CONSTRUCTIVE: 'var(--scanner-green)',
  SELECTIVE: 'var(--scanner-accent)',
  DEFENSIVE: 'var(--scanner-red)',
  WAIT: 'var(--scanner-text3)',
};

/**
 * @typedef {Object} FactorStance
 * @property {string} stance - CONSTRUCTIVE | SELECTIVE | DEFENSIVE | WAIT
 * @property {number} confidence - 0-10
 * @property {string[]} rationale - explanation fragments
 * @property {string} color - CSS color for the stance
 * @property {Object} gates - which checks passed
 * @property {Object} raw - raw input values
 */

/**
 * Compute a factor stance from z-scores, rotation state, and crowding.
 *
 * @param {object} params
 * @param {number} params.spreadZ        - current spread z-score
 * @param {number} [params.spreadPctile] - percentile vs trailing window (0-100)
 * @param {object} [params.rotation]     - output of rotationDetector.detectRotation()
 * @param {number} [params.crowdingScore] - max |correlation| vs other factors (0-1)
 * @param {number} [params.confirmation]  - breadth of agreement (0-1)
 * @param {string} [params.factorName]    - for rationale text
 * @returns {FactorStance}
 */
export function computeFactorStance({
  spreadZ,
  spreadPctile,
  rotation,
  crowdingScore,
  confirmation,
  factorName = 'factor',
}) {
  const z = spreadZ ?? 0;
  const absZ = Math.abs(z);
  const pctile = spreadPctile ?? 50;
  const crowded = (crowdingScore ?? 0) > CROWDING_THRESHOLD;
  const confirmed = rotation?.confirmed ?? false;
  const hasBreadth = (confirmation ?? 1) >= CONFIRMATION_THRESHOLD;
  const isPositive = z > 0;

  const rationale = [];
  const gates = { stretch: false, persistence: false, crowding: false, breadth: false };

  // Gate 1: Stretch
  gates.stretch = absZ >= STRETCH_THRESHOLD;
  if (gates.stretch) {
    rationale.push(`Stretched: z=${z.toFixed(1)} (${pctile.toFixed(0)}th pctile, ${isPositive ? 'positive' : 'negative'} stretch)`);
  } else if (absZ >= 1.0) {
    rationale.push(`Elevated: z=${z.toFixed(1)} (${pctile.toFixed(0)}th pctile)`);
  } else {
    rationale.push(`Neutral: z=${z.toFixed(1)} (${pctile.toFixed(0)}th pctile)`);
  }

  // Gate 2: Persistence (rotation confirmed)
  gates.persistence = confirmed;
  if (rotation) {
    if (confirmed) {
      rationale.push(`Confirmed leader (${rotation.heldSessions} sessions)`);
    } else if (rotation.flipped) {
      rationale.push(`Unconfirmed flip (${rotation.heldSessions} sessions, needs ${rotation.confirmSessions})`);
    } else if (rotation.heldSessions > 0) {
      rationale.push(`Leading for ${rotation.heldSessions} sessions`);
    }
  }

  // Gate 3: Crowding
  gates.crowding = !crowded;
  if (crowded) {
    rationale.push(`Crowded (max corr ${(crowdingScore ?? 0).toFixed(2)} > ${CROWDING_THRESHOLD})`);
  } else if (crowdingScore != null) {
    rationale.push(`Not crowded (max corr ${crowdingScore.toFixed(2)})`);
  }

  // Gate 4: Breadth
  gates.breadth = hasBreadth;
  if (confirmation != null) {
    if (hasBreadth) {
      rationale.push(`Broad participation (${(confirmation * 100).toFixed(0)}% confirming)`);
    } else {
      rationale.push(`Narrow participation (${(confirmation * 100).toFixed(0)}% confirming)`);
    }
  }

  // Count passing gates
  const passCount = Object.values(gates).filter(Boolean).length;

  // Determine stance and confidence
  let stance, confidence;

  if (gates.stretch && gates.persistence && gates.crowding) {
    // Full conviction: stretched + confirmed + not crowded
    stance = STANCE.CONSTRUCTIVE;
    confidence = gates.breadth ? 9 : 7;
  } else if (gates.stretch && gates.persistence && !gates.crowding) {
    // Stretched and confirmed but crowded → still favorable but riskier
    stance = STANCE.SELECTIVE;
    confidence = 5;
  } else if (gates.stretch && !gates.persistence) {
    // Stretched but unconfirmed → wait for confirmation
    stance = STANCE.WAIT;
    confidence = 3;
  } else if (!gates.stretch && gates.persistence) {
    // Confirmed leader but not stretched → maintain but don't add
    stance = STANCE.SELECTIVE;
    confidence = 5;
  } else if (gates.stretch && z < 0) {
    // Negative stretch (factor breaking down)
    stance = STANCE.DEFENSIVE;
    confidence = 6;
  } else {
    // Nothing significant
    stance = STANCE.WAIT;
    confidence = 2;
  }

  // Crowding caps confidence regardless of other gates
  if (crowded && stance === STANCE.CONSTRUCTIVE) {
    stance = STANCE.SELECTIVE;
    confidence = Math.min(confidence, 5);
  }

  return {
    stance,
    confidence,
    rationale,
    color: STANCE_COLORS[stance],
    gates,
    raw: {
      spreadZ: z,
      spreadPctile: pctile,
      crowdingScore,
      confirmation,
      passCount,
    },
  };
}

/**
 * Compute stances for all factors in a spread monitor.
 * Returns the factor with the highest confidence as the "primary signal."
 *
 * @param {Array} spreadMonitorRows - array of factor spread data
 * @param {object} rotation - rotation state from detectRotation
 * @param {object} [crowdingMatrix] - output of crowdingMatrix.buildCrowdingMatrix
 * @returns {{primary: object, all: Array}} primary signal + all factor stances
 */
export function computeAllStances(spreadMonitorRows, rotation, crowdingMatrix) {
  const all = spreadMonitorRows.map(row => {
    // Use the 20d spread z-score as the primary signal
    const spread20d = row.spread_20d || row.rel_20d || {};
    return computeFactorStance({
      spreadZ: spread20d.z,
      spreadPctile: spread20d.pctile,
      rotation: rotation?.currentLabel === row.factor ? rotation : null,
      crowdingScore: crowdingMatrix?.maxCorrelation?.(row.factor),
      factorName: row.factor,
    });
  }).sort((a, b) => b.confidence - a.confidence);

  return {
    primary: all[0] || null,
    all,
  };
}

export { STANCE, STANCE_COLORS, STRETCH_THRESHOLD, CROWDING_THRESHOLD };
