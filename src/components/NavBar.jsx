import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const TABS = [
  { label: 'Screener',     path: '/' },
  { label: 'Market Board', path: '/board' },
  { label: 'Macro',        path: '/macro' },
];

export default function NavBar() {
  const { pathname } = useLocation();

  return (
    <nav
      className="sticky top-0 z-50 font-mono flex items-center px-3 md:px-8"
      style={{
        background: 'linear-gradient(180deg, #0a0d14 0%, var(--scanner-bg1) 100%)',
        borderBottom: '1px solid var(--scanner-border2)',
        minHeight: 52,
      }}
      aria-label="Main navigation"
    >
      {/* Logo / brand */}
      <div className="flex items-center gap-2.5 mr-4 md:mr-8 flex-shrink-0">
        <img
          src="/logo-small.png"
          alt="TrendScan"
          className="w-7 h-7 md:w-8 md:h-8"
          style={{ display: 'block' }}
        />
        <span className="text-[11px] md:text-[12px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--scanner-text)' }}>
          Trend<span style={{ color: 'var(--scanner-accent)' }}>Scan</span>
        </span>
      </div>

      {/* Nav tabs */}
      <div className="flex items-stretch h-full gap-1 flex-1 md:flex-none" role="tablist">
        {TABS.map(tab => {
          const active = pathname === tab.path || (tab.path !== '/' && pathname.startsWith(tab.path));
          return (
            <Link
              key={tab.path}
              to={tab.path}
              role="tab"
              aria-selected={active}
              aria-current={active ? 'page' : undefined}
              className="flex items-center justify-center px-4 md:px-5 text-[11px] md:text-[10px] font-bold tracking-[0.1em] uppercase transition-all no-underline flex-1 md:flex-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                minHeight: 44,
                color: active ? 'var(--scanner-accent)' : 'var(--scanner-text3)',
                borderBottom: active ? '2px solid var(--scanner-accent)' : '2px solid transparent',
                background: active ? 'rgba(240,165,0,0.08)' : 'rgba(255,255,255,0.02)',
                textDecoration: 'none',
                border: active
                  ? '1px solid rgba(240,165,0,0.25)'
                  : '1px solid var(--scanner-border2)',
                borderBottomWidth: active ? 2 : 1,
                borderBottomColor: active ? 'var(--scanner-accent)' : 'var(--scanner-border2)',
                outlineColor: 'var(--scanner-accent)',
              }}
            >
              {tab.label === "Market Board" ? (<><span className="md:hidden">Board</span><span className="hidden md:inline">Market Board</span></>) : tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}