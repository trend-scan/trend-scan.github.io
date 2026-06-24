import React from 'react';
import { RefreshCw } from 'lucide-react';

const EXCHANGE_NAMES = {
  okx: 'OKX Spot',
  kraken: 'Kraken',
  binance: 'Binance Spot',
  binance_perps: 'Binance Perps',
};

export default function BoardHeader({ regime, regimeLabel, updatedAt, exchange, isLoading, onRefresh }) {
  const pct20  = regime?.pctAbove20  ?? '—';
  const pct50  = regime?.pctAbove50  ?? '—';
  const pct200 = regime?.pctAbove200 ?? '—';

  const labelColor = regimeLabel?.color === 'risk-on' ? 'var(--scanner-green)'
    : regimeLabel?.color === 'risk-off' ? 'var(--scanner-red)'
    : 'var(--scanner-text2)';

  return (
    <div className="font-mono px-5 md:px-8 py-4" style={{
      background: 'var(--scanner-bg2)',
      borderBottom: '1px solid var(--scanner-border2)'
    }}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        {/* Regime + Breadth strip */}
        <div className="flex items-center gap-4 flex-wrap">
          {regimeLabel && (
            <>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-1.5 h-4 rounded-sm"
                  style={{ background: labelColor }}
                />
                <span className="text-[10px] font-bold" style={{ color: labelColor }}>
                  {regimeLabel.label}
                </span>
              </div>
              <div className="w-px h-5 flex-shrink-0" style={{ background: 'var(--scanner-border2)' }} />
            </>
          )}

          <BreadthChip label="▲20MA" value={`${pct20}%`} color={pct20 >= 60 ? 'var(--scanner-green)' : pct20 <= 35 ? 'var(--scanner-red)' : 'var(--scanner-text2)'} />
          <BreadthChip label="▲50MA" value={`${pct50}%`} color={pct50 >= 60 ? 'var(--scanner-green)' : pct50 <= 35 ? 'var(--scanner-red)' : 'var(--scanner-text2)'} />
          <BreadthChip label="▲200MA" value={`${pct200}%`} color={pct200 >= 60 ? 'var(--scanner-green)' : pct200 <= 35 ? 'var(--scanner-red)' : 'var(--scanner-text2)'} />

          <div className="w-px h-5 flex-shrink-0" style={{ background: 'var(--scanner-border2)' }} />

          <BreadthChip label="NH-20" value={regime?.newHigh20d ?? '—'} color="var(--scanner-blue)" />
          <BreadthChip label="▲4%+" value={regime?.upBig ?? '—'} color="var(--scanner-green)" />
          <BreadthChip label="▼4%+" value={regime?.downBig ?? '—'} color="var(--scanner-red)" />

          <div className="w-px h-5 flex-shrink-0" style={{ background: 'var(--scanner-border2)' }} />

          <span className="text-[9px] tracking-wider" style={{ color: 'var(--scanner-text3)' }}>
            {EXCHANGE_NAMES[exchange] || exchange} · {regime?.total ?? 0} assets · {updatedAt ?? '—'}
          </span>
        </div>

        {/* Refresh */}
        <button
          className="font-mono flex items-center gap-2 text-[10px] font-bold tracking-[0.12em] uppercase px-4 py-2"
          style={{
            background: isLoading ? 'var(--scanner-border2)' : 'var(--scanner-accent)',
            color: isLoading ? 'var(--scanner-text3)' : '#000',
            border: 'none',
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
          disabled={isLoading}
          onClick={onRefresh}
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

function BreadthChip({ label, value, color }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: 'var(--scanner-text3)' }}>{label}</span>
      <span className="text-[13px] font-bold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}
