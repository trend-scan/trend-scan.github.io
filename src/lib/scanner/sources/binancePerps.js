/**
 * Binance USDⓈ-M Futures (perps) — free, no API key, CORS-enabled
 * Strong crypto perps source with deep liquidity. 600+ USDT-quoted perpetuals.
 *
 * Docs: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data
 * Endpoint: https://fapi.binance.com/fapi/v1/klines
 *
 * IMPORTANT — Binance "1000X" prefix convention:
 *   Low-priced tokens are listed on Binance perps with a '1000' or
 *   '1000000' prefix to avoid sub-cent price ticks. Examples:
 *     'XEC' (eCash) is listed as '1000XEC'
 *     'MOG' (Mog Coin) is listed as '1000000MOG'
 *     'SHIB' is listed as '1000SHIB'
 *     'PEPE' is listed as '1000PEPE'
 *
 *   This source maintains a universe cache that maps bare symbols (e.g. 'XEC')
 *   to actual Binance baseAssets (e.g. '1000XEC'). Callers always pass the
 *   bare symbol; the source handles the translation transparently.
 *
 *   Price adjustment: Binance returns the BASKET price for 1000x/1000000x
 *   symbols (e.g. $0.10 for 1000000MOG, not $0.0000001 per token). We
 *   divide OHLC by the multiplier to get per-token prices that match
 *   other exchanges. Volume is multiplied by the multiplier to get
 *   actual token count.
 *
 * NOTE: Geo-restricted in some regions. The UI marks this with "⚠ VPN".
 */

const BASE = 'https://fapi.binance.com/fapi/v1';

const TIMEFRAME_INTERVAL = {
  '15m': '15m',
  '30m': '30m',
  '1H': '1h',
  '4H': '4h',
  '12H': '12h',
  '1D': '1d',
  '1w': '1w',
  '1W': '1w',
};

// Cache of universe: bare symbol -> actual Binance baseAsset
// (e.g. 'XEC' -> '1000XEC', 'BTC' -> 'BTC')
let _universe = null;
let _universeTime = 0;
const UNIVERSE_TTL_MS = 10 * 60 * 1000;  // refresh every 10 min

async function loadUniverse() {
  const now = Date.now();
  if (_universe && now - _universeTime < UNIVERSE_TTL_MS) return _universe;
  try {
    const res = await fetch(`${BASE}/exchangeInfo`);
    if (!res.ok) return _universe || null;
    const d = await res.json();
    _universe = {};  // bare -> actual
    for (const inst of d.symbols || []) {
      if (inst.contractType !== 'PERPETUAL') continue;
      if (inst.quoteAsset !== 'USDT') continue;
      const baseAsset = inst.baseAsset;
      if (!baseAsset) continue;
      // Add the bare asset as-is (e.g. 'BTC' -> 'BTC')
      _universe[baseAsset] = baseAsset;
      // Also add the normalized form (strip '1000' / '1000000' prefixes)
      // so callers passing 'XEC' find '1000XEC'
      if (baseAsset.startsWith('1000000')) {
        const bare = baseAsset.slice(7);
        _universe[bare] = baseAsset;
      } else if (baseAsset.startsWith('1000')) {
        const bare = baseAsset.slice(4);
        _universe[bare] = baseAsset;
      }
    }
    _universeTime = now;
    return _universe;
  } catch (e) {
    console.warn(`[binance_perps] universe fetch failed: ${e.message}`);
    return _universe || null;
  }
}

/**
 * Fetch OHLC candles for a symbol from Binance USDⓈ-M futures.
 *
 * @param {string} symbol - bare symbol (e.g. 'BTC', 'ETH', 'XEC').
 *                          The source automatically maps 'XEC' → '1000XEC'
 *                          based on the Binance exchangeInfo listing.
 * @param {string} [timeframe='4H']
 * @param {number} [limit=300]
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>|null>}
 */
export async function fetchCandles(symbol, timeframe = '4H', limit = 300) {
  const interval = TIMEFRAME_INTERVAL[timeframe] || '4h';

  // Resolve actual Binance baseAsset (handles 1000x prefix)
  const universe = await loadUniverse();
  const symUpper = symbol.toUpperCase();
  const actualBase = universe?.[symUpper] || symUpper;  // fallback: try as-is
  const binanceSymbol = `${actualBase}USDT`;

  // Determine the price multiplier for 1000x/1000000x-prefixed symbols.
  // Binance returns the BASKET price (e.g. $0.10 for 1000000MOG), NOT the
  // per-token price ($0.0000001). We must divide by the multiplier to get
  // the true per-token price that matches other exchanges (Hyperliquid, Yahoo).
  let priceMultiplier = 1;
  if (actualBase.startsWith('1000000')) {
    priceMultiplier = 1000000;
  } else if (actualBase.startsWith('1000')) {
    priceMultiplier = 1000;
  }

  const url = `${BASE}/klines?symbol=${encodeURIComponent(binanceSymbol)}&interval=${interval}&limit=${Math.min(limit, 1500)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 400 = invalid symbol; 429 = rate limit; 451 = geo-blocked
      return null;
    }
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;

    // Binance kline format: [openTime, open, high, low, close, volume, closeTime,
    //                       quoteAssetVolume, trades, takerBuyBase, takerBuyQuote, ignore]
    // For 1000x/1000000x symbols, divide OHLC by the multiplier to get
    // per-token prices. Volume is already in basket units, so multiply
    // by the multiplier to get actual token count.
    return arr.map(c => ({
      ts: parseInt(c[0]),
      open: parseFloat(c[1]) / priceMultiplier,
      high: parseFloat(c[2]) / priceMultiplier,
      low: parseFloat(c[3]) / priceMultiplier,
      close: parseFloat(c[4]) / priceMultiplier,
      vol: parseFloat(c[5]) * priceMultiplier,
    }));
  } catch (e) {
    console.warn(`[binance_perps] ${symbol} failed: ${e.message}`);
    return null;
  }
}

/**
 * Check if a symbol is supported by Binance perps.
 * @param {string} symbol - bare symbol (e.g. 'BTC', 'XEC')
 * @returns {Promise<boolean>}
 */
export async function isSupported(symbol) {
  const universe = await loadUniverse();
  if (!universe) return true;  // don't block if universe fetch failed
  return symbol.toUpperCase() in universe;
}

export const sourceMeta = {
  id: 'binance_perps',
  type: 'crypto',
  supportsTimeframes: ['15m', '30m', '1H', '4H', '12H', '1D', '1w', '1W'],
  rateLimitPerMin: 1200,  // Binance default weight limit is 2400/min
  requiresApiKey: false,
  maxCandlesPerCall: 1500,
  notes: 'Geo-restricted in some regions (US, UK, etc.). UI marks with ⚠ VPN.',
};
