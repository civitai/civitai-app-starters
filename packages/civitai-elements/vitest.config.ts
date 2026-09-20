import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, mirroring the shape @civitai/blocks-react and
 * @civitai/components-react already use.
 *
 *   - `unit`    = happy-dom. Fast. Covers everything that is pure DOM
 *                 bookkeeping: attribute reflection, child survival, the
 *                 generated-CSS parity check, the API snapshot.
 *   - `browser` = real headless Chromium. EVERYTHING form-associated lives
 *                 here and cannot move: happy-dom has no working
 *                 `ElementInternals.setFormValue()`/`setValidity()` and does
 *                 not implement form-associated custom elements, so the two
 *                 🔴 constraints (no double-submit, `required` reaching the
 *                 control) are STRUCTURALLY INVISIBLE to the unit tier. A
 *                 guard that runs there would pass vacuously.
 *
 * NixOS: point Playwright at a system Chromium —
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(nix-shell -p chromium --run 'command -v chromium')
 */
export default defineConfig({
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
