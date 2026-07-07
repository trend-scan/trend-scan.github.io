import { useMemo, useState } from 'react';
import { toTradingViewSymbol, toTradingViewInterval } from '@/lib/scanner/tradingViewSymbols';

/**
 * TradingViewChart — embeds TradingView's free Advanced Chart via direct iframe.
 *
 * Uses the documented embed URL format: s.tradingview.com/embed-widget/...
 * (not the undocumented tradingview-widget.com domain that the embed script
 * redirects to — that one works but isn't in TradingView's own docs).
 *
 * Features:
 * - Loading state: shows "Loading chart…" while the iframe paints
 * - Conditional side toolbar: hidden on narrow viewports (<640px) where
 *   it would consume too much of the already-limited width
 * - The iframe IS the chart container (height chain is simple)
 * - Query params configure the widget (same as the script's JSON config)
 *
 * @param {object} props
 * @param {string} props.symbol - bare symbol, e.g. "BTC"
 * @param {string} props.exchange - screener exchange id, e.g. "hyperliquid"
 * @param {string} props.timeframe - screener timeframe, e.g. "4H"
 */
export default function TradingViewChart({ symbol, exchange, timeframe }) {
  const [loaded, setLoaded] = useState(false);
  const tvSymbol = toTradingViewSymbol(symbol, exchange);
  const tvInterval = toTradingViewInterval(timeframe);

  // Check viewport width once at render time. The Sheet is opened fresh
  // per row-click, so this will be correct for the viewport the user is
  // on when they open it. Won't react to live resize, but that's an
  // acceptable tradeoff — the user can close and reopen the panel.
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 640;

  const src = useMemo(() => {
    const params = new URLSearchParams({
      frameElementId: 'tv-advanced-chart',
      symbol: tvSymbol,
      interval: tvInterval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      allow_symbol_change: 'true',
      hide_side_toolbar: isNarrow ? 'true' : 'false',
      withdateranges: 'true',
      details: 'false',
      hotlist: 'false',
      calendar: 'false',
      studies: '[]',
    });
    return `https://s.tradingview.com/embed-widget/advanced-chart/?${params.toString()}`;
  }, [tvSymbol, tvInterval, isNarrow]);

  return (
    <>
      {!loaded && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--scanner-text3)',
          fontSize: 11,
          fontFamily: 'IBM Plex Mono, monospace',
        }}>
          Loading chart…
        </div>
      )}
      <iframe
        id="tv-advanced-chart"
        src={src}
        title={`${symbol} · ${timeframe} chart`}
        onLoad={() => setLoaded(true)}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          position: 'relative',
          zIndex: 1,
        }}
        allowFullScreen
        allow="clipboard-write"
      />
    </>
  );
}
