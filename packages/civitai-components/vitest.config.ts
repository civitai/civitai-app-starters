import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * `node` = source guards, `dom` = the NON-BROWSER DOM consumers actually test
 * in, `browser` = element behaviour on chromium, `contract` = the cross-engine
 * surface on all three engines. `prefers-dark` needs its own project because the
 * OS scheme is a browser-context option, not a page one.
 *
 * 🔴 WHY `dom` EXISTS, AND WHAT IT IS NOT FOR (#485). Every element-behaviour
 * project here is a real engine, so this package had no tier that could see a
 * defect which only appears where the platform is INCOMPLETE — and that is the
 * tier an App Block's own suite runs in (`@civitai/blocks-react/testing` is
 * documented as letting a block "run in `vitest`/`happy-dom`", and both React
 * packages' `unit` projects are happy-dom). `<civitai-menu>` threw
 * `TypeError: panel.showPopover is not a function` there while 851 browser tests
 * were green.
 *
 * It is NOT a second home for element behaviour. happy-dom does no layout, and
 * — measured on 20.9.0 — does not deliver a click on slotted content to a
 * listener on the `<slot>` it is assigned to, so trigger clicks are silent and
 * anything positional is meaningless. Put behaviour in `browser`; put
 * "this does not explode where a consumer runs it" here.
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
            // `node` has no DOM at all, so a `*.dom.test.ts` would fail there on
            // `document` rather than on anything it asserts.
            '**/*.dom.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['test/**/*.dom.test.ts'],
          exclude: ['node_modules'],
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
            provider: playwright({}),
            // Per instance: firefox and webkit refuse chromium's flags outright
            // ("Unknown option --no-sandbox"), which closes the whole run.
            instances: CONTRACT_BROWSERS.map((browser) => ({
              browser,
              ...(browser === 'chromium'
                ? { provider: playwright({ launchOptions: { args: CHROMIUM_ARGS, ...CONTRACT_EXECUTABLE } }) }
                : {}),
            })),
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
