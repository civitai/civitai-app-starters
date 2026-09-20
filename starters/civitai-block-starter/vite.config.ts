import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Validates block.manifest.json against the canonical schema on every dev-server
// boot and every build. Wired in by #330 — before it, nothing in any starter
// called `defineBlock`, so no shipped manifest was ever checked.
import { blockManifestPlugin } from './vite-plugin-block-manifest';

// Block apps are pure SPAs — the host page hands the iframe everything it
// needs via BLOCK_INIT. No BFF, no server-side rendering. Build output is
// a single static bundle; the platform builds + serves it and stamps the
// block's iframe.src server-side (you don't set it in the manifest).
export default defineConfig({
  plugins: [blockManifestPlugin(), react()],
  server: {
    // The starter dev harness simulates BLOCK_INIT from the same origin —
    // strict-port avoids the harness allowlist drifting when 5173 is busy.
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // Single-file output keeps the iframe-loaded surface small.
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
