import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Runtime suites only. Type-level suites (`*.test-d.ts`) are compiled by
    // `tsc -p tsconfig.typecheck.json` via the `test:types` script.
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
