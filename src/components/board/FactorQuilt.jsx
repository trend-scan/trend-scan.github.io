/**
 * FactorQuilt — rolling returns by factor × month (factorwatch-style quilt).
 *
 * Uses the existing buildQuilt() function from factorEngine.js (which was
 * implemented but never imported — this activates the dead code).
 *
 * Renders a color-coded grid: rows = factors, columns = months.
 * Green = positive return, red = negative. Cells are ranked within each month.
 */

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}

function cellColor(v) {
  if (v == null || !Number.isFinite(v)) return { bg: 'transparent', text: 'var(--scanner-text3)' };
  if (v > 0.05) return { bg: 'rgba(0,230,118,0.18)', text: 'var(--scanner-green)' };
  if (v > 0.02) return { bg: 'rgba(0,230,118,0.08)', text: 'var(--scanner-green)' };
  if (v < -0.05) return { bg: 'rgba(255,68,68,0.18)', text: 'var(--scanner-red)' };
  if (v < -0.02) return { bg: 'rgba(255,68,68,0.08)', text: 'var(--scanner-red)' };
  return { bg: 'transparent', text: 'var(--scanner-text2)' };
}

function formatMonthLabel(monthStr) {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export default function FactorQuilt({ quilt }) {
  if (!quilt || quilt.length === 0) return null;

  // Extract all unique factors from the first month's ranking
  const allFactors = quilt[0]?.ranking?.map(r => r.factor) || [];
  if (allFactors.length === 0) return null;

  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider mb-2" style={{ color: 'var(--scanner-text3)' }}>
        Factor Quilt — Monthly Returns (Long-Only)
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse" style={{ minWidth: `${allFactors.length > 0 ? (quilt.length + 1) * 70 : 300}px` }}>
          <thead>
            <tr>
              <th className="text-[8px] uppercase tracking-wider py-1.5 px-2 text-left sticky left-0" style={{
                color: 'var(--scanner-text3)',
                background: 'var(--scanner-bg2)',
              }}>
                Factor
              </th>
              {quilt.map(q => (
                <th key={q.month} className="text-[8px] uppercase tracking-wider py-1.5 px-1 text-center" style={{
                  color: 'var(--scanner-text3)',
                }}>
                  {formatMonthLabel(q.month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allFactors.map(factor => (
              <tr key={factor} style={{ borderBottom: '1px solid var(--scanner-border)' }}>
                <td className="text-[9px] font-semibold py-1.5 px-2 capitalize sticky left-0" style={{
                  color: 'var(--scanner-text2)',
                  background: 'var(--scanner-bg2)',
                }}>
                  {factor}
                </td>
                {quilt.map(q => {
                  const entry = q.ranking?.find(r => r.factor === factor);
                  const ret = entry?.return;
                  const { bg, text } = cellColor(ret);
                  const rank = entry ? q.ranking.indexOf(entry) + 1 : null;
                  return (
                    <td key={q.month} className="py-1.5 px-1 text-center" style={{ background: bg }}>
                      <div className="text-[9px] font-semibold tabular-nums" style={{ color: text }}>
                        {ret != null ? fmtPct(ret) : '—'}
                      </div>
                      {rank && rank <= 2 && (
                        <div className="text-[6px]" style={{ color: text, opacity: 0.6 }}>
                          #{rank}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[7.5px] mt-1" style={{ color: 'var(--scanner-text3)' }}>
        Monthly returns of Q5 (long-only) quintile portfolios. Green = positive, red = negative. #1/#2 = top-ranked factor that month.
      </div>
    </div>
  );
}
