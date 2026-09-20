/**
 * Per-component CSS split — the guard that makes every sliced artifact
 * trustworthy, plus its negative control.
 *
 * THE CLAIM UNDER TEST is a RELATIONSHIP, not a component: the 14 slices this
 * package emits are a faithful PARTITION of `src/components.css`. A slicer that
 * silently dropped a section would still produce valid-looking CSS files, a
 * green build, and an export map that resolves — the defect would surface as
 * "one element renders unstyled in one app" with nothing pointing back here.
 *
 * So the suite asserts, in both directions:
 *   - reassembly is BYTE-identical to the source sheet (and a deliberately
 *     lossy slice FAILS, naming the byte gap — the negative control below);
 *   - every emitted `dist/css/<slug>.css` is exactly the composed slice;
 *   - every emitted `src/css/<slug>.generated.ts` string equals that file;
 *   - the set of `./css/*` exports in package.json equals the set of slugs the
 *     slicer produces — failing when either side GROWS or SHRINKS;
 *   - every declared `COMPONENT_NAME` has a subpath;
 *   - `componentsCss` (the whole-pack contract) still carries EVERY section.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertLossless,
  composeSheet,
  cssSlices,
  sliceComponentsCss,
  type CssSplit,
} from '../scripts/slice-css.js';
import { COMPONENT_NAMES, componentsCss } from '../src/index.js';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcCssPath = join(pkgRoot, 'src/components.css');
const srcCss = readFileSync(srcCssPath, 'utf8');
const split = sliceComponentsCss(srcCss);
const slices = cssSlices(split);

const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
  exports: Record<string, string | { types: string; import: string }>;
};

/** Every section marker present in the source sheet, e.g. `/* ----- Button ----- *\/`. */
const MARKERS = srcCss.match(/^ {2}\/\* ----- .+? ----- \*\/$/gm) ?? [];

describe('per-component CSS slicing', () => {
  it('splits the sheet into every marked section (coverage floor)', () => {
    // Without a floor, a slicer that found ONE section would satisfy the
    // lossless check below vacuously (base + one section == the whole inner).
    expect(MARKERS.length).toBeGreaterThanOrEqual(14);
    expect(split.sections).toHaveLength(MARKERS.length);
    expect(slices).toHaveLength(MARKERS.length);
  });

  it('reassembles BYTE-identically to src/components.css', () => {
    const reassembled = composeSheet(split, split.sections);
    // Three claims, deliberately separate. `String.length` counts UTF-16 code
    // units, NOT bytes — the sheet carries em dashes, so the two numbers differ
    // (31,900 units vs 31,970 bytes at the time of writing) and quoting one as
    // the other would be a wrong number that looks right. The byte count is
    // compared against the file ON DISK, not against a re-encode of what we
    // already read.
    expect(reassembled.length).toBe(srcCss.length);
    expect(Buffer.byteLength(reassembled, 'utf8')).toBe(statSync(srcCssPath).size);
    expect(reassembled).toBe(srcCss);
    // `assertLossless` is what the build writer actually calls; exercise it.
    expect(() => assertLossless(split, srcCss)).not.toThrow();
  });

  /* ── the NEGATIVE CONTROL ────────────────────────────────────────────────
   * A guard nobody has watched fail proves nothing. These two cases mutate the
   * split the exact way a broken slicer would and assert THIS guard's own
   * error fires — matched on its `[slice] LOSSY` prefix and the byte gap, so a
   * different check throwing first (missing `@layer` opener, zero sections)
   * would NOT satisfy them. Reachability: both mutants are built FROM the
   * real, successfully-parsed split, so every earlier check has already run
   * and passed by the time `assertLossless` is reached.
   * ──────────────────────────────────────────────────────────────────────── */

  function lossyBy(bytes: number): CssSplit {
    const [first, ...rest] = split.sections;
    if (!first) throw new Error('fixture: no sections');
    return { ...split, sections: [{ ...first, text: first.text.slice(0, -bytes) }, ...rest] };
  }

  it('NEGATIVE CONTROL: a 13-byte-lossy slice fails, naming the gap', () => {
    const mutant = lossyBy(13);
    expect(() => assertLossless(mutant, srcCss)).toThrowError(
      new RegExp(
        `^\\[slice\\] LOSSY: reassembled sheet is ${srcCss.length - 13} B, ` +
          `source is ${srcCss.length} B \\(gap 13 B\\)\\.`
      )
    );
  });

  it('NEGATIVE CONTROL: dropping a whole section fails, naming the gap', () => {
    const dropped = split.sections[3];
    if (!dropped) throw new Error('fixture: fewer than 4 sections');
    const mutant: CssSplit = {
      ...split,
      sections: split.sections.filter((s) => s !== dropped),
    };
    expect(dropped.text.length).toBeGreaterThan(0);
    expect(() => assertLossless(mutant, srcCss)).toThrowError(
      new RegExp(
        `^\\[slice\\] LOSSY: reassembled sheet is ${srcCss.length - dropped.text.length} B, ` +
          `source is ${srcCss.length} B \\(gap ${dropped.text.length} B\\)\\.`
      )
    );
  });

  it('each slice is a standalone layered sheet carrying only its own section', () => {
    for (const slice of slices) {
      expect(slice.css.startsWith(split.header), slice.slug).toBe(true);
      expect(slice.css).toContain('@layer civitai.components {');
      expect(slice.css.endsWith(split.tail), slice.slug).toBe(true);
      // Exactly one section marker — its own.
      expect((slice.css.match(/^ {2}\/\* ----- .+? ----- \*\/$/gm) ?? []).length, slice.slug).toBe(
        1
      );
      // The shared base rule rides along so the slice stands alone.
      expect(slice.css, slice.slug).toContain(split.base);
    }
  });
});

describe('emitted per-component artifacts', () => {
  it('dist/css/<slug>.css matches the composed slice', () => {
    for (const slice of slices) {
      const file = join(pkgRoot, 'dist/css', `${slice.slug}.css`);
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, 'utf8'), slice.slug).toBe(slice.css);
    }
  });

  it('the JS-injectable string per slice embeds the same CSS', async () => {
    // `.ts` (not `.js`) so vite can resolve the variable dynamic import against
    // files that actually exist in `src/`.
    for (const slice of slices) {
      const mod = (await import(`../src/css/${slice.slug}.generated.ts`)) as { css: string };
      expect(mod.css, slice.slug).toBe(slice.css);
    }
  });
});

describe('./css/* subpath exports', () => {
  /** `./css/button` and `./css/button.css`, expected exactly once per slug. */
  const expected = new Map<string, string>();
  for (const slice of slices) {
    for (const slug of slice.slugs) {
      expected.set(`./css/${slug}`, slice.slug);
      expected.set(`./css/${slug}.css`, slice.slug);
    }
  }
  const declared = Object.keys(pkg.exports).filter((k) => k.startsWith('./css/'));

  it('declares exactly one subpath pair per component slug', () => {
    // Set equality in BOTH directions: a slug added to the sheet without an
    // export, or an export left behind after a section is renamed, both fail.
    expect(new Set(declared)).toEqual(new Set(expected.keys()));
    expect(declared.length).toBe(expected.size);
    // Literal floor so the pair above cannot agree at zero: 21 component slugs
    // (14 sections' own names + 7 group/alias names) x 2 subpaths each.
    expect(new Set(slices.flatMap((s) => s.slugs)).size).toBe(21);
    expect(declared.length).toBe(42);
  });

  it('every subpath target exists on disk and points at the right slice', () => {
    for (const [subpath, owningSlug] of expected) {
      const entry = pkg.exports[subpath];
      if (subpath.endsWith('.css')) {
        expect(entry, subpath).toBe(`./dist/css/${owningSlug}.css`);
        expect(existsSync(join(pkgRoot, `dist/css/${owningSlug}.css`)), subpath).toBe(true);
      } else {
        expect(entry, subpath).toEqual({
          types: `./dist/css/${owningSlug}.generated.d.ts`,
          import: `./dist/css/${owningSlug}.generated.js`,
        });
        expect(existsSync(join(pkgRoot, `dist/css/${owningSlug}.generated.js`)), subpath).toBe(
          true
        );
        expect(existsSync(join(pkgRoot, `dist/css/${owningSlug}.generated.d.ts`)), subpath).toBe(
          true
        );
      }
    }
  });

  it('every declared COMPONENT_NAME has a subpath', () => {
    for (const name of COMPONENT_NAMES) {
      expect(declared, name).toContain(`./css/${name}`);
    }
  });
});

describe('whole-pack contract (deliberately UNCHANGED by the split)', () => {
  /**
   * `useBlocksStyles()` in @civitai/blocks-react injects the WHOLE pack, which
   * MARKUP.md documents: rendering any one `/ui` component is enough to style
   * hand-written `data-civitai-ui="…"` markup elsewhere on the page. Narrowing
   * `componentsCss` onto a slice would realise the bundle win and break that
   * contract silently — nothing would error, some markup would just stop being
   * styled. This pins the whole-pack shape until that decision is made
   * deliberately (issue #358).
   */
  it('componentsCss still carries EVERY section of the sheet', () => {
    expect(componentsCss).toBe(srcCss);
    for (const marker of MARKERS) {
      expect(componentsCss, marker).toContain(marker);
    }
    expect(MARKERS.length).toBeGreaterThanOrEqual(14);
  });
});
