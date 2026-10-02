/**
 * GENERATION-PARITY GUARD — the committed artifacts must byte-match a fresh
 * generation. A stale hand-edit of `dist/tokens.css`, `dist/tokens.dtcg.json`
 * or `src/tokens.generated.ts` (bypassing the generator) FAILS here, so the
 * committed output can never diverge from `buildArtifacts()`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildArtifacts, resolveTokens } from '../src/generate.js';
import { civitaiThemeSource } from '../src/theme.source.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = buildArtifacts();

const CASES: { file: string; key: keyof typeof artifacts }[] = [
  { file: 'dist/tokens.css', key: 'tokens.css' },
  { file: 'dist/tokens.dtcg.json', key: 'tokens.dtcg.json' },
  { file: 'src/tokens.generated.ts', key: 'tokens.generated.ts' },
];

describe('generation parity', () => {
  for (const { file, key } of CASES) {
    it(`${file} matches a fresh generation`, () => {
      const committed = readFileSync(join(pkgRoot, file), 'utf8');
      expect(committed, `${file} is stale — run \`pnpm --filter @civitai/theme build\` and commit`).toBe(
        artifacts[key]
      );
    });
  }

  // `color-scheme` is not a token — it tells the UA which scheme to paint NATIVE
  // controls in. Without it a number input's spinner and a select's caret stay
  // light against a dark surface.
  describe('color-scheme', () => {
    const css = artifacts['tokens.css'];
    const block = (selector: string): string =>
      new RegExp(`${selector} \\{([\\s\\S]*?)\\}`).exec(css)?.[1] ?? '';

    it.each([
      // 🔴 `:root` is DARK. Changing this row is changing the design system's
      // base scheme, not fixing a test.
      [':root', 'dark'],
      ["\\[data-theme='light'\\]", 'light'],
      ["\\[data-theme='dark'\\]", 'dark'],
    ])('%s declares color-scheme: %s', (selector, scheme) => {
      expect(block(selector)).toContain(`color-scheme: ${scheme};`);
    });
  });

  /*
   * 🔴 THE DARK-BASE CONTRACT. Every assertion in this block is part of it —
   * count them rather than trusting a number here; an earlier version said
   * "these three" and was staled twice by assertions added below it, which
   * invites a reader to conclude the surplus ones are not part of the contract
   * and relax one. Each has a failure mode that is invisible in a rendered page
   * until someone reports a light flash or a theme that follows the wrong
   * thing.
   *
   * Pinned as the SHEET's text rather than a computed style on purpose: the
   * absence of an at-rule cannot be observed from a computed value — a page
   * under a dark OS looks identical whether the base is dark or the base is
   * light with an OS-dark override. Only the source can tell them apart.
   */
  describe('dark base, and no OS preference anywhere', () => {
    const css = artifacts['tokens.css'];

    it('declares NO prefers-color-scheme block, in either direction', () => {
      // The old shape was `@media (prefers-color-scheme: dark) {
      // :root:not([data-theme]) { … } }`, which made an unthemed element follow
      // the OS. An OS-LIGHT block would be the same defect mirrored.
      expect(css).not.toContain('prefers-color-scheme');
    });

    /*
     * 🔴 THIS SHEET CARRIES NO CASCADE LAYER, AND THAT IS LOAD-BEARING FOR
     * CONSUMERS — it is why a consumer's `:root { --civitai-…: }` only TIES
     * with the blocks below (both 0-1-0) and stylesheet order decides, which
     * is the whole reason `@civitai/components`' MARKUP.md tells authors to
     * SCOPE a token override instead.
     *
     * Asserted HERE because this is the defining property, in the package that
     * owns it. `@civitai/components`' `test/token-override-order.browser.test.ts`
     * pins the consumer-visible CONSEQUENCE at the chromium tier; a downstream
     * consequence in another package is evidence, not a tripwire.
     *
     * 🔴 THERE ARE TWO WAYS TO MAKE AN UNLAYERED CONSUMER `:root` WIN, AND BOTH
     * ARE PINNED, because an earlier version of this comment claimed one
     * assertion covered both and it did not. A `@layer` wrap is caught by the
     * substring check; giving the base block ZERO specificity (`:where(:root)`)
     * is invisible to it — measured, that mutation left this assertion GREEN
     * and instead emptied two unrelated `/:root \{/` regexes above, whose
     * messages read as "the `:root` block lost its declarations" and invite
     * someone to widen those regexes and ship the cascade change with this
     * tripwire still green. So the selector shape is asserted too.
     */
    it('declares NO cascade layer — the tokens are unlayered on purpose', () => {
      expect(css).not.toContain('@layer');
    });

    it('declares its base block at full specificity — not zero-specificity', () => {
      // The property is SPECIFICITY, so assert that and nothing narrower.
      // `:where(…)` anywhere in this sheet drops a block to 0-0-0 and hands
      // consumers a different cascade.
      expect(css).not.toContain(':where(');
      // 🔴 A SELECTOR LIST IS ALLOWED, DELIBERATELY. An earlier version asserted
      // `toContain(':root {')`, which reddens on `:root, :host { … }` — a change
      // that adds shadow-root support and alters NOTHING about specificity or
      // the consumer cascade — and reddened it with this test's name, blaming
      // zero-specificity when nothing became zero-specificity. A guard whose
      // message misdiagnoses is worse than one that stays quiet, because the
      // fix it suggests is to loosen the wrong thing.
      expect(css).toMatch(/(^|\})\s*:root[\s,{]/);
    });

    it(":root carries the DARK value for every token that has one", () => {
      const { root, dark } = resolveTokens();
      const rootBlock = /:root \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
      expect(Object.keys(dark).length).toBeGreaterThan(10); // positive control
      for (const [varName, value] of Object.entries(dark)) {
        expect(rootBlock, `${varName} must be dark in :root`).toContain(`${varName}: ${value};`);
      }
      // And a token with no dark override keeps the shared value, so the base
      // is not silently dropping anything.
      const shared = Object.keys(root).filter((v) => !(v in dark));
      expect(shared.length).toBeGreaterThan(5); // positive control
      for (const varName of shared) {
        expect(rootBlock).toContain(`${varName}: ${root[varName]};`);
      }
    });

    /*
     * ⚠️ INVARIANT GUARD, not regression coverage — stated so nobody counts it
     * as the latter. Measured: this one assertion is GREEN against the
     * pre-flip generator, because the light block was already a full mirror.
     * The other three in this describe are red there. What makes it worth
     * keeping is that the flip changes its CONSEQUENCE: before, an omission
     * here fell back to a light `:root` and was invisible; now it falls back to
     * a dark one and shows.
     */
    it("[data-theme='light'] is a FULL mirror, not a diff — it is the only way back to light", () => {
      const { root, dark } = resolveTokens();
      const lightBlock = /\[data-theme='light'\] \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
      // Every token :root sets dark must be restated here, or a light subtree
      // inherits dark values for the ones that were omitted.
      for (const varName of Object.keys(dark)) {
        expect(lightBlock, `${varName} must be restated in the light block`).toContain(
          `${varName}: ${root[varName]};`
        );
      }
    });
  });

  // --- issue #181 F8: the dark theme block must carry --civitai-color-primary-fg
  // for symmetry with light (it was previously omitted because its resolved dark
  // value equals light and the generator skips equal-value dark overrides). It is
  // now force-emitted via TokenSpec.alwaysDark — GENERATED, not hand-authored.
  describe('dark --civitai-color-primary-fg symmetry (#181 F8)', () => {
    const PRIMARY_FG = '--civitai-color-primary-fg';
    const { root, dark } = resolveTokens();

    it('is emitted into the dark map, derived (white), matching the light contrast color', () => {
      expect(dark, `${PRIMARY_FG} must be present in the dark block`).toHaveProperty(PRIMARY_FG);
      // Derived from Mantine's --mantine-primary-color-contrast in the dark
      // scheme; the contrast on both primary shades is white.
      expect(dark[PRIMARY_FG]).toBe('#fefefe');
      // Same value as light (symmetry, not a different color).
      expect(dark[PRIMARY_FG]).toBe(root[PRIMARY_FG]);
    });

    it("appears in the generated [data-theme='dark'] CSS block", () => {
      const css = artifacts['tokens.css'];
      const darkBlock = /\[data-theme='dark'\] \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
      expect(darkBlock, "dark block must declare --civitai-color-primary-fg").toContain(
        `${PRIMARY_FG}: #fefefe;`
      );
    });

    it('leaves the light/:root value unchanged (#fefefe)', () => {
      expect(root[PRIMARY_FG]).toBe('#fefefe');
    });
  });

  // --- issue #181 F7: the full 10-step Mantine gray ramp is exposed as
  // --civitai-color-gray-0…-9, GENERATED from the vendored (drift-guarded) gray
  // tuple via the token pipeline — never hand-authored. These assertions pin
  // presence, count, provenance (each step == Mantine gray[N]), and that the
  // ramp is additive (the pre-existing semantic neutrals are untouched).
  describe('neutral gray ramp (#181 F7)', () => {
    const { root, dark } = resolveTokens();
    const grayTuple = (civitaiThemeSource.colors as Record<string, readonly string[]>).gray!;

    it('emits all 10 --civitai-color-gray-N tokens into :root', () => {
      for (let i = 0; i < 10; i++) {
        expect(root, `--civitai-color-gray-${i} must be present`).toHaveProperty(
          `--civitai-color-gray-${i}`
        );
      }
      const grayVars = Object.keys(root).filter((k) => /^--civitai-color-gray-\d$/.test(k));
      expect(grayVars, 'exactly 10 gray ramp steps').toHaveLength(10);
    });

    it('each step is GENERATED from the vendored Mantine gray[N] tuple', () => {
      for (let i = 0; i < 10; i++) {
        expect(
          root[`--civitai-color-gray-${i}`]!.toLowerCase(),
          `gray-${i} must derive from Mantine gray[${i}]`
        ).toBe(grayTuple[i]!.toLowerCase());
      }
    });

    it('is a raw palette — scheme-independent (no dark overrides emitted)', () => {
      for (let i = 0; i < 10; i++) {
        expect(dark, `gray-${i} must NOT be in the dark block (light == dark)`).not.toHaveProperty(
          `--civitai-color-gray-${i}`
        );
      }
    });

    it('appears in the generated tokens.css :root + typed JS export, only as --civitai-*', () => {
      const css = artifacts['tokens.css'];
      for (let i = 0; i < 10; i++) {
        expect(css).toContain(`--civitai-color-gray-${i}: ${grayTuple[i]};`);
      }
      // css-integrity: the resolved stylesheet references no raw --mantine-* names.
      expect(css).not.toContain('--mantine-');
      const ts = artifacts['tokens.generated.ts'];
      for (let i = 0; i < 10; i++) expect(ts).toContain(`"colorGray${i}"`);
    });

    it('is ADDITIVE — the pre-existing semantic neutrals are unchanged', () => {
      expect(root['--civitai-color-border']).toBe('#ced4da');
      expect(root['--civitai-color-surface']).toBe('#fefefe');
      expect(root['--civitai-color-text-dimmed']).toBe('#868e96');
    });
  });

  it('DTCG export is valid JSON with $value/$type on every leaf', () => {
    const dtcg = JSON.parse(artifacts['tokens.dtcg.json']) as Record<string, Record<string, unknown>>;
    for (const group of Object.values(dtcg)) {
      for (const token of Object.values(group)) {
        const t = token as Record<string, unknown>;
        expect(t.$value, 'token missing $value').toBeDefined();
        expect(t.$type, 'token missing $type').toBeDefined();
      }
    }
  });
});
