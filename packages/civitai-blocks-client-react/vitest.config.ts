import { defineConfig } from 'vitest/config';

/**
 * One project. These are hook-behaviour tests — sequencing, cancellation,
 * snapshot stability — and none of them needs real layout or computed style, so
 * happy-dom is the right environment and there is deliberately no browser tier
 * to keep green separately.
 */
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['test/**/*.test.{ts,tsx}'],
          exclude: ['node_modules'],
        },
      },
    ],
  },
});
