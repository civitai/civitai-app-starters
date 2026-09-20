import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // `starter-wiring.test.ts` loads each scaffold's
      // `vite-plugin-block-manifest.ts`, which imports the PUBLISHED specifier.
      // Point it at `src/` so the suite exercises the code under test and does
      // not depend on `dist/` existing — CI's `sdk` job runs `test` BEFORE
      // `build`, so a dist-dependent test would fail there for the wrong reason.
      '@civitai/app-sdk/blocks': fileURLToPath(new URL('./src/blocks/index.ts', import.meta.url)),
    },
  },
  test: {
    // Runtime suites only. Type-level suites (`*.test-d.ts`) are compiled by
    // `tsc -p tsconfig.typecheck.json` via the `test:types` script.
    include: ['test/**/*.test.ts'],
    environment: 'node',
    server: {
      deps: {
        // The scaffold plugins live outside this package's root; without this
        // Vitest externalises them to plain Node ESM and the alias above is
        // never applied.
        inline: [/vite-plugin-block-manifest\.ts$/],
      },
    },
  },
});
