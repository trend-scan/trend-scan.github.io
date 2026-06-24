import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    logLevel: 'error',
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
    define: {
      'import.meta.env.VITE_MASSIVE_API_KEY': JSON.stringify(env.VITE_MASSIVE_API_KEY || ''),
    },
  }
})