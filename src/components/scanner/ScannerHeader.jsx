import React from 'react';

function indicatorLabel(type, emaVal, vwapVal) {
  return type === 'vwap' ? `VWAP(${vwapVal}d)` : `EMA(${emaVal})`;
}

const EXCHANGE_NAMES = {
  okx_perps: 'OKX Perps',
  okx: 'OKX Spot',
  kraken: 'Kraken',
  binance: 'Binance Spot',
  binance_perps: 'Binance Perps',
  hyperliquid: 'Hyperliquid',
  bybit: 'Bybit',
  coingecko: 'CoinGecko',
};

function fmtVol(v) {
  if (!v || v <= 0) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

export default function ScannerHeader({ settings, scanMeta }) {
  const fastLabel = indicatorLabel(settings.fastType, settings.emaFast, settings.vwapFastDays);
  const midLabel  = indicatorLabel(settings.midType,  settings.emaMid,  settings.vwapMidDays);
  const slowLabel = indicatorLabel(settings.slowType, settings.emaSlow, settings.vwapDays);

  return (
    <div className="font-mono" style={{
      background: 'linear-gradient(180deg, #0a0d14 0%, var(--scanner-bg1) 100%)',
      borderBottom: '1px solid var(--scanner-border2)'
    }}>
      <div className="flex items-start justify-between gap-6 px-5 md:px-8 pt-5 pb-4 flex-wrap">
        <div>
          {/* Eyebrow */}
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--scanner-accent)', boxShadow: '0 0 6px var(--scanner-accent)' }} />
            <span className="text-[9px] font-semibold tracking-[0.2em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
              Crypto · Market Structure
            </span>
          </div>

          {/* Title */}
          <h1 className="text-xl md:text-2xl font-bold tracking-tight leading-none" style={{ color: 'var(--scanner-text)' }}>
            Trend{' '}
            <span style={{
              background: 'linear-gradient(90deg, var(--scanner-accent), #ffcc44)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>Strength Screener</span>
          </h1>

          {/* Short description */}
          <p className="mt-2 text-[10px] leading-relaxed max-w-lg" style={{ color: 'var(--scanner-text3)' }}>
            Identify high-momentum assets across the top 300 market cap pairs.
          </p>
          <p className="mt-1 text-[10px] leading-relaxed max-w-lg" style={{ color: 'var(--scanner-text3)' }}>
            Returns assets satisfying: <span style={{ color: 'var(--scanner-text2)' }}>Price &gt; Base Trend</span> AND <span style={{ color: 'var(--scanner-text2)' }}>Fast MA &gt; Slow MA</span>.
            Fully customizable by timeframe, calculation type, moving average lengths, and optional
            <span style={{ color: 'var(--scanner-text2)' }}> 24H volume</span> and
            <span style={{ color: 'var(--scanner-text2)' }}> market cap</span> filters to screen out illiquid or micro-cap assets.
          </p>

          {/* Live condition summary — each item on its own line */}
          <div className="mt-3 flex flex-col gap-1 text-[10px]" style={{ color: 'var(--scanner-text2)' }}>
            <div className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--scanner-text3)' }} />
              <span>Price above</span>
              <CondBadge color="var(--scanner-green)">{slowLabel}</CondBadge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--scanner-text3)' }} />
              <CondBadge color="var(--scanner-blue)">Fast {fastLabel}</CondBadge>
              <span style={{ color: 'var(--scanner-text3)' }}>above</span>
              <CondBadge color="var(--scanner-blue)">Slow {midLabel}</CondBadge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--scanner-text3)' }} />
              <span>Timeframe</span>
              <CondBadge color="var(--scanner-accent)">{settings.timeframe || '4H'}</CondBadge>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--scanner-text3)' }} />
              <span>Universe</span>
              <CondBadge color="var(--scanner-text2)">Top 300</CondBadge>
            </div>
            {settings.minVolume > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--scanner-accent)' }} />
                <span>Min Vol 24H</span>
                <CondBadge color="var(--scanner-accent)">{fmtVol(settings.minVolume)}</CondBadge>
              </div>
            )}
            {settings.minMarketCap > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--scanner-accent)' }} />
                <span>Min MCap</span>
                <CondBadge color="var(--scanner-accent)">{fmtVol(settings.minMarketCap)}</CondBadge>
              </div>
            )}
          </div>
        </div>

        {/* Right meta */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <MetaChip label="Exchange" value={EXCHANGE_NAMES[settings.exchange] || settings.exchange.toUpperCase()} />
          <MetaChip label="Updated"  value={scanMeta.updatedAt || '—'} />
          <MetaChip label="Duration" value={scanMeta.duration ? `${scanMeta.duration}s` : '—'} />
        </div>
      </div>
    </div>
  );
}

function CondBadge({ children, color }) {
  return (
    <span className="px-1.5 py-0.5 font-semibold text-[9.5px]" style={{
      background: `${color}15`,
      color,
      border: `1px solid ${color}35`
    }}>
      {children}
    </span>
  );
}

function MetaChip({ label, value }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[8px] font-semibold tracking-[0.14em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
        {label}
      </span>
      <span className="text-[11px] font-medium" style={{ color: 'var(--scanner-text2)' }}>
        {value}
      </span>
    </div>
  );
}