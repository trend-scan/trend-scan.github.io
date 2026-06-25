// Traditional market universe with Kraken xStocks tickers
// Used by the Market Board Macro tab for traditional market analysis

export const TRAD_UNIVERSE = [
  // ── MAJORS / BENCHMARKS ──────────────────────────────────────────────────────
  { symbol: 'SPY',  name: 'S&P 500 ETF',          category: 'Majors',       type: 'ETF' },
  { symbol: 'QQQ',  name: 'Nasdaq 100 ETF',         category: 'Majors',       type: 'ETF' },
  { symbol: 'DIA',  name: 'Dow Jones ETF',           category: 'Majors',       type: 'ETF' },
  { symbol: 'IWM',  name: 'Russell 2000 ETF',        category: 'Majors',       type: 'ETF' },
  { symbol: 'VTI',  name: 'Total Stock Market',      category: 'Majors',       type: 'ETF' },
  { symbol: 'VEA',  name: 'Developed ex-US',         category: 'Majors',       type: 'ETF' },
  { symbol: 'VWO',  name: 'Emerging Markets',        category: 'Majors',       type: 'ETF' },
  { symbol: 'EEM',  name: 'iShares EM',              category: 'Majors',       type: 'ETF' },

  // ── SECTORS ──────────────────────────────────────────────────────────────────
  { symbol: 'XLK',  name: 'Technology',              category: 'Sectors',      type: 'ETF' },
  { symbol: 'XLF',  name: 'Financials',              category: 'Sectors',      type: 'ETF' },
  { symbol: 'XLV',  name: 'Healthcare',              category: 'Sectors',      type: 'ETF' },
  { symbol: 'XLY',  name: 'Consumer Discretionary',  category: 'Sectors',      type: 'ETF' },
  { symbol: 'XLP',  name: 'Consumer Staples',        category: 'Sectors',      type: 'ETF' },
  { symbol: 'XLE',  name: 'Energy',                  category: 'Sectors',      type: 'ETF' },
  { symbol: 'XLB',  name: 'Materials',               category: 'Sectors',      type: 'ETF' },
  { symbol: 'XLRE', name: 'Real Estate',             category: 'Sectors',      type: 'ETF' },
  { symbol: 'XLU',  name: 'Utilities',               category: 'Sectors',      type: 'ETF' },
    { symbol: 'XLC',  name: 'Communication Services',  category: 'Sectors',      type: 'ETF' },
  { symbol: 'XLI',  name: 'Industrials',             category: 'Sectors',      type: 'ETF' },

  // ── STYLES ───────────────────────────────────────────────────────────────────
  { symbol: 'VUG',  name: 'US Growth',               category: 'Styles',       type: 'ETF' },
  { symbol: 'VTV',  name: 'US Value',                category: 'Styles',       type: 'ETF' },
  { symbol: 'VO',   name: 'Mid Cap',                 category: 'Styles',       type: 'ETF' },
  { symbol: 'VB',   name: 'Small Cap',               category: 'Styles',       type: 'ETF' },
  { symbol: 'MTUM', name: 'Momentum Factor',         category: 'Styles',       type: 'ETF' },
  { symbol: 'QUAL', name: 'Quality Factor',          category: 'Styles',       type: 'ETF' },
  { symbol: 'VLUE', name: 'Value Factor',            category: 'Styles',       type: 'ETF' },
  { symbol: 'SIZE', name: 'Size Factor',             category: 'Styles',       type: 'ETF' },

  // ── BONDS / RATES ────────────────────────────────────────────────────────────
  { symbol: 'TLT',  name: '20+ Yr Treasury',         category: 'Bonds',        type: 'ETF' },
  { symbol: 'IEF',  name: '7-10 Yr Treasury',        category: 'Bonds',        type: 'ETF' },
  { symbol: 'SHY',  name: '1-3 Yr Treasury',         category: 'Bonds',        type: 'ETF' },
  { symbol: 'BND',  name: 'Total Bond',              category: 'Bonds',        type: 'ETF' },
  { symbol: 'AGG',  name: 'US Aggregate Bond',       category: 'Bonds',        type: 'ETF' },
  { symbol: 'LQD',  name: 'Investment Grade Corp',   category: 'Bonds',        type: 'ETF' },
  { symbol: 'HYG',  name: 'High Yield Corporate',    category: 'Bonds',        type: 'ETF' },
  { symbol: 'MUB',  name: 'Muni Bonds',              category: 'Bonds',        type: 'ETF' },

  // ── COMMODITIES ──────────────────────────────────────────────────────────────
  { symbol: 'GLD',  name: 'Gold',                    category: 'Commodities',  type: 'ETF' },
  { symbol: 'SLV',  name: 'Silver',                  category: 'Commodities',  type: 'ETF' },
  { symbol: 'USO',  name: 'Crude Oil',               category: 'Commodities',  type: 'ETF' },
  { symbol: 'UNG',  name: 'Natural Gas',             category: 'Commodities',  type: 'ETF' },
  { symbol: 'DBA',  name: 'Agriculture',             category: 'Commodities',  type: 'ETF' },
  { symbol: 'PDBC', name: 'Commodities Diversified', category: 'Commodities',  type: 'ETF' },

  // ── RISK / VOLATILITY ────────────────────────────────────────────────────────
  { symbol: 'VIXY', name: 'VIX Short-Term',         category: 'Risk',         type: 'ETF' },
  { symbol: 'UVXY', name: 'VIX 1.5x',               category: 'Risk',         type: 'ETF' },
  { symbol: 'SPLV', name: 'Low Volatility',          category: 'Risk',         type: 'ETF' },
  { symbol: 'USMV', name: 'Min Vol Factor',          category: 'Risk',         type: 'ETF' },

  // ── CRYPTO TRADITIONAL ───────────────────────────────────────────────────────
  { symbol: 'GBTC', name: 'Grayscale Bitcoin',       category: 'Crypto',       type: 'ETF' },
  { symbol: 'ETHE', name: 'Grayscale Ethereum',      category: 'Crypto',       type: 'ETF' },
  { symbol: 'COIN', name: 'Coinbase Global',         category: 'Crypto',       type: 'Stock' },
  { symbol: 'MSTR', name: 'MicroStrategy',           category: 'Crypto',       type: 'Stock' },
  { symbol: 'IBIT', name: 'iShares Bitcoin Trust',   category: 'Crypto',       type: 'ETF' },
  { symbol: 'FBTC', name: 'Fidelity Bitcoin ETF',    category: 'Crypto',       type: 'ETF' },
  { symbol: 'ARKB', name: 'Ark 21Shares Bitcoin',    category: 'Crypto',       type: 'ETF' },

  // ── THEMATIC ─────────────────────────────────────────────────────────────────
  { symbol: 'ARKK',  name: 'Ark Innovation',          category: 'Thematic',    type: 'ETF' },
  { symbol: 'SOXX',  name: 'Semiconductor',           category: 'Thematic',    type: 'ETF' },
  { symbol: 'SMH',   name: 'VanEck Semiconductor',    category: 'Thematic',    type: 'ETF' },
  { symbol: 'ICLN',  name: 'Clean Energy',            category: 'Thematic',    type: 'ETF' },
  { symbol: 'FinT',  name: 'FinTech',                 category: 'Thematic',    type: 'ETF' },
  { symbol: 'BOTZ',  name: 'Robotics & AI',           category: 'Thematic',    type: 'ETF' },
  { symbol: 'CNCR',  name: 'Cancer Therapeutics',     category: 'Thematic',    type: 'ETF' },
  { symbol: 'EDOC',  name: 'Global Telemedicine',     category: 'Thematic',    type: 'ETF' },
];

// Category groupings for the Macro tab
export const TRAD_CATEGORIES = [
  { name: 'Majors',     description: 'Core market benchmarks' },
  { name: 'Sectors',    description: 'S&P 500 sector breakdown' },
  { name: 'Styles',     description: 'Factor/style exposure' },
  { name: 'Bonds',      description: 'Fixed income & rates' },
  { name: 'Commodities',description: 'Commodity exposure' },
  { name: 'Risk',       description: 'Volatility & defensive' },
  { name: 'Crypto',     description: 'Crypto-related equities' },
  { name: 'Thematic',   description: 'Growth themes' },
];

// RS benchmark: QQQ for traditional assets
export const RS_BENCHMARK = 'QQQ';

// Style rotation pairs (like the original dashboard)
export const STYLE_ROTATION_PAIRS = [
  { label: 'QQQ/SPY',  a: 'QQQ',  b: 'SPY',  desc: 'Nasdaq vs S&P 500 (growth vs broad)' },
  { label: 'IWM/SPY',  a: 'IWM',  b: 'SPY',  desc: 'Small-cap vs large-cap' },
  { label: 'VUG/VTV',  a: 'VUG',  b: 'VTV',  desc: 'Growth vs value' },
  { label: 'XLK/XLF',  a: 'XLK',  b: 'XLF',  desc: 'Tech vs financials' },
  { label: 'XLY/XLP',  a: 'XLY',  b: 'XLP',  desc: 'Discretionary vs staples' },
  { label: 'GLD/SPY',  a: 'GLD',  b: 'SPY',  desc: 'Gold vs equities' },
  { label: 'TLT/SPY',  a: 'TLT',  b: 'SPY',  desc: 'Long bonds vs equities' },
];

// Risk pulse pairs
export const RISK_PULSE_PAIRS = [
  { label: 'HYG/LQD',  context: 'credit spread',     a: 'HYG', b: 'LQD' },
  { label: 'TLT',      context: 'rate direction',    a: 'TLT', b: null  },
  { label: 'VIXY',     context: 'fear/vol signal',   a: 'VIXY', b: null },
  { label: 'GLD',      context: 'defensive/safe haven', a: 'GLD', b: null },
  { label: 'USO',      context: 'energy/demand',     a: 'USO', b: null  },
];

// Sector rotation list for RS vs SPY
export const SECTOR_ROTATION_TICKERS = ['XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLE', 'XLI', 'XLRE', 'XLU', 'XLC', 'XLB'];