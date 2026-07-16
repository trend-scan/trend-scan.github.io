import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    // Use 'info' in CI so bundle-size summaries are visible in workflow logs.
    // 'error' hides useful build output and makes size regressions invisible.
    logLevel: mode === 'production' ? 'info' : 'error',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    plugins: [
      react(),
    ],
    build: {
      outDir: 'dist',
      sourcemap: false,
      minify: 'esbuild',
      // Route-level code splitting is done via React.lazy() in App.jsx.
      // Each page (Scanner, Board, MacroRegime) loads its own JS chunk
      // on demand. This manualChunks config splits the big shared
      // dependencies (recharts, react-query, etc.) into cacheable chunks
      // that don't need to be re-downloaded when app code changes.
      rollupOptions: {
        output: {
          manualChunks: {
            // React core — needed for every route, cache aggressively.
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            // State / data fetching.
            'query-vendor': ['@tanstack/react-query'],
            // Charts are heavy (~250KB) and only used on Macro + Board.
            'chart-vendor': ['recharts'],
            // Icon set is large but flat — split so it caches separately
            // from app code that changes more often.
            'icon-vendor': ['lucide-react'],
          },
        },
      },
      // Vite warns at 500KB; our main chunk is well under that after splitting,
      // but keep the threshold explicit so future regressions are visible.
      chunkSizeWarningLimit: 600,
    },
    // No more build-time key injection — the sourceResolver handles keys at runtime,
    // and the daily FRED snapshot is fetched server-side in GitHub Actions.
    // Vite auto-loads VITE_* vars from .env via the loadEnv() call above.
  }
})