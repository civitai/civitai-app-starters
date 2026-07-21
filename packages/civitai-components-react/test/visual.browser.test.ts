/**
 * Visual regression (SOFT layer). Per-component screenshot in light + dark.
 *
 * SKIPPED BY DEFAULT. Screenshot pixels depend on the host's font rasterizer,
 * which is not deterministic across this sandbox's nix Chromium and a CI image,
 * so committing baselines here would produce false failures elsewhere. The
 * tests are written and runnable — enable with `VITE_RUN_VR=1` on a machine whose
 * renderer matches the committed baselines (e.g. the CI container), then commit
 * the generated `__screenshots__`. This is intentionally decoupled from the
 * core parity + axe suite so VR flakiness can never block them.
 */
import { page } from 'vitest/browser';
import { beforeAll, describe, expect, it } from 'vitest';

import { A11Y_CASES } from './fixtures.js';
import { ensureStyles, mountReact } from './render.js';

// Browser context has no `process`; read the opt-in via Vite's import.meta.env.
// Enable with `VITE_RUN_VR=1 pnpm test:browser`.
const RUN_VR = import.meta.env.VITE_RUN_VR === '1';
const THEMES = ['light', 'dark'] as const;

beforeAll(() => {
  ensureStyles();
});

describe.skipIf(!RUN_VR)('visual regression', () => {
  for (const theme of THEMES) {
    for (const c of A11Y_CASES) {
      it(`${c.id} — ${theme}`, async () => {
        const react = mountReact(theme, c.node);
        try {
          const el = react.mount.querySelector(c.selector) ?? react.mount;
          await expect(page.elementLocator(el)).toMatchScreenshot(`${c.id}-${theme}`);
        } finally {
          react.cleanup();
        }
      });
    }
  }
});
