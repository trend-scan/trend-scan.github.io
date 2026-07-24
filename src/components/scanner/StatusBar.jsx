import React from 'react';

function indicatorLabel(type, emaVal, vwapVal) {
  return type === 'vwap' ? `VWAP(${vwapVal}d)` : `EMA(${emaVal})`;
}

const EXCHANGE_NAMES = {
  okx: 'OKX Spot',
  kraken: 'Kraken',
  binance: 'Binance Spot',
  binance_perps: 'Binance Perps',
};

export default function StatusBar({ settings }) {
  const fastLabel = indicatorLabel(settings.fastType, settings.emaFast, settings.vwapFastDays);
  const midLabel  = indicatorLabel(settings.midType,  settings.emaMid,  settings.vwapMidDays);
  const slowLabel = indicatorLabel(settings.slowType, settings.emaSlow, settings.vwapDays);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 font-mono flex items-center justify-between px-5 md:px-8 py-2 text-[9px] tracking-wider" style={{
      background: 'var(--scanner-bg1)',
      borderTop: '1px solid var(--scanner-border2)',
      color: 'var(--scanner-text3)'
    }}>
      <div className="flex gap-5 flex-wrap">
        <span>{EXCHANGE_NAMES[settings.exchange] || settings.exchange.toUpperCase()}</span>
        <span>Top 500 · {settings.timeframe || '4H'}</span>
        <span className="hidden sm:inline">
          Price &gt; {slowLabel} · Fast {fastLabel} &gt; Slow {midLabel}
        </span>
        {settings.chainFilter && settings.chainFilter !== 'All' && (
          <span style={{ color: 'var(--scanner-accent)' }}>Chain: {settings.chainFilter}</span>
        )}
        {settings.sectorFilter && settings.sectorFilter !== 'All' && (
          <span style={{ color: 'var(--scanner-accent)' }}>Sector: {settings.sectorFilter}</span>
        )}
        {settings.maxSupplyFilter > 0 && (
          <span style={{ color: 'var(--scanner-accent)' }}>Max Supply &gt;= {settings.maxSupplyFilter.toLocaleString()}</span>
        )}
      </div>
      <span style={{ color: 'var(--scanner-text3)' }}>Trend Strength Screener v1.5</span>
    </div>
  );
}