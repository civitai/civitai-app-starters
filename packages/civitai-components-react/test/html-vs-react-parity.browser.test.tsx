/**
 * HEADLINE TEST — dual-consumption.
 *
 * Two independent claims, proven by two blocks:
 *
 *  1. CONSUMER-EQUIVALENCE (the `computed-style parity` block): for every
 *     component/variant/size, the `@civitai/components-react` render and
 *     hand-written plain HTML with the same `data-*` contract produce IDENTICAL
 *     key computed styles in both themes. This proves React ≡ HTML *as
 *     consumers of the same stylesheet* — but on its own it is NOT proof the
 *     design-system CSS is doing anything: if no stylesheet were applied, both
 *     paths would fall back to identical UA defaults and still match.
 *
 *  2. STYLING-CORRECTNESS (the `styling anchors` block): absolute assertions
 *     that specific computed values equal the DERIVED TOKENS (primary fill, a
 *     dark-theme surface, the token radius) — values that can only come from
 *     the `@civitai/components` + `@civitai/theme` CSS, never from UA defaults.
 *     These anchors are what make the equality block meaningful: neuter
 *     `injectStyles()` and the anchors FAIL (verified), even though the pure
 *     equality assertions would still pass.
 *
 * Together: the anchors prove the CSS renders the intended (token-derived)
 * styling, and the equality block proves generic HTML gets byte-identically
 * that same styling as React.
 */
import { darkTokens, tokens } from '@civitai/theme';
import { beforeAll, describe, expect, it } from 'vitest';

import { Button, Card } from '../src/index.js';
import { CASES } from './fixtures.js';
import { ensureStyles, mountHtml, mountReact } from './render.js';

const THEMES = ['light', 'dark'] as const;

beforeAll(() => {
  ensureStyles();
});

/** `#228BE6` / `#1a1b1e` → `rgb(34, 139, 230)` (getComputedStyle's opaque form). */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

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

/**
 * STYLING-CORRECTNESS ANCHORS — absolute values tied to the derived tokens, so
 * a green suite can't be a "no stylesheet, both fall back to UA defaults"
 * tautology. Asserted on BOTH the React and the HTML render (proving the
 * anchored, token-derived styling reaches both consumers).
 */
describe('styling anchors (token-derived, UA-default-proof)', () => {
  const expectedPrimaryLight = hexToRgb(tokens.colorPrimary); // #228BE6 -> rgb(34, 139, 230)
  const expectedSurfaceLight = hexToRgb(tokens.colorSurface); // #fefefe -> rgb(254, 254, 254)
  const expectedSurfaceDark = hexToRgb(darkTokens.colorSurface); // #1A1B1E -> rgb(26, 27, 30)

  function bg(theme: string, node: React.ReactElement, html: string, selector: string): { react: string; html: string } {
    const r = mountReact(theme, node);
    const h = mountHtml(theme, html);
    try {
      const react = getComputedStyle(r.mount.querySelector(selector)!).backgroundColor;
      const htmlV = getComputedStyle(h.mount.querySelector(selector)!).backgroundColor;
      return { react, html: htmlV };
    } finally {
      r.cleanup();
      h.cleanup();
    }
  }

  it('(a) filled Button background === derived primary in light', () => {
    const { react, html } = bg(
      'light',
      <Button variant="filled" size="md">Go</Button>,
      `<button data-civitai-ui="button" data-variant="filled" data-size="md" type="button">Go</button>`,
      '[data-civitai-ui="button"]'
    );
    expect(react).toBe(expectedPrimaryLight);
    expect(html).toBe(expectedPrimaryLight);
    // Meaningless-proof: this is NOT a UA-default button background.
    expect(react).not.toBe(expectedSurfaceLight);
  });

  it('(b) Card background tracks the theme: light vs dark surface tokens', () => {
    const cardNode = (
      <Card withBorder padding="md">
        x
      </Card>
    );
    const cardHtml = `<div data-civitai-ui="card" data-with-border="true" data-padding="md">x</div>`;
    const sel = '[data-civitai-ui="card"]';

    const light = bg('light', cardNode, cardHtml, sel);
    const dark = bg('dark', cardNode, cardHtml, sel);

    expect(light.react).toBe(expectedSurfaceLight);
    expect(light.html).toBe(expectedSurfaceLight);
    expect(dark.react).toBe(expectedSurfaceDark);
    expect(dark.html).toBe(expectedSurfaceDark);
    // The dark surface must actually differ from light — proves [data-theme]
    // token overrides are applied, not a single static value.
    expect(dark.react).not.toBe(light.react);
  });

  it('(c) filled Button border-radius === token radius (0.25rem = 4px), non-zero', () => {
    const r = mountReact('light', <Button variant="filled" size="md">Go</Button>);
    const h = mountHtml(
      'light',
      `<button data-civitai-ui="button" data-variant="filled" data-size="md" type="button">Go</button>`
    );
    try {
      const rRadius = getComputedStyle(r.mount.querySelector('[data-civitai-ui="button"]')!).borderTopLeftRadius;
      const hRadius = getComputedStyle(h.mount.querySelector('[data-civitai-ui="button"]')!).borderTopLeftRadius;
      // --civitai-radius resolves to 0.25rem; at the 16px root that is 4px.
      expect(rRadius).toBe('4px');
      expect(hRadius).toBe('4px');
      expect(rRadius).not.toBe('0px');
    } finally {
      r.cleanup();
      h.cleanup();
    }
  });
});
