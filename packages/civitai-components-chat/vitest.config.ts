import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * `node` = logic, `dom` = the elements in jsdom, `browser` = layout in real headless Chromium.
 *
 * jsdom does no layout, so anything about sizes or positions (does the New chat button fit a
 * phone-width chat?) belongs in `browser` (`*.browser.test.ts`, `pnpm test:browser`).
 *
 * CI uses Playwright's bundled Chromium (env unset). NixOS cannot run that generic binary; point
 * it at a system Chromium via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.dom.test.ts', 'src/**/*.browser.test.ts'],
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
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
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
