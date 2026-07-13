/**
 * QuickViewBar — 5 market summary cards displayed above the tab bar.
 *
 * Shows the top tickers for each category:
 * 1. Strongest Right Now: best composite score (returns + RS + trend)
 * 2. Picking Up Speed: recent acceleration vs monthly pace
 * 3. Crowded Longs: high funding + price climbing (Hyperliquid data)
 * 4. Washed Out: worst 60D returns (rebound watch list)
 * 5. Yesterday's Big Moves: largest |ret1d| (drift candidates)
 *
 * Each card shows the top ticker + its key metric. Compact, scannable.
 */

function fmtPct(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}

function fmtPctRaw(v) {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function fmtFundingAnn(v) {
  if (v == null) return '—';
  return v.toFixed(1) + '%';
}

function retColor(v) {
  if (v == null) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text3)';
}

function QuickCard({ title, subtitle, accentColor, items, renderItem }) {
  return (
    <div className="flex-1 min-w-[180px] rounded p-3" style={{
      background: 'var(--scanner-bg1)',
      border: `1px solid var(--scanner-border2)`,
      borderTop: `2px solid ${accentColor}`,
    }}>
      <div className="text-[9px] font-bold tracking-[0.1em] uppercase mb-0.5" style={{ color: accentColor }}>
        {title}
      </div>
      <div className="text-[7.5px] mb-2" style={{ color: 'var(--scanner-text3)' }}>
        {subtitle}
      </div>
      <div className="space-y-1">
        {items.length === 0 ? (
          <div className="text-[9px] py-2" style={{ color: 'var(--scanner-text3)' }}>—</div>
        ) : (
          items.slice(0, 3).map((item, i) => renderItem(item, i))
        )}
      </div>
    </div>
  );
}

export default function QuickViewBar({ quickView }) {
  if (!quickView) return null;

  const { strongest = [], pickingUp = [], crowded = [], washedOut = [], bigMoves = [] } = quickView;

  return (
    <div className="flex gap-2 px-5 md:px-8 py-3 flex-wrap" style={{
      background: 'var(--scanner-bg)',
      borderBottom: '1px solid var(--scanner-border2)',
    }}>
      {/* 1. Strongest Right Now */}
      <QuickCard
        title="Strongest Right Now"
        subtitle="Best 1M ret + RS + trend"
        accentColor="var(--scanner-green)"
        items={strongest}
        renderItem={(t, i) => (
          <div key={t.symbol} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-bold" style={{ color: 'var(--scanner-text3)' }}>#{i+1}</span>
              <span className="text-[10px] font-bold" style={{ color: 'var(--scanner-text)' }}>{t.symbol}</span>
            </div>
            <span className="text-[10px] font-semibold tabular-nums" style={{ color: retColor(t.ret20d) }}>
              {fmtPct(t.ret20d)}
            </span>
          </div>
        )}
      />

      {/* 2. Picking Up Speed */}
      <QuickCard
        title="Picking Up Speed"
        subtitle="1W outpacing 1M trend"
        accentColor="var(--scanner-accent)"
        items={pickingUp}
        renderItem={(t, i) => (
          <div key={t.symbol} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-bold" style={{ color: 'var(--scanner-text3)' }}>#{i+1}</span>
              <span className="text-[10px] font-bold" style={{ color: 'var(--scanner-text)' }}>{t.symbol}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] tabular-nums" style={{ color: 'var(--scanner-text3)' }}>1M:{fmtPct(t.ret20d)}</span>
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: retColor(t.ret1w) }}>
                {fmtPct(t.ret1w)}
              </span>
            </div>
          </div>
        )}
      />

      {/* 3. Crowded Longs */}
      <QuickCard
        title="Crowded Longs"
        subtitle="High funding + price climbing"
        accentColor="var(--scanner-red)"
        items={crowded}
        renderItem={(t, i) => (
          <div key={t.symbol} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-bold" style={{ color: 'var(--scanner-text3)' }}>#{i+1}</span>
              <span className="text-[10px] font-bold" style={{ color: 'var(--scanner-text)' }}>{t.symbol}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] tabular-nums" style={{ color: 'var(--scanner-text3)' }}>5D:{fmtPct(t.ret5d)}</span>
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: 'var(--scanner-red)' }}>
                {fmtFundingAnn(t.fundingAnn)}
              </span>
            </div>
          </div>
        )}
      />

      {/* 4. Washed Out */}
      <QuickCard
        title="Washed Out"
        subtitle="Worst 60D — rebound zone"
        accentColor="#6a6a8a"
        items={washedOut}
        renderItem={(t, i) => (
          <div key={t.symbol} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-bold" style={{ color: 'var(--scanner-text3)' }}>#{i+1}</span>
              <span className="text-[10px] font-bold" style={{ color: 'var(--scanner-text)' }}>{t.symbol}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] tabular-nums" style={{ color: 'var(--scanner-text3)' }}>20D:{fmtPct(t.ret20d)}</span>
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: 'var(--scanner-red)' }}>
                {fmtPct(t.ret60d)}
              </span>
            </div>
          </div>
        )}
      />

      {/* 5. Yesterday's Big Moves */}
      <QuickCard
        title="Yesterday's Big Moves"
        subtitle="Outsized 1D moves — drift zone"
        accentColor="var(--scanner-blue)"
        items={bigMoves}
        renderItem={(t, i) => (
          <div key={t.symbol} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[8px] font-bold" style={{ color: 'var(--scanner-text3)' }}>#{i+1}</span>
              <span className="text-[10px] font-bold" style={{ color: 'var(--scanner-text)' }}>{t.symbol}</span>
              {t.direction === 'up' ? '▲' : '▼'}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] tabular-nums" style={{ color: 'var(--scanner-text3)' }}>
                Vol:{t.volRatio != null ? t.volRatio.toFixed(1)+'x' : '—'}
              </span>
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: retColor(t.ret1d) }}>
                {fmtPct(t.ret1d)}
              </span>
            </div>
          </div>
        )}
      />
    </div>
  );
}
