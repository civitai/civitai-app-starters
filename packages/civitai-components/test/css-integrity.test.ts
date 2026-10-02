/**
 * @civitai/components CSS integrity:
 *   - generation parity: dist/components.css === src/components.css, and the
 *     JS-injectable string embeds the same CSS byte-for-byte.
 *   - token discipline: the shipped CSS references `--civitai-*` tokens and
 *     NEVER the old `--ci-*` or raw `--mantine-*` names (the drift being fixed).
 *   - layering: every rule is inside `@layer civitai.components`.
 *   - no OS colour-scheme preference, anywhere this package authors CSS.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { componentsCss } from '../src/styles.generated.js';
import { VERSION } from '../src/version.generated.js';
import pkg from '../package.json' with { type: 'json' };

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcCss = readFileSync(join(pkgRoot, 'src/components.css'), 'utf8');
const distCss = readFileSync(join(pkgRoot, 'dist/components.css'), 'utf8');

describe('components CSS integrity', () => {
  it('dist/components.css matches the source', () => {
    expect(distCss).toBe(srcCss);
  });

  it('the JS-injectable string embeds the source CSS', () => {
    expect(componentsCss).toBe(srcCss);
  });

  /*
   * 🔴 THIS CANNOT SEE A STALE COMMIT, AND IT READS AS IF IT COULD. CI builds
   * this package before testing it (`.github/workflows/ci.yml`, the
   * `design-system` job) and the build rewrites `src/version.generated.ts` from
   * package.json — so what this asserts is that the GENERATOR stamped the right
   * version, never that the version in git is current. `0.8.1` sat committed
   * against a `0.9.0` package.json from #492 onward with this test green
   * throughout.
   *
   * The committed file is checked by `scripts/check-generated-version.mjs`
   * (`pnpm check:generated-version`), which reads it as text and runs BEFORE any
   * build step. Keep both: this one owns the generator, that one owns the
   * commit.
   */
  it('the stamped element version matches package.json (post-BUILD: see the note above)', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('references --civitai-* tokens', () => {
    expect(srcCss).toMatch(/var\(--civitai-color-primary\)/);
    expect((srcCss.match(/--civitai-/g) ?? []).length).toBeGreaterThan(20);
  });

  it('does NOT reference legacy --ci-* or raw --mantine-* tokens', () => {
    // `--civitai-` contains `--ci`, so assert the standalone `--ci-<word>` form
    // is absent rather than a bare substring.
    expect(srcCss).not.toMatch(/--ci-[a-z]/);
    expect(srcCss).not.toContain('--mantine-');
  });

  it('wraps all rules in @layer civitai.components', () => {
    expect(srcCss).toContain('@layer civitai.components {');
    // No selector rule should sit outside the layer: the only top-level `{`
    // block is the @layer itself. Strip the layer block and assert no stray
    // `[data-civitai-ui` selectors remain at top level.
    const withoutLayer = srcCss.replace(/@layer civitai\.components \{[\s\S]*\}\s*$/, '');
    expect(withoutLayer).not.toContain('[data-civitai-ui');
  });
});

/*
 * 🔴 NO OS COLOUR-SCHEME PREFERENCE IN THIS PACKAGE'S CSS — an INVARIANT
 * GUARD, not regression coverage. There are zero occurrences in `src/` today,
 * so it has never caught anything and nothing it forbids has ever shipped here;
 * it exists to keep it that way now that the dark-OS browser project which used
 * to watch this surface is gone. Do not count it as a regression test.
 *
 * It replaces that project. `vitest.config.ts` carries the argument for the
 * retirement — read it THERE, not here: this comment deliberately does not
 * restate it, because the same argument living in three files is how three
 * copies drift apart.
 *
 * Pinned at SOURCE because the absence of an at-rule cannot be observed from a
 * computed value, which is the same reason `@civitai/theme` pins its half as
 * text in `test/generation-parity.test.ts`. The corpus is wider than the
 * retired project's reach: the authored sheet, both committed generated sheets,
 * and every element's shadow-DOM `css` template.
 *
 * ⚠️ SCOPE, stated so this is not read wider than it is — it reads authored
 * text under `src/` plus the two generated root sheets. Outside it: a
 * `prefers-color-scheme` in a third-party sheet a consumer loads, and any JS
 * `matchMedia` branch. ⚠️ `playground/main.ts` HAS such a branch — an earlier
 * version of this comment claimed "there are none of either in this package",
 * which was false; the true claim is `src/`-scoped. That file is a local dev
 * page, is not published, and is deliberately not in the corpus. Neither case
 * was in the retired project's reach either.
 */
describe('no OS colour-scheme preference in the component CSS', () => {
  /*
   * Every surface this package authors or ships CSS in: everything under
   * `src/`, plus the two committed generated root sheets (which sit outside it).
   *
   * 🔴 THE `src/` WALK IS RECURSIVE AND EXTENSION-DRIVEN ON PURPOSE. An earlier
   * version enumerated `src/elements/*.ts`, which silently excluded `src/sdk/`
   * — where `civitai-sign-in-button` and `civitai-workflow-button`, both
   * PUBLISHED export keys, author shadow-DOM `css` templates. So the comment
   * claimed "every element's template" while an at-rule planted in either one
   * reached `dist/` with all 293 tests green. A walk cannot reacquire that gap
   * when someone adds a directory; a hand-written list of directories can, and
   * did.
   *
   * `dist/` is deliberately absent because it is a COPY of `src/components.css`
   * — asserted byte-identical two tests above — so scanning it would add a
   * second reading of the same bytes, not a second surface.
   *
   * 🔴 THAT IS NOT INDEPENDENCE FROM THE BUILD, and an earlier version of this
   * comment claimed it was. This module reads `dist/components.css` at the top
   * level (line 22), so it cannot even IMPORT without a build — measured by
   * removing that file: `Error: ENOENT` and `Tests no tests`, which reads as a
   * skipped tier rather than a failure. Nothing here buys build-independence;
   * excluding `dist/` only avoids double-counting.
   */
  const walk = (dir: string): string[] =>
    readdirSync(join(pkgRoot, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : /\.(ts|css)$/.test(entry.name)
          ? [`${dir}/${entry.name}`]
          : []
    );

  /** Generated, committed, published — and OUTSIDE `src/`, so named explicitly. */
  const ROOT_SHEETS = ['utilities.css', 'bootstrap-compat.css'];

  const corpus = [...ROOT_SHEETS, ...walk('src')].map((file) => ({
    file,
    text: readFileSync(join(pkgRoot, file), 'utf8'),
  }));

  const hits = (text: string): number => (text.match(/prefers-color-scheme/g) ?? []).length;

  it('reads the NAMED surfaces, and a corpus big enough to be the real one', () => {
    // POSITIVE CONTROL on the CORPUS. The verdict below is a zero, and a zero
    // is only evidence if something was read: a glob that resolves to nothing,
    // or to one stub file, reports a perfectly clean sweep.
    const files = corpus.map((c) => c.file);

    // 🔴 THE NAMED SURFACES COME FIRST, BECAUSE A COUNT CANNOT SEE THE LOSS OF
    // A SPECIFIC ONE. Measured: drop the three CSS sheets and ~100 element
    // files remain — comfortably over any floor — while the stylesheet this
    // package exists to ship goes unscanned, and an at-rule planted in it
    // passes. A cardinality floor is blind to exactly the surface that matters
    // most.
    expect(files).toEqual(
      expect.arrayContaining(['src/components.css', ...ROOT_SHEETS])
    );
    // The two PUBLISHED sdk elements — the gap the directory-enumerated corpus
    // had. Named, not merely counted, so the walk losing that directory fails
    // here rather than silently shrinking the corpus by two.
    expect(files).toEqual(
      expect.arrayContaining([
        'src/sdk/civitai-sign-in-button.ts',
        'src/sdk/civitai-workflow-button.ts',
      ])
    );

    // The floor sits well under the live figure (126 files when written), so
    // adding or removing components cannot trip it.
    //
    // There was a second floor here, on the corpus's total BYTES. Deleted
    // rather than kept: no mutation was found that it kills and this one does
    // not — and it is blind in the same direction, since the three CSS sheets
    // are only ~28% of the bytes, so a floor set "well under" the live figure
    // survives their removal too. The named-surface assertions above are what
    // actually close that. Re-add a byte floor only with a mutant only it
    // catches.
    expect(corpus.length).toBeGreaterThan(60);
  });

  it('can see the thing it forbids', () => {
    // POSITIVE CONTROL on the MATCHER, which the corpus control cannot give: a
    // mis-typed pattern finds nothing in a clean tree and nothing in a dirty
    // one, and those two are indistinguishable from the result alone.
    expect(hits('@media (prefers-color-scheme: dark) { :root { color: red } }')).toBe(1);
  });

  it('declares none, in either direction, in any of them', () => {
    // An OS-LIGHT block is the same defect mirrored, so the at-rule's NAME is
    // the hazard rather than either value it can carry.
    const offenders = corpus.filter(({ text }) => hits(text) > 0).map(({ file }) => file);
    expect(
      offenders,
      'component CSS must not consult the OS colour scheme — the theme is the page\'s to declare, via data-theme'
    ).toEqual([]);
  });
});
