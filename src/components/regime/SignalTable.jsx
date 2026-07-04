/**
 * SignalTable - Shows Ultra6 and OB1 signal details
 */

import React from 'react';

function SignalDot({ isOn }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mr-1"
      style={{
        background: isOn ? 'var(--scanner-green)' : 'var(--scanner-text3)',
        opacity: isOn ? 1 : 0.3,
      }}
    />
  );
}

function SignalRow({ name, isOn, score }) {
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded text-[9px]"
      style={{
        background: isOn ? 'rgba(0,230,118,0.04)' : 'transparent',
      }}
    >
      <div className="flex items-center">
        <SignalDot isOn={isOn} />
        <span style={{ color: isOn ? 'var(--scanner-text)' : 'var(--scanner-text3)' }}>
          {name}
        </span>
      </div>
      <span
        className="font-bold"
        style={{ color: isOn ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}
      >
        {isOn ? '✓' : '✗'}
      </span>
    </div>
  );
}

export default function SignalTable({ regime }) {
  if (!regime) {
    return (
      <div
        className="rounded-lg p-4 border"
        style={{ background: 'var(--scanner-bg2)', borderColor: 'var(--scanner-border2)' }}
      >
        <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--scanner-text3)' }}>
          SIGNAL DETAILS
        </div>
        <div className="text-center py-8" style={{ color: 'var(--scanner-text3)' }}>
          Loading signals...
        </div>
      </div>
    );
  }

  const {
    ultra6 = { signals: {}, score: 0, on: false },
    ob1 = { signals: {}, score: 0, on: false },
    core9Score = 0,
    allocation = {},
    btcPrice = [],
  } = regime;

  // Convert signals object to array for display
  const ultra6List = Object.entries(ultra6.signals || {}).map(([key, val]) => ({
    name: formatSignalName(key),
    isOn: val === true,
  }));

  const ob1List = Object.entries(ob1.signals || {}).map(([key, val]) => ({
    name: formatSignalName(key),
    isOn: val === true,
  }));

  const onCount6 = ultra6List.filter(s => s.isOn).length;
  const onCountOB = ob1List.filter(s => s.isOn).length;

  // BTC above MA50
  const btcMA50 = btcPrice.length > 50
    ? btcPrice.slice(-50).reduce((a, b) => a + b, 0) / 50
    : 0;
  const btcAboveMA = btcPrice.length > 0 && btcPrice[btcPrice.length - 1] > btcMA50;

  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--scanner-bg2)', border: '1px solid var(--scanner-border2)' }}
    >
      {/* Header */}
      <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-4" style={{ color: 'var(--scanner-text3)' }}>
        SIGNAL DETAILS
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Ultra6 Column */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold" style={{ color: 'var(--scanner-accent)' }}>
              ULTRA6 SIGNALS
            </span>
            <span
              className="text-[10px] font-bold"
              style={{ color: ultra6.on ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}
            >
              {onCount6}/6
            </span>
          </div>
          <div className="space-y-0.5">
            {ultra6List.map((s, i) => (
              <SignalRow key={i} name={s.name} isOn={s.isOn} />
            ))}
          </div>
        </div>

        {/* OB1 Column */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold" style={{ color: 'var(--scanner-accent)' }}>
              OB1 SIGNALS
            </span>
            <span
              className="text-[10px] font-bold"
              style={{ color: ob1.on ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}
            >
              {onCountOB}/6
            </span>
          </div>
          <div className="space-y-0.5">
            {ob1List.map((s, i) => (
              <SignalRow key={i} name={s.name} isOn={s.isOn} />
            ))}
          </div>
        </div>
      </div>

      {/* Strategy Rules */}
      <div className="mt-6 pt-4 border-t" style={{ borderColor: 'var(--scanner-border2)' }}>
        <div className="text-[9px] font-bold tracking-[0.1em] uppercase mb-3" style={{ color: 'var(--scanner-text3)' }}>
          STRATEGY RULES
        </div>
        <div className="space-y-1.5 text-[9px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <SignalDot isOn={ultra6.on && ob1.on} />
              <span style={{ color: 'var(--scanner-text2)' }}>Both ON</span>
            </div>
            <span style={{ color: 'var(--scanner-text3)' }}>Allocate crypto</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <SignalDot isOn={ultra6.on && ob1.on && core9Score >= 7} />
              <span style={{ color: 'var(--scanner-text2)' }}>Both + C9 ≥ 7</span>
            </div>
            <span style={{ color: 'var(--scanner-text3)' }}>High conviction BTC</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <SignalDot isOn={ultra6.on && ob1.on && core9Score >= 8 && btcAboveMA} />
              <span style={{ color: 'var(--scanner-text2)' }}>Both + C9 ≥ 8 + BTC &gt; MA50</span>
            </div>
            <span
              className="font-bold"
              style={{ color: 'var(--scanner-accent)' }}
            >
              T3 Basket (MAX)
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <SignalDot isOn={false} />
              <span style={{ color: 'var(--scanner-text2)' }}>Neither ON</span>
            </div>
            <span style={{ color: 'var(--scanner-red)' }}>Stablecoins</span>
          </div>
        </div>
      </div>

      {/* Master Allocation */}
      {allocation.status && (
        <div className="mt-4 p-3 rounded" style={{
          background: allocation.status === 'ALLOCATE' ? 'rgba(0,230,118,0.08)' : 'rgba(156,163,175,0.05)',
          border: `1px solid ${allocation.status === 'ALLOCATE' ? 'rgba(0,230,118,0.2)' : 'var(--scanner-border2)'}`,
        }}>
          <div className="flex items-center gap-2">
            <span className="text-[14px]" style={{ color: 'var(--scanner-accent)' }}>
              {allocation.icon}
            </span>
            <div>
              <div className="text-[10px] font-bold" style={{ color: allocation.status === 'ALLOCATE' ? 'var(--scanner-green)' : 'var(--scanner-text3)' }}>
                {allocation.status}
              </div>
              <div className="text-[8px]" style={{ color: 'var(--scanner-text3)' }}>
                {allocation.vehicle || '—'} · {allocation.conviction || 'NONE'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Format signal key to readable name
function formatSignalName(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
