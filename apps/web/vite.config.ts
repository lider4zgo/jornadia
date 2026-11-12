import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': avisa de la versión nueva en lugar de recargar sola (ver src/lib/update.ts)
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Korporia — RH y finanzas para PyMEs',
        short_name: 'Korporia',
        description: 'Recursos humanos y finanzas de tu empresa. Checa tu entrada y salida con selfie y ubicación.',
        lang: 'es-MX',
        theme_color: '#0E1630',
        background_color: '#F4F5FA',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        // La librería de rostro pesa más que el límite por defecto
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Modelos de rostro: se descargan una vez y quedan en el teléfono
            urlPattern: ({ url }) => url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'face-models', expiration: { maxEntries: 20 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  server: {
    // En desarrollo, /api va al Worker local (npm run dev:api)
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
});
