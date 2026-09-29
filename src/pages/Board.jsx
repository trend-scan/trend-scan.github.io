import React, { useState, useCallback, useEffect, useRef } from 'react';
import BoardHeader from '@/components/board/BoardHeader';
import ScrollingTicker from '@/components/board/ScrollingTicker';
import DailyBoard from '@/components/board/DailyBoard';
import CryptoTab from '@/components/board/CryptoTab';
import ThemesTab from '@/components/board/ThemesTab';
import BreadthTab from '@/components/board/BreadthTab';
import ExtensionTab from '@/components/board/ExtensionTab';
import MomentumTab from '@/components/board/MomentumTab';
import MomentumScanTab from '@/components/board/MomentumScanTab';
import MacroTab from '@/components/board/MacroTab';
import LeveredETFTab from '@/components/board/LeveredETFTab';
import ThemeScoresTab from '@/components/board/ThemeScoresTab';
import EtfPulseTab from '@/components/board/EtfPulseTab';
import ScannersTab from '@/components/board/ScannersTab';
import WatchlistTab from '@/components/board/WatchlistTab';
import MassiveApiKeyInput from '@/components/scanner/MassiveApiKeyInput';
import FactorMonitor from '@/components/board/FactorMonitor';
import QuickViewBar from '@/components/board/QuickViewBar';
import BoardToolbar from '@/components/board/BoardToolbar';
import FreshnessBanner from '@/components/FreshnessBanner';
import { runBoardAnalysis } from '@/lib/board/boardEngine';
import { fetchTradMarketData, buildTradDataFromSnapshot, rebuildTradDataFromFreshSnapshot } from '@/lib/board/traditionalMarkets';
import { fetchAllTickers as fetchHyperliquidTickers } from '@/lib/scanner/sources/hyperliquid';
import { getGloballyBlockedSources } from '@/lib/scanner/sourceResolver';

// Two-row tab layout: crypto tabs on row 1, tradfi tabs on row 2.
// Row 1 (indices 0-6): Watchlist, Daily, Crypto, Momentum, Themes, Breadth, Factor Monitor
// Row 2 (indices 7-11): TradFi, Theme Scores, ETF Pulse, Scanners, Levered ETFs
// Watchlist (index 0) renders WITHOUT board scan data — it fetches its own
// live/snapshot data (watchlistEngine) and persists symbols in localStorage.
const CRYPTO_TABS = ['Watchlist', 'Daily', 'Crypto', 'Momentum', 'Themes', 'Breadth', 'Factor Monitor'];
const TRADFI_TABS = ['TradFi', 'Theme Scores', 'ETF Pulse', 'Scanners', 'Levered ETFs'];
const ALL_TABS = [...CRYPTO_TABS, ...TRADFI_TABS];
const CRYPTO_TAB_COUNT = CRYPTO_TABS.length; // 7 — first index of tradfi row
const WATCHLIST_TAB = 0; // activeTab index of the Watchlist (data-independent)

const DEFAULT_EXCHANGE = 'auto';

export default function Board() {
  const [activeTab, setActiveTab] = useState(0);
  const [exchange, setExchange] = useState(() => {
    try {
      const saved = localStorage.getItem('trendscan_board_exchange');
      if (saved) return saved;
    } catch {}
    return DEFAULT_EXCHANGE;
  });

  // Save exchange to localStorage when it changes
  useEffect(() => {
    try { localStorage.setItem('trendscan_board_exchange', exchange); } catch {}
  }, [exchange]);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState({ phase: 'idle', message: 'Press Refresh to load data', done: undefined, total: undefined });
  const [data, setData] = useState(() => {
    // Restore last board data from sessionStorage so navigating away
    // and back doesn't wipe the page.
    try {
      const saved = sessionStorage.getItem('trendscan_board_data');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const [error, setError] = useState(null);
  const [tradData, setTradData] = useState(null);
  const [tradLoading, setTradLoading] = useState(false);
  const [tradSnapshotLoading, setTradSnapshotLoading] = useState(true); // true until snapshot fetch resolves
  const [tradDataSource, setTradDataSource] = useState('');  // 'snapshot' or 'live'
  const [tradAutoRefreshed, setTradAutoRefreshed] = useState(false); // tracks if auto-refresh has fired
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const apiKeyChecked = useRef(false);
  const hasLoaded = useRef(false);

  // Extreme OI — fetched independently of the board candle scan.
  // Only needs Hyperliquid tickers (OI + funding) + snapshot market caps.
  // This ensures the card populates for every user on page load, even if
  // they never click Refresh to run the full board analysis.
  const [extremeOI, setExtremeOI] = useState([]);

  // Fetch snapshot.json for signal_metrics + regime_history (macro quadrant)
  // These are server-side computed and available instantly from the snapshot.
  const [snapshotData, setSnapshotData] = useState(null);
  const snapshotRef = useRef(null);
  snapshotRef.current = snapshotData;
  useEffect(() => {
    fetch('/snapshot.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => setSnapshotData(d))
      .catch(() => {});
  }, []);

  // ── Extreme OI: fetch independently of the board candle scan ──────────────
  // Runs when snapshotData loads (provides market caps). Fetches Hyperliquid
  // tickers (OI + funding) in a single bulk call. Computes OI/MC ratio for
  // every asset and takes the top 5. Does NOT depend on runBoardAnalysis.
  useEffect(() => {
    if (!snapshotData) return;
    let cancelled = false;

    (async () => {
      try {
        // Build market cap map from snapshot
        const mcaps = {};
        const cu = snapshotData?.crypto_universe;
        if (cu) for (const [sym, c] of Object.entries(cu)) if (c.marketCap) mcaps[sym] = c.marketCap;
        const cg = snapshotData?.coingecko_top;
        if (cg) for (const [sym, c] of Object.entries(cg)) if (c.marketCap && !mcaps[sym]) mcaps[sym] = c.marketCap;

        // Fetch Hyperliquid tickers (single bulk call, ~232 assets)
        const hlOIMap = new Map();
        try {
          const hl = await fetchHyperliquidTickers();
          if (hl instanceof Map) {
            for (const [sym, t] of hl) {
              hlOIMap.set(sym, { oiUsd: t.openInterestUsd ?? 0, oiCoin: t.openInterest ?? 0, funding: t.fundingRate ?? null });
            }
          }
        } catch (e) {
          console.warn('[Board] Hyperliquid ticker fetch for Extreme OI failed:', e.message);
        }

        // Fetch OKX OI (batch, ~421 SWAP instruments)
        const okxOIMap = new Map();
        try {
          const res = await fetch('https://www.okx.com/api/v5/public/open-interest?instType=SWAP');
          if (res.ok) {
            const d = await res.json();
            if (d?.code === '0' && Array.isArray(d.data)) {
              for (const item of d.data) {
                const parts = item.instId?.split('-');
                if (!parts || parts.length < 2) continue;
                okxOIMap.set(parts[0], { oiUsd: parseFloat(item.oiUsd || '0'), oiCoin: parseFloat(item.oiCcy || '0') });
              }
            }
          }
        } catch (e) {
          console.warn('[Board] OKX OI fetch failed:', e.message);
        }

        // Fetch Bybit tickers (batch, ~679 USDT perps)
        const bybitOIMap = new Map();
        try {
          const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
          if (res.ok) {
            const d = await res.json();
            if (d?.retCode === 0) {
              for (const item of (d?.result?.list || [])) {
                const sym = item.symbol || '';
                if (!sym.endsWith('USDT')) continue;
                bybitOIMap.set(sym.replace('USDT', ''), {
                  oiUsd: parseFloat(item.openInterestValue || '0'),
                  oiCoin: parseFloat(item.openInterest || '0'),
                  funding: parseFloat(item.fundingRate || '0'),
                });
              }
            }
          }
        } catch (e) {
          console.warn('[Board] Bybit OI fetch failed:', e.message);
        }

        // Fetch Bitget tickers (batch, ~733 USDT perps)
        const bitgetOIMap = new Map();
        try {
          const res = await fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
          if (res.ok) {
            const d = await res.json();
            if (d?.code === '00000') {
              for (const item of (d.data || [])) {
                const sym = item.symbol || '';
                if (!sym.endsWith('USDT')) continue;
                const symbol = sym.replace('USDT', '');
                const oiCoin = parseFloat(item.holdingAmount || '0');
                const price = parseFloat(item.lastPr || '0');
                bitgetOIMap.set(symbol, { oiUsd: oiCoin * price, oiCoin, funding: parseFloat(item.fundingRate || '0') });
              }
            }
          }
        } catch (e) {
          console.warn('[Board] Bitget OI fetch failed:', e.message);
        }

        // Fetch Gate.io contracts (batch, ~857 USDT perps)
        const gateOIMap = new Map();
        try {
          const res = await fetch('https://api.gateio.ws/api/v4/futures/usdt/contracts');
          if (res.ok) {
            const d = await res.json();
            if (Array.isArray(d)) {
              for (const c of d) {
                const name = c.name || '';
                if (!name.endsWith('_USDT')) continue;
                const symbol = name.replace('_USDT', '');
                const ps = parseFloat(c.position_size || '0');
                const qm = parseFloat(c.quanto_multiplier || '1');
                const mp = parseFloat(c.mark_price || '0');
                gateOIMap.set(symbol, { oiUsd: ps * qm * mp, oiCoin: ps * qm, funding: parseFloat(c.funding_rate || '0') });
              }
            }
          }
        } catch (e) {
          console.warn('[Board] Gate.io OI fetch failed:', e.message);
        }

        if (cancelled) return;

        // Binance OI from snapshot (server-side fetched, max 4h stale)
        const binanceOI = snapshotData?.binance_oi || {};

        // Build aggregated OI (SUM across ALL 6 exchanges) + compute OI/MC ratio
        const allSymbols = new Set([...hlOIMap.keys(), ...okxOIMap.keys(), ...bybitOIMap.keys(), ...bitgetOIMap.keys(), ...gateOIMap.keys(), ...Object.keys(binanceOI)]);
        const items = [];
        for (const symbol of allSymbols) {
          const hlOi = hlOIMap.get(symbol)?.oiUsd ?? 0;
          const okxOi = okxOIMap.get(symbol)?.oiUsd ?? 0;
          const bybitOi = bybitOIMap.get(symbol)?.oiUsd ?? 0;
          const bitgetOi = bitgetOIMap.get(symbol)?.oiUsd ?? 0;
          const gateOi = gateOIMap.get(symbol)?.oiUsd ?? 0;
          const binanceOi = binanceOI[symbol]?.oiUsd ?? 0;
          const totalOi = hlOi + okxOi + bybitOi + bitgetOi + gateOi + binanceOi;
          const mcap = mcaps[symbol];
          if (totalOi > 0 && mcap != null && mcap > 0) {
            const funding = hlOIMap.get(symbol)?.funding ?? bybitOIMap.get(symbol)?.funding ?? bitgetOIMap.get(symbol)?.funding ?? gateOIMap.get(symbol)?.funding ?? binanceOI[symbol]?.fundingRate ?? null;
            const fundingAnn = funding != null ? funding * 3 * 365 * 100 : null;
            items.push({
              symbol,
              name: symbol,
              oiUsd: totalOi,
              oiCoin: (hlOIMap.get(symbol)?.oiCoin ?? 0) + (okxOIMap.get(symbol)?.oiCoin ?? 0) + (bybitOIMap.get(symbol)?.oiCoin ?? 0) + (bitgetOIMap.get(symbol)?.oiCoin ?? 0) + (gateOIMap.get(symbol)?.oiCoin ?? 0) + (binanceOI[symbol]?.oiCoin ?? 0),
              marketCap: mcap,
              oiRatio: totalOi / mcap,
              funding,
              fundingAnn,
            });
          }
        }

        // Sort by OI/MC ratio descending, take top 5
        items.sort((a, b) => b.oiRatio - a.oiRatio);
        if (!cancelled) setExtremeOI(items.slice(0, 5));
      } catch (e) {
        console.warn('[Board] Extreme OI computation failed:', e.message);
      }
    })();

    return () => { cancelled = true; };
  }, [snapshotData]);

  // Track which sources are geo-blocked in the user's region (e.g. Binance
  // returns HTTP 451 for US IPs). Display these as small chips so the user
  // understands why coverage is lower than expected without VPN.
  const [blockedSources, setBlockedSources] = useState([]);
  useEffect(() => {
    let mounted = true;
    const update = () => {
      if (mounted) setBlockedSources(getGloballyBlockedSources());
    };
    update();
    // Poll every 15s — blocks expire on their own, but the UI won't re-render
    // unless we re-check. 15s is frequent enough to show newly-blocked sources
    // but not so frequent that it causes unnecessary re-renders.
    const interval = setInterval(update, 15000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const handleProgress = useCallback((p) => {
    setProgress(p);
  }, []);

  // Persist board data to sessionStorage so navigating away and back
  // doesn't wipe the page. Uses sessionStorage (not localStorage) so data
  // is cleared when the browser tab closes — avoids stale data on next visit.
  useEffect(() => {
    try {
      if (data) {
        sessionStorage.setItem('trendscan_board_data', JSON.stringify(data));
      } else {
        sessionStorage.removeItem('trendscan_board_data');
      }
    } catch {}
  }, [data]);

  // Load snapshot data instantly (no API calls — reads from /snapshot.tradfi.json)
  // This gives the TradFi tab immediate data while the live fetch runs in background.
  // The snapshot is pre-baked server-side by build_snapshot.js (fetches Yahoo Finance
  // via the Cloudflare Worker, stores in snapshot.tradfi.json).
  useEffect(() => {
    buildTradDataFromSnapshot().then(snapData => {
      if (snapData) {
        setTradData(snapData);
        setTradDataSource('snapshot');
      }
      setTradSnapshotLoading(false);
    }).catch(() => setTradSnapshotLoading(false));
  }, []);

  // Use a ref to track the latest tradData so the callback doesn't
  // get recreated on every partial update (which would cause the
  // Board's useCallback dependency to fire constantly).
  const tradDataRef = useRef(null);
  tradDataRef.current = tradData;

  const runTradAnalysis = useCallback(async () => {
    setTradLoading(true);
    try {
      // Refresh the tradfi snapshot in the background (non-blocking) so the
      // next loadSnapshotTradfi() call picks up the latest data. We don't
      // await this — the live fetch below will use the existing cached
      // snapshot to seed rawResults, and any newly-fetched snapshot data
      // will be picked up on the next refresh cycle.
      rebuildTradDataFromFreshSnapshot().then(freshSnapData => {
        if (freshSnapData) {
          setTradData(prev => {
            // Only update if we're still in 'snapshot' mode (live fetch hasn't
            // started updating yet). Once live data starts flowing, we don't
            // want to clobber it with a fresh snapshot.
            if (tradDataSource === 'snapshot') return freshSnapData;
            return prev;
          });
        }
      }).catch(() => {});

      // Pass existing tradData (snapshot or previous live) so the fetcher
      // can seed rawResults with it — assets not yet refreshed retain
      // their existing metrics instead of disappearing.
      const result = await fetchTradMarketData(
        undefined,
        (partial) => {
          setTradData(partial);
          setTradDataSource('live');
        },
        tradDataRef.current  // seed with existing data
      );
      setTradData(result);
      setTradDataSource('live');
    } catch (err) {
      console.warn('Trad market fetch failed:', err.message);
      // Keep existing data if available — don't overwrite with null
      if (!tradDataRef.current) setTradData(null);
    } finally {
      setTradLoading(false);
    }
  }, [tradDataSource]);

  /**
   * Re-fetch /snapshot.json (cache-busting) so the Board header's signal
   * metrics, macro quadrant, freshness banner, and global metrics reflect
   * the latest server-side data. Returns the fresh snapshot or null.
   *
   * The 4× daily refresh deploys new snapshots every 6 hours, but the browser
   * HTTP cache (and our in-memory tradfi cache) would otherwise hold stale
   * data indefinitely. This function busts both caches.
   */
  const refreshSnapshotData = useCallback(async () => {
    try {
      const res = await fetch(`/snapshot.json?t=${Date.now()}`);
      if (!res.ok) return null;
      const freshSnap = await res.json();
      setSnapshotData(freshSnap);
      return freshSnap;
    } catch (e) {
      console.warn('Snapshot re-fetch failed:', e.message);
      return null;
    }
  }, []);

  // Auto-refresh: when the user first visits any TradFi tab (indices 7-11:
  // TradFi, Levered ETFs, Theme Scores, ETF Pulse, Scanners) — or the
  // Watchlist tab while it holds tradfi symbols — and we only have snapshot
  // data, kick off the live background refresh automatically.
  const ensureTradfiLive = useCallback(() => {
    if (tradDataSource === 'snapshot' && !tradLoading && !tradAutoRefreshed) {
      setTradAutoRefreshed(true);
      runTradAnalysis();
    }
  }, [tradDataSource, tradLoading, tradAutoRefreshed, runTradAnalysis]);

  useEffect(() => {
    if (activeTab >= CRYPTO_TAB_COUNT && tradDataSource === 'snapshot' && !tradLoading && !tradAutoRefreshed) {
      setTradAutoRefreshed(true);
      runTradAnalysis();
    }
  }, [activeTab, tradDataSource, tradLoading, tradAutoRefreshed, runTradAnalysis]);

  const runAnalysis = useCallback(async (exch = exchange) => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    setProgress({ phase: 'loading', message: 'Refreshing snapshot + live data…', done: undefined, total: undefined });
    try {
      // ── Re-fetch /snapshot.json FIRST (cache-busting) ────────────────────
      // The 4× daily refresh deploys new snapshots every 6 hours, but the
      // browser HTTP cache holds stale data indefinitely. Without this re-fetch,
      // users would have to manually hard-reload the page to pick up a fresh
      // snapshot — which defeats the purpose of the Refresh button.
      //
      // We do NOT await this for the live candle fetch (runBoardAnalysis below)
      // because the live fetch uses exchange APIs (Binance/OKX/etc.), not the
      // snapshot. But we DO want the snapshot data (signal_metrics, regime_history,
      // global_metrics, macro quadrant) to be fresh before we re-render.
      refreshSnapshotData();

      // Pass existing data (from sessionStorage or previous refresh) so the
      // engine can seed rawResults — assets not yet refreshed retain their
      // previous metrics instead of disappearing during the refresh.
      // Build market cap map from snapshot for Extreme OI normalization
      // Use a ref to avoid stale closure — snapshotData may not be in the
      // useCallback dependency array, but snapshotRef.current always has
      // the latest value.
      const snap = snapshotRef.current;
      const snapMcaps = {};
      const cu = snap?.crypto_universe;
      if (cu) {
        for (const [sym, c] of Object.entries(cu)) {
          if (c.marketCap) snapMcaps[sym] = c.marketCap;
        }
      }
      // Also check coingecko_top (top 100 with richer data)
      const cg = snap?.coingecko_top;
      if (cg) {
        for (const [sym, c] of Object.entries(cg)) {
          if (c.marketCap && !snapMcaps[sym]) snapMcaps[sym] = c.marketCap;
        }
      }
      // Pass Binance OI from snapshot (server-side fetched, max 4h stale)
      // Stored under _binanceOI key — boardEngine extracts and removes it
      if (snap?.binance_oi) snapMcaps._binanceOI = snap.binance_oi;

      const result = await runBoardAnalysis(exch, handleProgress, data, snapMcaps);
      setData(result);
      // Kick off tradfi fetch in the background — don't await it.
      // runTradAnalysis also re-fetches /snapshot.tradfi.json (cache-busting)
      // so the TradFi tab picks up fresh OHLCV data too.
      runTradAnalysis();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setProgress(prev => ({ ...prev, phase: 'complete' }));
    }
  }, [exchange, isLoading, handleProgress, runTradAnalysis, refreshSnapshotData, data]);

  // No auto-run — wait for manual user trigger (Refresh button)

  // No auto-refresh — user triggers manually

  // API key modal trigger removed — 'auto' default uses free sources.
  // Kept the ref so existing MassiveApiKeyInput component still imports cleanly;
  // will be triggered manually if user picks 'massive' exchange (now aliased to 'auto').

  const regime           = data?.regime           ?? {};
  const regimeLabel      = data?.regimeLabel       ?? { label: 'MIXED', color: 'neutral' };
  const benchmarks       = data?.benchmarks       ?? [];
  const themes           = data?.themes           ?? [];
  const constituents     = data?.constituents     ?? {};
  const themeRotation    = data?.themeRotation    ?? { climbers: [], fallers: [], lookbackDays: 5 };
  const startingToMove   = data?.startingToMove   ?? [];
  const styleRotation    = data?.styleRotation    ?? [];
  const riskPulse        = data?.riskPulse         ?? [];
  const themeSectorRotation = data?.themeSectorRotation ?? [];
  const tooHot           = data?.tooHot           ?? [];
  const cleanMomentum    = data?.cleanMomentum     ?? [];
  const fading           = data?.fading           ?? [];
  const momentumScan     = data?.momentumScan     ?? { '1W': [], '1M': [], '3M': [], '6M': [] };
  const breadthSeries    = data?.breadthSeries    ?? null;
  const quickView        = data?.quickView        ?? null;

  return (
    <div className="min-h-screen pb-16 font-mono" style={{ background: 'var(--scanner-bg)', color: 'var(--scanner-text)' }}>

      {/* Exchange selector + controls */}
      <div className="px-5 md:px-8 pt-4 pb-0 flex items-center gap-4 flex-wrap">
        <select
          className="font-mono text-[11px] px-2.5 py-1.5 outline-none cursor-pointer"
          style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)', color: 'var(--scanner-text)' }}
          value={exchange}
          onChange={e => setExchange(e.target.value)}
        >
          <option value="auto"          style={{ background: 'var(--scanner-bg2)' }}>Auto (Recommended) ✦</option>
          <option value="coingecko"     style={{ background: 'var(--scanner-bg2)' }}>CoinGecko (Daily)</option>
          <option value="hyperliquid"   style={{ background: 'var(--scanner-bg2)' }}>Hyperliquid (Perps)</option>
          <option value="bybit"         style={{ background: 'var(--scanner-bg2)' }}>Bybit</option>
          <option value="okx_perps"     style={{ background: 'var(--scanner-bg2)' }}>OKX Perps</option>
          <option value="okx"           style={{ background: 'var(--scanner-bg2)' }}>OKX (Spot)</option>
          <option value="kraken"        style={{ background: 'var(--scanner-bg2)' }}>Kraken</option>
          <option value="binance"       style={{ background: 'var(--scanner-bg2)' }}>Binance Spot ⚠ VPN</option>
          <option value="binance_perps" style={{ background: 'var(--scanner-bg2)' }}>Binance Perps ⚠ VPN</option>
        </select>
        <span className="text-[9px] tracking-wider" style={{ color: 'var(--scanner-text3)' }}>
          Universe: {data?.assetCount ?? 0} assets computed
        </span>
        {blockedSources.length > 0 && (
          <span
            className="text-[9px] tracking-wider px-2 py-0.5"
            title={`Sources geo-blocked in this region (HTTP 451). Enable VPN to restore coverage. Auto-retry in ${Math.max(0, ...blockedSources.map(s => s.secondsLeft ?? 0))}s.`}
            style={{
              color: 'var(--scanner-text3)',
              background: 'rgba(255,165,0,0.08)',
              border: '1px solid rgba(255,165,0,0.25)',
              borderRadius: 2,
            }}
          >
            ⚠ Geo-blocked: {blockedSources.map(s => s.sourceId).join(', ')}
            <span className="ml-1 opacity-60">({Math.max(0, ...blockedSources.map(s => s.secondsLeft ?? 0))}s retry)</span>
          </span>
        )}
      </div>

      {/* Scrolling price ticker — live prices from OKX SWAP perps (polls every 15s) */}
      <ScrollingTicker />

      {/* Breadth header strip */}
      <BoardHeader
        regime={regime}
        regimeLabel={regimeLabel}
        updatedAt={data?.updatedAt}
        exchange={exchange}
        isLoading={isLoading}
        onRefresh={() => runAnalysis(exchange)}
        signalMetrics={snapshotData?.signal_metrics}
        macroQuadrant={snapshotData?.regime_history?.[snapshotData.regime_history.length - 1]?.quadrant}
        tradRegime={tradData?.tradRegime}
        globalMetrics={snapshotData?.global_metrics}
        regimeHistory={snapshotData?.regime_history}
      />

      {/* Snapshot freshness banner — alerts when Board header's signal/quadrant
          badges are stale. Board's main content (table) is live scanner data
          and is unaffected, but the header's BTC Signal + Macro quadrant come
          from snapshot.json and go stale if the 4× daily refresh misses. */}
      <FreshnessBanner generatedAt={snapshotData?.generated_at} contextLabel="board" />

      {/* Progress bar */}
      {isLoading && (
        <div className="relative h-0.5" style={{ background: 'var(--scanner-border)' }}>
          <div className="absolute inset-y-0 animate-indeterminate" style={{ background: 'var(--scanner-accent)', width: '30%' }} />
        </div>
      )}

      {/* Status message */}
      {isLoading && (
        <div className="px-5 md:px-8 py-2 text-[10px] tracking-wider" style={{ color: 'var(--scanner-text3)' }}>
          ⟳ {progress.message}
          {progress.done != null && progress.total > 0 && ` (${progress.done}/${progress.total})`}
        </div>
      )}

      {error && (
        <div className="mx-5 md:mx-8 mt-3 px-3.5 py-2.5 text-[11px]" style={{
          background: 'rgba(255,68,68,0.05)', border: '1px solid rgba(255,68,68,0.2)', color: 'var(--scanner-red)'
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Quick View Bar — 5 market summary metrics (from board scan) + Extreme OI (independent fetch) */}
      <QuickViewBar quickView={{ ...(quickView || {}), extremeOI }} />

      {/* Tab bar — two rows: crypto (top) + tradfi (bottom) + toolbar */}
      <div className="px-5 md:px-8 mt-4">
        {/* Row 1: Crypto tabs + toolbar */}
        <div className="flex items-end justify-between" style={{ borderBottom: '1px solid var(--scanner-border2)' }}>
          <div className="flex items-end gap-0">
            {CRYPTO_TABS.map((tab, i) => (
              <button
                key={tab}
                className="font-mono text-[10px] font-semibold tracking-[0.1em] uppercase px-4 py-2.5 transition-all"
                style={{
                  background: activeTab === i ? 'var(--scanner-bg2)' : 'transparent',
                  color: activeTab === i ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                  border: 'none',
                  borderBottom: activeTab === i ? '2px solid var(--scanner-accent)' : '2px solid transparent',
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
                onClick={() => setActiveTab(i)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="pb-2">
            <BoardToolbar />
          </div>
        </div>
        {/* Row 2: TradFi tabs */}
        <div className="flex items-end" style={{ borderBottom: '1px solid var(--scanner-border2)' }}>
          {TRADFI_TABS.map((tab, i) => {
            const idx = CRYPTO_TAB_COUNT + i;
            return (
              <button
                key={tab}
                className="font-mono text-[10px] font-semibold tracking-[0.1em] uppercase px-4 py-2.5 transition-all"
                style={{
                  background: activeTab === idx ? 'var(--scanner-bg2)' : 'transparent',
                  color: activeTab === idx ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                  border: 'none',
                  borderBottom: activeTab === idx ? '2px solid var(--scanner-accent)' : '2px solid transparent',
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
                onClick={() => setActiveTab(idx)}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      {/* Watchlist tab is data-independent — it renders even before the user
          presses Refresh (it fetches its own live + snapshot data). */}
      {activeTab === WATCHLIST_TAB && (
        <WatchlistTab
          snapshotData={snapshotData}
          tradData={tradData}
          tradLoading={tradLoading}
          onEnsureTradfiLive={ensureTradfiLive}
        />
      )}

      {!isLoading && activeTab !== WATCHLIST_TAB && !data && !error && (
        <div className="text-center py-24 font-mono">
          <div className="text-4xl mb-4 opacity-20">◈</div>
          <div className="text-sm mb-2" style={{ color: 'var(--scanner-text2)' }}>No data loaded</div>
          <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>Click Refresh to fetch market data</div>
        </div>
      )}

      {data && (
        <>
          {/* Row 1: Crypto tabs (indices 1-6) */}
          {activeTab === 1 && (
            <DailyBoard
              themes={themes}
              benchmarks={benchmarks}
              themeRotation={themeRotation}
              startingToMove={startingToMove}
              styleRotation={styleRotation}
              riskPulse={riskPulse}
              themeSectorRotation={themeSectorRotation}
            />
          )}
          {activeTab === 2 && (
            <CryptoTab cryptoAssets={data?.cryptoAssets} />
          )}
          {activeTab === 3 && (
            <>
              <MomentumScanTab momentumScan={momentumScan} />
              <MomentumTab cleanMomentum={cleanMomentum} />
              <ExtensionTab tooHot={tooHot} fading={fading} />
            </>
          )}
          {activeTab === 4 && <ThemesTab themes={themes} constituents={constituents} />}
          {activeTab === 5 && <BreadthTab breadthSeries={breadthSeries} />}
          {activeTab === 6 && <FactorMonitor />}

          {/* Row 2: TradFi tabs (indices 7-11) */}
          {activeTab === 7 && (
            <MacroTab
              tradData={tradData}
              isLoading={tradLoading}
              snapshotLoading={tradSnapshotLoading}
              onRefresh={runTradAnalysis}
            />
          )}
          {activeTab === 8 && <ThemeScoresTab tradData={tradData} isLoading={tradLoading} />}
          {activeTab === 9 && <EtfPulseTab tradData={tradData} isLoading={tradLoading} />}
          {activeTab === 10 && <ScannersTab tradData={tradData} isLoading={tradLoading} breadthHistory={snapshotData?.tradfi_breadth_history} />}
          {activeTab === 11 && <LeveredETFTab tradData={tradData} isLoading={tradLoading} />}
        </>
      )}

      {showApiKeyModal && (
        <MassiveApiKeyInput onClose={() => setShowApiKeyModal(false)} />
      )}
    </div>
  );
}