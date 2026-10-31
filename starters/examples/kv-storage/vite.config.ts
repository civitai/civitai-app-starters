import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Validates block.manifest.json on every dev-server boot and every build, by
// compiling the CANONICAL schema (https://civitai.com/schemas/app-block/v1.json,
// vendored inside the SDK) with Ajv. Needs `ajv` in devDependencies (an optional
// peer of @civitai/app-sdk). A dev-loop gate, NOT a substitute for
// `civitai app validate`.
import { blockManifestPlugin } from '@civitai/app-sdk/vite';

// base MUST be '/' — the block is served at the root of its own subdomain
// (https://<blockId>.civit.ai/). The platform stamps that root URL as the
// block's iframe.src at approve; you never set it in the manifest, and
// `defineBlock` refuses one that does (gotcha #33/#36).
export default defineConfig(({ mode }) => {
  // Read at CONFIG time (server-side), never bundled.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: '/',
    plugins: [blockManifestPlugin(), react()],
    server: {
      // A fixed origin per example, so two of them can run side by side.
      host: 'localhost',
      port: 5183,
      strictPort: true,
      // For `dev:live`: the SDK live host calls `/api/...` on THIS origin and
      // the proxy forwards it to the real backend with an accepted Origin
      // header, so the browser never makes a cross-origin call. (The mock host
      // never calls `/api`.) Dev server only; `vite build` ignores `server`.
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
