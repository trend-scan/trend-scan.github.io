/**
 * WatchlistTab.jsx — user-defined watchlists on the Board (first tab).
 *
 * Features (per spec, 2026-09-29):
 *   - Multiple named watchlists (create / rename / delete / switch)
 *   - Manual add (single ticker input) + paste-import of screener scan
 *     results (bare lists, TradingView-prefixed lists, CSV with headers)
 *   - Empty on first visit; persists entries in localStorage thereafter
 *   - Data precedence per asset: Hyperliquid live → other live sources →
 *     snapshot (surfaced per-row via the Src badge)
 *   - Crypto table: the same columns as the Crypto tab's all-assets table
 *   - TradFi table: the same columns as the TradFi tab's All Assets table
 *     (plus the TradingView chart button)
 *   - Both tables: sticky asset-name column, horizontal scroll, sortable
 *     headers, TradingView chart sheet, per-row remove button
 *
 * Data flow:
 *   - Crypto rows: watchlistEngine.fetchWatchlistCryptoData (HL-first resolver,
 *     60s live refresh while the tab is mounted, snapshot fallback)
 *   - TradFi rows: resolveWatchlistTradfi over tradData (Board loads snapshot
 *     on mount; onEnsureTradfiLive() triggers the live refresh once), then
 *     fetchWatchlistTradfiLive overlays LIVE prices + 24h moves from OKX
 *     USDT-quoted SWAP perps (60s refresh; snapshot keeps the indicators)
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import TradingViewChart from '@/components/scanner/TradingViewChart';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import CopyCsvButtons from './CopyCsvButtons';
import { TRAD_UNIVERSE } from '@/lib/board/traditionalMarkets';
import { fetchAllTickers as fetchHyperliquidTickers } from '@/lib/scanner/sources/hyperliquid';
import {
  loadWatchlists, saveWatchlists, defaultWatchlistState,
  createList, renameList, deleteList, addSymbols, removeSymbol,
  parseScreenerPaste, classifyWatchlistSymbols,
} from '@/lib/board/watchlistStore';
import { fetchWatchlistCryptoData, fetchWatchlistTradfiLive, resolveWatchlistTradfi, sourceLabel } from '@/lib/board/watchlistEngine';
import { fmtCryptoPrice, fmtDollarPrice } from '@/lib/board/priceFormat';

/** TRAD_UNIVERSE metadata by upper symbol — used for OKX-live rows of tickers
 *  the snapshot has no row for yet (newly added universe members). */
const TRAD_META = new Map(TRAD_UNIVERSE.map(a => [String(a.symbol).toUpperCase(), a]));

// ─── Formatting helpers (identical conventions to CryptoTab / MacroTab) ──────

function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}
function fmtPctRaw(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function retColor(v) {
  if (v == null || !Number.isFinite(v)) return 'var(--scanner-text3)';
  return v > 0 ? 'var(--scanner-green)' : v < 0 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}
function rsiColor(v) {
  if (v == null) return 'var(--scanner-text3)';
  return v < 30 ? 'var(--scanner-green)' : v > 70 ? 'var(--scanner-red)' : 'var(--scanner-text2)';
}

function MiniSparkline({ data }) {
  if (!data || data.length < 2) return <span className="text-[9px]" style={{ color: 'var(--scanner-text3)' }}>—</span>;
  const w = 80, h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? 'var(--scanner-green)' : 'var(--scanner-red)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <path d={`M${pts.join(' L')}`} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.85" />
    </svg>
  );
}

/** TradingView chart button — same look as CryptoTab's ChartButton. */
function ChartButton({ symbol, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(symbol); }}
      title={`View ${symbol} chart`}
      style={{
        background: 'transparent',
        border: '1px solid var(--scanner-border2)',
        borderRadius: '4px',
        width: '24px',
        height: '20px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        color: 'var(--scanner-text3)',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--scanner-accent)';
        e.currentTarget.style.color = 'var(--scanner-accent)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--scanner-border2)';
        e.currentTarget.style.color = 'var(--scanner-text3)';
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="5" width="2.5" height="6" rx="0.5" fill="currentColor" opacity="0.7" />
        <line x1="3.25" y1="3" x2="3.25" y2="5" stroke="currentColor" strokeWidth="0.75" opacity="0.7" />
        <line x1="3.25" y1="11" x2="3.25" y2="13" stroke="currentColor" strokeWidth="0.75" opacity="0.7" />
        <rect x="6.75" y="3" width="2.5" height="9" rx="0.5" fill="currentColor" />
        <line x1="8" y1="1.5" x2="8" y2="3" stroke="currentColor" strokeWidth="0.75" />
        <line x1="8" y1="12" x2="8" y2="14.5" stroke="currentColor" strokeWidth="0.75" />
        <rect x="11.5" y="6" width="2.5" height="5" rx="0.5" fill="currentColor" opacity="0.5" />
        <line x1="12.75" y1="4" x2="12.75" y2="6" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
        <line x1="12.75" y1="11" x2="12.75" y2="13" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
      </svg>
    </button>
  );
}

/** Per-row remove (×) button — removes the asset from the active watchlist. */
function RemoveButton({ onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title="Remove from watchlist"
      style={{
        background: 'transparent',
        border: 'none',
        width: '22px', height: '20px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0,
        color: 'var(--scanner-text3)', opacity: 0.6,
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--scanner-red)'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = 'var(--scanner-text3)'; }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10">
        <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function SectionLabel({ children, right = null }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-3 rounded-full" style={{ background: 'var(--scanner-accent)' }} />
      <span className="text-[9px] font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--scanner-text3)' }}>{children}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function WatchlistTab({ snapshotData, tradData, tradLoading, onEnsureTradfiLive }) {
  // ── Watchlist state (localStorage-backed) ─────────────────────────────────
  const [wlState, setWlState] = useState(() => loadWatchlists() || defaultWatchlistState());
  useEffect(() => { saveWatchlists(wlState); }, [wlState]);

  const activeList = useMemo(
    () => wlState.lists.find(l => l.id === wlState.activeId) || wlState.lists[0],
    [wlState]
  );
  const symbols = activeList?.symbols || [];

  // ── Inline rename of the active list ──────────────────────────────────────
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');

  // ── Add / paste-import UI state ───────────────────────────────────────────
  const [addText, setAddText] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [feedback, setFeedback] = useState(null); // { ok: string, warn?: string }

  // ── Hyperliquid perp universe (for add-time classification of fresh listings) ──
  const [hlUniverse, setHlUniverse] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchHyperliquidTickers()
      .then(m => { if (!cancelled && m instanceof Map) setHlUniverse(new Set(m.keys())); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Classification (recomputed as universes load) ─────────────────────────
  const classified = useMemo(() => {
    const cryptoUniverse = {
      ...(snapshotData?.crypto_universe || {}),
      ...(snapshotData?.coingecko_top || {}),
    };
    return classifyWatchlistSymbols(symbols, {
      crypto: cryptoUniverse,
      tradfi: TRAD_UNIVERSE,
      hlTickers: hlUniverse,
    });
  }, [symbols, snapshotData, hlUniverse]);

  const cryptoKey = classified.crypto.join(',');
  const tradfiKey = classified.tradfi.join(',');

  // ── Crypto live data (HL-first → live chain → snapshot fallback) ──────────
  const [cryptoData, setCryptoData] = useState(null); // { rows, fetchedAt, liveCount, snapshotCount }
  const [wlLoading, setWlLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const snapshotReady = snapshotData != null;

  useEffect(() => {
    if (!cryptoKey) { setCryptoData(null); return; }
    let cancelled = false;
    const run = async () => {
      setWlLoading(true);
      try {
        const res = await fetchWatchlistCryptoData(cryptoKey.split(','), snapshotData);
        if (!cancelled) setCryptoData(res);
      } catch (e) {
        console.warn('[WatchlistTab] crypto fetch failed:', e.message);
      } finally {
        if (!cancelled) setWlLoading(false);
      }
    };
    run();
    // 60s live refresh — only while the tab is mounted (Board unmounts
    // inactive tabs), so no background polling when the user is elsewhere.
    const interval = setInterval(run, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cryptoKey, snapshotReady, refreshTick]);

  // ── TradFi live prices (OKX USDT-quoted perps; 60s refresh) ───────────────
  // Probes `${base}-USDT-SWAP` per symbol; misses are negatively cached in
  // the engine. Gated on tradData so the divergence guard always has snapshot
  // prices to verify against (avoids flashing collided prices on first load).
  const [tradfiLive, setTradfiLive] = useState(null); // { rows: Map, fetchedAt }
  useEffect(() => {
    if (!tradfiKey || !tradData) { setTradfiLive(null); return; }
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetchWatchlistTradfiLive(tradfiKey.split(','), tradData);
        if (!cancelled) setTradfiLive(res);
      } catch (e) {
        console.warn('[WatchlistTab] tradfi live fetch failed:', e.message);
      }
    };
    run();
    const interval = setInterval(run, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tradfiKey, tradData, refreshTick]);

  // ── TradFi rows (snapshot metrics + OKX live price overlay) ───────────────
  const tradfiRows = useMemo(() => {
    const syms = tradfiKey ? tradfiKey.split(',') : [];
    const base = resolveWatchlistTradfi(syms, tradData);
    if (!tradfiLive?.rows?.size) return base;
    const live = tradfiLive.rows;
    const bySym = new Map(base.map(r => [r.symbol, r]));
    const out = [];
    for (const sym of syms) {
      const l = live.get(sym);
      const b = bySym.get(sym);
      if (l && b) {
        // Hybrid: live OKX price + 24h move, snapshot indicators (deep history).
        out.push({
          ...b,
          price: l.price,
          ret1d: l.ret1d ?? b.ret1d,
          high24h: l.high24h,
          low24h: l.low24h,
          okxInstId: l.okxInstId,
          dataSource: 'okx',
          live: true,
        });
      } else if (l) {
        // OKX-live ticker with no snapshot row (newly added universe member
        // before its first snapshot refresh) — minimal live row; indicator
        // columns render '—' until the snapshot catches up.
        const meta = TRAD_META.get(sym);
        out.push({
          symbol: sym, name: meta?.name || sym, category: meta?.category || '',
          type: meta?.type || null, subtheme: meta?.subtheme || null,
          price: l.price, ret1d: l.ret1d ?? null,
          ret5d: null, ret20d: null, ret60d: null,
          distMa20: null, distMa50: null, atrExt50ma: null, rsi14: null,
          pctFrom52wHigh: null, rs_qqq_20d: null, sparkline: null,
          high24h: l.high24h, low24h: l.low24h, okxInstId: l.okxInstId,
          dataSource: 'okx', live: true,
        });
      } else if (b) {
        out.push(b);
      }
    }
    return out;
  }, [tradfiKey, tradData, tradfiLive]);
  const tradfiLiveCount = tradfiRows.filter(r => r.live).length;
  // Trigger the Board's one-shot live tradfi refresh when the watchlist has
  // tradfi symbols and we're still on snapshot-only data.
  const hasTradfi = classified.tradfi.length > 0;
  useEffect(() => {
    if (hasTradfi && onEnsureTradfiLive) onEnsureTradfiLive();
  }, [hasTradfi, onEnsureTradfiLive]);

  // ── Chart sheet ───────────────────────────────────────────────────────────
  const [chart, setChart] = useState(null); // { symbol, exchange }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const mutate = useCallback((fn) => setWlState(prev => fn(prev)), []);

  const handleAdd = () => {
    const raw = addText.trim();
    if (!raw) return;
    const { symbols: parsed } = parseScreenerPaste(raw);
    if (parsed.length === 0) { setFeedback({ ok: '', warn: `"${raw.slice(0, 30)}" is not a valid ticker` }); setAddText(''); return; }
    const { crypto, tradfi, unknown } = classifyWatchlistSymbols(parsed, {
      crypto: { ...(snapshotData?.crypto_universe || {}), ...(snapshotData?.coingecko_top || {}) },
      tradfi: TRAD_UNIVERSE,
      hlTickers: hlUniverse,
    });
    const recognized = [...crypto, ...tradfi];
    const { state, added } = addSymbols(wlState, activeList.id, recognized);
    if (added > 0) setWlState(state);
    setAddText('');
    setFeedback({
      ok: added > 0 ? `Added ${added} asset${added > 1 ? 's' : ''}${crypto.length ? ` · ${crypto.length} crypto` : ''}${tradfi.length ? ` · ${tradfi.length} tradfi` : ''}` : '',
      warn: unknown.length ? `Not recognized: ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? ` +${unknown.length - 8} more` : ''}` : '',
    });
  };

  const handlePasteImport = () => {
    const { symbols: parsed, skipped } = parseScreenerPaste(pasteText);
    if (parsed.length === 0) {
      setFeedback({ ok: '', warn: 'No tickers found in the pasted text' });
      return;
    }
    const { crypto, tradfi, unknown } = classifyWatchlistSymbols(parsed, {
      crypto: { ...(snapshotData?.crypto_universe || {}), ...(snapshotData?.coingecko_top || {}) },
      tradfi: TRAD_UNIVERSE,
      hlTickers: hlUniverse,
    });
    const recognized = [...crypto, ...tradfi];
    const { state, added } = addSymbols(wlState, activeList.id, recognized);
    if (added > 0) setWlState(state);
    setPasteText('');
    setPasteOpen(false);
    setFeedback({
      ok: `Imported ${added} asset${added !== 1 ? 's' : ''}${crypto.length ? ` · ${crypto.length} crypto` : ''}${tradfi.length ? ` · ${tradfi.length} tradfi` : ''}${added < recognized.length ? ` · ${recognized.length - added} already on list` : ''}`,
      warn: unknown.length ? `Not recognized: ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? ` +${unknown.length - 8} more` : ''}` : (skipped.length ? `Skipped ${skipped.length} unparseable token${skipped.length > 1 ? 's' : ''}` : ''),
    });
  };

  const handleRemove = (symbol) => mutate(prev => removeSymbol(prev, activeList.id, symbol));

  const handleCreateList = () => mutate(prev => createList(prev));
  const handleRenameCommit = () => {
    if (renameText.trim()) mutate(prev => renameList(prev, activeList.id, renameText));
    setRenaming(false);
  };
  const handleDeleteList = () => {
    if (activeList.symbols.length > 0 && !window.confirm(`Delete "${activeList.name}" and its ${activeList.symbols.length} assets?`)) return;
    mutate(prev => deleteList(prev, activeList.id));
  };

  // ── Sort state (per table, CryptoTab/MacroTab conventions) ────────────────
  const [cSortKey, setCSortKey] = useState('ret20d');
  const [cSortDir, setCSortDir] = useState('desc');
  const [tSortKey, setTSortKey] = useState('ret20d');
  const [tSortDir, setTSortDir] = useState('desc');

  const sortRows = (rows, key, dir) => [...rows].sort((a, b) => {
    const av = a[key] ?? (dir === 'desc' ? -Infinity : Infinity);
    const bv = b[key] ?? (dir === 'desc' ? -Infinity : Infinity);
    if (key === 'symbol' || key === 'name') return dir === 'desc' ? String(b[key]).localeCompare(String(a[key])) : String(a[key]).localeCompare(String(b[key]));
    return dir === 'desc' ? bv - av : av - bv;
  });

  const cryptoRows = useMemo(
    () => sortRows(cryptoData?.rows || [], cSortKey, cSortDir),
    [cryptoData, cSortKey, cSortDir]
  );
  const tradfiSorted = useMemo(
    () => sortRows(tradfiRows, tSortKey, tSortDir),
    [tradfiRows, tSortKey, tSortDir]
  );

  const onSort = (which, key) => {
    if (which === 'crypto') {
      if (cSortKey === key) setCSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
      else { setCSortKey(key); setCSortDir('desc'); }
    } else {
      if (tSortKey === key) setTSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
      else { setTSortKey(key); setTSortDir('desc'); }
    }
  };

  const updatedTs = Math.max(
    Date.parse(cryptoData?.fetchedAt || 0),
    Date.parse(tradfiLive?.fetchedAt || 0),
  );
  const updatedLabel = updatedTs > 0
    ? new Date(updatedTs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="font-mono px-5 md:px-8 py-5">

      {/* ── Watchlist selector + list management ─────────────────────────── */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {wlState.lists.map(l => {
          const active = l.id === activeList.id;
          return active && renaming ? (
            <input
              key={l.id}
              autoFocus
              value={renameText}
              onChange={e => setRenameText(e.target.value)}
              onBlur={handleRenameCommit}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameCommit(); if (e.key === 'Escape') setRenaming(false); }}
              className="font-mono text-[9px] font-semibold px-2.5 py-1 outline-none"
              style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-accent)', color: 'var(--scanner-text)', width: 130 }}
            />
          ) : (
            <button
              key={l.id}
              className="font-mono text-[9px] font-semibold px-2.5 py-1.5 transition-all"
              style={{
                background: active ? 'rgba(245,158,11,0.12)' : 'var(--scanner-bg2)',
                border: `1px solid ${active ? 'var(--scanner-accent)' : 'var(--scanner-border2)'}`,
                color: active ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                cursor: 'pointer',
              }}
              onClick={() => setWlState(prev => ({ ...prev, activeId: l.id }))}
              title={`${l.name} — ${l.symbols.length} assets`}
            >
              {l.name} <span style={{ opacity: 0.6 }}>({l.symbols.length})</span>
            </button>
          );
        })}
        <button
          className="font-mono text-[9px] font-semibold px-2 py-1.5"
          style={{ background: 'var(--scanner-bg2)', border: '1px dashed var(--scanner-border2)', color: 'var(--scanner-text3)', cursor: 'pointer' }}
          onClick={handleCreateList}
          title="Create a new watchlist"
        >+ New</button>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            className="font-mono text-[9px] font-semibold px-2 py-1.5"
            style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)', color: 'var(--scanner-text3)', cursor: 'pointer' }}
            onClick={() => { setRenaming(true); setRenameText(activeList.name); }}
            title="Rename this watchlist"
          >✎ Rename</button>
          <button
            className="font-mono text-[9px] font-semibold px-2 py-1.5"
            style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)', color: 'var(--scanner-text3)', cursor: 'pointer' }}
            onClick={handleDeleteList}
            title="Delete this watchlist"
          >✕ Delete</button>
        </div>
      </div>

      {/* ── Add / paste-import / refresh bar ────────────────────────────── */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <input
          type="text"
          placeholder="Add asset… (e.g. BTC, AAPL, or paste several)"
          value={addText}
          onChange={e => setAddText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          className="font-mono text-[10px] px-2 py-1 outline-none"
          style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)', color: 'var(--scanner-text)', borderRadius: '4px', width: 250 }}
        />
        <button
          className="font-mono text-[9px] font-semibold px-2.5 py-1.5"
          style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid var(--scanner-accent)', color: 'var(--scanner-accent)', cursor: 'pointer' }}
          onClick={handleAdd}
        >+ Add</button>
        <button
          className="font-mono text-[9px] font-semibold px-2.5 py-1.5"
          style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)', color: pasteOpen ? 'var(--scanner-accent)' : 'var(--scanner-text3)', cursor: 'pointer' }}
          onClick={() => { setPasteOpen(o => !o); setFeedback(null); }}
        >⌸ Paste Scan Results</button>
        <button
          className="font-mono text-[9px] font-semibold px-2.5 py-1.5"
          style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)', color: wlLoading ? 'var(--scanner-accent)' : 'var(--scanner-text3)', cursor: 'pointer' }}
          onClick={() => setRefreshTick(t => t + 1)}
          title="Re-fetch live data now"
        >{wlLoading ? '⟳ Loading…' : '⟳ Refresh'}</button>
        {updatedLabel && (
          <span className="text-[8px] tracking-wider" style={{ color: 'var(--scanner-text3)' }} title="Live-data fetch time · live/snapshot asset counts">
            updated {updatedLabel}
            {cryptoData ? ` · crypto ${cryptoData.liveCount} live / ${cryptoData.snapshotCount} snapshot` : ''}
            {tradfiRows.length ? ` · tradfi ${tradfiLiveCount} live` : ''}
          </span>
        )}
      </div>

      {/* Paste textarea */}
      {pasteOpen && (
        <div className="mb-3 p-2.5 rounded" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
          <div className="text-[8.5px] mb-1.5" style={{ color: 'var(--scanner-text3)' }}>
            Paste screener output — accepts comma-separated tickers, TradingView symbols (BINANCE:BTCUSDT.P), or CSV with headers
          </div>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={4}
            placeholder={'BTC, ETH, SOL, HYPE\nor\nBINANCE:BTCUSDT.P, NASDAQ:AAPL\nor\nTicker,Name,Price\nBTC,Bitcoin,83900'}
            className="font-mono text-[10px] p-2 w-full outline-none"
            style={{ background: 'var(--scanner-bg)', border: '1px solid var(--scanner-border2)', color: 'var(--scanner-text)', resize: 'vertical' }}
          />
          <div className="flex gap-1.5 mt-1.5">
            <button
              className="font-mono text-[9px] font-semibold px-2.5 py-1"
              style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid var(--scanner-accent)', color: 'var(--scanner-accent)', cursor: 'pointer' }}
              onClick={handlePasteImport}
            >Import</button>
            <button
              className="font-mono text-[9px] font-semibold px-2.5 py-1"
              style={{ background: 'var(--scanner-bg)', border: '1px solid var(--scanner-border2)', color: 'var(--scanner-text3)', cursor: 'pointer' }}
              onClick={() => { setPasteOpen(false); setPasteText(''); }}
            >Cancel</button>
          </div>
        </div>
      )}

      {/* Feedback line */}
      {feedback && (feedback.ok || feedback.warn) && (
        <div className="mb-2 text-[9.5px] flex items-center gap-3 flex-wrap">
          {feedback.ok && <span style={{ color: 'var(--scanner-green)' }}>✓ {feedback.ok}</span>}
          {feedback.warn && <span style={{ color: 'var(--scanner-accent)' }}>⚠ {feedback.warn}</span>}
        </div>
      )}

      {/* ── Empty state (first visit / empty active list) ─────────────────── */}
      {symbols.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-4 opacity-20">◈</div>
          <div className="text-sm mb-2" style={{ color: 'var(--scanner-text2)' }}>Your watchlist is empty</div>
          <div className="text-[11px] max-w-md mx-auto leading-relaxed" style={{ color: 'var(--scanner-text3)' }}>
            Add assets above (crypto tickers like <span style={{ color: 'var(--scanner-text2)' }}>BTC</span> or tradfi tickers like <span style={{ color: 'var(--scanner-text2)' }}>AAPL</span>),
            or paste your screener scan results. Entries are saved in this browser and survive reloads.
            Live data comes from Hyperliquid when an asset is listed there, then other live sources, then the snapshot;
            tradfi tickers get live prices from OKX's USDT perps when listed there.
          </div>
        </div>
      )}

      {/* ── Crypto table (same columns as the Crypto tab's all-assets table) ── */}
      {classified.crypto.length > 0 && (
        <div className="mb-6">
          <SectionLabel right={
            <div className="flex items-center gap-2">
              <span className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
                {classified.crypto.length} crypto · {cryptoData ? `${cryptoData.liveCount} live / ${cryptoData.snapshotCount} snapshot` : wlLoading ? 'loading…' : ''}
              </span>
              <CopyCsvButtons tableId="watchlist-crypto-table" />
            </div>
          }>
            Crypto
          </SectionLabel>

          {(wlLoading && !cryptoData) ? (
            <div className="py-8 text-center text-[10px]" style={{ color: 'var(--scanner-text3)' }}>Fetching live crypto data…</div>
          ) : (
            <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
              <table id="watchlist-crypto-table" className="board-table w-full border-collapse min-w-[1400px]">
                <thead>
                  <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
                    {[
                      { key: 'symbol', label: 'Ticker' },
                      { key: null, label: 'Name' },
                      { key: 'price', label: 'Price' },
                      { key: null, label: 'Trend' },
                      { key: 'ret1d', label: '1D' },
                      { key: 'ret5d', label: '5D' },
                      { key: 'ret20d', label: '20D' },
                      { key: 'ret60d', label: '60D' },
                      { key: 'distMa20', label: 'vs20MA' },
                      { key: 'distMa50', label: 'vs50MA' },
                      { key: 'atrExt50ma', label: 'ATR' },
                      { key: 'rsi14', label: 'RSI' },
                      { key: 'rs_btc_20d', label: 'RS/BTC' },
                      { key: 'volRatio', label: 'rVOL' },
                      { key: 'adrUsedPct', label: 'ADR%' },
                      { key: 'oiRatio', label: 'OI/MC' },
                      { key: null, label: '' },
                    ].map((h, hi) => (
                      <th
                        key={hi}
                        className={`text-[8.5px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap py-2 px-2.5 ${h.key ? 'cursor-pointer' : ''} ${hi === 0 ? 'text-left' : 'text-right'}`}
                        style={{
                          color: cSortKey === h.key ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                          ...(hi === 0 ? { position: 'sticky', left: 0, zIndex: 10, background: 'var(--scanner-bg2)' } : {}),
                        }}
                        onClick={() => h.key && onSort('crypto', h.key)}
                      >
                        {h.label}
                        {cSortKey === h.key && <span className="ml-0.5 opacity-60">{cSortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cryptoRows.length === 0 ? (
                    <tr><td colSpan={17} className="py-4 text-center text-[10px]" style={{ color: 'var(--scanner-text3)' }}>No data yet — press Refresh.</td></tr>
                  ) : cryptoRows.map(item => (
                    <tr key={item.symbol}
                      style={{ borderBottom: '1px solid var(--scanner-border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      {/* Ticker + chart button (sticky col 0) */}
                      <td className="py-2 px-2.5" style={{ position: 'sticky', left: 0, zIndex: 5, background: 'var(--scanner-bg1)', whiteSpace: 'nowrap' }}>
                        <span className="flex items-center gap-1.5">
                          <ChartButton symbol={item.symbol} onClick={(sym) => setChart({ symbol: sym, exchange: item.dataSource === 'hyperliquid' ? 'hyperliquid' : 'binance_perps' })} />
                          <span className="text-[11px] font-bold" style={{ color: 'var(--scanner-text)' }}>{item.symbol}</span>
                          <span
                            className="text-[7.5px] px-1 py-0.5 rounded"
                            style={{ background: 'var(--scanner-bg3, rgba(22,22,30,1))', color: item.live ? 'var(--scanner-accent)' : 'var(--scanner-text3)' }}
                            title={item.live ? `Live source: ${item.dataSource}` : 'Snapshot fallback (no live source available)'}
                          >{sourceLabel(item.dataSource)}</span>
                        </span>
                      </td>
                      {/* Name */}
                      <td className="py-2 px-2.5 text-[10px] text-right" style={{ color: 'var(--scanner-text3)', maxWidth: 100 }}>
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
                      </td>
                      {/* Price — sub-cent cryptos (PEPE, PUMP…) get up to 7 decimals */}
                      <td className="py-2 px-2.5 text-[11px] font-semibold tabular-nums text-right" style={{ color: 'var(--scanner-text)' }}>
                        {fmtCryptoPrice(item.price)}
                      </td>
                      {/* 20D sparkline */}
                      <td className="py-1.5 px-2.5 text-right">
                        <MiniSparkline data={item.sparkline?.slice(-20)} />
                      </td>
                      {/* Returns */}
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.ret1d) }}>{fmtPct(item.ret1d)}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.ret5d) }}>{fmtPct(item.ret5d)}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.ret20d) }}>{fmtPct(item.ret20d)}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.ret60d) }}>{fmtPct(item.ret60d)}</span></td>
                      {/* vs MA */}
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.distMa20 != null ? item.distMa20 / 100 : null) }}>{item.distMa20 != null ? fmtPctRaw(item.distMa20) : '—'}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.distMa50 != null ? item.distMa50 / 100 : null) }}>{item.distMa50 != null ? fmtPctRaw(item.distMa50) : '—'}</span></td>
                      {/* ATR */}
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: 'var(--scanner-text2)' }}>{item.atrExt50ma != null ? item.atrExt50ma.toFixed(1) : '—'}</span></td>
                      {/* RSI */}
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: rsiColor(item.rsi14) }}>{item.rsi14 != null ? item.rsi14.toFixed(0) : '—'}</span></td>
                      {/* RS/BTC */}
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.rs_btc_20d) }}>{item.rs_btc_20d != null ? fmtPctRaw(item.rs_btc_20d * 100) : '—'}</span></td>
                      {/* rVOL */}
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: item.volRatio >= 2 ? 'var(--scanner-accent)' : item.volRatio >= 1.5 ? 'var(--scanner-green)' : 'var(--scanner-text2)' }}>{item.volRatio != null ? item.volRatio.toFixed(1) + 'x' : '—'}</span></td>
                      {/* ADR% */}
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: item.adrUsedPct >= 150 ? 'var(--scanner-accent)' : item.adrUsedPct <= 50 ? 'var(--scanner-text3)' : 'var(--scanner-text2)' }} title="ADR Used: today's range / trailing 20D avg range. 150%+ = stretched, 50%- = room left.">{item.adrUsedPct != null ? item.adrUsedPct.toFixed(0) + '%' : '—'}</span></td>
                      {/* OI/MC */}
                      <td className="py-2 px-2.5 text-right">
                        <span
                          className="text-[10px] font-semibold tabular-nums cursor-help"
                          style={{
                            color: item.oiRatio == null ? 'var(--scanner-text3)' :
                                   item.oiRatio >= 0.30 ? 'var(--scanner-red)' :
                                   item.oiRatio >= 0.15 ? 'var(--scanner-accent)' :
                                   'var(--scanner-text2)'
                          }}
                          title={item.oiRatio != null
                            ? `OI/MC: ${(item.oiRatio * 100).toFixed(1)}% of market cap in open interest. >30% = extreme, >15% = elevated.`
                            : 'OI/MC unavailable'}
                        >
                          {item.oiRatio != null ? `${(item.oiRatio * 100).toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      {/* Remove */}
                      <td className="py-2 px-1.5 text-right">
                        <RemoveButton onClick={() => handleRemove(item.symbol)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TradFi table (same columns as the TradFi tab's All Assets table) ── */}
      {classified.tradfi.length > 0 && (
        <div className="mb-6">
          <SectionLabel right={
            <div className="flex items-center gap-2">
              <span className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
                {classified.tradfi.length} tradfi{tradData ? (tradfiLiveCount ? ` · ${tradfiLiveCount} live / ${classified.tradfi.length - tradfiLiveCount} snapshot` : '') : ' · loading…'}
              </span>
              <CopyCsvButtons tableId="watchlist-tradfi-table" />
            </div>
          }>
            TradFi
          </SectionLabel>

          {tradfiRows.length === 0 ? (
            <div className="py-8 text-center text-[10px]" style={{ color: 'var(--scanner-text3)' }}>
              {tradLoading || !tradData ? 'Loading TradFi data…' : 'No data for these tickers.'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--scanner-border2)' }}>
              <table id="watchlist-tradfi-table" className="board-table w-full border-collapse min-w-[1150px]">
                <thead>
                  <tr style={{ background: 'var(--scanner-bg2)', borderBottom: '1px solid var(--scanner-border2)' }}>
                    {[
                      { key: 'symbol', label: 'Ticker' },
                      { key: null, label: 'Name' },
                      { key: 'price', label: 'Price' },
                      { key: null, label: '20D' },
                      { key: 'ret1d', label: '1D' },
                      { key: 'ret5d', label: '5D' },
                      { key: 'ret20d', label: '20D Ret' },
                      { key: 'ret60d', label: '60D' },
                      { key: 'distMa20', label: 'vs20MA' },
                      { key: 'distMa50', label: 'vs50MA' },
                      { key: 'atrExt50ma', label: 'ATR' },
                      { key: 'rsi14', label: 'RSI' },
                      { key: 'pctFrom52wHigh', label: '52W%' },
                      { key: 'rs_qqq_20d', label: 'RS/QQQ' },
                      { key: null, label: 'Src' },
                      { key: null, label: 'Cat' },
                      { key: null, label: '' },
                    ].map((h, hi) => (
                      <th
                        key={hi}
                        className={`text-[8.5px] font-semibold tracking-[0.1em] uppercase whitespace-nowrap py-2.5 px-2.5 ${h.key ? 'cursor-pointer' : ''} ${hi === 0 ? 'text-left' : 'text-right'}`}
                        style={{
                          color: tSortKey === h.key ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                          ...(hi === 0 ? { position: 'sticky', left: 0, zIndex: 10, background: 'var(--scanner-bg2)' } : {}),
                        }}
                        onClick={() => h.key && onSort('tradfi', h.key)}
                      >
                        {h.label}
                        {tSortKey === h.key && <span className="ml-0.5 opacity-60">{tSortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tradfiSorted.map(item => (
                    <tr key={item.symbol}
                      style={{ borderBottom: '1px solid var(--scanner-border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      {/* Ticker + chart button (sticky col 0) */}
                      <td className="py-2 px-2.5" style={{ position: 'sticky', left: 0, zIndex: 5, background: 'var(--scanner-bg1)', whiteSpace: 'nowrap' }}>
                        <span className="flex items-center gap-1.5">
                          <ChartButton symbol={item.symbol} onClick={(sym) => setChart({ symbol: sym, exchange: 'auto' })} />
                          <span className="text-[11px] font-bold" style={{ color: 'var(--scanner-text)' }}>{item.symbol}</span>
                        </span>
                      </td>
                      {/* Name */}
                      <td className="py-2 px-2.5 text-[10px] text-right" style={{ color: 'var(--scanner-text3)', maxWidth: 100 }}>
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{item.name}</span>
                      </td>
                      {/* Price */}
                      <td className="py-2 px-2.5 text-[11px] font-semibold tabular-nums text-right" style={{ color: 'var(--scanner-text)' }} title={item.live && item.high24h != null ? `OKX 24h: H ${fmtDollarPrice(item.high24h)} · L ${fmtDollarPrice(item.low24h)}` : undefined}>
                        {fmtDollarPrice(item.price)}
                      </td>
                      {/* 20D sparkline */}
                      <td className="py-1.5 px-2.5 text-right">
                        <MiniSparkline data={item.sparkline?.slice(-20)} />
                      </td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.ret1d) }}>{fmtPct(item.ret1d)}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.ret5d) }}>{fmtPct(item.ret5d)}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.ret20d) }}>{fmtPct(item.ret20d)}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.ret60d) }}>{fmtPct(item.ret60d)}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.distMa20 != null ? item.distMa20 / 100 : null) }}>{fmtPctRaw(item.distMa20)}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.distMa50 != null ? item.distMa50 / 100 : null) }}>{fmtPctRaw(item.distMa50)}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: 'var(--scanner-text2)' }}>{item.atrExt50ma != null ? item.atrExt50ma.toFixed(1) : '—'}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: rsiColor(item.rsi14) }}>{item.rsi14 != null ? item.rsi14.toFixed(0) : '—'}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px]" style={{ color: retColor(item.pctFrom52wHigh != null ? item.pctFrom52wHigh / 100 : null) }}>{item.pctFrom52wHigh != null ? fmtPctRaw(item.pctFrom52wHigh) : '—'}</span></td>
                      <td className="py-2 px-2.5 text-right"><span className="tabular-nums text-[10px] font-semibold" style={{ color: retColor(item.rs_qqq_20d != null ? item.rs_qqq_20d / 100 : null) }}>{item.rs_qqq_20d != null ? fmtPctRaw(item.rs_qqq_20d) : '—'}</span></td>
                      {/* Src */}
                      <td className="py-2 px-2.5 text-right">
                        <span className="text-[8px] px-1 py-0.5 rounded" style={{
                          background: 'var(--scanner-bg3, rgba(22,22,30,1))',
                          color: item.live ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                        }} title={item.live
                          ? `Live via OKX ${item.okxInstId || 'USDT perp'} — price + 24h move; indicators from snapshot`
                          : `Data source: ${item.dataSource}`}>{sourceLabel(item.dataSource)}</span>
                      </td>
                      {/* Cat */}
                      <td className="py-2 px-2.5 text-right">
                        <span className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>{item.category}</span>
                      </td>
                      {/* Remove */}
                      <td className="py-2 px-1.5 text-right">
                        <RemoveButton onClick={() => handleRemove(item.symbol)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Unrecognized symbols strip ───────────────────────────────────── */}
      {classified.unknown.length > 0 && symbols.length > 0 && (
        <div className="mb-2 flex items-center gap-2 flex-wrap text-[9px]" style={{ color: 'var(--scanner-text3)' }}>
          <span style={{ color: 'var(--scanner-accent)' }}>⚠ Not recognized:</span>
          {classified.unknown.map(sym => (
            <span key={sym} className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
              {sym}
              <button onClick={() => handleRemove(sym)} title="Remove" style={{ background: 'none', border: 'none', color: 'var(--scanner-text3)', cursor: 'pointer', padding: 0 }}>×</button>
            </span>
          ))}
          <span className="opacity-60">(not in the crypto or tradfi universes — kept in your list, remove to clean up)</span>
        </div>
      )}

      {/* ── TradingView chart sheet (same as CryptoTab) ──────────────────── */}
      <Sheet open={!!chart} onOpenChange={(open) => !open && setChart(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl p-0 flex flex-col"
          style={{ background: 'var(--scanner-bg)', border: 'none', overflow: 'hidden', maxWidth: '672px' }}
        >
          <SheetHeader className="p-4 border-b flex-shrink-0" style={{ borderColor: 'var(--scanner-border)' }}>
            <SheetTitle style={{ color: 'var(--scanner-text)' }}>
              {chart?.symbol} · 1D
            </SheetTitle>
          </SheetHeader>
          <div className="tradingview-chart-container flex-1" style={{ minHeight: '300px', position: 'relative' }}>
            {chart && (
              <TradingViewChart
                symbol={chart.symbol}
                exchange={chart.exchange}
                timeframe="1D"
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
