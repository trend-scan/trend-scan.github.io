import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import PageNotFound from './lib/PageNotFound';
import NavBar from './components/NavBar';
import ErrorBoundary from './components/ErrorBoundary';
import SpaAwareRedirect from './components/SpaAwareRedirect';
import LegalDisclaimer from './components/LegalDisclaimer';

// Route-level code splitting — each page loads its own JS chunk on demand.
// Scanner (recharts + scanner engine) stays in the initial bundle since it's
// the default route. Board and MacroRegime are lazy-loaded.
const Scanner = lazy(() => import('./pages/Scanner'));
const Board = lazy(() => import('./pages/Board'));
const MacroRegime = lazy(() => import('./pages/MacroRegime'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center font-mono"
      style={{ background: 'var(--scanner-bg)', color: 'var(--scanner-text3)' }}>
      <div className="text-center">
        <div className="text-2xl mb-2 animate-pulse" style={{ opacity: 0.4 }}>◈</div>
        <div className="text-[11px] tracking-wider">Loading…</div>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <SpaAwareRedirect />
        <NavBar />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<ErrorBoundary name="Scanner"><Scanner /></ErrorBoundary>} />
            <Route path="/board" element={<ErrorBoundary name="Market Board"><Board /></ErrorBoundary>} />
            <Route path="/macro" element={<ErrorBoundary name="Macro Regime"><MacroRegime /></ErrorBoundary>} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Suspense>
        <LegalDisclaimer />
      </Router>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App
