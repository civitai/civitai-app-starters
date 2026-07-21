/**
 * HEADLINE TEST — dual-consumption parity.
 *
 * For every component/variant/size, render (a) the `@civitai/components-react`
 * component and (b) hand-written plain HTML with the same `data-*` contract,
 * then assert IDENTICAL key computed styles (color, background, border, radius,
 * padding, font, size) in BOTH `[data-theme='light']` and `[data-theme='dark']`.
 *
 * Passing this proves generic HTML renders byte-identically to React — the core
 * claim of the 3-layer design system.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { CASES } from './fixtures.js';
import { ensureStyles, mountHtml, mountReact } from './render.js';

const THEMES = ['light', 'dark'] as const;

beforeAll(() => {
  ensureStyles();
});

for (const theme of THEMES) {
  describe(`computed-style parity — [data-theme='${theme}']`, () => {
    for (const c of CASES) {
      it(c.id, () => {
        const react = mountReact(theme, c.node);
        const html = mountHtml(theme, c.html);
        try {
          const rEl = react.mount.querySelector(c.selector);
          const hEl = html.mount.querySelector(c.selector);
          expect(rEl, `react: no element for ${c.selector}`).toBeTruthy();
          expect(hEl, `html: no element for ${c.selector}`).toBeTruthy();

          const rCs = getComputedStyle(rEl!);
          const hCs = getComputedStyle(hEl!);

          const diffs: string[] = [];
          for (const prop of c.compare) {
            const rv = (rCs as unknown as Record<string, string>)[prop];
            const hv = (hCs as unknown as Record<string, string>)[prop];
            // Both must be a real resolved value (guards a typo'd property name
            // that would make both `undefined` and vacuously "match").
            expect(rv, `computed ${prop} missing on react element`).toBeTruthy();
            if (rv !== hv) diffs.push(`  ${prop}: react=${JSON.stringify(rv)} html=${JSON.stringify(hv)}`);
          }
          expect(diffs, `[${theme}] ${c.id} — React and HTML diverge:\n${diffs.join('\n')}`).toEqual([]);
        } finally {
          react.cleanup();
          html.cleanup();
        }
      });
    }
  });
}
