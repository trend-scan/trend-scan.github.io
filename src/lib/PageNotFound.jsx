import React from 'react';
import { Link } from 'react-router-dom';

export default function PageNotFound() {
  return (
    <div className="font-mono min-h-screen flex items-center justify-center" style={{ background: 'var(--scanner-bg)', color: 'var(--scanner-text)' }}>
      <div className="text-center">
        <div className="text-6xl mb-4 opacity-20">404</div>
        <div className="text-sm mb-2" style={{ color: 'var(--scanner-text2)' }}>Page not found</div>
        <Link to="/" className="text-[11px]" style={{ color: 'var(--scanner-accent)' }}>← Back to TrendScan</Link>
      </div>
    </div>
  );
}
