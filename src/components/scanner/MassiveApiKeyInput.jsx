import React, { useState } from 'react';

// Simple API key input for Massive
export default function MassiveApiKeyInput({ onClose }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('MASSIVE_API_KEY') || '');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (apiKey.trim()) {
      localStorage.setItem('MASSIVE_API_KEY', apiKey.trim());
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        if (onClose) onClose();
      }, 1000);
    }
  };

  const handleClear = () => {
    localStorage.removeItem('MASSIVE_API_KEY');
    setApiKey('');
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      if (onClose) onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 p-6 rounded-lg" style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold tracking-wide" style={{ color: 'var(--scanner-text)' }}>
            Massive API Key
          </h3>
          {onClose && (
            <button
              onClick={onClose}
              className="text-lg leading-none"
              style={{ color: 'var(--scanner-text3)' }}
            >
              ×
            </button>
          )}
        </div>

        <p className="text-[11px] mb-4" style={{ color: 'var(--scanner-text3)' }}>
          Enter your Massive (Polygon.io) API key to enable crypto market data from Massive.
          Get your key at <span style={{ color: 'var(--scanner-accent)' }}>massive.com/dashboard/keys</span>
        </p>

        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="Enter API key..."
          className="w-full px-3 py-2 text-[12px] font-mono rounded outline-none"
          style={{
            background: 'var(--scanner-bg)',
            border: '1px solid var(--scanner-border2)',
            color: 'var(--scanner-text)',
          }}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
        />

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleSave}
            className="flex-1 py-2 text-[11px] font-bold tracking-wide rounded transition-all"
            style={{
              background: saved ? 'var(--scanner-green)' : 'var(--scanner-accent)',
              color: saved ? '#000' : '#000',
              cursor: 'pointer',
              border: 'none',
            }}
          >
            {saved ? '✓ Saved!' : 'Save Key'}
          </button>

          {apiKey && (
            <button
              onClick={handleClear}
              className="px-4 py-2 text-[11px] font-medium tracking-wide rounded transition-all"
              style={{
                background: 'transparent',
                border: '1px solid var(--scanner-border2)',
                color: 'var(--scanner-text3)',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>

        <p className="text-[9px] mt-3 text-center" style={{ color: 'var(--scanner-text3)' }}>
          Key is stored locally in your browser (localStorage)
        </p>
      </div>
    </div>
  );
}