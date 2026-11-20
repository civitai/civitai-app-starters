import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Two Vitest projects sharing one config/runner (mirrors civitai's root
// vitest.config.mts shape):
//   - `unit`    = the existing happy-dom suite, UNCHANGED. Fast, no browser.
//                 ~380 component/hook/transport tests. This is what `pnpm test`
//                 and CI's `test` step run.
//   - `browser` = real headless Chromium (vitest browser mode via Playwright).
//                 happy-dom does NO layout, NO image decode, and does NOT run
//                 IntersectionObserver/`performance`/`PerformanceObserver`, so
//                 picker perf + lazy-loading + grid-collapse regressions were
//                 UNCATCHABLE by the unit suite. The browser project closes that
//                 blind spot. Run with `pnpm test:browser`.
//
// The browser project's glob is `*.browser.test.ts`; the unit project EXCLUDES
// that glob so the two never overlap (the unit project's include
// `test/**/*.test.{ts,tsx}` would otherwise also match `*.browser.test.ts`).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['test/**/*.test.{ts,tsx}'],
          // Browser-mode tests must NOT run under happy-dom (no layout/decode).
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
            // `--no-sandbox` + `--disable-dev-shm-usage`: required to launch
            // Chromium as root inside a CI container (the GH runner / node:20
            // image); without --no-sandbox Chromium refuses to start as UID 0,
            // and a small /dev/shm crashes it without --disable-dev-shm-usage.
            // Harmless locally.
            //
            // CI uses Playwright's BUNDLED Chromium (env unset). NixOS can't run
            // that generic binary — point this at a system Chromium, e.g.
            //   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v chromium)
            // (use `nix-shell -p chromium` if it isn't on PATH).
            provider: playwright({
              launchOptions: {
                args: ['--no-sandbox', '--disable-dev-shm-usage'],
                ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
                  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
                  : {}),
              },
            }),
            // A modest viewport so 24 cards reliably OVERFLOW the modal's grid
            // (→ the bottom sentinel sits beyond the 400px prefetch margin → no
            // auto page-load storm on open, and the grid genuinely scrolls). A
            // huge viewport would let the first page fit and mask the storm guard.
            viewport: { width: 800, height: 600 },
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
