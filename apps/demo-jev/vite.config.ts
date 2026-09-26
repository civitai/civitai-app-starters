import { defineConfig } from 'vite';

// Minimal on purpose: this demo has no framework plugin and no block manifest —
// it is a plain vanilla-TS page over the workspace-linked design-system packages.
// The workspace links (`apps/demo-jev/node_modules/@civitai/*` -> ../../packages/*)
// are what pnpm install creates; Vite resolves through them like any package.
export default defineConfig({
  base: '/',
  server: {
    port: 5186,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
});
