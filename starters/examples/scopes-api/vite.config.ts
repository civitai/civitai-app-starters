import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base MUST be '/' — the block is served at the root of its own subdomain
// (https://<blockId>.civit.ai/) and the manifest iframe.src is root-served
// with no path prefix (gotcha #33/#36).
export default defineConfig({
  base: '/',
  plugins: [react()],
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
