import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Validates block.manifest.json on every dev-server boot and every build, by
// compiling the CANONICAL schema (https://civitai.com/schemas/app-block/v1.json,
// vendored inside the SDK) with Ajv. Needs `ajv` in devDependencies (an optional
// peer of @civitai/app-sdk). A dev-loop gate, NOT a substitute for
// `civitai app validate`.
import { blockManifestPlugin } from '@civitai/app-sdk/vite';

import { REHYDRATABLE } from './src/dev/fixtures.js';

// base MUST be '/' — the block is served at the root of its own subdomain
// (https://<blockId>.civit.ai/). The platform stamps that root URL as the
// block's iframe.src at approve; you never set it in the manifest, and
// `defineBlock` refuses one that does (gotcha #33/#36).
export default defineConfig(({ mode }) => {
  // Read at CONFIG time (server-side), never bundled.
  const env = loadEnv(mode, process.cwd(), '');
  const mockHost = process.env.VITE_DEV_HARNESS === 'true' && process.env.VITE_LIVE_MODE !== 'true';
  return {
    base: '/',
    plugins: [blockManifestPlugin(), react(), ...(mockHost ? [mockGenerationResources()] : [])],
    server: {
      // A fixed origin per example, so two of them can run side by side.
      host: 'localhost',
      port: 5188,
      strictPort: true,
      // For `dev:live`: the SDK live host calls `/api/...` on THIS origin and
      // the proxy forwards it to the real backend with an accepted Origin
      // header, so the browser never makes a cross-origin call. Dev server
      // only; `vite build` ignores `server`.
      proxy: {
        '/api': {
          target: env.VITE_LIVE_HOST_ORIGIN || 'https://civitai.com',
          changeOrigin: true,
          headers: { origin: 'https://civitai.com' },
        },
      },
    },
    build: {
      target: 'es2022',
      rollupOptions: { output: { manualChunks: undefined } },
    },
  };
});

/**
 * `dev:harness` ONLY: answer `GET /api/v1/blocks/generation-resources` from the
 * dev fixtures.
 *
 * `useGenerationResources()` is a direct REST call (block token as a Bearer,
 * against the host origin) — not a bridge message — so the SDK's mock host
 * cannot answer it, and through the proxy above it would reach the real API with
 * a mock token and 401. This stands in for the endpoint with its response shape:
 * `{ items }`, unknown or unavailable ids simply OMITTED, a Bearer required.
 * Registered before Vite's own middlewares, so it wins over the proxy; never
 * registered for `dev:live` or a build.
 */
function mockGenerationResources(): Plugin {
  return {
    name: 'generate-studio:mock-generation-resources',
    configureServer(server) {
      server.middlewares.use('/api/v1/blocks/generation-resources', (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (!req.headers.authorization?.startsWith('Bearer ')) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'missing block token' }));
          return;
        }
        const ids = new URL(req.url ?? '', 'http://localhost').searchParams.get('ids')?.split(',').map(Number) ?? [];
        res.end(JSON.stringify({ items: REHYDRATABLE.filter((r) => ids.includes(r.versionId)) }));
      });
    },
  };
}
