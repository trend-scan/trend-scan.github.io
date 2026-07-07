import { useEffect, useRef } from 'react';
import { toTradingViewSymbol, toTradingViewInterval } from '@/lib/scanner/tradingViewSymbols';

/**
 * TradingViewChart — embeds TradingView's free Advanced Chart widget.
 *
 * The widget is a script tag that injects an iframe. It's not reactive to
 * prop changes after mount, so the effect re-runs (and fully re-injects
 * the widget) whenever symbol, exchange, or timeframe changes.
 *
 * `allow_symbol_change: true` lets the user manually search a different
 * symbol in the widget itself if the mapped one doesn't resolve on that
 * venue — TradingView doesn't have every token on every exchange.
 *
 * @param {object} props
 * @param {string} props.symbol - bare symbol, e.g. "BTC"
 * @param {string} props.exchange - screener exchange id, e.g. "hyperliquid"
 * @param {string} props.timeframe - screener timeframe, e.g. "4H"
 */
export default function TradingViewChart({ symbol, exchange, timeframe }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const widgetDiv = document.createElement('div');
    widgetDiv.style.height = '100%';
    widgetDiv.style.width = '100%';
    containerRef.current.appendChild(widgetDiv);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: toTradingViewSymbol(symbol, exchange),
      interval: toTradingViewInterval(timeframe),
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(0,0,0,0)',
      allow_symbol_change: true,   // lets the user manually search a different
                                    // symbol in the widget itself if the mapped
                                    // one doesn't resolve on that venue
      support_host: 'https://www.tradingview.com',
    });
    containerRef.current.appendChild(script);
  }, [symbol, exchange, timeframe]);

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />;
}
