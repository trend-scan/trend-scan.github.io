/**
 * RevisionArbitrageTable — displays FactorWatch estimate revision spreads
 * for the 7 equity factors.
 *
 * Shows the "Top − bottom" spread for each factor, indicating where analysts
 * are directing upgrades. Negative spreads mean analysts are upgrading
 * lagging/distressed assets over market leaders — a mean-reversion signal.
 *
 * Placed BELOW the existing crypto factor board in the FactorMonitor tab.
 */

import { useFactorSignals } from '@/hooks/useFactorSignals';

const FACTOR_DISPLAY = [
  { key: 'momentum',       label: 'Momentum' },
  { key: 'high_beta',      label: 'High Beta' },
  { key: 'quality',        label: 'Quality' },
  { key: 'value',          label: 'Value' },
  { key: 'size',           label: 'Size' },
  { key: 'low_volatility', label: 'Low Vol' },
  { key: 'dividend_yield', label: 'Div Yield' },
];

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v + '%';
}

function spreadColor(v) {
  if (v == null || !Number.isFinite(v)) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}

export default function RevisionArbitrageTable() {
  const signals = useFactorSignals();
  const sp500Revisions = signals?.factorWatch?.sp500?.revisions;
  const fw3000Revisions = signals?.factorWatch?.fw3000?.revisions;

  if (!sp500Revisions && !fw3000Revisions) return null;

  return (
    <section className="mt-6">
      <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--scanner-text3)' }}>
        Estimate Revision Spreads (TradFi Smart Money)
      </div>
      <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
        <table className="w-full border-collapse min-w-[500px]">
          <thead>
            <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
              <th className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2 px-3 text-left" style={{ color: 'var(--scanner-text3)' }}>Factor</th>
              {sp500Revisions && (
                <>
                  <th className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2 px-3 text-right" style={{ color: 'var(--scanner-text3)' }}>S&P Top</th>
                  <th className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2 px-3 text-right" style={{ color: 'var(--scanner-text3)' }}>S&P Bot</th>
                  <th className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2 px-3 text-right" style={{ color: 'var(--scanner-accent)' }}>S&P Spread</th>
                </>
              )}
              {fw3000Revisions && (
                <th className="text-[8.5px] font-semibold tracking-[0.1em] uppercase py-2 px-3 text-right" style={{ color: 'var(--scanner-text3)' }}>FW3000 Spread</th>
              )}
            </tr>
          </thead>
          <tbody>
            {FACTOR_DISPLAY.map(({ key, label }) => {
              const sp = sp500Revisions?.[key];
              const fw = fw3000Revisions?.[key];
              if (!sp && !fw) return null;
              return (
                <tr key={key} style={{ borderBottom: '1px solid var(--scanner-border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td className="py-2 px-3">
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--scanner-text)' }}>{label}</span>
                  </td>
                  {sp500Revisions && (
                    <>
                      <td className="py-2 px-3 text-right">
                        <span className="text-[10px] tabular-nums" style={{ color: spreadColor(sp?.top) }}>{fmtPct(sp?.top)}</span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className="text-[10px] tabular-nums" style={{ color: spreadColor(sp?.bot) }}>{fmtPct(sp?.bot)}</span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span className="text-[11px] font-bold tabular-nums" style={{ color: spreadColor(sp?.spread) }}>
                          {fmtPct(sp?.spread)}
                        </span>
                      </td>
                    </>
                  )}
                  {fw3000Revisions && (
                    <td className="py-2 px-3 text-right">
                      <span className="text-[10px] tabular-nums" style={{ color: spreadColor(fw?.spread) }}>{fmtPct(fw?.spread)}</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[7.5px] mt-1.5" style={{ color: 'var(--scanner-text3)' }}>
        Top − bottom spread = analysts upgrading leaders (+) vs lagging assets (−). Negative = smart money rotating to laggards.
        Data: <a href="https://factorwatch.ai" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>factorwatch.ai</a>
      </div>
    </section>
  );
}
