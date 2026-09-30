import { defineConfig } from 'vitest/config';

/** `node` = logic, `dom` = the elements in jsdom. */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.dom.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.dom.test.ts'],
          setupFiles: ['./src/test-setup.ts'],
        },
      },
    ],
  },
});
