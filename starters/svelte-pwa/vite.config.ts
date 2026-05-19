import { defineConfig, loadEnv } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import devServer from '@hono/vite-dev-server';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // The Hono BFF reads `process.env` directly (see server/env.ts). Vite's
  // `loadEnv` parses `.env*` but does NOT populate process.env — bridge it
  // manually so the BFF sees the same vars in dev that Node loads in prod via
  // `node --env-file=.env`.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    plugins: [
      svelte(),
      devServer({
        // server/app.ts default-exports the Hono app (what dev-server expects).
        // server/index.ts is the prod Node-server entry (calls serve()) and
        // doesn't export — only used by `pnpm start`.
        entry: 'server/app.ts',
        exclude: [/^(?!\/api\/).*/],
      }),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'Civitai App Starter (Svelte PWA)',
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
        workbox: { navigateFallbackDenylist: [/^\/api/] },
      }),
    ],
    server: {
      port: 5175,
      strictPort: false,
    },
    ssr: {
      // @civitai/client uses extension-less internal imports (e.g. './generated')
      // that Node's ESM resolver rejects (ERR_UNSUPPORTED_DIR_IMPORT) when Vite
      // SSR-loads the Hono BFF. Bundle it instead of externalizing.
      noExternal: ['@civitai/client', '@civitai/app-sdk'],
    },
  };
});
