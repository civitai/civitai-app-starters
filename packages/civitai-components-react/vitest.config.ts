import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Two Vitest projects (mirrors @civitai/blocks-react's config shape):
 *   - `unit`    = filesystem guards over the generated bindings — generation
 *                 parity, the event map, entry-point shape, and the guard that
 *                 keeps `src/` to generated bindings only (`*.test.ts`, NOT
 *                 `*.browser.test.tsx`). Fast, no browser. `pnpm test` runs it.
 *   - `browser` = real headless Chromium (`*.browser.test.tsx`): the binding
 *                 mechanics (property assignment, refs, typed custom events,
 *                 shadow-root `change` retargeting) and an axe a11y sweep —
 *                 both need a real DOM that can upgrade a custom element,
 *                 which happy-dom cannot. `pnpm test:browser` runs it.
 *                 Until 0.8.0 this also carried HTML-vs-React computed-style
 *                 parity and an opt-in visual-regression layer; the first went
 *                 with the hand-written React layer it compared, the second
 *                 was deleted never having run (no baselines, no CI opt-in).
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
