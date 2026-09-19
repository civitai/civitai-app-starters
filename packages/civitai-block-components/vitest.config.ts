import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * The elements need real custom-element upgrade, `ElementInternals` and
 * `getComputedStyle`, so they run in `browser`; the CSS guards stay in `node`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['node_modules', '**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['test/**/*.browser.test.ts'],
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
