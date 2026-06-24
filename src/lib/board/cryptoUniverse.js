// Crypto universe with category/theme groupings (analogous to the stock universe)
// Used by the Market Board for theme scoring and breadth analysis

export const CRYPTO_UNIVERSE = [
  // AI Infrastructure / GPU Layer
  { symbol: 'RENDER', name: 'Render Network',    theme: 'AI & Compute',      tier: 'Core',    subtheme: 'GPU/Compute' },
  { symbol: 'FET',    name: 'Fetch.ai',          theme: 'AI & Compute',      tier: 'Core',    subtheme: 'AI Protocol' },
  { symbol: 'AGIX',   name: 'SingularityNET',    theme: 'AI & Compute',      tier: 'Active',  subtheme: 'AI Protocol' },
  { symbol: 'NMR',    name: 'Numeraire',          theme: 'AI & Compute',      tier: 'Active',  subtheme: 'Data Marketplace' },
  { symbol: 'OCEAN',  name: 'Ocean Protocol',     theme: 'AI & Compute',      tier: 'Active',  subtheme: 'Data Marketplace' },
  { symbol: 'GRT',    name: 'The Graph',          theme: 'AI & Compute',      tier: 'Core',    subtheme: 'Data Marketplace' },
  { symbol: 'RNDR',   name: 'Render',             theme: 'AI & Compute',      tier: 'Active',  subtheme: 'GPU/Compute' },

  // Layer 1s
  { symbol: 'BTC',    name: 'Bitcoin',            theme: 'Layer 1',           tier: 'Core',    subtheme: 'Bitcoin' },
  { symbol: 'ETH',    name: 'Ethereum',           theme: 'Layer 1',           tier: 'Core',    subtheme: 'Smart Contract L1' },
  { symbol: 'SOL',    name: 'Solana',             theme: 'Layer 1',           tier: 'Core',    subtheme: 'Smart Contract L1' },
  { symbol: 'BNB',    name: 'BNB',                theme: 'Layer 1',           tier: 'Core',    subtheme: 'Exchange L1' },
  { symbol: 'ADA',    name: 'Cardano',            theme: 'Layer 1',           tier: 'Core',    subtheme: 'Smart Contract L1' },
  { symbol: 'AVAX',   name: 'Avalanche',          theme: 'Layer 1',           tier: 'Core',    subtheme: 'Smart Contract L1' },
  { symbol: 'DOT',    name: 'Polkadot',           theme: 'Layer 1',           tier: 'Core',    subtheme: 'Smart Contract L1' },
  { symbol: 'NEAR',   name: 'NEAR Protocol',      theme: 'Layer 1',           tier: 'Core',    subtheme: 'Smart Contract L1' },
  { symbol: 'APT',    name: 'Aptos',              theme: 'Layer 1',           tier: 'Active',  subtheme: 'Smart Contract L1' },
  { symbol: 'SUI',    name: 'Sui',                theme: 'Layer 1',           tier: 'Active',  subtheme: 'Smart Contract L1' },
  { symbol: 'TON',    name: 'Toncoin',            theme: 'Layer 1',           tier: 'Core',    subtheme: 'Smart Contract L1' },
  { symbol: 'TRX',    name: 'TRON',               theme: 'Layer 1',           tier: 'Active',  subtheme: 'Smart Contract L1' },
  { symbol: 'XRP',    name: 'XRP',                theme: 'Layer 1',           tier: 'Core',    subtheme: 'Payments L1' },

  // Layer 2 / Scaling
  { symbol: 'MATIC',  name: 'Polygon',            theme: 'Layer 2',           tier: 'Core',    subtheme: 'Rollup' },
  { symbol: 'POL',    name: 'Polygon (POL)',       theme: 'Layer 2',           tier: 'Active',  subtheme: 'Rollup' },
  { symbol: 'ARB',    name: 'Arbitrum',           theme: 'Layer 2',           tier: 'Core',    subtheme: 'Rollup' },
  { symbol: 'OP',     name: 'Optimism',           theme: 'Layer 2',           tier: 'Core',    subtheme: 'Rollup' },
  { symbol: 'STRK',   name: 'Starknet',           theme: 'Layer 2',           tier: 'Active',  subtheme: 'ZK Rollup' },
  { symbol: 'IMX',    name: 'Immutable X',        theme: 'Layer 2',           tier: 'Active',  subtheme: 'Gaming L2' },
  { symbol: 'MANTA',  name: 'Manta Network',      theme: 'Layer 2',           tier: 'Active',  subtheme: 'ZK Rollup' },
  { symbol: 'BLAST',  name: 'Blast',              theme: 'Layer 2',           tier: 'Active',  subtheme: 'Rollup' },
  { symbol: 'ZK',     name: 'ZKsync',             theme: 'Layer 2',           tier: 'Active',  subtheme: 'ZK Rollup' },
  { symbol: 'SCROLL', name: 'Scroll',             theme: 'Layer 2',           tier: 'Watch',   subtheme: 'ZK Rollup' },

  // DeFi
  { symbol: 'UNI',    name: 'Uniswap',            theme: 'DeFi',              tier: 'Core',    subtheme: 'DEX' },
  { symbol: 'AAVE',   name: 'Aave',               theme: 'DeFi',              tier: 'Core',    subtheme: 'Lending' },
  { symbol: 'MKR',    name: 'MakerDAO',           theme: 'DeFi',              tier: 'Core',    subtheme: 'Lending' },
  { symbol: 'CRV',    name: 'Curve',              theme: 'DeFi',              tier: 'Active',  subtheme: 'DEX' },
  { symbol: 'LDO',    name: 'Lido DAO',           theme: 'DeFi',              tier: 'Core',    subtheme: 'Liquid Staking' },
  { symbol: 'SNX',    name: 'Synthetix',          theme: 'DeFi',              tier: 'Active',  subtheme: 'Derivatives' },
  { symbol: 'GMX',    name: 'GMX',                theme: 'DeFi',              tier: 'Active',  subtheme: 'Derivatives' },
  { symbol: 'PENDLE', name: 'Pendle',             theme: 'DeFi',              tier: 'Active',  subtheme: 'Lending' },
  { symbol: 'JUP',    name: 'Jupiter',            theme: 'DeFi',              tier: 'Active',  subtheme: 'DEX' },
  { symbol: 'COMP',   name: 'Compound',           theme: 'DeFi',              tier: 'Active',  subtheme: 'Lending' },
  { symbol: 'BAL',    name: 'Balancer',           theme: 'DeFi',              tier: 'Watch',   subtheme: 'DEX' },
  { symbol: 'DYDX',   name: 'dYdX',               theme: 'DeFi',              tier: 'Active',  subtheme: 'Derivatives' },
  { symbol: 'ENA',    name: 'Ethena',             theme: 'DeFi',              tier: 'Core',    subtheme: 'Stablecoin' },
  { symbol: 'ONDO',   name: 'Ondo Finance',       theme: 'DeFi',              tier: 'Core',    subtheme: 'RWA' },

  // Infrastructure / Oracles / Data
  { symbol: 'LINK',   name: 'Chainlink',          theme: 'Infrastructure',    tier: 'Core',    subtheme: 'Oracle' },
  { symbol: 'FIL',    name: 'Filecoin',           theme: 'Infrastructure',    tier: 'Core',    subtheme: 'Storage' },
  { symbol: 'AR',     name: 'Arweave',            theme: 'Infrastructure',    tier: 'Active',  subtheme: 'Storage' },
  { symbol: 'BAND',   name: 'Band Protocol',      theme: 'Infrastructure',    tier: 'Watch',   subtheme: 'Oracle' },
  { symbol: 'API3',   name: 'API3',               theme: 'Infrastructure',    tier: 'Watch',   subtheme: 'Oracle' },
  { symbol: 'PYTH',   name: 'Pyth Network',       theme: 'Infrastructure',    tier: 'Active',  subtheme: 'Oracle' },
  { symbol: 'STRAX',  name: 'Stratis',            theme: 'Infrastructure',    tier: 'Watch',   subtheme: 'Oracle' },

  // Gaming & Metaverse
  { symbol: 'AXS',    name: 'Axie Infinity',      theme: 'Gaming',            tier: 'Core',    subtheme: 'Gaming' },
  { symbol: 'SAND',   name: 'The Sandbox',        theme: 'Gaming',            tier: 'Core',    subtheme: 'Gaming' },
  { symbol: 'MANA',   name: 'Decentraland',       theme: 'Gaming',            tier: 'Core',    subtheme: 'Gaming' },
  { symbol: 'GALA',   name: 'Gala Games',         theme: 'Gaming',            tier: 'Active',  subtheme: 'Gaming' },
  { symbol: 'ILV',    name: 'Illuvium',           theme: 'Gaming',            tier: 'Active',  subtheme: 'Gaming' },
  { symbol: 'MAGIC',  name: 'Treasure DAO',       theme: 'Gaming',            tier: 'Active',  subtheme: 'Gaming' },
  { symbol: 'BEAM',   name: 'Beam',               theme: 'Gaming',            tier: 'Active',  subtheme: 'Gaming' },
  { symbol: 'RON',    name: 'Ronin',              theme: 'Gaming',            tier: 'Active',  subtheme: 'Gaming' },
  { symbol: 'YGG',    name: 'Yield Guild Games',  theme: 'Gaming',            tier: 'Watch',   subtheme: 'Gaming' },

  // Meme & Narrative
  { symbol: 'DOGE',   name: 'Dogecoin',           theme: 'Meme',              tier: 'Core',    subtheme: 'Meme' },
  { symbol: 'SHIB',   name: 'Shiba Inu',          theme: 'Meme',              tier: 'Core',    subtheme: 'Meme' },
  { symbol: 'PEPE',   name: 'Pepe',               theme: 'Meme',              tier: 'Active',  subtheme: 'Meme' },
  { symbol: 'FLOKI',  name: 'Floki',              theme: 'Meme',              tier: 'Active',  subtheme: 'Meme' },
  { symbol: 'WIF',    name: 'dogwifhat',          theme: 'Meme',              tier: 'Core',    subtheme: 'Meme' },
  { symbol: 'BONK',   name: 'Bonk',               theme: 'Meme',              tier: 'Active',  subtheme: 'Meme' },
  { symbol: 'POPCAT', name: 'Popcat',             theme: 'Meme',              tier: 'Active',  subtheme: 'Meme' },

  // RWA & Payments
  { symbol: 'XLM',    name: 'Stellar',            theme: 'RWA & Payments',    tier: 'Core',    subtheme: 'Payments' },
  { symbol: 'HBAR',   name: 'Hedera',             theme: 'RWA & Payments',    tier: 'Core',    subtheme: 'Payments L1' },
  { symbol: 'XDC',    name: 'XDC Network',        theme: 'RWA & Payments',    tier: 'Active',  subtheme: 'Payments' },
  { symbol: 'CELO',   name: 'Celo',               theme: 'RWA & Payments',    tier: 'Watch',   subtheme: 'Payments' },
  { symbol: 'ALGO',   name: 'Algorand',           theme: 'RWA & Payments',    tier: 'Active',  subtheme: 'Payments L1' },

  // Privacy
  { symbol: 'XMR',    name: 'Monero',             theme: 'Privacy',           tier: 'Core',    subtheme: 'Privacy' },
  { symbol: 'ZEC',    name: 'Zcash',              theme: 'Privacy',           tier: 'Active',  subtheme: 'Privacy' },
  { symbol: 'SCRT',   name: 'Secret Network',     theme: 'Privacy',           tier: 'Watch',   subtheme: 'Privacy' },
  { symbol: 'ROSE',   name: 'Oasis Network',      theme: 'Privacy',           tier: 'Active',  subtheme: 'Privacy' },

  // Exchange Tokens
  { symbol: 'OKB',    name: 'OKB',                theme: 'Exchange Tokens',   tier: 'Core',    subtheme: 'CEX Token' },
  { symbol: 'CRO',    name: 'Cronos',             theme: 'Exchange Tokens',   tier: 'Active',  subtheme: 'CEX Token' },
  { symbol: 'KCS',    name: 'KuCoin Token',       theme: 'Exchange Tokens',   tier: 'Watch',   subtheme: 'CEX Token' },
  { symbol: 'FTT',    name: 'FTX Token',          theme: 'Exchange Tokens',   tier: 'Watch',   subtheme: 'CEX Token' },
];

// Benchmark assets for regime/relative strength
// Crypto Majors - BTC, ETH, SOL, BNB, HYPE
export const BENCHMARKS = [
  { symbol: 'BTC',    name: 'Bitcoin',    subtheme: 'Store of Value' },
  { symbol: 'ETH',    name: 'Ethereum',   subtheme: 'Smart Contract L1' },
  { symbol: 'SOL',    name: 'Solana',     subtheme: 'Smart Contract L1' },
  { symbol: 'BNB',    name: 'BNB Chain',  subtheme: 'Exchange L1' },
  { symbol: 'HYPE',   name: 'Hyperliquid', subtheme: 'Perpetuals L1' },
  { symbol: 'TOTAL',  name: 'Alt Index',  subtheme: 'Equal Weight' },
];

// Style rotation pairs (analogous to IWM/SPY etc.)
export const ROTATION_PAIRS = [
  { label: 'ETH / BTC',    a: 'ETH',    b: 'BTC',    desc: 'Alt vs store-of-value' },
  { label: 'SOL / ETH',    a: 'SOL',    b: 'ETH',    desc: 'New L1 vs established' },
  { label: 'ARB / ETH',    a: 'ARB',    b: 'ETH',    desc: 'L2 vs base chain' },
  { label: 'DOGE / BTC',   a: 'DOGE',   b: 'BTC',    desc: 'Speculation vs safety' },
  { label: 'UNI / BTC',    a: 'UNI',    b: 'BTC',    desc: 'DeFi vs Bitcoin' },
];