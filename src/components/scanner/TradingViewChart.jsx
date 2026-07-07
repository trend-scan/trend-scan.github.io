import { useMemo } from 'react';
import { toTradingViewSymbol, toTradingViewInterval } from '@/lib/scanner/tradingViewSymbols';

/**
 * TradingViewChart — embeds TradingView's free Advanced Chart via direct iframe.
 *
 * Previous approach used the embed-widget-advanced-chart.js script which
 * dynamically creates an iframe. That had two problems:
 * 1. The script needs to be in CSP script-src (it was, but fragile)
 * 2. The script creates the iframe as a sibling, not a child, of the
 *    script tag — which broke the height chain in the Sheet panel.
 *
 * This direct iframe approach:
 * - No external script needed (one less CSP directive to maintain)
 * - The iframe IS the chart container (height chain is simple)
 * - Query params configure the widget (same as the script's JSON config)
 *
 * @param {object} props
 * @param {string} props.symbol - bare symbol, e.g. "BTC"
 * @param {string} props.exchange - screener exchange id, e.g. "hyperliquid"
 * @param {string} props.timeframe - screener timeframe, e.g. "4H"
 */
export default function TradingViewChart({ symbol, exchange, timeframe }) {
  const tvSymbol = toTradingViewSymbol(symbol, exchange);
  const tvInterval = toTradingViewInterval(timeframe);

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
      hide_side_toolbar: 'false',
      withdateranges: 'true',
      details: 'false',
      hotlist: 'false',
      calendar: 'false',
      studies: '[]',
    });
    return `https://www.tradingview-widget.com/embed-widget/advanced-chart/?${params.toString()}`;
  }, [tvSymbol, tvInterval]);

  return (
    <iframe
      id="tv-advanced-chart"
      src={src}
      title={`${symbol} · ${timeframe} chart`}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        display: 'block',
      }}
      allowFullScreen
      allow="clipboard-write"
    />
  );
}
