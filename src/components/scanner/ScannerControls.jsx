import React from 'react';

const TIMEFRAMES = ['15m', '30m', '1H', '4H', '12H', '1D'];

export default function ScannerControls({ settings, onSettingsChange, isScanning, onScan }) {
  const update = (key, val) => onSettingsChange({ ...settings, [key]: val });

  return (
    <div className="font-mono flex items-center gap-2 flex-wrap px-5 md:px-8 py-3" style={{
      background: 'var(--scanner-bg1)',
      borderBottom: '1px solid var(--scanner-border2)'
    }}>

      {/* Fast indicator — toggle gates fast > mid */}
      <IndicatorControl
        label="Fast"
        type={settings.fastType}
        emaValue={settings.emaFast}
        vwapValue={settings.vwapFastDays}
        onTypeChange={v => update('fastType', v)}
        onEmaChange={v => update('emaFast', clamp(v, 2, 499))}
        onVwapChange={v => update('vwapFastDays', clamp(v, 1, 90))}
        toggleChecked={settings.fastAboveMidEnabled}
        onToggleChange={v => update('fastAboveMidEnabled', v)}
        toggleTitle="Gate: Fast > Mid"
      />

      {/* Mid indicator — no toggle, it's the reference for fast > mid */}
      <IndicatorControl
        label="Slow"
        type={settings.midType}
        emaValue={settings.emaMid}
        vwapValue={settings.vwapMidDays}
        onTypeChange={v => update('midType', v)}
        onEmaChange={v => update('emaMid', clamp(v, 2, 499))}
        onVwapChange={v => update('vwapMidDays', clamp(v, 1, 90))}
      />

      {/* Base (slow) indicator — toggle gates price > slow */}
      <IndicatorControl
        label="Base"
        type={settings.slowType}
        emaValue={settings.emaSlow}
        vwapValue={settings.vwapDays}
        onTypeChange={v => update('slowType', v)}
        onEmaChange={v => update('emaSlow', clamp(v, 2, 500))}
        onVwapChange={v => update('vwapDays', clamp(v, 1, 90))}
        toggleChecked={settings.priceAboveSlowEnabled}
        onToggleChange={v => update('priceAboveSlowEnabled', v)}
        toggleTitle="Gate: Price > Base"
      />

      <Separator />

      {/* Timeframe */}
      <div className="flex items-center gap-0 overflow-hidden" style={{
        background: 'var(--scanner-bg2)',
        border: '1px solid var(--scanner-border2)'
      }}>
        <span className="text-[8.5px] font-semibold tracking-[0.14em] uppercase whitespace-nowrap px-2 py-1.5" style={{
          color: 'var(--scanner-text3)',
          borderRight: '1px solid var(--scanner-border2)'
        }}>
          TF
        </span>
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            className="font-mono text-[9px] font-bold tracking-wide px-2 py-1.5 transition-colors"
            style={{
              background: settings.timeframe === tf ? 'rgba(245,158,11,0.15)' : 'transparent',
              color: settings.timeframe === tf ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
              border: 'none',
              cursor: 'pointer',
              borderRight: tf !== '1D' ? '1px solid var(--scanner-border)' : 'none'
            }}
            onClick={() => update('timeframe', tf)}
          >
            {tf}
          </button>
        ))}
      </div>

      <Separator />

      {/* Exchange */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[8px] font-semibold tracking-[0.12em] uppercase px-0.5" style={{ color: 'var(--scanner-text3)' }}>
          Select Exchange
        </span>
        <select
          className="font-mono text-[11px] font-medium tracking-wide px-2.5 py-1.5 outline-none cursor-pointer"
          style={{
            background: 'var(--scanner-bg2)',
            border: '1px solid var(--scanner-border2)',
            color: 'var(--scanner-text)'
          }}
          value={settings.exchange}
          onChange={e => update('exchange', e.target.value)}
        >
          <option value="hyperliquid"    style={{ background: 'var(--scanner-bg2)' }}>Hyperliquid (Default)</option>
          <option value="okx_perps"      style={{ background: 'var(--scanner-bg2)' }}>OKX Perps</option>
          <option value="okx"            style={{ background: 'var(--scanner-bg2)' }}>OKX (Spot)</option>
          <option value="binance_perps"  style={{ background: 'var(--scanner-bg2)' }}>Binance Perps ⚠ VPN</option>
          <option value="binance"        style={{ background: 'var(--scanner-bg2)' }}>Binance Spot ⚠ VPN</option>
          <option value="kraken"         style={{ background: 'var(--scanner-bg2)' }}>Kraken</option>
          <option value="bybit"          style={{ background: 'var(--scanner-bg2)' }}>Bybit</option>
          <option value="coingecko"      style={{ background: 'var(--scanner-bg2)' }}>CoinGecko (Daily)</option>
        </select>
      </div>

      <Separator />

      {/* Filters */}
      <div className="flex items-center gap-2">
        {/* Volume Filter */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <FilterToggle checked={settings.minVolumeEnabled} onChange={v => update('minVolumeEnabled', v)} />
            <span className="text-[8px] font-semibold tracking-[0.1em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
              Min Vol 24H
            </span>
          </div>
          <select
            disabled={!settings.minVolumeEnabled}
            className="font-mono text-[10px] px-2 py-1 outline-none cursor-pointer"
            style={{
              background: 'var(--scanner-bg2)',
              border: '1px solid var(--scanner-border2)',
              color: settings.minVolume > 0 ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
              opacity: settings.minVolumeEnabled ? 1 : 0.4
            }}
            value={settings.minVolume}
            onChange={e => update('minVolume', Number(e.target.value))}
          >
            <option value={0}>— Any</option>
            <option value={1000000}>$1M</option>
            <option value={5000000}>$5M</option>
            <option value={10000000}>$10M</option>
            <option value={25000000}>$25M</option>
            <option value={50000000}>$50M</option>
            <option value={100000000}>$100M</option>
          </select>
        </div>

        {/* Market Cap Filter */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <FilterToggle checked={settings.minMarketCapEnabled} onChange={v => update('minMarketCapEnabled', v)} />
            <span className="text-[8px] font-semibold tracking-[0.1em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
              Min MCap
            </span>
          </div>
          <select
            disabled={!settings.minMarketCapEnabled}
            className="font-mono text-[10px] px-2 py-1 outline-none cursor-pointer"
            style={{
              background: 'var(--scanner-bg2)',
              border: '1px solid var(--scanner-border2)',
              color: settings.minMarketCap > 0 ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
              opacity: settings.minMarketCapEnabled ? 1 : 0.4
            }}
            value={settings.minMarketCap}
            onChange={e => update('minMarketCap', Number(e.target.value))}
          >
            <option value={0}>— Any</option>
            <option value={10000000}>$10M</option>
            <option value={25000000}>$25M</option>
            <option value={50000000}>$50M</option>
            <option value={100000000}>$100M</option>
            <option value={250000000}>$250M</option>
            <option value={500000000}>$500M</option>
            <option value={1000000000}>$1B</option>
          </select>
        </div>

        {/* RSI Range Filter */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <FilterToggle checked={settings.rsiEnabled} onChange={v => update('rsiEnabled', v)} />
            <span className="text-[8px] font-semibold tracking-[0.1em] uppercase" style={{ color: 'var(--scanner-text3)' }}>
              RSI(14)
            </span>
          </div>
          <div className="flex items-center gap-1" style={{ opacity: settings.rsiEnabled ? 1 : 0.4 }}>
            {/* RSI timeframe selector */}
            <select
              disabled={!settings.rsiEnabled}
              className="font-mono text-[9px] px-1 py-1 outline-none cursor-pointer"
              style={{
                background: 'var(--scanner-bg2)',
                border: '1px solid var(--scanner-border2)',
                color: settings.rsiTimeframe !== settings.timeframe ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
              }}
              value={settings.rsiTimeframe}
              onChange={e => update('rsiTimeframe', e.target.value)}
              title="RSI timeframe (separate from scan timeframe)"
            >
              {TIMEFRAMES.map(tf => (
                <option key={tf} value={tf} style={{ background: 'var(--scanner-bg2)' }}>{tf}</option>
              ))}
            </select>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[7px] font-semibold tracking-[0.08em] uppercase" style={{ color: 'var(--scanner-text3)' }}>Min</span>
              <SpinnerInput
                value={settings.rsiMin}
                min={0} max={100} width={30}
                onChange={v => {
                  const newMin = clamp(v, 0, 100);
                  onSettingsChange({ ...settings, rsiMin: newMin, rsiMax: Math.max(newMin, settings.rsiMax) });
                }}
              />
            </div>
            <span style={{ color: 'var(--scanner-text3)', fontSize: 9, marginTop: '7px' }}>–</span>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[7px] font-semibold tracking-[0.08em] uppercase" style={{ color: 'var(--scanner-text3)' }}>Max</span>
              <SpinnerInput
                value={settings.rsiMax}
                min={0} max={100} width={30}
                onChange={v => {
                  const newMax = clamp(v, 0, 100);
                  onSettingsChange({ ...settings, rsiMax: newMax, rsiMin: Math.min(newMax, settings.rsiMin) });
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Scan Button */}
      <button
        className="font-mono text-[10px] font-bold tracking-[0.14em] uppercase px-5 py-2 whitespace-nowrap transition-all"
        style={{
          background: isScanning ? 'var(--scanner-border2)' : 'var(--scanner-accent)',
          color: isScanning ? 'var(--scanner-text2)' : '#000',
          cursor: isScanning ? 'not-allowed' : 'pointer',
          border: 'none'
        }}
        disabled={isScanning}
        onClick={onScan}
      >
        {isScanning ? '⟳  SCANNING…' : '▶  SCAN'}
      </button>

      {/* Info */}
      <div className="ml-auto text-[9px] tracking-wider whitespace-nowrap hidden lg:block" style={{ color: 'var(--scanner-text3)' }}>
        UNIVERSE <span style={{ color: 'var(--scanner-text2)' }}>TOP 300</span>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.type
 * @param {number} props.emaValue
 * @param {number} props.vwapValue
 * @param {function} props.onTypeChange
 * @param {function} props.onEmaChange
 * @param {function} props.onVwapChange
 * @param {boolean} [props.toggleChecked] Present only when this indicator has a filter toggle
 * @param {function} [props.onToggleChange] Present only when this indicator has a filter toggle
 * @param {string} [props.toggleTitle] Tooltip text for the toggle
 */
function IndicatorControl({ label, type, emaValue, vwapValue, onTypeChange, onEmaChange, onVwapChange, toggleChecked, onToggleChange, toggleTitle }) {
  return (
    <div className="flex items-center gap-0 overflow-hidden" style={{
      background: 'var(--scanner-bg2)',
      border: '1px solid var(--scanner-border2)',
      opacity: toggleChecked === false ? 0.6 : 1
    }}>
      {/* Toggle (optional — only rendered when onToggleChange is provided) */}
      {onToggleChange && (
        <div className="flex items-center px-1.5" style={{ borderRight: '1px solid var(--scanner-border2)' }}>
          <FilterToggle checked={toggleChecked} onChange={onToggleChange} title={toggleTitle} />
        </div>
      )}

      {/* Label */}
      <span className="text-[8.5px] font-semibold tracking-[0.14em] uppercase whitespace-nowrap px-2 py-1.5" style={{
        color: 'var(--scanner-text3)',
        borderRight: '1px solid var(--scanner-border2)'
      }}>
        {label}
      </span>

      {/* EMA / VWAP toggle */}
      <div className="flex">
        {['ema', 'vwap'].map(t => (
          <button
            key={t}
            className="font-mono text-[9px] font-bold tracking-wide px-2 py-1.5 transition-colors"
            style={{
              background: type === t ? label === 'Fast' ? 'rgba(255,255,0,0.15)' : label === 'Slow' ? 'rgba(255,45,255,0.12)' : 'rgba(0,229,255,0.12)' : 'transparent',
              color: type === t ? label === 'Fast' ? 'var(--scanner-fast)' : label === 'Slow' ? 'var(--scanner-slow)' : 'var(--scanner-base)' : 'var(--scanner-text3)',
              border: 'none',
              cursor: 'pointer',
              borderRight: t === 'ema' ? '1px solid var(--scanner-border2)' : 'none'
            }}
            onClick={() => onTypeChange(t)}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Period input with spinner */}
      <div style={{ borderLeft: '1px solid var(--scanner-border2)' }} className="flex items-center">
        {type === 'vwap' ? (
          <SpinnerInput value={vwapValue} onChange={onVwapChange} min={0} max={90} width={40} suffix="d" color={label === 'Fast' ? 'var(--scanner-fast)' : label === 'Slow' ? 'var(--scanner-slow)' : 'var(--scanner-base)'} />
        ) : (
          <SpinnerInput value={emaValue} onChange={onEmaChange} min={0} max={500} width={48} color={label === 'Fast' ? 'var(--scanner-fast)' : label === 'Slow' ? 'var(--scanner-slow)' : 'var(--scanner-base)'} />
        )}
      </div>
    </div>
  );
}

function SpinnerInput({ value, onChange, min = 0, max = 500, width = 48, suffix = '', color = 'var(--scanner-accent)' }) {
  const [localVal, setLocalVal] = React.useState(String(value));

  React.useEffect(() => { setLocalVal(String(value)); }, [value]);

  const commit = (raw) => {
    const v = parseInt(raw);
    if (!isNaN(v)) onChange(clamp(v, min, max));
    else setLocalVal(String(value));
  };

  return (
    <div className="flex items-center" style={{ gap: 0 }}>
      <input
        type="text"
        inputMode="numeric"
        className="font-mono text-[13px] font-semibold bg-transparent border-none outline-none text-center"
        style={{ color: color, borderBottom: '1px solid var(--scanner-border3)', width: `${width}px`, padding: '6px 0' }}
        value={localVal}
        onFocus={e => e.target.select()}
        onChange={e => setLocalVal(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(localVal); }}
      />
      {suffix && <span className="text-[8px] pl-0.5 pr-1" style={{ color: 'var(--scanner-text3)' }}>{suffix}</span>}
      <div className="flex flex-col" style={{ borderLeft: '1px solid var(--scanner-border)' }}>
        <button
          className="flex items-center justify-center"
          style={{ width: 14, height: 13, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--scanner-text3)', borderBottom: '1px solid var(--scanner-border)', fontSize: 8, lineHeight: 1 }}
          onMouseDown={e => { e.preventDefault(); onChange(clamp(value + 1, min, max)); }}
        >▲</button>
        <button
          className="flex items-center justify-center"
          style={{ width: 14, height: 13, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--scanner-text3)', fontSize: 8, lineHeight: 1 }}
          onMouseDown={e => { e.preventDefault(); onChange(clamp(value - 1, min, max)); }}
        >▼</button>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.checked
 * @param {function} props.onChange
 * @param {string} [props.title] Tooltip text for the toggle
 */
function FilterToggle({ checked, onChange, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className="flex-shrink-0"
      style={{
        width: 22, height: 13, borderRadius: 7, padding: 0, border: 'none',
        background: checked ? 'var(--scanner-accent)' : 'var(--scanner-border2)',
        cursor: 'pointer', position: 'relative', transition: 'background 0.15s ease'
      }}
    >
      <span style={{
        position: 'absolute', top: 1.5, left: checked ? 10 : 1.5,
        width: 10, height: 10, borderRadius: '50%',
        background: checked ? '#000' : 'var(--scanner-text3)',
        transition: 'left 0.15s ease'
      }} />
    </button>
  );
}

function Separator() {
  return <div className="w-px h-6 mx-1 flex-shrink-0" style={{ background: 'var(--scanner-border2)' }} />;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}