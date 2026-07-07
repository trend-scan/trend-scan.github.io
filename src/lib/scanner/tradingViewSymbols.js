/**
 * Maps a Screener exchange + interval to TradingView's symbol/interval conventions.
 * Best-effort mappings based on documented TradingView conventions.
 *
 * Hyperliquid perpetuals on TradingView use the USDC.P suffix (e.g. BTCUSDC.P),
 * confirmed against TradingView's symbol search.
 */

const EXCHANGE_MAP = {
  hyperliquid:    { prefix: 'HYPERLIQUID', suffix: 'USDC.P' },   // confirmed: BTCUSDC.P
  okx_perps:      { prefix: 'OKX',         suffix: 'USDT.P' },
  okx:            { prefix: 'OKX',         suffix: 'USDT' },
  binance_perps:  { prefix: 'BINANCE',     suffix: 'USDT.P' },
  binance:        { prefix: 'BINANCE',     suffix: 'USDT' },
  kraken:         { prefix: 'KRAKEN',      suffix: 'USD' },
  bybit:          { prefix: 'BYBIT',       suffix: 'USDT.P' },
  // CoinGecko isn't a tradeable venue and has no chart data of its own —
  // fall back to Binance spot, the broadest-coverage venue in this list.
  coingecko:      { prefix: 'BINANCE',     suffix: 'USDT' },
};

const INTERVAL_MAP = {
  '15m': '15',
  '30m': '30',
  '1H':  '60',
  '4H':  '240',
  '12H': '720',
  '1D':  'D',
  '1W':  'W',
};

/** @param {string} symbol - e.g. "BTC" */
/** @param {string} exchange - e.g. "hyperliquid" */
/** @returns {string} e.g. "HYPERLIQUID:BTCUSD.P" */
export function toTradingViewSymbol(symbol, exchange) {
  const map = EXCHANGE_MAP[exchange] || EXCHANGE_MAP.binance;
  return `${map.prefix}:${symbol}${map.suffix}`;
}

/** @param {string} timeframe - e.g. "4H" */
/** @returns {string} TradingView interval code, e.g. "240" or "D" */
export function toTradingViewInterval(timeframe) {
  return INTERVAL_MAP[timeframe] || '240';
}
