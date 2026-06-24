import React from 'react';

export default function ProgressBar({ progress, status }) {
  const { done = 0, total = 0, matched = 0, message = '—' } = progress;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const isIndeterminate = status === 'fetching_universe' || status === 'loading_exchange';
  const isActive = isIndeterminate || status === 'scanning';

  return (
    <div className="font-mono" style={{
      background: 'var(--scanner-bg1)',
      borderBottom: '1px solid var(--scanner-border)'
    }}>
      {/* Bar track */}
      <div className="h-[2px] relative overflow-hidden" style={{ background: 'var(--scanner-border)' }}>
        {isIndeterminate ? (
          <div className="absolute h-full animate-indeterminate" style={{
            background: 'linear-gradient(90deg, transparent, var(--scanner-accent), transparent)',
            width: '35%'
          }} />
        ) : (
          <div className="h-full transition-all duration-200" style={{
            background: status === 'complete'
              ? 'var(--scanner-green)'
              : 'linear-gradient(90deg, var(--scanner-accent), var(--scanner-accent2))',
            width: `${pct}%`
          }} />
        )}
      </div>

      <div className="flex items-center gap-4 px-5 md:px-8 py-2.5 flex-wrap">
        <MetaItem label="Scanned">
          <span style={{ color: 'var(--scanner-accent)' }}>{done}</span>
          <span style={{ color: 'var(--scanner-text3)' }}> / {total || '—'}</span>
        </MetaItem>
        <MetaItem label="Matched">
          <span style={{ color: 'var(--scanner-green)' }}>{matched}</span>
        </MetaItem>
        <MetaItem label="Status">
          <span style={{ color: 'var(--scanner-text2)' }}>{message}</span>
        </MetaItem>
        <div className="ml-auto">
          <StatusPill status={status} />
        </div>
      </div>
    </div>
  );
}

function MetaItem({ label, children }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="font-semibold tracking-[0.1em] uppercase" style={{ color: 'var(--scanner-text3)' }}>{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function StatusPill({ status }) {
  const config = {
    idle:             { label: 'Idle',     color: 'var(--scanner-text3)',  bg: 'transparent',            border: 'var(--scanner-border2)' },
    fetching_universe:{ label: 'Fetching', color: 'var(--scanner-accent)', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)' },
    loading_exchange: { label: 'Loading',  color: 'var(--scanner-accent)', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)' },
    scanning:         { label: 'Scanning', color: 'var(--scanner-accent)', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)' },
    complete:         { label: 'Complete', color: 'var(--scanner-green)',  bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.3)' },
    error:            { label: 'Error',    color: 'var(--scanner-red)',    bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.3)' },
  };
  const c = config[status] || config.idle;

  return (
    <span className="flex items-center gap-1.5 text-[9px] font-bold tracking-[0.1em] uppercase px-2.5 py-1 rounded" style={{
      color: c.color, background: c.bg, border: `1px solid ${c.border}`
    }}>
      {(status === 'scanning' || status === 'fetching_universe' || status === 'loading_exchange') && (
        <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: c.color }} />
      )}
      {c.label}
    </span>
  );
}