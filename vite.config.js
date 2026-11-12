import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';
import { renameSync, existsSync, readFileSync } from 'node:fs';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    resolve: {
      alias: {
        '#worker-factory': r(single ? './src/scan/worker-factory.single.js' : './src/scan/worker-factory.js'),
        '#pwa': r(single ? './src/pwa/register.single.js' : './src/pwa/register.js'),
      },
    },
    worker: { format: single ? 'iife' : 'es' },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
      chunkSizeWarningLimit: 2500,
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
    plugins: single
      ? [
          viteSingleFile({ removeViteModuleLoader: true }),
          {
            name: 'inline-favicon',
            transformIndexHtml(h) {
              const svg = readFileSync(r('./public/icons/favicon.svg'), 'utf8');
              return h
                .replace('./icons/favicon.svg', `data:image/svg+xml,${encodeURIComponent(svg)}`)
                .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '');
            },
          },
          {
            name: 'rename-single',
            closeBundle() {
              const from = r('./dist-single/index.html');
              if (existsSync(from)) renameSync(from, r('./dist-single/AI-Content-Reviewer.html'));
            },
          },
        ]
      : [
          VitePWA({
            registerType: 'prompt',
            injectRegister: false,
            includeAssets: ['icons/*.svg', 'icons/*.png', '404.html'],
            manifest: {
              name: 'AI Content Reviewer',
              short_name: 'Lens',
              description: 'Offline scanner that flags AI-generation identifiers in your files.',
              id: './',
              start_url: './',
              scope: './',
              display: 'standalone',
              display_override: ['window-controls-overlay', 'standalone'],
              orientation: 'any',
              background_color: '#090b16',
              theme_color: '#090b16',
              categories: ['productivity', 'utilities', 'education'],
              icons: [
                { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
              file_handlers: [
                { action: './', accept: { 'application/zip': ['.zip'], 'application/pdf': ['.pdf'], 'image/*': ['.png', '.jpg', '.jpeg', '.webp'], 'text/plain': ['.txt', '.md'] } },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
              maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
              navigateFallback: 'index.html',
              cleanupOutdatedCaches: true,
              clientsClaim: true,
            },
          }),
        ],
    test: { environment: 'node', include: ['tests/**/*.test.js'] },
  };
});
