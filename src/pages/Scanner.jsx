import React, { useState, useRef, useCallback, useEffect } from 'react';
import ScannerHeader from '@/components/scanner/ScannerHeader';
import ScannerControls from '@/components/scanner/ScannerControls';
import ProgressBar from '@/components/scanner/ProgressBar';
import ResultsTable from '@/components/scanner/ResultsTable';
import StatusBar from '@/components/scanner/StatusBar';
import MassiveApiKeyInput from '@/components/scanner/MassiveApiKeyInput';
import { runScan } from '@/lib/scanner/scanEngine';

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
  concurrency: 7,
  // Filters
  minVolume: 0,        // 0 = no filter, otherwise USD value (e.g. 1000000 = $1M min)
  minMarketCap: 0,      // 0 = no filter, otherwise USD value (e.g. 10000000 = $10M min)
};

export default function Scanner() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0, matched: 0, message: '—' });
  const [results, setResults] = useState([]);
  const [scanMeta, setScanMeta] = useState({ updatedAt: null, duration: null });
  const [error, setError] = useState(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const throttleRef = useRef(null);

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

    if (p.results) {
      // Throttle result updates to ~5fps
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
      }, 200);
      setResults([...p.results]);
    }

    if (p.phase === 'complete') {
      setResults(p.results);
      setScanMeta({ updatedAt: p.updatedAt, duration: p.duration });
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

      <ResultsTable results={results} settings={settings} isScanning={isScanning} />
      <StatusBar settings={settings} />

      {showApiKeyModal && (
        <MassiveApiKeyInput onClose={() => setShowApiKeyModal(false)} />
      )}
    </div>
  );
}