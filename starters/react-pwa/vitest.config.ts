import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// A config of its own, not vite.config.ts: that file also loads the Hono dev
// server and the PWA plugin, which a component test has no use for.
//
// happy-dom, not a real browser: tests/GenerateForm.test.ts renders the real
// form and drives it through its DOM (type, click, read what it shows) with
// `fetch` stubbed. happy-dom does no layout, so nothing here asserts a size or
// a position.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    // `include` alone keeps vitest off `tests/*.test.mjs` (those are
    // `node --test` files) and off the Playwright specs in `e2e/`.
    include: ['tests/**/*.test.ts'],
  },
});
