import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import Scanner from './pages/Scanner';
import Board from './pages/Board';
import MacroRegime from './pages/MacroRegime';
import NavBar from './components/NavBar';
import ErrorBoundary from './components/ErrorBoundary';
import SpaAwareRedirect from './components/SpaAwareRedirect';
import LegalDisclaimer from './components/LegalDisclaimer';

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <SpaAwareRedirect />
        <NavBar />
        <Routes>
          <Route path="/" element={<ErrorBoundary name="Scanner"><Scanner /></ErrorBoundary>} />
          <Route path="/board" element={<ErrorBoundary name="Market Board"><Board /></ErrorBoundary>} />
          <Route path="/macro" element={<ErrorBoundary name="Macro Regime"><MacroRegime /></ErrorBoundary>} />
          <Route path="*" element={<PageNotFound />} />
        </Routes>
        <LegalDisclaimer />
      </Router>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App
