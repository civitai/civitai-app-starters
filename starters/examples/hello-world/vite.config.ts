import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Validates block.manifest.json on every dev-server boot and every build, by
// compiling the CANONICAL schema (https://civitai.com/schemas/app-block/v1.json,
// vendored inside the SDK) with Ajv — not against a hand-written mirror of it.
// Wired in by #330; before it nothing in any starter called `defineBlock`, so no
// shipped manifest was ever checked. Needs `ajv` in devDependencies (an optional
// peer of @civitai/app-sdk). This is a dev-loop gate, NOT a substitute for
// `civitai app validate`.
import { blockManifestPlugin } from '@civitai/app-sdk/vite';

// Civitai Apps are served at the ROOT of their own subdomain
// (https://<blockId>.civit.ai/) by an nginx container — the platform stamps that
// URL as the block's `iframe.src` at approve; you never set it yourself, and
// `defineBlock` refuses a manifest that does (gotcha #33/#36).
// So `base` MUST be '/' — a stale Vite `base: '/my-block/'` makes the bundle
// request its assets from a path nginx doesn't serve, and the iframe renders
// blank. Keep this '/'.
export default defineConfig({
  base: '/',
  plugins: [blockManifestPlugin(), react()],
  server: {
    // The dev harness pins the allowed parent origin to this exact origin
    // (gotcha #53). Serve on localhost:5180 so BLOCK_INIT isn't origin-rejected.
    host: 'localhost',
    port: 5180,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: undefined } },
  },
});
