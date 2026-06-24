// Massive (formerly Polygon.io) exchange adapter
// Docs: https://massive.com/docs

const BASE_URL = 'https://api.massive.com';
const WS_URL = 'wss://ws.massive.com';

// Massive uses X: prefix for crypto pairs
function toMassiveTicker(symbol) {
  return `X:${symbol}USD`;
}

function fromMassiveTicker(massiveTicker) {
  // Remove X: prefix and USD suffix
  return massiveTicker.replace('X:', '').replace('USD', '');
}

// Timeframe mapping: app timeframe -> Massive multiplier/timespan
const TIMEFRAME_MAP = {
  '1m': { multiplier: 1, timespan: 'minute' },
  '5m': { multiplier: 5, timespan: 'minute' },
  '15m': { multiplier: 15, timespan: 'minute' },
  '30m': { multiplier: 30, timespan: 'minute' },
  '1h': { multiplier: 1, timespan: 'hour' },
  '4h': { multiplier: 4, timespan: 'hour' },
  '1d': { multiplier: 1, timespan: 'day' },
  '1w': { multiplier: 1, timespan: 'week' },
};

async function fetchCandles(symbol, exchange, timeframe, limit = 300) {
  const apiKey = import.meta.env?.VITE_MASSIVE_API_KEY || import.meta.env?.massiveApiKey;

  if (!apiKey) {
    throw new Error('Massive API key not configured. Set VITE_MASSIVE_API_KEY in your environment.');
  }

  const tf = TIMEFRAME_MAP[timeframe] || TIMEFRAME_MAP['4h'];
  const ticker = toMassiveTicker(symbol);

  // Calculate date range
  const to = new Date();
  const from = new Date(to.getTime() - (limit * getIntervalMs(timeframe)));

  const params = new URLSearchParams({
    multiplier: tf.multiplier.toString(),
    timespan: tf.timespan,
    from: from.toISOString(),
    to: to.toISOString(),
    adjusted: 'false',
    sort: 'asc',
    limit: limit.toString(),
    apiKey: apiKey,
  });

  const url = `${BASE_URL}/v2/aggs/ticker/${ticker}/range/${tf.multiplier}/${tf.timespan}/${from.toISOString()}/${to.toISOString()}?${params}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Massive API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (data.status !== 'OK' || !data.results) {
      throw new Error(`Massive API returned status: ${data.status}`);
    }

    // Convert Massive format to our internal format
    return data.results.map(candle => ({
      ts: candle.t,
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
      vol: candle.v,
      vwap: candle.vw,
    }));
  } catch (error) {
    console.error(`Massive fetch error for ${symbol}:`, error);
    throw error;
  }
}

function getIntervalMs(timeframe) {
  const map = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
  };
  return map[timeframe] || 4 * 60 * 60 * 1000;
}

// Preload - Massive doesn't require preloading
async function preloadExchange(exchange) {
  // No preloading needed for Massive REST API
  return true;
}

// Get available symbols from Massive
async function getSymbols(exchange) {
  // For now, return null - symbols are managed in the universe
  return null;
}

// WebSocket streaming (for real-time updates)
class MassiveWebSocket {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.handlers = {};
    this.subscriptions = new Set();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        // Authenticate with API key
        this.ws.send(JSON.stringify({
          action: 'auth',
          params: { apiKey: this.apiKey }
        }));
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Handle auth response
        if (data.action === 'auth_response' && data.status === 'success') {
          resolve();
          return;
        }

        // Handle data messages
        if (data.ev) {
          const candles = Array.isArray(data) ? data : [data];
          candles.forEach(c => {
            const symbol = fromMassiveTicker(c.sym);
            if (this.handlers[symbol]) {
              this.handlers[symbol]({
                ts: c.s,
                open: c.o,
                high: c.h,
                low: c.l,
                close: c.c,
                vol: c.v,
                vwap: c.a,
              });
            }
          });
        }
      };

      this.ws.onerror = (error) => {
        console.error('Massive WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('Massive WebSocket closed');
      };
    });
  }

  subscribe(symbol, timeframe = '4h') {
    const tf = TIMEFRAME_MAP[timeframe] || TIMEFRAME_MAP['4h'];
    const ticker = toMassiveTicker(symbol);

    // Subscribe to aggregates channel
    this.ws.send(JSON.stringify({
      action: 'subscribe',
      params: {
        channel: 'aggregates',
        symbols: [ticker],
      }
    }));

    this.subscriptions.add(symbol);
  }

  unsubscribe(symbol) {
    const ticker = toMassiveTicker(symbol);

    this.ws.send(JSON.stringify({
      action: 'unsubscribe',
      params: {
        channel: 'aggregates',
        symbols: [ticker],
      }
    }));

    this.subscriptions.delete(symbol);
  }

  onCandle(symbol, handler) {
    this.handlers[symbol] = handler;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

export {
  fetchCandles,
  preloadExchange,
  getSymbols,
  MassiveWebSocket,
  toMassiveTicker,
  fromMassiveTicker,
};