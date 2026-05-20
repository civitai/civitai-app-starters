import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
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
