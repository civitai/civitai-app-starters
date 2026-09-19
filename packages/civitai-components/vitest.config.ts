import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * `node` = source guards, `browser` = element behaviour on chromium, `contract`
 * = the cross-engine surface on all three engines. `prefers-dark` needs its own
 * project because the OS scheme is a browser-context option, not a page one.
 */
const CHROMIUM_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

// All three in CI; narrow it locally, where installing engines is the slow part.
const CONTRACT_BROWSERS = (process.env.CIVITAI_CONTRACT_BROWSERS ?? 'chromium,firefox,webkit')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

// A chromium binary path cannot be handed to firefox or webkit, so it only
// applies when chromium is the only engine being launched.
const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const EXECUTABLE = override ? { executablePath: override } : {};
const CONTRACT_EXECUTABLE =
  override && CONTRACT_BROWSERS.every((b) => b === 'chromium') ? EXECUTABLE : {};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: [
            'node_modules',
            '**/*.browser.test.ts',
            '**/*.contract.test.ts',
            '**/*.prefers-dark.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'contract',
          include: ['test/**/*.contract.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
              launchOptions: { args: CHROMIUM_ARGS, ...CONTRACT_EXECUTABLE },
            }),
            instances: CONTRACT_BROWSERS.map((browser) => ({ browser })),
          },
        },
      },
      {
        test: {
          name: 'prefers-dark',
          include: ['test/**/*.prefers-dark.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
              launchOptions: { args: CHROMIUM_ARGS, ...EXECUTABLE },
              contextOptions: { colorScheme: 'dark' },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'browser',
          include: ['test/**/*.browser.test.ts'],
          exclude: ['node_modules', '**/*.contract.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({ launchOptions: { args: CHROMIUM_ARGS, ...EXECUTABLE } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
