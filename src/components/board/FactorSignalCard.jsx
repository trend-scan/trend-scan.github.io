/**
 * FactorSignalCard — displays the actionable signal verdict for a factor.
 *
 * Mirrors the visual pattern of AllocationPanel.jsx on the Macro Regime page:
 *   - Status line (FACTOR — STANCE)
 *   - Confidence score bar
 *   - Rationale lines (plain-English explanation)
 *   - Rotation history (if available)
 *
 * This is the "signal, not data" layer — the difference between a table
 * someone has to read and a sentence someone can act on.
 */


function ConfidenceBar({ score, color }) {
  // score is 0-10, display as a bar
  const pct = (score / 10) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Confidence</span>
      <div className="flex-1 h-2 rounded-sm overflow-hidden" style={{ background: 'var(--scanner-bg)' }}>
        <div className="h-full rounded-sm transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{score}/10</span>
    </div>
  );
}

export default function FactorSignalCard({ factorName, stance, rotation }) {
  if (!stance) return null;

  const { stance: label, confidence, rationale, color } = stance;

  return (
    <div className="rounded p-4" style={{
      background: 'var(--scanner-bg1)',
      border: `1px solid var(--scanner-border2)`,
      borderTop: `2px solid ${color}`,
    }}>
      {/* Headline */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[8px] uppercase tracking-[0.15em]" style={{ color: 'var(--scanner-text3)' }}>
            Factor Signal
          </div>
          <div className="text-[14px] font-bold tracking-wide" style={{ color }}>
            {factorName.toUpperCase()} — {label}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Stance</div>
          <div className="text-[10px] font-bold" style={{ color }}>{label}</div>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="mb-3">
        <ConfidenceBar score={confidence} color={color} />
      </div>

      {/* Rationale lines */}
      <div className="space-y-1 mb-2">
        {rationale.map((line, i) => (
          <div key={i} className="text-[9px] leading-relaxed" style={{ color: 'var(--scanner-text2)' }}>
            {line}
          </div>
        ))}
      </div>

      {/* Rotation context */}
      {rotation && (
        <div className="pt-2 mt-2 text-[8px]" style={{
          borderTop: '1px solid var(--scanner-border)',
          color: 'var(--scanner-text3)',
        }}>
          {rotation.flipFlag && rotation.confirmed && (
            <span>
              ↻ Rotation confirmed: {rotation.previousLabel} → {rotation.currentLabel} ({rotation.heldSessions} sessions)
            </span>
          )}
          {rotation.flipped && !rotation.confirmed && (
            <span style={{ color: 'var(--scanner-accent)' }}>
              ⚠ Unconfirmed flip: {rotation.previousLabel} → {rotation.currentLabel} ({rotation.heldSessions}/{rotation.confirmSessions} sessions)
            </span>
          )}
          {!rotation.flipped && rotation.currentLabel && (
            <span>
              Leader: {rotation.currentLabel} ({rotation.heldSessions} sessions)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
