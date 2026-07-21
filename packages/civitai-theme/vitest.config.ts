import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Token generation + drift guard are pure Node (fs + Mantine resolver).
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
