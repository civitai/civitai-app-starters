import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The Postgres-backed suite starts DBOS.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
