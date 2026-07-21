import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Two Vitest projects (mirrors @civitai/blocks-react's config shape):
 *   - `unit`    = happy-dom markup/ARIA assertions (`*.test.tsx`, NOT
 *                 `*.browser.test.tsx`). Fast, no browser. `pnpm test` runs it.
 *   - `browser` = real headless Chromium (`*.browser.test.tsx`): the
 *                 HTML-vs-React computed-style parity, axe a11y, and (opt-in)
 *                 visual-regression suites — all need real layout + getComputedStyle,
 *                 which happy-dom does not provide. `pnpm test:browser` runs it.
 *
 * CI uses Playwright's bundled Chromium (env unset). NixOS can't run that
 * generic binary — point it at a system Chromium via
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(nix-shell -p chromium --run 'command -v chromium')
 */
export default defineConfig({
  // A single React copy — a duplicate makes the hooks dispatcher null in
  // browser mode ("Cannot read properties of null (reading 'useEffect')").
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['test/**/*.test.{ts,tsx}'],
          exclude: ['node_modules', '**/*.browser.test.{ts,tsx}'],
        },
      },
      {
        resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
        test: {
          name: 'browser',
          include: ['test/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
              launchOptions: {
                args: ['--no-sandbox', '--disable-dev-shm-usage'],
                ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
                  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
                  : {}),
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
