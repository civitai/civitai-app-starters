import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// A config of its own, not vite.config.ts: a component test needs the Svelte
// compiler, not the whole SvelteKit app (its router, server hooks and env).
// `$lib` is the one Kit alias the form imports, so it is mapped here by hand.
//
// happy-dom, not a real browser: tests/GenerateForm.test.ts mounts the real
// form and drives it through its DOM (type, click, read what it shows) with
// `fetch` stubbed. happy-dom does no layout, so nothing here asserts a size or
// a position.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
    // Svelte's `mount` exists only in its browser build; without this condition
    // vitest resolves the server build and every mount throws.
    conditions: ['browser'],
  },
  test: {
    environment: 'happy-dom',
    // `include` alone keeps vitest off `tests/*.test.mjs` (those are
    // `node --test` files) and off the Playwright specs in `e2e/`.
    include: ['tests/**/*.test.ts'],
  },
});
