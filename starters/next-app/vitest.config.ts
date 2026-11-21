import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// A config of its own: a component test needs the form and the modules it
// imports, not Next (its router, server components and env). `@/` is the one
// tsconfig path the form imports, so it is mapped here by hand. No React plugin
// either: Vite compiles the form's JSX itself, with the automatic runtime that
// tsconfig's `"jsx": "react-jsx"` names.
//
// happy-dom, not a real browser: tests/GenerateForm.test.ts renders the real
// form and drives it through its DOM (type, click, read what it shows) with
// `fetch` stubbed. happy-dom does no layout, so nothing here asserts a size or
// a position.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    // `include` alone keeps vitest off `tests/*.test.mjs` (those are
    // `node --test` files) and off the Playwright specs in `e2e/`.
    include: ['tests/**/*.test.ts'],
  },
});
