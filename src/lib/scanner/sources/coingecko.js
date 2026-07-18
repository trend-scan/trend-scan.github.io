/**
 * CoinGecko — free, no API key, CORS-enabled (Access-Control-Allow-Origin: *)
 * Primary daily-OHLC source for crypto. Also provides market cap + 24h volume.
 *
 * Docs: https://docs.coingecko.com/reference/coins-id-ohlc
 * Limits: ~30 req/min on free tier (no key); 100-500/min with demo key.
 */

import { fetchWithTimeout } from '../fetchWithTimeout';

const BASE = 'https://api.coingecko.com/api/v3';

// Timeframe → CoinGecko OHLC `days` param
// CoinGecko returns: 1d-2d → 30min candles; 7-30d → 4h candles; >30d → 4d candles
// For our scanner (which expects 1d+ candles), we map app timeframes to days.
const TIMEFRAME_DAYS = {
  '1D': 365,    // daily candles for 1y
  '4H': 90,     // 4h candles for 90d
  '1H': 30,     // 30min candles for 30d (CoinGecko doesn't have 1h directly)
  '12H': 180,
  '15m': 1,
  '30m': 1,
  '1w': 365,
  '1W': 365,
};

// Map symbol → CoinGecko coin id (the OHLC endpoint requires the id, not the ticker)
// Extend this map as needed; for unknown symbols, the caller should fall back to another source.
const SYMBOL_TO_ID = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LTC: 'litecoin',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  XLM: 'stellar',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  FIL: 'filecoin',
  ICP: 'internet-computer',
  VET: 'vechain',
  ALGO: 'algorand',
  FTM: 'fantom',
  SAND: 'the-sandbox',
  MANA: 'decentraland',
  AXS: 'axie-infinity',
  GRT: 'the-graph',
  ETC: 'ethereum-classic',
  BCH: 'bitcoin-cash',
  SHIB: 'shiba-inu',
  PEPE: 'pepe',
  WIF: 'dogwifcoin',
  BONK: 'bonk',
  JUP: 'jupiter-exchange-solana',
  PYTH: 'pyth-network',
  TIA: 'celestia',
  SEI: 'sei-network',
  SUI: 'sui',
  RUNE: 'thorchain',
  FET: 'fetch-ai',
  RNDR: 'render-token',
  IMX: 'immutable-x',
  LDO: 'lido-dao',
  MKR: 'maker',
  AAVE: 'aave',
  CRV: 'curve-dao-token',
  SUSHI: 'sushi',
  COMP: 'compound-governance-token',
  SNX: 'havven',
  DYDX: 'dydx-chain',
  GMX: 'gmx',
  INJ: 'injective-protocol',
  STX: 'blockstack',
  FLOW: 'flow',
  THETA: 'theta-token',
  HBAR: 'hedera-hashgraph',
  EGLD: 'elrond-erd-2',
  HT: 'huobi-token',
  KAVA: 'kava',
  ZEC: 'zcash',
  DASH: 'dash',
  NEO: 'neo',
  EOS: 'eos',
  MIOTA: 'iota',
  CHZ: 'chiliz',
  ENJ: 'enjincoin',
  BAT: 'basic-attention-token',
  ZIL: 'zilliqa',
  ICX: 'icon',
  KSM: 'kusama',
  WAVES: 'waves',
  OCEAN: 'ocean-protocol',
  RSR: 'reserve-rights-token',
  BTT: 'bittorrent',
  WIN: 'wink',
  HOT: 'holotoken',
  ORN: 'orion-protocol',
  UMA: 'uma',
  BNT: 'bancor',
  BAND: 'band-protocol',
  RLC: 'iexec-rlc',
  KNC: 'kyber-network-crystal',
  LRC: 'loopring',
  BAL: 'balancer',
  SNT: 'status',

  // ─── Added 2026-06: tokens missing from the original map ───────────────
  // Without these, CoinGecko tries /coins/list (rate-limited) and picks the
  // WRONG coin (e.g. HYPE → 'hype-3' instead of 'hyperliquid'). These IDs
  // are the canonical CoinGecko IDs for each token.
  HYPE: 'hyperliquid',           // Hyperliquid (native perp DEX token)
  TON: 'the-open-network',       // Toncoin
  TRX: 'tron',                   // TRON
  XMR: 'monero',                 // Monero
  AR: 'arweave',                 // Arweave
  CELO: 'celo',                  // Celo
  CRO: 'crypto-com-chain',       // Cronos
  GALA: 'gala',                  // Gala Games
  KCS: 'kucoin-shares',          // KuCoin Token
  NMR: 'numeraire',              // Numeraire
  OKB: 'okb',                    // OKB
  RENDER: 'render-token',        // Render Network (RNDR also maps here)
  SCRT: 'secret',                // Secret Network
  STRAX: 'stratis',              // Stratis
  FTT: 'ftx-token',              // FTX Token (delisted but still in universe)
  XDC: 'xdce-currency',          // XDC Network
  YGG: 'yield-guild-games',      // Yield Guild Games
  AGIX: 'singularitynet',        // SingularityNET
  BEAM: 'beam-2',                // Beam (privacy chain, not gaming)
  BLAST: 'blast',                // Blast L2
  ENA: 'ethena',                 // Ethena
  FLOKI: 'floki',                // Floki
  ILV: 'illuvium',               // Illuvium
  MAGIC: 'treasure',             // Treasure DAO
  MANTA: 'manta-network',        // Manta Network
  ONDO: 'ondo-finance',          // Ondo Finance
  PENDLE: 'pendle',              // Pendle
  POL: 'polygon-ecosystem-token',// Polygon (new POL token)
  POPCAT: 'popcat-2',            // Popcat (Solana meme)
  RON: 'ronin',                  // Ronin
  ROSE: 'oasis-network',         // Oasis Network
  SCROLL: 'scroll',              // Scroll
  STRK: 'starknet',              // Starknet
  ZK: 'zksync',                  // ZKsync
  // TOTAL is an index, not a coin — no CoinGecko ID. Resolver will use other sources.

  // ─── Added for user's expanded universe (June 2026) ────────────────────
  TAO: 'bittensor',               // Bittensor (AI)
  VIRTUAL: 'virtual-protocol',    // Virtuals Protocol
  WLD: 'worldcoin',               // Worldcoin
  EIGEN: 'eigenlayer',            // EigenLayer (restaking)
  IO: 'io-net',                   // io.net (depin GPU)
  AKT: 'akash-network',           // Akash Network
  VVV: 'venice-token',            // Venice Token
  GRASS: 'grass',                 // Grass (data layer)
  LIT: 'lit',                     // Lit Protocol
  GRAM: 'toncoin',                // Gram (formerly Toncoin)
  KAS: 'kaspa',                   // Kaspa
  MET: 'meteora',                 // Meteora
  BIO: 'bio-protocol',            // Bio Protocol
  MNT: 'mantle',                  // Mantle
  SKY: 'sky',                     // Sky (formerly MakerDAO)
  MORPHO: 'morpho',               // Morpho
  CAKE: 'pancakeswap-token',      // PancakeSwap
  AERO: 'aerodrome-finance',      // Aerodrome Finance
  JTO: 'jito-governance-token',   // Jito
  ETHFI: 'ether-fi',              // ether.fi
  SYRUP: 'maple',                 // Maple Finance (Syrup)
  FLUID: 'fluid',                 // Fluid (formerly Instadapp)
  STBL: 'stabl',                  // STBL (RWA Stablecoin)
  DUST: 'dust-protocol',          // Dust Protocol
  W: 'wormhole',                  // Wormhole
  TRUMP: 'official-trump',        // OFFICIAL TRUMP
  PUMP: 'pump-fun',               // Pump.fun
  FARTCOIN: 'fartcoin',           // Fartcoin
  SPX: 'spx6900',                 // SPX6900
  MOG: 'mog-coin',                // Mog Coin
  USELESS: 'useless',             // Useless Coin
  PENGU: 'pudgy-penguins',        // Pudgy Penguins
  BGB: 'bitget-token',            // Bitget Token
  GT: 'gate',                     // GateToken
  LEO: 'leo-token',               // UNUS SED LEO
  HNT: 'helium',                  // Helium
  IOT: 'helium-iot',              // Helium IOT
  MOBILE: 'helium-mobile',        // Helium Mobile
  USDT: 'tether',                 // Tether
  USDC: 'usd-coin',               // USD Coin
  DAI: 'dai',                     // Dai
  USDS: 'sky',                    // USDS (Sky)
  USDE: 'ethena-usde',            // Ethena USDe
  PYUSD: 'paypal-usd',            // PayPal USD
  FDUSD: 'first-digital-usd',     // First Digital USD
  RLUSD: 'ripple-usd',            // Ripple USD
  USD1: 'world-liberty-financial-usd', // World Liberty USD
};

let _idCache = null;
let _idMapPromise = null;  // deduplicates concurrent loadIdMap() calls

async function loadIdMap() {
  if (_idCache) return _idCache;
  // If a fetch is already in progress, wait for it instead of starting another
  if (_idMapPromise) return _idMapPromise;

  _idMapPromise = (async () => {
    try {
      const res = await fetchWithTimeout(`${BASE}/coins/list`);
      if (!res.ok) {
        return SYMBOL_TO_ID;
      }
      const list = await res.json();
      const apiMap = {};
      for (const c of list) {
        const sym = c.symbol.toUpperCase();
        if (!apiMap[sym]) apiMap[sym] = c.id;
      }
      _idCache = { ...apiMap, ...SYMBOL_TO_ID };
      return _idCache;
    } catch {
      return SYMBOL_TO_ID;
    } finally {
      _idMapPromise = null;
    }
  })();

  return _idMapPromise;
}

/**
 * Fetch OHLC candles for a crypto symbol.
 * @returns {Promise<Array<{ts,open,high,low,close,vol}>>} or null on failure
 */
export async function fetchCandles(symbol, timeframe = '1D', limit = 300) {
  const idMap = await loadIdMap();
  const coinId = idMap[symbol.toUpperCase()];
  if (!coinId) return null;

  const days = TIMEFRAME_DAYS[timeframe] || 365;
  const url = `${BASE}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;

    // CoinGecko returns [[timestamp_ms, o, h, l, c], ...]
    // No volume in OHLC endpoint — caller can fetch from /markets if needed
    let candles = arr.map(c => ({
      ts: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      vol: 0,  // not provided by OHLC endpoint
    }));

    // Trim to requested limit (most recent)
    if (candles.length > limit) candles = candles.slice(-limit);
    return candles;
  } catch (e) {
    console.warn(`[coingecko] ${symbol} failed: ${e.message}`);
    return null;
  }
}

/**
 * Fetch current market data (price, market cap, 24h volume) for many symbols.
 *
 * Fallback chain (in priority order):
 *   1. CoinGecko /coins/markets (live, fresh, but heavily rate-limited → 429)
 *   2. Pre-baked /snapshot.json (from daily GitHub Action — up to 24h stale but always available)
 *   3. CoinCap /v2/assets (live backup, no key, CORS-enabled)
 *
 * Used by the scanner and FactorMonitor to get market cap + volume for ranking.
 */
let _marketCache = null;
let _marketCacheTime = 0;
const MARKET_TTL_MS = 60 * 1000;

export async function fetchMarketData(symbols = []) {
  const now = Date.now();
  if (_marketCache && now - _marketCacheTime < MARKET_TTL_MS) {
    return filterBySymbols(_marketCache, symbols);
  }

  // Try 1: CoinGecko live (most fresh, but rate-limited)
  let marketMap = await tryCoinGeckoMarkets();
  if (Object.keys(marketMap).length >= 10) {
    _marketCache = marketMap;
    _marketCacheTime = now;
    return filterBySymbols(_marketCache, symbols);
  }

  // Try 2: Pre-baked snapshot.json (always available — built daily by CI)
  if (!marketMap || Object.keys(marketMap).length === 0) {
    marketMap = await trySnapshotMarkets();
  } else {
    // Merge: live data takes precedence, snapshot fills gaps
    const snapshotMap = await trySnapshotMarkets();
    for (const [sym, data] of Object.entries(snapshotMap)) {
      if (!marketMap[sym]) marketMap[sym] = data;
    }
  }
  if (Object.keys(marketMap).length >= 10) {
    _marketCache = marketMap;
    _marketCacheTime = now;
    return filterBySymbols(_marketCache, symbols);
  }

  // Try 3: CoinCap backup (no key, CORS-enabled)
  if (!marketMap || Object.keys(marketMap).length === 0) {
    marketMap = await tryCoinCapMarkets();
  } else {
    const coincapMap = await tryCoinCapMarkets();
    for (const [sym, data] of Object.entries(coincapMap)) {
      if (!marketMap[sym]) marketMap[sym] = data;
    }
  }
  if (Object.keys(marketMap).length > 0) {
    _marketCache = marketMap;
    _marketCacheTime = now;
  }
  return filterBySymbols(_marketCache || marketMap, symbols);
}

async function tryCoinGeckoMarkets() {
  try {
    const url = `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return {};
    const arr = await res.json();
    if (!Array.isArray(arr)) return {};
    const out = {};
    for (const c of arr) {
      out[c.symbol.toUpperCase()] = {
        price: c.current_price,
        marketCap: c.market_cap || 0,
        volume24h: c.total_volume || 0,
        marketCapRank: c.market_cap_rank || 999999,
        change24h: c.price_change_percentage_24h || 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

async function trySnapshotMarkets() {
  try {
    const res = await fetch('/snapshot.json');
    if (!res.ok) return {};
    const snap = await res.json();
    const top = snap?.coingecko_top || {};
    const out = {};
    for (const [sym, data] of Object.entries(top)) {
      out[sym.toUpperCase()] = {
        price: data.price,
        marketCap: data.marketCap || 0,
        volume24h: data.volume24h || 0,
        marketCapRank: data.marketCapRank || 999999,
        change24h: data.change24h || 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

async function tryCoinCapMarkets() {
  try {
    const res = await fetchWithTimeout('https://api.coincap.io/v2/assets?limit=200');
    if (!res.ok) return {};
    const d = await res.json();
    const arr = d?.data || [];
    const out = {};
    for (const c of arr) {
      out[c.symbol.toUpperCase()] = {
        price: parseFloat(c.priceUsd) || 0,
        marketCap: parseFloat(c.marketCapUsd) || 0,
        volume24h: parseFloat(c.volumeUsd24Hr) || 0,
        marketCapRank: parseInt(c.rank, 10) || 999999,
        change24h: parseFloat(c.changePercent24Hr) || 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function filterBySymbols(map, symbols) {
  if (!symbols.length) return map;
  const out = {};
  for (const s of symbols) {
    if (map[s.toUpperCase()]) out[s.toUpperCase()] = map[s.toUpperCase()];
  }
  return out;
}

export const sourceMeta = {
  id: 'coingecko',
  type: 'crypto',
  supportsTimeframes: ['1D', '4H', '1H', '15m', '30m', '1w', '1W'],
  rateLimitPerMin: 30,
  requiresApiKey: false,
};
