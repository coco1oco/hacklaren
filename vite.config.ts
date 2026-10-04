import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// The frontend is a static SPA deployed to Vercel. Cloud Functions live in ./functions and deploy to Firebase.
export default defineConfig({
  // In dev, /api is served by scripts/dev-api.ts (same handlers as the Vercel functions) against the emulators.
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Domain logic shared verbatim with Cloud Functions (single source of truth).
      '@shared': fileURLToPath(new URL('./functions/src/shared', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': a new version waits until the user taps "Reload" (see src/lib/pwaUpdate.ts), so a reload never
      // interrupts a form or discards the one-time hospital link.
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'MARA — Maternal Referral and Admission',
        short_name: 'MARA',
        description: 'The patient moves. Her record moves with her.',
        theme_color: '#c2410c',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/dashboard',
        scope: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app shell only. Patient data is cached by Firestore's own IndexedDB persistence,
        // never by the service worker, and callable function responses are never cached.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: 'es2020',
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Higher priority groups claim modules first. React gets its own chunk so it is not hoisted into
          // "charts" (recharts depends on it); otherwise every page, including the public hospital view,
          // would statically load recharts. Charts stay a lazily loaded chunk.
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|react-is|use-sync-external-store)[\\/]/, priority: 3 },
            { name: 'firebase', test: /node_modules[\\/](firebase|@firebase)[\\/]/, priority: 2 },
            { name: 'charts', test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
});
