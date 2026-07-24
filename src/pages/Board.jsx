import React, { useState, useCallback, useEffect, useRef } from 'react';
import BoardHeader from '@/components/board/BoardHeader';
import DailyBoard from '@/components/board/DailyBoard';
import ThemesTab from '@/components/board/ThemesTab';
import BreadthTab from '@/components/board/BreadthTab';
import ExtensionTab from '@/components/board/ExtensionTab';
import MomentumTab from '@/components/board/MomentumTab';
import MomentumScanTab from '@/components/board/MomentumScanTab';
import MacroTab from '@/components/board/MacroTab';
import MassiveApiKeyInput from '@/components/scanner/MassiveApiKeyInput';
import FactorMonitor from '@/components/board/FactorMonitor';
import QuickViewBar from '@/components/board/QuickViewBar';
import FreshnessBanner from '@/components/FreshnessBanner';
import { runBoardAnalysis } from '@/lib/board/boardEngine';
import { fetchTradMarketData, buildTradDataFromSnapshot } from '@/lib/board/traditionalMarkets';
import { getGloballyBlockedSources } from '@/lib/scanner/sourceResolver';

// TradFi moved to position 1 (right after Daily) so cross-asset breadth
// comparison is the first thing users see when they explore beyond Daily.
// Indices/sectors/commodities/FX/rates (~80 assets) — same Yahoo data the
// BoardHeader's new TradFi breadth spectrum uses.
const TABS = ['Daily', 'TradFi', 'Themes', 'Breadth', 'Momentum Scan', 'Momentum', 'Extension', 'Factor Monitor'];

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

  // Fetch snapshot.json for signal_metrics + regime_history (macro quadrant)
  // These are server-side computed and available instantly from the snapshot.
  const [snapshotData, setSnapshotData] = useState(null);
  useEffect(() => {
    fetch('/snapshot.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => setSnapshotData(d))
      .catch(() => {});
  }, []);

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
  }, []);

  // Auto-refresh: when the user first visits the TradFi tab (activeTab === 1)
  // and we only have snapshot data (not yet refreshed with live data), kick
  // off the live background refresh automatically. This gives the user the
  // instant snapshot view, then seamlessly updates with live data as it arrives.
  useEffect(() => {
    if (activeTab === 1 && tradDataSource === 'snapshot' && !tradLoading && !tradAutoRefreshed) {
      setTradAutoRefreshed(true);
      runTradAnalysis();
    }
  }, [activeTab, tradDataSource, tradLoading, tradAutoRefreshed, runTradAnalysis]);

  const runAnalysis = useCallback(async (exch = exchange) => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    setProgress({ phase: 'loading', message: 'Starting…', done: undefined, total: undefined });
    try {
      // Pass existing data (from sessionStorage or previous refresh) so the
      // engine can seed rawResults — assets not yet refreshed retain their
      // previous metrics instead of disappearing during the refresh.
      const result = await runBoardAnalysis(exch, handleProgress, data);
      setData(result);
      // Kick off tradfi fetch in the background — don't await it
      runTradAnalysis();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setProgress(prev => ({ ...prev, phase: 'complete' }));
    }
  }, [exchange, isLoading, handleProgress, runTradAnalysis, data]);

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
            title={`Sources geo-blocked in this region (HTTP 451). Enable VPN to restore coverage. Auto-retry in ${blockedSources[0]?.secondsLeft ?? 0}s.`}
            style={{
              color: 'var(--scanner-text3)',
              background: 'rgba(255,165,0,0.08)',
              border: '1px solid rgba(255,165,0,0.25)',
              borderRadius: 2,
            }}
          >
            ⚠ Geo-blocked: {blockedSources.map(s => s.sourceId).join(', ')}
            <span className="ml-1 opacity-60">({blockedSources[0]?.secondsLeft ?? 0}s retry)</span>
          </span>
        )}
      </div>

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

      {/* Quick View Bar — 5 market summary metrics */}
      {quickView && <QuickViewBar quickView={quickView} />}

      {/* Tab bar */}
      <div className="flex items-end gap-0 px-5 md:px-8 mt-4" style={{ borderBottom: '1px solid var(--scanner-border2)' }}>
        {TABS.map((tab, i) => (
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

      {/* Tab content */}
      {!isLoading && !data && !error && (
        <div className="text-center py-24 font-mono">
          <div className="text-4xl mb-4 opacity-20">◈</div>
          <div className="text-sm mb-2" style={{ color: 'var(--scanner-text2)' }}>No data loaded</div>
          <div className="text-[11px]" style={{ color: 'var(--scanner-text3)' }}>Click Refresh to fetch market data</div>
        </div>
      )}

      {data && (
        <>
          {activeTab === 0 && (
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
          {activeTab === 1 && <MacroTab tradData={tradData} isLoading={tradLoading} snapshotLoading={tradSnapshotLoading} onRefresh={runTradAnalysis} />}
          {activeTab === 2 && <ThemesTab themes={themes} constituents={constituents} />}
          {activeTab === 3 && <BreadthTab breadthSeries={breadthSeries} />}
          {activeTab === 4 && <MomentumScanTab momentumScan={momentumScan} />}
          {activeTab === 5 && <MomentumTab cleanMomentum={cleanMomentum} />}
          {activeTab === 6 && <ExtensionTab tooHot={tooHot} fading={fading} />}
          {activeTab === 7 && <FactorMonitor />}
        </>
      )}

      {showApiKeyModal && (
        <MassiveApiKeyInput onClose={() => setShowApiKeyModal(false)} />
      )}
    </div>
  );
}