import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import devServer from '@hono/vite-dev-server';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // Bridge .env into process.env so the Hono BFF (server/env.ts) can read it.
  // Vite only exposes VITE_-prefixed vars on import.meta.env; the BFF needs the rest.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    plugins: [
      react(),
      devServer({
        // server/app.ts default-exports the Hono app (what dev-server expects).
        // server/index.ts is the prod Node entry — not used in dev.
        entry: 'server/app.ts',
        exclude: [/^(?!\/api\/).*/],
      }),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'Civitai App Starter (React PWA)',
          short_name: 'Civitai Starter',
          description: 'Minimal Civitai OAuth + orchestrator demo.',
          theme_color: '#0a0a0a',
          background_color: '#fafafa',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Don't precache the BFF — auth state lives there.
          navigateFallbackDenylist: [/^\/api/],
        },
      }),
    ],
    server: {
      port: 5174,
      strictPort: false,
    },
    ssr: {
      // @civitai/client uses extension-less internal imports (e.g. './generated')
      // that Node's ESM resolver rejects (ERR_UNSUPPORTED_DIR_IMPORT) when Vite
      // SSR-loads the Hono BFF. Bundle these instead of externalizing.
      noExternal: ['@civitai/client', '@civitai/app-sdk'],
    },
  };
});
