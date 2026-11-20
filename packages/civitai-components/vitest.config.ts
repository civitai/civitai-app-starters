import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * `node` = source guards, `dom` = the NON-BROWSER DOM consumers actually test
 * in, `browser` = element behaviour on chromium, `contract` = the cross-engine
 * surface on all three engines.
 *
 * 🔴 THERE IS DELIBERATELY NO DARK-OS PROJECT, AND ADDING ONE BACK IS A
 * DECISION, NOT A FIX. One existed — the OS scheme is a browser-CONTEXT option
 * rather than a page one, so it cannot share a project — and after the
 * dark-base flip (`@civitai/theme@0.5.0`) every assertion in it passed
 * identically with and without the change it was aimed at: a dark-OS context
 * cannot tell "dark base" from "light base plus an OS-dark override", because
 * both answer dark. The hazard it was left guarding — a `prefers-color-scheme`
 * at-rule authored in THIS package's CSS — is now pinned at source in
 * `test/css-integrity.test.ts`, over a wider surface and without a second
 * browser launch. The discriminating RENDERED fixture is a LIGHT OS, which is
 * what the `browser` project already reports; that is why
 * `test/color-scheme.dark-base.browser.test.ts` lives there.
 *
 * ⚠️ If you DO add one back, it needs TWO edits, not one: the project block
 * here, AND the matching `prefers-dark` glob back in the `node` project's
 * `exclude` below. Without the second, `node` collects the file and it dies on
 * `ReferenceError: document is not defined` rather than on anything it asserts.
 * (Writing that glob literally in this comment is not possible: it contains the
 * block-comment terminator.)
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
