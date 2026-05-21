import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...next,
  ...nextTs,
  {
    // `react-hooks/purity` is enabled by default in eslint-config-next@16's
    // eslint-plugin-react-hooks@7 bundle. It flags any `Date.now()` / `Math.random()`
    // call inside a component body — but in App Router server components those
    // calls run server-side per request, not during a client re-render, so the
    // purity warning doesn't apply. Disable globally rather than per-line.
    rules: {
      'react-hooks/purity': 'off',
    },
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist-server/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },
];

export default config;
