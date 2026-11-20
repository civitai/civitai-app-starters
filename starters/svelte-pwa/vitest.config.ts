import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// A config of its own, not vite.config.ts: that file also loads the Hono dev
// server and the PWA plugin, which a component test has no use for.
//
// happy-dom, not a real browser: tests/GenerateForm.test.ts mounts the real
// form and drives it through its DOM (type, click, read what it shows) with
// `fetch` stubbed. happy-dom does no layout, so nothing here asserts a size or
// a position.
export default defineConfig({
  plugins: [svelte()],
  // Svelte's `mount` exists only in its browser build; without this condition
  // vitest resolves the server build and every mount throws.
  resolve: { conditions: ['browser'] },
  test: {
    environment: 'happy-dom',
    // `include` alone keeps vitest off `tests/*.test.mjs` (those are
    // `node --test` files) and off the Playwright specs in `e2e/`.
    include: ['tests/**/*.test.ts'],
  },
});
