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
 * SCOPE — exactly this, and the statement is positive rather than a chain of
 * corrections: it reads CODE (comments stripped) under `src/`, plus the two
 * generated root sheets. Within that it catches a `prefers-color-scheme` in any
 * form — a CSS at-rule, and equally a JS `matchMedia('(prefers-color-scheme:
 * …)')`. Outside it: third-party sheets a consumer loads, anything beyond
 * `src/` and those two sheets, and prose. `playground/main.ts` has a
 * `matchMedia` branch and is deliberately out — a local dev page, never
 * published.
 *
 * ⚠️ RETRACTED WORDINGS OF THE PARAGRAPH ABOVE, listed so a fourth is not
 * derived. Three rounds each produced one, which is why this is now a list
 * rather than another nested aside:
 *   1. "there are none of either in this package" — false; `playground/` has one.
 *   2. "a JS `matchMedia` branch is outside it" — stopped being true when the
 *      corpus widened from `src/elements/` to all of `src/`.
 *   3. "wherever it is REACHABLE from this package" — wider than the corpus
 *      (`dist/`, `demo/`, `test/` and `playground/` are all reachable).
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
   * `dist/` is deliberately absent, and the reason is simply that it is a BUILD
   * OUTPUT: a guard over committed sources is one a reader can reason about
   * without knowing whether a build has run.
   *
   * ⚠️ TWO EARLIER VERSIONS OF THIS PARAGRAPH GAVE REASONS THAT DO NOT DESCRIBE
   * THE CODE, so they are recorded rather than quietly reworded — a reader who
   * tests a stated reason and finds it false strips `*.generated.ts` from the
   * walk believing the whole note is wrong.
   *   (1) "scanning `dist/` would add a second reading of the same bytes" — the
   *       walk already re-reads this sheet's content many times over, via
   *       `src/styles.generated.ts` and the 15 `src/css/*.generated.ts` slices.
   *   (2) "every one of them a byte-embedding of the same sheet, so an at-rule
   *       in `src/components.css` reports SEVENTEEN offenders" — only
   *       `styles.generated.ts` embeds the whole sheet (41 kB against the
   *       sheet's 40 kB). Each slice is the shared base rule plus ONE component
   *       section (2–9 kB; see `scripts/build-css.ts`, `sliceComponentsCss`).
   *       So the offender count is POSITION-DEPENDENT: an at-rule in the shared
   *       `[data-civitai-ui]` base rule reports 17, one inside a single
   *       section reports 3.
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

  /*
   * 🔴 COMMENTS ARE STRIPPED BEFORE MATCHING, and that is a correctness
   * requirement rather than tidiness. The corpus is 123 `.ts` files, and a
   * docblock that merely NAMES this invariant — "no `@media
   * (prefers-color-scheme: …)` block anywhere in this package" — is exactly the
   * next edit someone makes. Measured on the un-stripped version: such a
   * docblock in `src/index.ts` turned the guard RED with a message blaming CSS,
   * in a file containing none. The identical docblock already exists in two
   * sibling packages' `src/`, so this was a false blocker on a documented and
   * demonstrated habit, not a contrived input.
   *
   * So what this guard means is precise: a `prefers-color-scheme` in CODE. Write
   * about the invariant freely.
   */
  /*
   * 🔴 ONE LEFT-TO-RIGHT PASS, NOT TWO — and this is the whole correctness of
   * the helper. An earlier version stripped block comments in one pass and line
   * comments in a second, so a `/*` appearing INSIDE a `//` comment opened a
   * block the author never opened, and the file's next legitimate comment
   * terminator closed it — deleting everything between from the guard's view,
   * including a real at-rule.
   *
   * Measured before the fix: an `@media (prefers-color-scheme: dark)` in
   * `src/sdk/civitai-workflow-button.ts` (a PUBLISHED export) with a line
   * comment two lines above it containing a glob or a URL wildcard — `// … a/*`
   * or ``// … `<scheme>://*.<suffix>` `` — passed 10/10. Both shapes exist
   * verbatim in sibling packages today (7 such comments across 4 of them), so
   * the authoring habit is live even though this package has none.
   *
   * A single alternation makes `//` consume its own line before any later `/*`
   * can open, because the regex engine takes whichever branch matches first.
   */
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ');

  const hits = (text: string): number =>
    (stripComments(text).match(/prefers-color-scheme/g) ?? []).length;

  it('reads the NAMED surfaces, and a corpus big enough to be the real one', () => {
    // POSITIVE CONTROL on the CORPUS. The verdict below is a zero, and a zero
    // is only evidence if something was read: a glob that resolves to nothing,
    // or to one stub file, reports a perfectly clean sweep.
    const files = corpus.map((c) => c.file);

    // 🔴 THE NAMED SURFACES COME FIRST, BECAUSE A COUNT CANNOT SEE THE LOSS OF
    // A SPECIFIC ONE. Measured: drop the CSS sheets and ~100 element files
    // remain — comfortably over any floor — while the stylesheet this package
    // exists to ship goes unscanned, and an at-rule planted in it passes. A
    // cardinality floor is blind to exactly the surface that matters most.
    //
    // 🔴 EVERY NAME HERE IS A LITERAL, DELIBERATELY DUPLICATING `ROOT_SHEETS`
    // ABOVE. An earlier version wrote `...ROOT_SHEETS` instead, which derived
    // the expectation from the implementation it was testing: the constant fed
    // BOTH the corpus and this assertion, so `ROOT_SHEETS = []` dropped two
    // PUBLISHED exports out of the corpus and shrank this check to match —
    // measured 293/293 GREEN, with an at-rule in the generated `utilities.css`
    // then passing. Each published surface is spelled out so losing one fails
    // here. Do not DRY this back up against the corpus.
    expect(files).toEqual(
      expect.arrayContaining([
        'src/components.css',
        'utilities.css',
        'bootstrap-compat.css',
        // The two PUBLISHED sdk elements — the gap the directory-enumerated
        // corpus had, so the walk losing that directory fails here rather than
        // silently shrinking the corpus by two.
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
    // are only 18.1% of the live corpus's bytes (76,722 of 423,666 over 126
    // files), so a floor set "well under" the live figure survives their
    // removal comfortably. ⚠️ That figure read "~28%" for two rounds: 27.6% was
    // measured over the ROUND-0 corpus of 103 files and never updated when the
    // walk widened. The named-surface assertions above are what
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

  it('does NOT fire on prose that merely names it', () => {
    // NEGATIVE CONTROL half. Both shapes are real — the block form is how this
    // invariant is documented in two sibling packages today.
    expect(hits('/* no @media (prefers-color-scheme: dark) block, deliberately */')).toBe(0);
    expect(hits('// never reach for prefers-color-scheme here')).toBe(0);
    // ...and a comment must not launder an adjacent real one on the same line.
    expect(hits('@media (prefers-color-scheme: dark) { } // and prefers-color-scheme')).toBe(1);
  });

  it('still fires on a real at-rule that FOLLOWS a comment', () => {
    /*
     * 🔴 THIS IS THE HALF THAT PINS "CATCHES NOTHING", AND WITHOUT IT AN INERT
     * STRIPPER PASSES ALL 294 TESTS. Stripping is monotone — it can only ever
     * reduce the hit count — and every corpus file is 0 today, so NO
     * over-stripping mutant can go red on a clean tree. The three expectations
     * above cannot see one either, because none of their inputs has code AFTER
     * a comment. Measured: a line-comment strip made greedy to EOF, and a
     * block-comment strip made greedy from the first opener to the last
     * terminator, both survived the entire suite while deleting essentially
     * every file from the guard's view.
     *
     * (Those two mutants are described rather than spelled, because writing a
     * block-comment terminator inside a block comment ends it — which is how
     * this very comment broke the file once. See the note on the `node` project
     * in `vitest.config.ts` for the same hazard in the same package.)
     *
     * So these two inputs are the discriminator: real code positioned after a
     * comment, in both comment shapes. The second is also F1's exact bug —
     * a glob inside a line comment, then a real at-rule, then a later
     * terminator.
     */
    expect(hits('/* note */\n@media (prefers-color-scheme: dark) { }')).toBe(1);
    expect(
      hits('// glob: a/*\n@media (prefers-color-scheme: dark) { }\n/* trailing */')
    ).toBe(1);
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
