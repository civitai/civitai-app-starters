import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * The React-19-behaviour evidence lives in the `browser` project. It COULD run
 * under happy-dom — React's prop/event dispatch is React's own code — but the
 * claim this package is built on ("React 19 needs no wrappers") is a claim
 * about real browsers, and happy-dom's missing `ElementInternals` makes any
 * form-shaped assertion vacuous there. Measuring it where it ships is the
 * point; see the file's own header for the tier note.
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
