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
import { runBoardAnalysis } from '@/lib/board/boardEngine';
import { fetchTradMarketData } from '@/lib/board/traditionalMarkets';

const TABS = ['Daily', 'Themes', 'Breadth', 'Momentum Scan', 'Momentum', 'Extension', 'Macro', 'Factor Monitor'];

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
  const [progress, setProgress] = useState({ phase: 'idle', message: 'Press Refresh to load data' });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tradData, setTradData] = useState(null);
  const [tradLoading, setTradLoading] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const apiKeyChecked = useRef(false);
  const hasLoaded = useRef(false);

  const handleProgress = useCallback((p) => {
    setProgress(p);
  }, []);

  const runTradAnalysis = useCallback(async () => {
    // Independent of board isLoading — uses its own tradLoading state
    setTradLoading(true);
    try {
      const result = await fetchTradMarketData();
      setTradData(result);
    } catch (err) {
      console.warn('Trad market fetch failed:', err.message);
      // Set empty data so Macro tab shows "no data" instead of infinite loading
      setTradData(null);
    } finally {
      setTradLoading(false);
    }
  }, []);

  const runAnalysis = useCallback(async (exch = exchange) => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    setProgress({ phase: 'loading', message: 'Starting…' });
    try {
      const [result] = await Promise.all([
        runBoardAnalysis(exch, handleProgress),
        runTradAnalysis(),
      ]);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setProgress(prev => ({ ...prev, phase: 'complete' }));
    }
  }, [exchange, isLoading, handleProgress, runTradAnalysis]);

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
  const styleRotation    = data?.styleRotation    ?? [];
  const riskPulse        = data?.riskPulse         ?? [];
  const themeSectorRotation = data?.themeSectorRotation ?? [];
  const tooHot           = data?.tooHot           ?? [];
  const cleanMomentum    = data?.cleanMomentum     ?? [];
  const fading           = data?.fading           ?? [];
  const momentumScan     = data?.momentumScan     ?? { '1W': [], '1M': [], '3M': [], '6M': [] };
  const breadthSeries    = data?.breadthSeries    ?? null;

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
      </div>

      {/* Breadth header strip */}
      <BoardHeader
        regime={regime}
        regimeLabel={regimeLabel}
        updatedAt={data?.updatedAt}
        exchange={exchange}
        isLoading={isLoading}
        onRefresh={() => runAnalysis(exchange)}
      />

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
              styleRotation={styleRotation}
              riskPulse={riskPulse}
              themeSectorRotation={themeSectorRotation}
            />
          )}
          {activeTab === 1 && <ThemesTab themes={themes} constituents={constituents} />}
          {activeTab === 2 && <BreadthTab breadthSeries={breadthSeries} />}
          {activeTab === 3 && <MomentumScanTab momentumScan={momentumScan} />}
          {activeTab === 4 && <MomentumTab cleanMomentum={cleanMomentum} />}
          {activeTab === 5 && <ExtensionTab tooHot={tooHot} fading={fading} />}
          {activeTab === 6 && <MacroTab tradData={tradData} isLoading={tradLoading} onRefresh={runTradAnalysis} />}
          {activeTab === 7 && <FactorMonitor />}
        </>
      )}

      {showApiKeyModal && (
        <MassiveApiKeyInput onClose={() => setShowApiKeyModal(false)} />
      )}
    </div>
  );
}