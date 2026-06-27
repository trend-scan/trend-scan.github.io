// Crypto universe — top 200 by market cap (excluding USD-pegged stablecoins and xStocks)
// Updated: June 2026 — sourced from CoinMarketCap / CoinGecko top 200
// Used by the Market Board for theme scoring, breadth analysis, and momentum scanning

export const CRYPTO_UNIVERSE = [
  // Layer 1
  { symbol: 'BTC',    name: 'Bitcoin',                                            theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Bitcoin' },
  { symbol: 'ETH',    name: 'Ethereum',                                           theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'BNB',    name: 'BNB',                                                theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'XRP',    name: 'XRP',                                                theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'SOL',    name: 'Solana',                                             theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'TRX',    name: 'TRON',                                               theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'HYPE',   name: 'Hyperliquid',                                        theme: 'Layer 1',                            tier: 'Active',     subtheme: 'Smart Contract L1' },
  { symbol: 'ZEC',    name: 'Zcash',                                              theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'XLM',    name: 'Stellar',                                            theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'XMR',    name: 'Monero',                                             theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'ADA',    name: 'Cardano',                                            theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'GRAM',   name: 'Gram (prev. Toncoin)',                               theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'BCH',    name: 'Bitcoin Cash',                                       theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'LTC',    name: 'Litecoin',                                           theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'HBAR',   name: 'Hedera',                                             theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'SUI',    name: 'Sui',                                                theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'AVAX',   name: 'Avalanche',                                          theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'NEAR',   name: 'NEAR Protocol',                                      theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'DOT',    name: 'Polkadot',                                           theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'ICP',    name: 'Internet Computer',                                  theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'ETC',    name: 'Ethereum Classic',                                   theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'ATOM',   name: 'Cosmos Hub',                                         theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'KAS',    name: 'Kaspa',                                              theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'ALGO',   name: 'Algorand',                                           theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'FLR',    name: 'Flare',                                              theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  { symbol: 'XDC',    name: 'XDC Network',                                        theme: 'Layer 1',                            tier: 'Core',       subtheme: 'Smart Contract L1' },
  // Layer 2
  { symbol: 'MNT',    name: 'Mantle',                                             theme: 'Layer 2',                            tier: 'Active',     subtheme: 'Rollup' },
  { symbol: 'MORPHO', name: 'Morpho',                                             theme: 'Layer 2',                            tier: 'Active',     subtheme: 'Rollup' },
  { symbol: 'POL',    name: 'POL (ex-MATIC)',                                     theme: 'Layer 2',                            tier: 'Active',     subtheme: 'Rollup' },
  // DeFi
  { symbol: 'UNI',    name: 'Uniswap',                                            theme: 'DeFi',                               tier: 'Core',       subtheme: 'DEX' },
  { symbol: 'ONDO',   name: 'Ondo',                                               theme: 'DeFi',                               tier: 'Core',       subtheme: 'DEX' },
  { symbol: 'AAVE',   name: 'Aave',                                               theme: 'DeFi',                               tier: 'Core',       subtheme: 'Lending' },
  { symbol: 'SKY',    name: 'Sky',                                                theme: 'DeFi',                               tier: 'Active',     subtheme: 'Lending' },
  { symbol: 'DEXE',   name: 'DeXe',                                               theme: 'DeFi',                               tier: 'Active',     subtheme: 'DEX' },
  { symbol: 'QNT',    name: 'Quant',                                              theme: 'DeFi',                               tier: 'Active',     subtheme: 'DEX' },
  { symbol: 'JUP',    name: 'Jupiter',                                            theme: 'DeFi',                               tier: 'Active',     subtheme: 'DEX' },
  { symbol: 'ENA',    name: 'Ethena',                                             theme: 'DeFi',                               tier: 'Core',       subtheme: 'Lending' },
  { symbol: 'JST',    name: 'JUST',                                               theme: 'DeFi',                               tier: 'Active',     subtheme: 'DEX' },
  // AI & Compute
  { symbol: 'TAO',    name: 'Bittensor',                                          theme: 'AI & Compute',                       tier: 'Active',     subtheme: 'AI Protocol' },
  { symbol: 'WLD',    name: 'Worldcoin',                                          theme: 'AI & Compute',                       tier: 'Active',     subtheme: 'AI Protocol' },
  { symbol: 'RENDER', name: 'Render',                                             theme: 'AI & Compute',                       tier: 'Core',       subtheme: 'GPU/Compute' },
  { symbol: 'VVV',    name: 'Venice Token',                                       theme: 'AI & Compute',                       tier: 'Active',     subtheme: 'AI Protocol' },
  // Infrastructure
  { symbol: 'LINK',   name: 'Chainlink',                                          theme: 'Infrastructure',                     tier: 'Core',       subtheme: 'Oracle' },
  { symbol: 'FIL',    name: 'Filecoin',                                           theme: 'Infrastructure',                     tier: 'Core',       subtheme: 'Storage' },
  // Meme
  { symbol: 'DOGE',   name: 'Dogecoin',                                           theme: 'Meme',                               tier: 'Core',       subtheme: 'Meme' },
  { symbol: 'SHIB',   name: 'Shiba Inu',                                          theme: 'Meme',                               tier: 'Core',       subtheme: 'Meme' },
  { symbol: 'PEPE',   name: 'Pepe',                                               theme: 'Meme',                               tier: 'Core',       subtheme: 'Meme' },
  { symbol: 'PUMP',   name: 'Pump.fun',                                           theme: 'Meme',                               tier: 'Active',     subtheme: 'Meme' },
  // Exchange Tokens
  { symbol: 'CRO',    name: 'Cronos',                                             theme: 'Exchange Tokens',                    tier: 'Active',     subtheme: 'CEX Token' },
  { symbol: 'OKB',    name: 'OKB',                                                theme: 'Exchange Tokens',                    tier: 'Active',     subtheme: 'CEX Token' },
  { symbol: 'BGB',    name: 'Bitget Token',                                       theme: 'Exchange Tokens',                    tier: 'Active',     subtheme: 'CEX Token' },
  { symbol: 'KCS',    name: 'KuCoin',                                             theme: 'Exchange Tokens',                    tier: 'Active',     subtheme: 'CEX Token' },
  { symbol: 'GT',     name: 'Gate',                                               theme: 'Exchange Tokens',                    tier: 'Active',     subtheme: 'CEX Token' },
  // Other
  { symbol: 'BDX',    name: 'Beldex',                                             theme: 'Other',                              tier: 'Active',     subtheme: 'Other' },
];

// Benchmark assets for regime/relative strength
// Crypto Majors — BTC, ETH, SOL, BNB, HYPE
export const BENCHMARKS = [
  { symbol: 'BTC',    name: 'Bitcoin',                             subtheme: 'Bitcoin' },
  { symbol: 'ETH',    name: 'Ethereum',                            subtheme: 'Smart Contract L1' },
  { symbol: 'SOL',    name: 'Solana',                              subtheme: 'Smart Contract L1' },
  { symbol: 'BNB',    name: 'BNB',                                 subtheme: 'Smart Contract L1' },
  { symbol: 'HYPE',   name: 'Hyperliquid',                         subtheme: 'Smart Contract L1' },
];

// Style rotation pairs (analogous to IWM/SPY etc.)
export const ROTATION_PAIRS = [
  { label: 'ETH / BTC',    a: 'ETH',    b: 'BTC',    desc: 'Alt vs store-of-value' },
  { label: 'SOL / ETH',    a: 'SOL',    b: 'ETH',    desc: 'New L1 vs established' },
  { label: 'HYPE / SOL',   a: 'HYPE',   b: 'SOL',    desc: 'Perp DEX L1 vs Smart Contract L1' },
  { label: 'DOGE / BTC',   a: 'DOGE',   b: 'BTC',    desc: 'Speculation vs safety' },
  { label: 'UNI / BTC',    a: 'UNI',    b: 'BTC',    desc: 'DeFi vs Bitcoin' },
];
