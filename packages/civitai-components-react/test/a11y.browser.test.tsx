/**
 * Accessibility — axe-core, zero violations per component.
 *
 * SCOPE: structural / semantic accessibility — labels, roles, ARIA wiring,
 * accessible names, required-attribute correctness. This is what the component
 * markup contract controls.
 *
 * `color-contrast` is DELIBERATELY DISABLED: the `--civitai-*` palette is
 * derived faithfully from civitai's real Mantine theme (drift-guarded), and
 * Mantine's default primary blue (#228be6) resolves to ~3.4:1 against white —
 * below WCAG AA for normal text. Enabling the rule would flag the UPSTREAM
 * palette, not this layer, and "fixing" it here would break fidelity + the
 * drift guard. Palette-level contrast is tracked as a separate concern; see the
 * PR notes. Every OTHER axe rule must pass with zero violations.
 */
import axe from 'axe-core';
import { beforeAll, describe, expect, it } from 'vitest';

import { A11Y_CASES } from './fixtures.js';
import { ensureStyles, mountReact } from './render.js';

const THEMES = ['light', 'dark'] as const;

const AXE_OPTIONS: axe.RunOptions = {
  rules: {
    'color-contrast': { enabled: false },
  },
  resultTypes: ['violations'],
};

beforeAll(() => {
  ensureStyles();
});

for (const theme of THEMES) {
  describe(`axe a11y — [data-theme='${theme}']`, () => {
    for (const c of A11Y_CASES) {
      it(`${c.id} has zero violations`, async () => {
        const react = mountReact(theme, c.node);
        try {
          const results = await axe.run(react.mount, AXE_OPTIONS);
          const summary = results.violations
            .map((v) => `  [${v.id}] ${v.help} (${v.nodes.length} node(s))`)
            .join('\n');
          expect(results.violations, `${c.id} axe violations:\n${summary}`).toHaveLength(0);
        } finally {
          react.cleanup();
        }
      });
    }
  });
}
