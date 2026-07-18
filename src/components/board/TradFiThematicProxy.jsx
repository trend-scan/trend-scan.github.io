/**
 * TradFiThematicProxy — horizontal scrollable card row mapping FactorWatch
 * thematic baskets to crypto equivalents.
 */

import { useFactorSignals } from '@/hooks/useFactorSignals';
import { basketToCryptoTheme } from '@/lib/regime/factorSignals';

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function pctColor(v) {
  if (v == null || !Number.isFinite(v)) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}

export default function TradFiThematicProxy() {
  const signals = useFactorSignals();
  const baskets = signals?.factorWatch?.baskets;
  if (!baskets || Object.keys(baskets).length === 0) return null;

  return (
    <section className="mb-6">
      <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--scanner-text3)' }}>
        TradFi Thematic Baskets → Crypto Proxies
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-2" style={{ minWidth: 'min-content' }}>
          {Object.entries(baskets).map(([basketName, data]) => {
            const cryptoTheme = basketToCryptoTheme(basketName);
            return (
              <div key={basketName} className="flex-shrink-0 rounded p-2.5" style={{ background: 'var(--scanner-bg1)', border: '1px solid var(--scanner-border2)', width: '155px' }}>
                <div className="text-[9px] font-bold leading-tight mb-1.5" style={{ color: 'var(--scanner-text)' }}>{basketName}</div>
                <div className="flex items-baseline gap-1 mb-1.5">
                  <span className="text-[7px]" style={{ color: 'var(--scanner-text3)' }}>20d:</span>
                  <span className="text-[10px] font-semibold tabular-nums" style={{ color: pctColor(data['20d_ret']) }}>{fmtPct(data['20d_ret'])}</span>
                </div>
                <div className="pt-1.5" style={{ borderTop: '1px solid var(--scanner-border)' }}>
                  {cryptoTheme ? (
                    <>
                      <div className="text-[7px] uppercase tracking-wider" style={{ color: 'var(--scanner-text3)' }}>Crypto proxy</div>
                      <div className="text-[8px] font-semibold" style={{ color: 'var(--scanner-accent)' }}>{cryptoTheme}</div>
                    </>
                  ) : (
                    <div className="text-[7px]" style={{ color: 'var(--scanner-text3)' }}>No crypto proxy</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="text-[7.5px] mt-1" style={{ color: 'var(--scanner-text3)' }}>
        Data: <a href="https://factorwatch.ai/baskets.html" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>factorwatch.ai</a>
      </div>
    </section>
  );
}
