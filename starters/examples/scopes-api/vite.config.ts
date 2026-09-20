import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Validates block.manifest.json against the canonical schema on every dev-server
// boot and every build. Wired in by #330 — before it, nothing in any starter
// called `defineBlock`, so no shipped manifest was ever checked.
import { blockManifestPlugin } from './vite-plugin-block-manifest';

// base MUST be '/' — the block is served at the root of its own subdomain
// (https://<blockId>.civit.ai/). The platform stamps that root URL as the
// block's iframe.src at approve; you never set it in the manifest, and
// `defineBlock` refuses one that does (gotcha #33/#36).
export default defineConfig({
  base: '/',
  plugins: [blockManifestPlugin(), react()],
  server: {
    // The dev harness pins the allowed parent origin to this exact origin
    // (gotcha #53). Serve here so BLOCK_INIT isn't origin-rejected.
    host: 'localhost',
    port: 5184,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: undefined } },
  },
});
