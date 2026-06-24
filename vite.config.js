import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Base path: GitHub Pages serves this repo at /trendscan.github.io/
  // (project page, not user page). Vite needs this so all asset URLs are prefixed.
  // For local dev (`npm run dev`), Vite automatically ignores `base` — serves from /.
  const isDev = mode === 'development';
  const base = isDev ? '/' : '/trendscan.github.io/';

  return {
    logLevel: 'error',
    base,
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
    },
    // No more build-time key injection — the sourceResolver handles keys at runtime,
    // and the daily FRED snapshot is fetched server-side in GitHub Actions.
    // Vite auto-loads VITE_* vars from .env via the loadEnv() call above.
  }
})