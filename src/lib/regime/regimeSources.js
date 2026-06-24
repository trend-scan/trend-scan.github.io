/**
 * Regime Data Sources - Free API Integration
 * Sources: CoinGecko, Binance, Kraken, FRED, Alternative.me
 */

// ─── API Keys ────────────────────────────────────────────────────────────────

const FRED_API_KEY = import.meta.env.VITE_FRED_API_KEY ?? '234ddf07b7e98f24f45a1b0981679a9e';
const MASSIVE_API_KEY = import.meta.env.VITE_MASSIVE_API_KEY ?? '';

// ─── Fetch Helpers ─────────────────────────────────────────────────────────────

async function safeFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${url}`);
  }
  return res.json();
}

// ─── CoinGecko ─────────────────────────────────────────────────────────────────

export async function fetchCoinGeckoGlobal() {
  const data = await safeFetch('https://api.coingecko.com/api/v3/global');
  const d = data.data;
  return {
    btcDominance: d.market_cap_percentage.btc,
    ethDominance: d.market_cap_percentage.eth,
    usdtDominance: d.market_cap_percentage.usdt,
    totalMarketCap: d.total_market_cap.usd,
    totalVolume: d.total_volume.usd,
    marketCapChange24h: d.market_cap_change_percentage_24h_usd,
    activeCryptocurrencies: d.active_cryptocurrencies,
  };
}

export async function fetchCoinGeckoMarketCapChart(days = 365) {
  const data = await safeFetch(
    `https://api.coingecko.com/api/v3/global/market_cap_chart?vs_currency=usd&days=${days}`
  );
  // Returns { market_cap: [[ts, value], ...], volume: [[ts, value], ...] }
  return {
    marketCap: data.market_cap_by_currency?.usd ?? [],
    volume: data.total_volumes ?? [],
  };
}

export async function fetchCoinMarketChart(coinId, days = 365) {
  const data = await safeFetch(
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`
  );
  return {
    prices: data.prices ?? [],
    marketCaps: data.market_caps ?? [],
    volumes: data.total_volumes ?? [],
  };
}

// ─── Binance Klines ───────────────────────────────────────────────────────────

export async function fetchBinanceKlines(symbol, interval = '1d', limit = 365) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const raw = await safeFetch(url);

  return raw.map(k => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}

// ─── Kraken OHLCV ─────────────────────────────────────────────────────────────

export async function fetchKrakenOHLC(pair, interval = 1440, since = null) {
  const now = Math.floor(Date.now() / 1000);
  const period = interval * 60; // interval in minutes
  const from = since ?? (now - 365 * 24 * 60 * 60);

  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}&since=${from}`;
  const json = await safeFetch(url);

  if (json.error?.length) {
    throw new Error(json.error.join(', '));
  }

  const key = Object.keys(json.result).find(k => k !== 'last');
  if (!key) throw new Error('No data for pair: ' + pair);

  const raw = json.result[key];
  return raw.map(k => ({
    time: k[0] * 1000,
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[6]),
    tr: parseFloat(k[7]), // true range for ATR
  }));
}

// ─── Fear & Greed ─────────────────────────────────────────────────────────────

export async function fetchFearGreed(limit = 90) {
  const data = await safeFetch(`https://api.alternative.me/fng/?limit=${limit}`);
  return (data.data || []).map(d => ({
    time: parseInt(d.timestamp) * 1000,
    value: parseInt(d.value),
    classification: d.value_classification,
  }));
}

// ─── FRED ────────────────────────────────────────────────────────────────────

export async function fetchFredSeries(seriesId, limit = 104) {
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}` +
    `&api_key=${FRED_API_KEY}` +
    `&file_type=json` +
    `&sort_order=desc` +
    `&limit=${limit}`;

  const data = await safeFetch(url);
  if (data.error) {
    throw new Error(data.error.message || 'FRED fetch failed');
  }

  return (data.observations || [])
    .filter(o => o.value !== '.')
    .map(o => ({
      date: o.date,
      time: new Date(o.date).getTime(),
      value: parseFloat(o.value),
    }))
    .reverse();
}

// FRED series to fetch
const FRED_SERIES = {
  // Liquidity
  M2SL: { id: 'M2SL', name: 'M2 Money Supply', limit: 104 },
  WALCL: { id: 'WALCL', name: 'Fed Assets', limit: 104 },
  WTREGEN: { id: 'WTREGEN', name: 'Treasury General', limit: 104 },
  RRPONTSYD: { id: 'RRPONTSYD', name: 'Reverse Repos', limit: 104 },
  NFCI: { id: 'NFCI', name: 'Fin Conditions', limit: 104 },
  WRESBAL: { id: 'WRESBAL', name: 'Fed Reserves', limit: 104 },

  // Growth
  ICSA: { id: 'ICSA', name: 'Jobless Claims', limit: 52 },
  BAMLH0A0HYM2: { id: 'BAMLH0A0HYM2', name: 'HY Spread', limit: 365 },

  // Inflation
  T10YIE: { id: 'T10YIE', name: '10Y Breakeven', limit: 365 },
  T5YIFR: { id: 'T5YIFR', name: '5Y5Y Fwd Inflation', limit: 365 },
  CPIAUCSL: { id: 'CPIAUCSL', name: 'CPI YoY', limit: 60 },
};

export async function fetchAllFredData() {
  const results = {};
  let fredAvailable = false;

  // Fetch in batches to avoid overwhelming
  const seriesIds = Object.keys(FRED_SERIES);
  const batchSize = 5;

  for (let i = 0; i < seriesIds.length; i += batchSize) {
    const batch = seriesIds.slice(i, i + batchSize);
    const promises = batch.map(async (id) => {
      try {
        const series = await fetchFredSeries(id, FRED_SERIES[id].limit);
        return { id, series, error: null };
      } catch (e) {
        return { id, series: [], error: e.message };
      }
    });

    const batchResults = await Promise.all(promises);
    for (const { id, series, error } of batchResults) {
      results[id] = series;
      if (!error && series.length > 0) {
        fredAvailable = true;
      }
    }
  }

  // Compute derived series
  if (results.WALCL && results.WTREGEN && results.RRPONTSYD) {
    // Fed Net Liquidity = Fed Assets - Treasury General - Reverse Repos
    const dates = [...new Set([
      ...results.WALCL.map(d => d.date),
      ...results.WTREGEN.map(d => d.date),
      ...results.RRPONTSYD.map(d => d.date),
    ])].sort();

    results.FED_NET_LIQ = dates.map(date => {
      const walcl = results.WALCL.find(d => d.date === date);
      const wtregen = results.WTREGEN.find(d => d.date === date);
      const rrp = results.RRPONTSYD.find(d => d.date === date);
      if (walcl && wtregen && rrp) {
        return {
          date,
          time: walcl.time,
          value: (walcl.value - wtregen.value - rrp.value) / 1000, // in trillions
        };
      }
      return null;
    }).filter(Boolean);
  }

  return { series: results, fredAvailable };
}

// ─── Massive API (Primary) ────────────────────────────────────────────────────

export async function fetchMassiveCryptoOHLC(ticker, limit = 365) {
  if (!MASSIVE_API_KEY) return null;

  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - limit * 86400000).toISOString().split('T')[0];

    const url = `https://api.massive.com/v2/aggs/ticker/X:${ticker}/range/1/day/${from}/${to}?apiKey=${MASSIVE_API_KEY}&sort=asc&limit=${limit}`;

    const data = await safeFetch(url);
    if (!data.results?.length) return null;

    return data.results.map(c => ({
      time: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: c.v,
    }));
  } catch (e) {
    console.warn('Massive fetch failed:', e.message);
    return null;
  }
}

export async function fetchMassiveForexOHLC(pair, limit = 365) {
  if (!MASSIVE_API_KEY) return null;

  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - limit * 86400000).toISOString().split('T')[0];

    const url = `https://api.massive.com/v2/aggs/ticker/C:${pair}/range/1/day/${from}/${to}?apiKey=${MASSIVE_API_KEY}&sort=asc&limit=${limit}`;

    const data = await safeFetch(url);
    if (!data.results?.length) return null;

    return data.results.map(c => ({
      time: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: c.v,
    }));
  } catch (e) {
    console.warn('Massive forex fetch failed:', e.message);
    return null;
  }
}

// ─── Main Data Fetcher ─────────────────────────────────────────────────────────

export async function fetchAllRegimeData() {
  try {
    const errors = {};

    // Fetch all sources in parallel with safe fallbacks
    const [
    binanceBTC,
    binanceETH,
    binanceETHBTC,
    binanceSOL,
    binanceBNB,
    binanceLINK,
    binanceDOGE,
    fearGreed,
    krakenGold,
    krakenBTC,
    krakenETH,
    coingeckoGlobal,
    coingeckoBTC,
    coingeckoETH,
    fredData,
  ] = await Promise.allSettled([
    // Binance OHLCV
    fetchBinanceKlines('BTCUSDT', '1d', 365),
    fetchBinanceKlines('ETHUSDT', '1d', 365),
    fetchBinanceKlines('ETHBTC', '1d', 365),
    fetchBinanceKlines('SOLUSDT', '1d', 365),
    fetchBinanceKlines('BNBUSDT', '1d', 365),
    fetchBinanceKlines('LINKUSDT', '1d', 365),
    fetchBinanceKlines('DOGEUSDT', '1d', 365),

    // Fear & Greed
    fetchFearGreed(90),

    // Kraken Gold
    fetchKrakenOHLC('XAUUSD', 1440),

    // Kraken BTC/ETH (backup)
    fetchKrakenOHLC('XXBTZUSD', 1440),
    fetchKrakenOHLC('XETHZUSD', 1440),

    // CoinGecko Global
    fetchCoinGeckoGlobal(),

    // CoinGecko BTC/ETH market charts
    fetchCoinMarketChart('bitcoin', 365),
    fetchCoinMarketChart('ethereum', 365),

    // FRED
    fetchAllFredData(),
  ]);

  // Process results
  const btcPrices = binanceBTC.status === 'fulfilled' ? binanceBTC.value : [];
  const ethPrices = binanceETH.status === 'fulfilled' ? binanceETH.value : [];
  const ethBtcPrices = binanceETHBTC.status === 'fulfilled' ? binanceETHBTC.value : [];
  const solPrices = binanceSOL.status === 'fulfilled' ? binanceSOL.value : [];
  const bnbPrices = binanceBNB.status === 'fulfilled' ? binanceBNB.value : [];
  const linkPrices = binanceLINK.status === 'fulfilled' ? binanceLINK.value : [];
  const dogePrices = binanceDOGE.status === 'fulfilled' ? binanceDOGE.value : [];
  const fgData = fearGreed.status === 'fulfilled' ? fearGreed.value : [];
  const goldPrices = krakenGold.status === 'fulfilled' ? krakenGold.value : [];
  const krakenBTCPrices = krakenBTC.status === 'fulfilled' ? krakenBTC.value : [];
  const krakenETHPrices = krakenETH.status === 'fulfilled' ? krakenETH.value : [];
  const cgGlobal = coingeckoGlobal.status === 'fulfilled' ? coingeckoGlobal.value : {};
  const cgBTC = coingeckoBTC.status === 'fulfilled' ? coingeckoBTC.value : {};
  const cgETH = coingeckoETH.status === 'fulfilled' ? coingeckoETH.value : {};
  const fred = fredData.status === 'fulfilled' ? fredData.value : { series: {}, fredAvailable: false };

  // Track data availability
  const sources = {
    btc: btcPrices.length > 0 ? 'BINANCE' : (krakenBTCPrices.length > 0 ? 'KRAKEN' : 'OFFLINE'),
    eth: ethPrices.length > 0 ? 'BINANCE' : (krakenETHPrices.length > 0 ? 'KRAKEN' : 'OFFLINE'),
    gold: goldPrices.length > 0 ? 'KRAKEN' : 'OFFLINE',
    fearGreed: fgData.length > 0 ? 'ALTERNATIVE' : 'OFFLINE',
    fred: fred.fredAvailable ? 'FRED' : 'OFFLINE',
  };

  // Extract price series (arrays of numbers)
  const extractPrices = (arr) => arr.map(c => c.close);
  const extractVolumes = (arr) => arr.map(c => c.volume);
  const extractTimes = (arr) => arr.map(c => c.time);

  // Use Binance BTC if available, else Kraken
  const btcPriceSeries = extractPrices(btcPrices.length > 0 ? btcPrices : krakenBTCPrices);
  const btcTimeSeries = extractTimes(btcPrices.length > 0 ? btcPrices : krakenBTCPrices);
  const btcVolumeSeries = extractVolumes(btcPrices.length > 0 ? btcPrices : krakenBTCPrices);

  const ethPriceSeries = extractPrices(ethPrices.length > 0 ? ethPrices : krakenETHPrices);
  const ethTimeSeries = extractTimes(ethPrices.length > 0 ? ethPrices : krakenETHPrices);

  const goldPriceSeries = extractPrices(goldPrices);
  const goldTimeSeries = extractTimes(goldPrices);

  // ETH/BTC ratio from Binance
  const ethBtcRatioSeries = ethBtcPrices.length > 0
    ? ethBtcPrices.map(c => c.close)
    : [];

  // CoinGecko derived data
  const btcDomSeries = [];
  const ethDomSeries = [];
  const usdtDomSeries = [];

  if (cgGlobal.btcDominance && cgBTC.prices?.length) {
    // Estimate dominance series from current values (would need historical for proper calc)
    const btcPricesArr = cgBTC.prices.map(p => p[1]);
    const totalCapSeries = cgBTC.marketCaps?.map(m => m[1]) ?? [];
    const ethPricesArr = cgETH.prices?.map(p => p[1]) ?? [];

    // Approximate dominance over time (simplified)
    for (let i = 0; i < btcPricesArr.length; i++) {
      const btcCap = totalCapSeries[i] ?? btcPricesArr[i] * 19500000;
      const ethCap = ethPricesArr[i] ? (cgETH.marketCaps?.[i]?.[1] ?? ethPricesArr[i] * 120000000) : 0;
      const totalCap = btcCap + ethCap + (totalCapSeries[i] ? totalCapSeries[i] * 0.1 : 0);

      const btcDom = (btcCap / totalCap) * 100;
      const ethDom = (ethCap / totalCap) * 100;
      const usdtDom = 100 - btcDom - ethDom;

      btcDomSeries.push(btcDom);
      ethDomSeries.push(ethDom);
      usdtDomSeries.push(Math.max(0, usdtDom));
    }
  }

  // Fear & Greed series
  const fearGreedSeries = fgData.map(d => d.value);
  const fearGreedTimes = fgData.map(d => d.time);

  return {
    // Price series
    btcPrice: btcPriceSeries,
    btcTime: btcTimeSeries,
    btcVolume: btcVolumeSeries,
    ethPrice: ethPriceSeries,
    ethTime: ethTimeSeries,
    ethBtcRatio: ethBtcRatioSeries,
    solPrice: extractPrices(solPrices),
    bnbPrice: extractPrices(bnbPrices),
    linkPrice: extractPrices(linkPrices),
    dogePrice: extractPrices(dogePrices),
    goldPrice: goldPriceSeries,
    goldTime: goldTimeSeries,

    // Dominance
    btcDominance: btcDomSeries,
    ethDominance: ethDomSeries,
    usdtDominance: usdtDomSeries,

    // Global data
    btcDominanceCurrent: cgGlobal.btcDominance,
    ethDominanceCurrent: cgGlobal.ethDominance,
    usdtDominanceCurrent: cgGlobal.usdtDominance,
    totalMarketCap: cgGlobal.totalMarketCap,
    totalVolume: cgGlobal.totalVolume,

    // Fear & Greed
    fearGreed: fearGreedSeries,
    fearGreedTime: fearGreedTimes,

    // FRED data
    fred: fred.series,
    fredAvailable: fred.fredAvailable,

    // Source tracking
    sources,

    // Timestamps
    lastUpdated: new Date().toISOString(),
  };
  } catch (err) {
    console.error('fetchAllRegimeData error:', err);
    // Return empty data on error so page doesn't crash
    return {
      btcPrice: [],
      btcTime: [],
      btcVolume: [],
      ethPrice: [],
      ethTime: [],
      ethBtcRatio: [],
      solPrice: [],
      bnbPrice: [],
      linkPrice: [],
      dogePrice: [],
      goldPrice: [],
      goldTime: [],
      btcDominance: [],
      ethDominance: [],
      usdtDominance: [],
      btcDominanceCurrent: 0,
      ethDominanceCurrent: 0,
      usdtDominanceCurrent: 0,
      totalMarketCap: 0,
      totalVolume: 0,
      fearGreed: [],
      fearGreedTime: [],
      fred: {},
      fredAvailable: false,
      sources: {
        btc: 'OFFLINE',
        eth: 'OFFLINE',
        gold: 'OFFLINE',
        fearGreed: 'OFFLINE',
        fred: 'OFFLINE',
      },
      lastUpdated: new Date().toISOString(),
    };
  }
}
