import React, { useState, useRef, useCallback, useEffect } from 'react';
import ScannerHeader from '@/components/scanner/ScannerHeader';
import ScannerControls from '@/components/scanner/ScannerControls';
import ProgressBar from '@/components/scanner/ProgressBar';
import ResultsTable from '@/components/scanner/ResultsTable';
import StatusBar from '@/components/scanner/StatusBar';
import MassiveApiKeyInput from '@/components/scanner/MassiveApiKeyInput';
import TradingViewChart from '@/components/scanner/TradingViewChart';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { runScan } from '@/lib/scanner/scanEngine';

const STORAGE_KEY = 'trendscan_scanner_settings';

const DEFAULT_SETTINGS = {
  fastType: 'ema',
  emaFast: 21,
  vwapFastDays: 3,
  midType: 'ema',
  emaMid: 100,
  vwapMidDays: 14,
  slowType: 'vwap',
  emaSlow: 200,
  vwapDays: 30,
  exchange: 'hyperliquid',
  timeframe: '4H',
  concurrency: 10,
  // Filters
  minVolume: 0,        // 0 = no filter, otherwise USD value (e.g. 1000000 = $1M min)
  minMarketCap: 0,      // 0 = no filter, otherwise USD value (e.g. 10000000 = $10M min)

  // NEW — explicit enable/disable per filter
  priceAboveSlowEnabled: true,   // gates: price > slow
  fastAboveMidEnabled: true,     // gates: fast > mid
  minVolumeEnabled: true,        // gates: volume24h >= minVolume (also still needs minVolume > 0)
  minMarketCapEnabled: true,     // gates: marketCap >= minMarketCap (also still needs minMarketCap > 0)

  // NEW — RSI range filter
  rsiEnabled: false,             // default OFF — new filter, don't change existing scan behavior for anyone
  rsiPeriod: 14,
  rsiTimeframe: '1D',            // separate timeframe for RSI (default daily — most common RSI usage)
  rsiMin: 0,
  rsiMax: 100,

  // Phase 2 — chain + sector filters (default: no filter)
  chainFilter: 'All',            // 'All' | 'Native' | 'Ethereum' | 'Solana' | 'BNB' | etc.
  sectorFilter: 'All',           // 'All' | 'defi' | 'ai-agents' | 'memes' | etc. (CMC tag slugs)

  // Phase 1c — max supply filter (0 = no filter)
  maxSupplyFilter: 0,            // minimum max supply (filters out inflationary coins with null maxSupply)
};

export default function Scanner() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SETTINGS;
  });

  // Save settings to localStorage whenever they change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0, matched: 0, message: '—' });
  const [results, setResults] = useState(() => {
    // Restore last scan results from sessionStorage so navigating away
    // and back doesn't wipe the page.
    try {
      const saved = sessionStorage.getItem('trendscan_scanner_results');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [scanMeta, setScanMeta] = useState(() => {
    try {
      const saved = sessionStorage.getItem('trendscan_scanner_meta');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { updatedAt: null, duration: null };
  });
  const [error, setError] = useState(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const throttleRef = useRef(null);

  // Persist scan results to sessionStorage whenever they change
  useEffect(() => {
    try {
      if (results.length > 0) {
        sessionStorage.setItem('trendscan_scanner_results', JSON.stringify(results));
      } else {
        sessionStorage.removeItem('trendscan_scanner_results');
      }
    } catch {}
  }, [results]);

  // Persist scan metadata to sessionStorage
  useEffect(() => {
    try {
      if (scanMeta.updatedAt) {
        sessionStorage.setItem('trendscan_scanner_meta', JSON.stringify(scanMeta));
      }
    } catch {}
  }, [scanMeta]);

  // Massive API key check removed — 'auto' default uses free sources via the resolver.
  // Modal can still be triggered manually from ScannerControls if user wants Massive/Polygon.

  const handleProgress = useCallback((p) => {
    setStatus(p.phase);
    setProgress({
      done: p.done || 0,
      total: p.total || 0,
      matched: p.matched || 0,
      message: p.message || `${p.done || 0}/${p.total || '—'} scanned`
    });

    // Handle completion FIRST — must not be skipped by the throttle below.
    // If the complete event arrives within 200ms of the last progress update
    // (common for fast scans), the throttle early-return would skip this block.
    if (p.phase === 'complete') {
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
      setResults(p.results);
      setScanMeta({ updatedAt: p.updatedAt, duration: p.duration });
      return;
    }

    if (p.results) {
      // Throttle result updates to ~5fps
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
      }, 200);
      setResults([...p.results]);
    }
  }, []);

  const startScan = useCallback(async () => {
    if (isScanning) return;
    setIsScanning(true);
    setError(null);
    setResults([]);
    setProgress({ done: 0, total: 0, matched: 0, message: '—' });

    try {
      await runScan(settings, handleProgress);
    } catch (err) {
      setStatus('error');
      setError(err.message);
      setProgress(prev => ({ ...prev, message: err.message }));
    } finally {
      setIsScanning(false);
    }
  }, [settings, isScanning, handleProgress]);

  // No auto-scan — wait for manual user trigger

  return (
    <div
      className="min-h-screen pb-16 font-mono"
      style={{
        background: 'var(--scanner-bg)',
        color: 'var(--scanner-text)'
      }}
    >
      <ScannerHeader settings={settings} scanMeta={scanMeta} />
      <ScannerControls
        settings={settings}
        onSettingsChange={setSettings}
        isScanning={isScanning}
        onScan={startScan}
      />
      <ProgressBar progress={progress} status={status} />

      {error && (
        <div className="mx-5 md:mx-8 mt-3 px-3.5 py-2.5 text-[11px] tracking-wide" style={{
          background: 'rgba(255,68,68,0.05)',
          border: '1px solid rgba(255,68,68,0.2)',
          color: 'var(--scanner-red)'
        }}>
          ⚠ &nbsp;{error}
        </div>
      )}

      <ResultsTable results={results} settings={settings} isScanning={isScanning} hasScanned={status !== 'idle'} onSelectRow={setSelectedRow} />
      <StatusBar settings={settings} />

      {showApiKeyModal && (
        <MassiveApiKeyInput onClose={() => setShowApiKeyModal(false)} />
      )}

      <Sheet open={!!selectedRow} onOpenChange={(open) => !open && setSelectedRow(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl p-0 flex flex-col"
          style={{ background: 'var(--scanner-bg)', border: 'none', overflow: 'hidden', maxWidth: '672px' }}
        >
          <SheetHeader className="p-4 border-b flex-shrink-0" style={{ borderColor: 'var(--scanner-border)' }}>
            <SheetTitle style={{ color: 'var(--scanner-text)' }}>
              {selectedRow?.symbol} · {settings.timeframe}
            </SheetTitle>
          </SheetHeader>
          <div className="tradingview-chart-container flex-1" style={{ minHeight: '300px', position: 'relative' }}>
            {selectedRow && (
              <TradingViewChart
                symbol={selectedRow.symbol}
                exchange={settings.exchange}
                timeframe={settings.timeframe}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}