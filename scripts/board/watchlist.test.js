/**
 * watchlist.test.js — Unit tests for the Board Watchlist (2026-09-29 feature).
 *
 * Run with:  npm test
 * (uses Node's built-in node:test framework — no extra deps)
 *
 * Coverage:
 *   1. watchlistStore persistence: load/save round-trip, first-visit null,
 *      corrupt-payload null, sanitization of bad lists
 *   2. List CRUD: create / rename / delete (incl. last-list invariant) /
 *      addSymbols dedup / removeSymbol
 *   3. parseScreenerPaste: bare lists, TV-prefixed, CSV with header,
 *      CSV from the crypto table export (leading empty chart-button column),
 *      mixed formats, garbage filtering
 *   4. normalizeToken: venue suffixes / prefixes / XBT
 *   5. classifyWatchlistSymbols: crypto / tradfi / unknown split
 *   6. watchlistEngine.sourceLabel mapping
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadWatchlists, saveWatchlists, defaultWatchlistState,
  createList, renameList, deleteList, addSymbols, removeSymbol,
  parseScreenerPaste, normalizeToken, classifyWatchlistSymbols,
} from '../../src/lib/board/watchlistStore.js';
import { sourceLabel } from '../../src/lib/board/watchlistEngine.js';

// ─── Fake storage adapter ────────────────────────────────────────────────────

function makeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
}

// ─── 1. Persistence ───────────────────────────────────────────────────────────

describe('watchlistStore persistence', () => {

  test('loadWatchlists returns null on first visit (empty storage)', () => {
    assert.equal(loadWatchlists(makeStorage()), null);
  });

  test('load/save round-trip preserves lists and activeId', () => {
    const storage = makeStorage();
    const state = defaultWatchlistState();
    const { state: withSymbols } = addSymbols(state, state.activeId, ['BTC', 'ETH', 'AAPL']);
    saveWatchlists(withSymbols, storage);
    const loaded = loadWatchlists(storage);
    assert.notEqual(loaded, null);
    assert.equal(loaded.lists.length, 1);
    assert.deepEqual(loaded.lists[0].symbols, ['BTC', 'ETH', 'AAPL']);
    assert.equal(loaded.activeId, loaded.lists[0].id);
  });

  test('corrupt JSON yields null', () => {
    const storage = makeStorage();
    storage.setItem('trendscan_watchlists_v1', '{not json');
    assert.equal(loadWatchlists(storage), null);
  });

  test('wrong version yields null (future migration hook point)', () => {
    const storage = makeStorage();
    storage.setItem('trendscan_watchlists_v1', JSON.stringify({ version: 2, lists: [] }));
    assert.equal(loadWatchlists(storage), null);
  });

  test('bad lists are sanitized out; activeId falls back to first list', () => {
    const storage = makeStorage();
    const good = defaultWatchlistState();
    const two = createList(good);   // returns state directly
    const raw = {
      version: 1,
      activeId: 'missing-id',
      lists: [
        null,
        { id: 'a', symbols: 'not-an-array' },        // bad symbols → dropped
        two.lists[0],                                  // good
        { id: 'b', name: 42, symbols: ['btc', 'BTC'] }, // bad name + dedup
      ],
    };
    storage.setItem('trendscan_watchlists_v1', JSON.stringify(raw));
    const loaded = loadWatchlists(storage);
    assert.equal(loaded.lists.length, 2);
    assert.equal(loaded.activeId, loaded.lists[0].id);
    const b = loaded.lists.find(l => l.id === 'b');
    assert.equal(b.name, 'Watchlist');
    assert.deepEqual(b.symbols, ['BTC']);
  });

  test('saveWatchlists swallows storage failures', () => {
    const bad = { setItem: () => { throw new Error('quota'); }, getItem: () => null, removeItem: () => {} };
    saveWatchlists(defaultWatchlistState(), bad); // must not throw
  });
});

// ─── 2. List CRUD ─────────────────────────────────────────────────────────────

describe('watchlistStore CRUD', () => {

  test('defaultWatchlistState has exactly one EMPTY list (first-visit spec)', () => {
    const s = defaultWatchlistState();
    assert.equal(s.lists.length, 1);
    assert.deepEqual(s.lists[0].symbols, []);
    assert.equal(s.version, 1);
  });

  test('createList appends an empty list and activates it', () => {
    let s = defaultWatchlistState();
    s = createList(s);
    assert.equal(s.lists.length, 2);
    assert.equal(s.activeId, s.lists[1].id);
    assert.deepEqual(s.lists[1].symbols, []);
    assert.notEqual(s.lists[1].name, '');
  });

  test('createList auto-numbers names (Watchlist 2, 3, …)', () => {
    let s = defaultWatchlistState();           // Watchlist 1
    s = createList(s);                          // Watchlist 2
    s = createList(s);                          // Watchlist 3
    assert.equal(s.lists[2].name, 'Watchlist 3');
  });

  test('renameList renames and truncates; empty rename is a no-op', () => {
    let s = defaultWatchlistState();
    const id = s.activeId;
    s = renameList(s, id, '  Momentum Plays ');
    assert.equal(s.lists[0].name, 'Momentum Plays');
    const before = s.lists[0].name;
    s = renameList(s, id, '   ');
    assert.equal(s.lists[0].name, before);
    s = renameList(s, id, 'x'.repeat(80));
    assert.ok(s.lists[0].name.length <= 60);
  });

  test('deleteList keeps at least one list (empties the last one instead)', () => {
    let s = defaultWatchlistState();
    const { state: withSym } = addSymbols(s, s.activeId, ['BTC']);
    s = withSym;
    s = deleteList(s, s.activeId);
    assert.equal(s.lists.length, 1);
    assert.deepEqual(s.lists[0].symbols, []);   // emptied, not removed
  });

  test('deleteList switches activeId to the first remaining list', () => {
    let s = defaultWatchlistState();
    s = createList(s);
    const secondId = s.activeId;
    const { state: s2 } = addSymbols(s, secondId, ['ETH']);
    s = deleteList(s2, secondId);
    assert.equal(s.lists.length, 1);
    assert.equal(s.activeId, s.lists[0].id);
    assert.deepEqual(s.lists[0].symbols, []);   // the untouched first list
  });

  test('addSymbols dedupes (case-insensitive) and counts only new', () => {
    const s = defaultWatchlistState();
    const { state: s1, added: a1 } = addSymbols(s, s.activeId, ['BTC', 'btc', 'ETH']);
    assert.equal(a1, 2);
    assert.deepEqual(s1.lists[0].symbols, ['BTC', 'ETH']);
    const { state: s2, added: a2 } = addSymbols(s1, s1.activeId, ['ETH', 'SOL']);
    assert.equal(a2, 1);
    assert.deepEqual(s2.lists[0].symbols, ['BTC', 'ETH', 'SOL']);
  });

  test('addSymbols ignores empties and non-strings', () => {
    const s = defaultWatchlistState();
    const { state: s1, added } = addSymbols(s, s.activeId, ['', '  ', null, undefined, 0, 'DOGE']);
    assert.equal(added, 1);
    assert.deepEqual(s1.lists[0].symbols, ['DOGE']);
  });

  test('removeSymbol removes only from the targeted list', () => {
    let s = defaultWatchlistState();
    const { state: s1 } = addSymbols(s, s.activeId, ['BTC']);
    s = createList(s1);
    const second = s.activeId;
    const { state: s2 } = addSymbols(s, second, ['BTC', 'ETH']);
    s = removeSymbol(s2, second, 'BTC');
    assert.deepEqual(s.lists[0].symbols, ['BTC']);   // first list untouched
    assert.deepEqual(s.lists[1].symbols, ['ETH']);
  });
});

// ─── 3. Screener paste parser ─────────────────────────────────────────────────

describe('parseScreenerPaste', () => {

  test('bare comma-separated list (Screener COPY format)', () => {
    const { symbols, skipped } = parseScreenerPaste('BTC, ETH, SOL, HYPE');
    assert.deepEqual(symbols, ['BTC', 'ETH', 'SOL', 'HYPE']);
    assert.deepEqual(skipped, []);
  });

  test('TradingView-prefixed list (Screener COPY-TV format)', () => {
    const { symbols } = parseScreenerPaste('BINANCE:BTCUSDT.P, HYPERLIQUID:ETHUSDC.P, NASDAQ:AAPL');
    assert.deepEqual(symbols, ['BTC', 'ETH', 'AAPL']);
  });

  test('newline-separated tickers', () => {
    const { symbols } = parseScreenerPaste('BTC\nETH\nSOL');
    assert.deepEqual(symbols, ['BTC', 'ETH', 'SOL']);
  });

  test('CSV with header row — tickers kept, name-column words filtered at classify time', () => {
    const csv = 'Ticker,Name,Price,1D %\nBTC,Bitcoin,83900,+1.5\nETH,Ethereum,2709,-2.1\nSOL,Solana,119.4,+0.3';
    const { symbols, skipped } = parseScreenerPaste(csv);
    // Name-column words (Bitcoin/Ethereum/Solana) parse as ticker-shaped
    // tokens — by design they surface in `symbols` here and get rejected at
    // CLASSIFY time (not in any universe), which the UI reports as
    // "not recognized". The parser itself must keep the real tickers:
    assert.deepEqual(symbols, ['BTC', 'BITCOIN', 'ETH', 'ETHEREUM', 'SOL', 'SOLANA']);
    assert.equal(skipped.length, 0);
    // And classification does filter them:
    const cls = classifyWatchlistSymbols(symbols, { crypto: new Set(['BTC', 'ETH', 'SOL']) });
    assert.deepEqual(cls.crypto, ['BTC', 'ETH', 'SOL']);
    assert.deepEqual(cls.unknown, ['BITCOIN', 'ETHEREUM', 'SOLANA']);
  });

  test('CSV from the crypto table export (leading empty chart-button column)', () => {
    const csv = ',Ticker,Name,Price\n,BTC,Bitcoin,83900\n,ETH,Ethereum,2709';
    const { symbols } = parseScreenerPaste(csv);
    // Header detected via known header-word vocabulary; BITCOIN/ETHEREUM
    // are name-column tokens (filtered at classify time, not here).
    assert.deepEqual(symbols, ['BTC', 'BITCOIN', 'ETH', 'ETHEREUM']);
  });

  test('mixed formats in one paste', () => {
    const mixed = 'BTC, binance:ethusdt.p\nQQQ  SPY';
    const { symbols } = parseScreenerPaste(mixed);
    assert.deepEqual(symbols, ['BTC', 'ETH', 'QQQ', 'SPY']);
  });

  test('CSV header line mid-paste is dropped (symbols list followed by CSV block)', () => {
    const mixed = 'BINANCE:SOLUSDT.P, NASDAQ:NVDA\nTicker,Name,Price\nDOGE,Dogecoin,0.16';
    const { symbols } = parseScreenerPaste(mixed);
    // Header tokens (Ticker/Name/Price) must NOT appear; DOGECOIN (name-column
    // word) does by design — classify filters it. NVDA normalizes from the TV prefix.
    assert.deepEqual(symbols, ['SOL', 'NVDA', 'DOGE', 'DOGECOIN']);
  });

  test('dedupes across formats', () => {
    const { symbols } = parseScreenerPaste('BTC, binance:btcusdt.p, BTCUSDT');
    assert.deepEqual(symbols, ['BTC']);
  });

  test('numbers / percentages / currency are silently ignored', () => {
    const { symbols, skipped } = parseScreenerPaste('BTC 83900 $83,900 +1.5% -2.1 — 0.5');
    assert.deepEqual(symbols, ['BTC']);
    assert.deepEqual(skipped, []);
  });

  test('empty / whitespace-only input', () => {
    assert.deepEqual(parseScreenerPaste(''), { symbols: [], skipped: [] });
    assert.deepEqual(parseScreenerPaste('   \n\t  '), { symbols: [], skipped: [] });
  });

  test('real garbage is reported in skipped', () => {
    const { symbols, skipped } = parseScreenerPaste('BTC !!! @#$ DOGE');
    assert.deepEqual(symbols, ['BTC', 'DOGE']);
    assert.ok(skipped.includes('!!!'));
    assert.ok(skipped.includes('@#$'));
  });

  test('tokens longer than 12 chars are rejected (not tickers)', () => {
    const { symbols } = parseScreenerPaste('BTC THISISNOTATICKERXYZ');
    assert.deepEqual(symbols, ['BTC']);
  });
});

// ─── 4. normalizeToken ────────────────────────────────────────────────────────

describe('normalizeToken', () => {
  test('venue suffix / prefix stripping', () => {
    assert.equal(normalizeToken('BINANCE:BTCUSDT.P'), 'BTC');
    assert.equal(normalizeToken('HYPERLIQUID:ETHUSDC.P'), 'ETH');
    assert.equal(normalizeToken('OKX:BTC-USDT'), 'BTC');
    assert.equal(normalizeToken('KRAKEN:XBTUSD'), 'BTC');   // XBTUSD → XBT → BTC (Kraken legacy)
    assert.equal(normalizeToken('BTCUSDT'), 'BTC');
    assert.equal(normalizeToken('BTC-USD'), 'BTC');
    assert.equal(normalizeToken('BTC/USD'), 'BTC');
    assert.equal(normalizeToken('BTCUSDC.P'), 'BTC');
    assert.equal(normalizeToken('btc'), 'BTC');
    assert.equal(normalizeToken('"BTC"'), 'BTC');
  });
  test('XBT legacy maps to BTC', () => {
    assert.equal(normalizeToken('XBT'), 'BTC');
  });
  test('long-tail 1000x prefixes are preserved', () => {
    assert.equal(normalizeToken('1000PEPEUSDT'), '1000PEPE');
    assert.equal(normalizeToken('1000000MOGUSDT'), '1000000MOG');
  });
  test('NASDAQ-prefixed tradfi keeps the bare ticker', () => {
    assert.equal(normalizeToken('NASDAQ:AAPL'), 'AAPL');
    assert.equal(normalizeToken('NYSE:BRK.B'), 'BRK.B');
  });
});

// ─── 5. Classification ────────────────────────────────────────────────────────

describe('classifyWatchlistSymbols', () => {
  const universes = {
    crypto: { BTC: {}, ETH: {}, HYPE: {} },            // object form (snapshot)
    tradfi: new Set(['SPY', 'QQQ', 'AAPL']),           // Set form
    hlTickers: new Map([['HYPE', {}], ['ZEC', {}]]),   // Map form (HL tickers)
  };

  test('splits crypto / tradfi / unknown', () => {
    const out = classifyWatchlistSymbols(['BTC', 'SPY', 'HYPE', 'QQQ', 'FOOBAR'], universes);
    assert.deepEqual(out.crypto, ['BTC', 'HYPE']);
    assert.deepEqual(out.tradfi, ['SPY', 'QQQ']);
    assert.deepEqual(out.unknown, ['FOOBAR']);
  });

  test('HL-only listing still classifies as crypto', () => {
    const out = classifyWatchlistSymbols(['ZEC'], universes);
    assert.deepEqual(out.crypto, ['ZEC']);
  });

  test('tradfi takes precedence over crypto for dual-listed symbols', () => {
    // SPY exists as a crypto perp on some venues but is tradfi-first here
    const out = classifyWatchlistSymbols(['SPY'], { ...universes, crypto: { SPY: {} } });
    assert.deepEqual(out.tradfi, ['SPY']);
  });

  test('empty universes → everything unknown', () => {
    const out = classifyWatchlistSymbols(['BTC', 'AAPL'], {});
    assert.deepEqual(out.unknown, ['BTC', 'AAPL']);
  });

  test('array-form universes are accepted (strings AND asset objects like TRAD_UNIVERSE)', () => {
    const out = classifyWatchlistSymbols(['BTC'], { crypto: ['BTC'] });
    assert.deepEqual(out.crypto, ['BTC']);
    // TRAD_UNIVERSE shape: array of {symbol, name, category, …} objects
    const out2 = classifyWatchlistSymbols(['SPY', 'BTC'], {
      crypto: ['BTC'],
      tradfi: [{ symbol: 'SPY', name: 'SPDR S&P 500 ETF', category: 'Benchmark' }],
    });
    assert.deepEqual(out2.tradfi, ['SPY']);
    assert.deepEqual(out2.crypto, ['BTC']);
  });
});

// ─── 6. Engine helpers ────────────────────────────────────────────────────────

describe('watchlistEngine sourceLabel', () => {
  test('maps known source ids to short labels', () => {
    assert.equal(sourceLabel('hyperliquid'), 'HL');
    assert.equal(sourceLabel('okx_perps'), 'OKX');
    assert.equal(sourceLabel('snapshot'), 'SNAP');
    assert.equal(sourceLabel('binance_perps'), 'BINANCE');
  });
  test('unknown ids are uppercased + truncated, null-safe', () => {
    assert.equal(sourceLabel('somevenuename'), 'SOMEVENU');
    assert.equal(sourceLabel(''), '?');
    assert.equal(sourceLabel(null), '?');
  });
});
