/**
 * watchlistStore.js — Watchlist state management for the Board's Watchlist tab.
 *
 * Responsibilities:
 *   1. localStorage persistence (key: trendscan_watchlists_v1) — empty on a
 *      user's first visit, persists their entries after that.
 *   2. Multiple named watchlists: create / rename / delete / switch.
 *   3. parseScreenerPaste() — robust parser for pasted screener output:
 *      handles bare symbol lists ("BTC, ETH, SOL"), TradingView-prefixed
 *      symbols ("BINANCE:BTCUSDT.P, NASDAQ:AAPL"), CSV downloads with a
 *      header row (from CopyCsvButtons / ResultsTable CSV export), and
 *      newline/tab/comma/whitespace-separated mixes.
 *   4. classifyWatchlistSymbols() — splits symbols into crypto / tradfi /
 *      unknown using the snapshot crypto universe + Hyperliquid perp
 *      universe + the curated TRAD_UNIVERSE.
 *
 * Storage shape (v1):
 *   {
 *     version: 1,
 *     activeId: 'wl_...',
 *     lists: [{ id: 'wl_...', name: 'My List', symbols: ['BTC', 'AAPL', …] }]
 *   }
 *
 * Deliberately framework-free (pure functions + a tiny storage adapter) so it
 * is unit-testable under node:test without a DOM — localStorage access is
 * guarded and injectable.
 */

const STORAGE_KEY = 'trendscan_watchlists_v1';

// ─── Storage adapter (injectable for tests) ──────────────────────────────────

/** @typedef {{ getItem: (k: string) => string | null, setItem: (k: string, v: string) => void, removeItem: (k: string) => void }} StorageLike */

/**
 * Read persisted watchlist state. Returns null when nothing is stored
 * (first visit) or when the stored payload is corrupt/unversioned.
 * @param {StorageLike} [storage] - defaults to globalThis.localStorage
 * @returns {{version: number, activeId: string, lists: Array<{id: string, name: string, symbols: string[]}>} | null}
 */
export function loadWatchlists(storage) {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;               // future migrations go here
    if (!Array.isArray(parsed.lists) || parsed.lists.length === 0) return null;
    // Sanitize each list
    const lists = parsed.lists
      .filter(l => l && typeof l.id === 'string' && Array.isArray(l.symbols))
      .map(l => ({
        id: l.id,
        name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 60) : 'Watchlist',
        symbols: [...new Set(l.symbols.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim().toUpperCase()))],
      }));
    if (lists.length === 0) return null;
    const activeId = lists.some(l => l.id === parsed.activeId) ? parsed.activeId : lists[0].id;
    return { version: 1, activeId, lists };
  } catch {
    return null;
  }
}

/**
 * Persist watchlist state. Failures (quota, private mode) are swallowed —
 * a watchlist is a convenience, not critical data.
 * @param {{version: number, activeId: string, lists: Array<{id: string, name: string, symbols: string[]}>}} state
 * @param {StorageLike} [storage]
 */
export function saveWatchlists(state, storage) {
  const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || !state) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota exceeded / private mode — ignore */
  }
}

// ─── List CRUD ───────────────────────────────────────────────────────────────

let _idCounter = 0;
function newId() {
  _idCounter += 1;
  return `wl_${Date.now().toString(36)}_${_idCounter.toString(36)}`;
}

/**
 * Default state for a first visit: ONE empty watchlist, no symbols.
 * (First-visit UX: the tab shows an onboarding empty state, not a fake list.)
 */
export function defaultWatchlistState() {
  const id = newId();
  return { version: 1, activeId: id, lists: [{ id, name: 'Watchlist 1', symbols: [] }] };
}

/** Create a new empty list and make it active. Returns new state. */
export function createList(state, name) {
  const lists = [...state.lists];
  const n = lists.filter(l => /^Watchlist \d+$/.test(l.name)).length;
  const finalName = (name && name.trim().slice(0, 60)) || `Watchlist ${n + 1}`;
  const list = { id: newId(), name: finalName, symbols: [] };
  lists.push(list);
  return { ...state, activeId: list.id, lists };
}

/** Rename a list by id. Returns new state (no-op if id unknown). */
export function renameList(state, id, name) {
  if (!name || !name.trim()) return state;
  return {
    ...state,
    lists: state.lists.map(l => (l.id === id ? { ...l, name: name.trim().slice(0, 60) } : l)),
  };
}

/**
 * Delete a list by id. Never deletes the last remaining list — if it is the
 * only one, it is emptied instead (preserves the "always ≥1 list" invariant
 * the UI relies on). Returns new state.
 */
export function deleteList(state, id) {
  if (!state.lists.some(l => l.id === id)) return state;
  if (state.lists.length === 1) {
    return { ...state, lists: [{ ...state.lists[0], symbols: [] }] };
  }
  const lists = state.lists.filter(l => l.id !== id);
  const activeId = state.activeId === id ? lists[0].id : state.activeId;
  return { ...state, activeId, lists };
}

/**
 * Add symbols to a list (deduped, uppercased, order-preserving).
 * Returns { state, added } where added counts only genuinely-new symbols.
 */
export function addSymbols(state, id, symbols) {
  const clean = (symbols || []).filter(Boolean).map(s => String(s).trim().toUpperCase()).filter(Boolean);
  if (clean.length === 0) return { state, added: 0 };
  let added = 0;
  const lists = state.lists.map(l => {
    if (l.id !== id) return l;
    const seen = new Set(l.symbols);
    const next = [...l.symbols];
    for (const s of clean) {
      if (!seen.has(s)) { seen.add(s); next.push(s); added += 1; }
    }
    return { ...l, symbols: next };
  });
  return { state: { ...state, lists }, added };
}

/** Remove a symbol from a list. Returns new state. */
export function removeSymbol(state, id, symbol) {
  const lists = state.lists.map(l =>
    l.id === id ? { ...l, symbols: l.symbols.filter(s => s !== symbol) } : l
  );
  return { ...state, lists };
}

// ─── Screener paste parser ───────────────────────────────────────────────────

/**
 * Strip a TradingView / exchange prefix and common quote-suffixes from a
 * token, yielding the bare screener symbol.
 *
 *   "BINANCE:BTCUSDT.P"  → "BTC"
 *   "HYPERLIQUID:ETHUSDC.P" → "ETH"
 *   "NASDAQ:AAPL"        → "AAPL"
 *   "OKX:BTC-USDT"       → "BTC"   (OKX native form, also handled)
 *   "KRAKEN:XBTUSD"      → "XBT"   (Kraken XBT → BTC handled below)
 *   "BTCUSDT"            → "BTC"
 *   "BTC-USD"            → "BTC"
 *   "BTC/USD"            → "BTC"
 *   "BTC"                → "BTC"
 *
 * Note: conservative — only strips suffixes that are unambiguous venue
 * quote-currency markers. Does NOT try to expand long-tail symbols
 * (e.g. "1000PEPEUSDT" keeps its 1000 prefix, matching the scanner's
 * own 1000x handling).
 */
export function normalizeToken(token) {
  let t = String(token || '').trim().toUpperCase();
  if (!t) return '';
  // Strip surrounding CSV quotes
  t = t.replace(/^"+|"+$/g, '').trim();
  // Exchange prefix (TradingView style "EXCHANGE:SYMBOL")
  if (t.includes(':')) {
    const parts = t.split(':');
    t = parts[parts.length - 1].trim();
  }
  if (!t) return '';
  // Venue-native pair separators: "BTC-USDT", "BTC/USD", "BTCUSD"
  // OKX native: BTC-USDT
  t = t.replace(/-(USDT|USDC|USD|PERP|SWAP)$/g, '');
  t = t.replace(/\/(USDT|USDC|USD|PERP)$/g, '');
  // TradingView suffixes: BTCUSDT.P / BTCUSDT / BTCUSDC
  t = t.replace(/\.(P|PERP)$/g, '');
  t = t.replace(/(USDT|USDC|USD)$/g, '');
  // Kraken legacy: XBT → BTC
  if (t === 'XBT') t = 'BTC';
  return t;
}

// Known CSV header-word vocabulary (lowercased) — matches the header rows of
// every table CSV this app exports (CryptoTab, MacroTab, ResultsTable, board
// sub-tables). ≥2 hits in a comma line = header row.
const HEADER_WORDS = new Set([
  'ticker', 'symbol', 'asset', 'coin', 'rank', 'name', 'price', 'trend',
  '1d', '5d', '20d', '60d', 'ret', 'rsi', 'atr', 'vol', 'rvol', 'volume',
  'change', 'pct', 'cat', 'category', 'src', 'source', 'oi', 'oi/mc',
  'mcap', 'marketcap', 'market', 'cap', 'close', 'open', 'high', 'low',
  'date', 'time', 'adr', 'adr%', 'vs20ma', 'vs50ma', 'rs/btc', 'rs/qqq',
  '52w%', 'funding', 'theme', 'score', 'value', 'pair', 'exchange',
]);

/**
 * Does this line look like a CSV header row (rather than data)?
 * True when the line starts with a known header word, or when ≥2 of its
 * comma-separated cells are known header words.
 */
function looksLikeHeaderLine(line) {
  const t = line.trim().toLowerCase();
  if (!t) return false;
  if (/^(ticker|symbol|asset|coin|rank|name)/.test(t)) return true;
  const cells = t.split(',').map(c => c.trim()).filter(Boolean);
  if (cells.length < 2) return false;
  const hits = cells.filter(c => HEADER_WORDS.has(c)).length;
  return hits >= 2;
}

/**
 * Parse pasted screener output into symbols.
 *
 * Accepted inputs (all handled by one tokenizer):
 *   - "BTC, ETH, SOL"                       (Screener COPY button)
 *   - "BINANCE:BTCUSDT.P, OKX:ETHUSDT.P"    (Screener COPY-TV button)
 *   - CSV with header row + data rows       (CSV download / spreadsheet)
 *   - newline-separated tickers
 *   - any mix of the above
 *
 * Returns { symbols: string[], skipped: string[] } — symbols are deduped,
 * uppercased, insertion-ordered; skipped holds tokens that parsed to
 * something non-empty but were rejected by the sanity filter (too long,
 * punctuation garbage). Pure numbers (prices, percentages, volumes) are
 * ignored silently — CSV data rows are full of them.
 */
export function parseScreenerPaste(text) {
  const raw = String(text || '');
  if (!raw.trim()) return { symbols: [], skipped: [] };

  // Split into lines, dropping header-like lines (a paste can contain the
  // CSV header anywhere — e.g. a symbols list followed by a pasted CSV block).
  const allLines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const dataLines = allLines.filter(l => !looksLikeHeaderLine(l));

  // Tokenize across commas / tabs / semicolons / spaces
  const tokens = dataLines
    .flatMap(line => line.split(/[,;\t]+/))
    .flatMap(chunk => chunk.trim().split(/\s+/))
    .map(tok => tok.trim())
    .filter(Boolean);

  const symbols = [];
  const seen = new Set();
  const skipped = [];

  for (const tok of tokens) {
    const norm = normalizeToken(tok);
    if (!norm) continue;
    // Sanity: 1–12 chars, starts with a letter, alnum + few safe chars
    if (!/^[A-Z][A-Z0-9._-]{0,11}$/.test(norm)) {
      // Numbers / prices / percentages / dashes from CSV data rows are
      // ignored silently — only real garbage is surfaced as "skipped".
      if (!/^[$€£+—-]?\d+([.,]\d+)?%?$/.test(norm) && norm !== '—') skipped.push(tok);
      continue;
    }
    if (!seen.has(norm)) { seen.add(norm); symbols.push(norm); }
  }

  return { symbols, skipped };
}

// ─── Symbol classification ───────────────────────────────────────────────────

/**
 * Split symbols into crypto / tradfi / unknown buckets.
 *
 * @param {string[]} symbols — bare uppercased symbols
 * @param {object} universes
 * @param {Set<string>|Map<string, any>|object|null} [universes.crypto] - snapshot crypto universe (keys=symbols) or HL ticker map
 * @param {Set<string>|Map<string, any>|object|null} [universes.tradfi] - TRAD_UNIVERSE symbols
 * @param {Set<string>|Map<string, any>|object|null} [universes.hlTickers] - Hyperliquid perp names (crypto, live-capable)
 * @returns {{crypto: string[], tradfi: string[], unknown: string[]}}
 */
export function classifyWatchlistSymbols(symbols, universes = {}) {
  const toSet = (u) => {
    if (!u) return new Set();
    if (u instanceof Set) return u;
    if (u instanceof Map) return new Set(u.keys());
    if (Array.isArray(u)) {
      // Array of strings OR array of asset objects ({ symbol, name, … } —
      // e.g. the exported TRAD_UNIVERSE from traditionalMarkets.js)
      return new Set(u.map(s => (s && typeof s === 'object' && s.symbol ? String(s.symbol) : String(s)).toUpperCase()));
    }
    if (typeof u === 'object') return new Set(Object.keys(u).map(k => k.toUpperCase()));
    return new Set();
  };
  const crypto = toSet(universes.crypto);
  const tradfi = toSet(universes.tradfi);
  const hl = toSet(universes.hlTickers);

  const out = { crypto: [], tradfi: [], unknown: [] };
  for (const s of symbols) {
    const sym = String(s).toUpperCase();
    if (tradfi.has(sym)) out.tradfi.push(sym);
    else if (crypto.has(sym) || hl.has(sym)) out.crypto.push(sym);
    else out.unknown.push(sym);
  }
  return out;
}
