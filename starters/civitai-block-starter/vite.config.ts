import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Block apps are pure SPAs — the host page hands the iframe everything it
// needs via BLOCK_INIT. No BFF, no server-side rendering. Build output is
// a single static bundle to be served from `iframe.src` in the manifest.
export default defineConfig({
  plugins: [react()],
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
