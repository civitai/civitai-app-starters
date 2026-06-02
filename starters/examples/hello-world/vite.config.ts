import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// App Blocks are served at the ROOT of their own subdomain
// (https://<blockId>.civit.ai/) by an nginx container, and the manifest's
// `iframe.src` must point at that root with NO path prefix (gotcha #33/#36).
// So `base` MUST be '/' — a stale Vite `base: '/my-block/'` makes the bundle
// request its assets from a path nginx doesn't serve, and the iframe renders
// blank. Keep this '/'.
export default defineConfig({
  base: '/',
  plugins: [react()],
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
