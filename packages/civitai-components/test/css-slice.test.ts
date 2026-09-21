/**
 * Per-component CSS split — the guards that make every sliced artifact
 * trustworthy, plus their negative controls.
 *
 * 🔴 WHAT `assertLossless` PROVES, AND WHAT IT DOES NOT. Read this before
 * citing it as the reason the split is faithful; an earlier revision of this
 * docblock did exactly that and was wrong.
 *
 * `sliceComponentsCss` partitions ONE string BY INDEX. Every piece is therefore
 * a substring and the boundaries are contiguous BY CONSTRUCTION, so
 * `header + LAYER_OPEN + base + Σsections.text + tail` reduces to the input
 * unconditionally. `assertLossless` proves that ARITHMETIC — that
 * `sliceComponentsCss` and `composeSheet` agree — and nothing else. It is not
 * vacuous (it pins the two functions to each other, and `composeSheet` is what
 * every emitted artifact is built with), but it cannot fail on any output of
 * the real code path, and the two NEGATIVE CONTROLS below say so honestly: they
 * build mutants BY HAND from an already-successful split, a state production
 * cannot reach. They prove the string comparison works. They do not prove the
 * slicing is faithful.
 *
 * The failure `assertLossless` was once credited with catching — "a slicer that
 * silently dropped a section" — is the one thing it structurally cannot see. A
 * marker `SECTION_RE` does not recognise (three leading spaces instead of two)
 * is never "dropped": its rules merge into the PREVIOUS section, that section
 * never gets its own `.css`, and reassembly stays byte-perfect. Measured on
 * this sheet, indenting one real marker by a single space takes the section
 * count 14 -> 13 with `assertLossless` silent throughout.
 *
 * `every section marker in the sheet becomes a section (BOUNDARY GUARD)` below
 * is what sees it, by counting raw `/* ----- ` occurrences independently of
 * `SECTION_RE`. That independence is the whole point: `MARKERS` (defined below)
 * is built with the SAME regex the slicer uses, so any assertion against it can
 * only ever agree with the slicer about which markers exist.
 *
 * 🔴 WHAT THIS SUITE DOES **NOT** COVER — read before trusting it.
 * The per-component artifacts are NOT a public surface and are NOT published.
 * `package.json` declares no `./css/*` entries, so
 * `@civitai/components/css/button` does not resolve for any consumer; and
 * `files` carries `"!dist/css"`, so the artifacts do not enter the tarball
 * either. They exist on disk, in this repo, for `pnpm measure:css-split` and
 * issue #358 — nothing else. That is deliberate: files on disk are reversible,
 * an `exports` key on a package with ~1.4k downloads/month is not, and no
 * consumer imports these yet.
 *
 * 🔴 THIS REVERSES AN EARLIER DECISION, AND THE ASSERTION BELOW REVERSED WITH
 * IT. An earlier revision of this file documented the artifacts as shipping
 * inside the tarball on the strength of `files: ["dist"]`, which was true and
 * was the wrong outcome: 70 files no consumer could name, 118,744 B of them
 * unpacked — measured by `npm pack --dry-run --json`, 84 entries against the
 * 14 this package had on `main` — on a package installed ~1,451 times a month.
 * Not exporting them was never a reason to ship them.
 * `the per-component artifacts are NOT published`
 * below now asserts the OPPOSITE of what the old prose described, and it asks
 * npm rather than reading `files`, so the exclusion cannot be satisfied by
 * spelling and then defeated by a later `files` entry that re-adds them.
 *
 * An earlier revision also asserted set-equality between the slug set and the
 * `./css/*` export keys; there is no export surface left for it to describe, so
 * that assertion is GONE rather than weakened, and `no ./css/* export is
 * declared` below pins the hold so that re-opening the surface is a deliberate
 * edit to this test and not a silent one.
 *
 * So the suite asserts:
 *   - reassembly is BYTE-identical to the source sheet (and a deliberately
 *     lossy slice FAILS, naming the gap — the negative controls below);
 *   - every raw `/* ----- ` marker in the sheet became its own section, counted
 *     WITHOUT `SECTION_RE` (the boundary guard);
 *   - every emitted `dist/css/<slug>.css` is exactly the composed slice;
 *   - every emitted `src/css/<slug>.generated.ts` string equals that file;
 *   - the slug vocabulary the slicer derives EQUALS `COMPONENT_NAMES`, in both
 *     directions — the assertion that would have caught the phantom `tabs`
 *     component the old prose-derived vocabulary invented;
 *   - `package.json` declares no `./css/*` export (the hold, pinned);
 *   - `npm pack` puts NO `dist/css/` entry in the tarball (the exclusion,
 *     pinned against npm itself rather than against the `files` spelling);
 *   - `pnpm build` prunes only its OWN generated files from the TRACKED
 *     `src/css/` directory;
 *   - `componentsCss` (the whole-pack contract) still carries EVERY section.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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

  /* ── the BOUNDARY GUARD ──────────────────────────────────────────────────
   * 🔴 DERIVED INDEPENDENTLY OF `SECTION_RE`, ON PURPOSE.
   *
   * `MARKERS` above uses the slicer's own pattern, so `split.sections.length
   * === MARKERS.length` is a tautology dressed as a check: both sides ask the
   * same regex which markers exist, and both get the same wrong answer when
   * one is malformed. This counts the bare token `/* -----` — no anchor, no
   * indent requirement, no title shape — so a marker the slicer fails to
   * recognise is still counted HERE and the two numbers disagree.
   *
   * This is the guard `assertLossless` was believed to be. A mis-indented
   * marker merges its rules into the previous section, that section never gets
   * a `.css` file, and reassembly stays byte-perfect — so nothing else in this
   * suite sees it.
   * ──────────────────────────────────────────────────────────────────────── */
  it('every section marker in the sheet becomes a section (BOUNDARY GUARD)', () => {
    const rawMarkers = (srcCss.match(/\/\* ----- /g) ?? []).length;
    // Positive control: the token is really present, so a zero here would be a
    // broken pattern rather than a sheet with no sections.
    expect(rawMarkers).toBeGreaterThanOrEqual(14);
    expect(
      split.sections.length,
      `the sheet contains ${rawMarkers} \`/* ----- \` markers but the slicer found ` +
        `${split.sections.length} sections. A marker SECTION_RE does not match (wrong indent, ` +
        'a trailing space, a line break in the title) is not an error — its rules merge into ' +
        'the PREVIOUS section, that section never gets its own dist/css/<slug>.css, and ' +
        'assertLossless still passes. This is the only check that sees it.'
    ).toBe(rawMarkers);
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

  /* ── the NEGATIVE CONTROLS, and their honest scope ───────────────────────
   * These mutate the split by hand and assert THIS guard's own error fires —
   * matched on its `[slice] LOSSY` prefix and the exact gap, so a different
   * check throwing first (missing `@layer` opener, zero sections) would NOT
   * satisfy them.
   *
   * 🔴 What they prove is that the STRING COMPARISON in `assertLossless`
   * works — no more. Both mutants are built FROM an already-successful split,
   * which is a state the production path cannot reach: `sliceComponentsCss`
   * partitions one string by index, so its own output ALWAYS recomposes. Do
   * not read a green here as "the slicer is faithful"; the boundary guard
   * above is what carries that claim.
   *
   * Gaps are in UTF-16 code units, matching the message — see `assertLossless`.
   * ──────────────────────────────────────────────────────────────────────── */

  function lossyBy(bytes: number): CssSplit {
    const [first, ...rest] = split.sections;
    if (!first) throw new Error('fixture: no sections');
    return { ...split, sections: [{ ...first, text: first.text.slice(0, -bytes) }, ...rest] };
  }

  it('NEGATIVE CONTROL: a 13-unit-lossy slice fails, naming the gap', () => {
    const mutant = lossyBy(13);
    expect(() => assertLossless(mutant, srcCss)).toThrowError(
      new RegExp(
        `^\\[slice\\] LOSSY: reassembled sheet is ${srcCss.length - 13} UTF-16 code units, ` +
          `source is ${srcCss.length} \\(gap 13;`
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
        `^\\[slice\\] LOSSY: reassembled sheet is ${srcCss.length - dropped.text.length} ` +
          `UTF-16 code units, source is ${srcCss.length} \\(gap ${dropped.text.length};`
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

describe('the slug vocabulary is derived from SELECTORS, not from comment prose', () => {
  /**
   * 🔴 THE ASSERTION THIS DESCRIBE EXISTS FOR.
   *
   * The old derivation read slugs out of the English in the section markers —
   * `SegmentedControl / Tabs` split on `/` — plus a hand-maintained alias
   * table for the names no title spelled. It produced `tabs`, which is not a
   * component: it is not in `COMPONENT_NAMES` and no rule in the sheet selects
   * `[data-civitai-ui='tabs']`; MARKUP.md documents it as a `role="tab"` MODE
   * of segmented-control.
   *
   * The permissive direction ("every COMPONENT_NAME has a slug") is what the
   * suite used to check, and it is exactly why `tabs` got through: an EXTRA
   * slug satisfies it. So this asserts SET EQUALITY, which fails when the
   * derived vocabulary grows a name the package does not declare *or* loses
   * one it does.
   */
  it('the derived slug set EQUALS COMPONENT_NAMES, in both directions', () => {
    const derived = new Set(slices.flatMap((s) => s.slugs));
    const declared = new Set<string>(COMPONENT_NAMES);
    // `toEqual` on two Sets reports the symmetric difference, so a failure
    // names the offending slug rather than just a count.
    expect(derived).toEqual(declared);
    // Literal floor so the equality above cannot be satisfied at zero by a
    // derivation that returns nothing on both sides.
    expect(derived.size).toBe(20);
    expect(COMPONENT_NAMES.length).toBe(20);
  });

  it('no slug is a phantom: every one is selected by a rule in the sheet', () => {
    for (const slice of slices) {
      for (const slug of slice.slugs) {
        expect(srcCss, slug).toContain(`[data-civitai-ui='${slug}']`);
      }
    }
    // Positive control for the check above: the phantom the old derivation
    // produced is NOT selected anywhere, so the same check would have failed
    // on it. Without this line the loop could be vacuously satisfiable.
    expect(srcCss).not.toContain(`[data-civitai-ui='tabs']`);
  });

  it('each slug resolves to exactly one slice', () => {
    const owners = new Map<string, string>();
    for (const slice of slices) {
      for (const slug of slice.slugs) {
        expect(owners.has(slug), `${slug} claimed twice`).toBe(false);
        owners.set(slug, slice.slug);
      }
    }
    // The measured subtlety, pinned: `src/components.css` carries
    // `[data-civitai-ui='button'] [data-civitai-ui='loader']` inside the
    // LOADER section, so `button` is named by two sections' rules. What
    // resolves it is FIRST-SECTION-WINS — Button claimed the slug 400 lines
    // earlier — not the leading-compound narrowing, which reports `button` for
    // the Loader section too. Delete the first-wins rule and `button` becomes
    // a duplicate; this pins the outcome.
    expect(srcCss).toContain(`[data-civitai-ui='button'] [data-civitai-ui='loader']`);
    expect(owners.get('button')).toBe('button');
    expect(owners.get('loader')).toBe('loader');
  });
});

describe('the ./css/* artifacts are deliberately UNEXPORTED and UNPUBLISHED (issue #358)', () => {
  /**
   * The artifacts exist and are complete; nothing can NAME them, and nothing
   * SHIPS them. Files on disk are reversible, `exports` keys on a published
   * package are not, and no consumer imports these. Deleting these tests to
   * open the surface is the point: it makes that a deliberate edit.
   */
  it('declares no ./css/* export', () => {
    const declared = Object.keys(pkg.exports).filter((k) => k.startsWith('./css/'));
    expect(declared).toEqual([]);
    // Positive control that the filter is wired to a real, non-empty map —
    // a zero from a mis-read `exports` would otherwise look identical.
    expect(Object.keys(pkg.exports)).toContain('./styles.css');
  });

  /**
   * 🔴 THIS ASSERTS THE OPPOSITE OF WHAT AN EARLIER REVISION DOCUMENTED.
   *
   * `files: ["dist"]` swept `dist/css/` into every install: 70 files, none of
   * them nameable by any consumer, 118,744 B unpacked, on a package installed
   * ~1,451 times a month. `"!dist/css"` removes them. The artifacts
   * stay on disk — `pnpm measure:css-split` and the tests above read them from
   * the working tree, which `files` has no bearing on.
   *
   * Asked of NPM, not of `files`. Reading `files` for the literal string
   * `"!dist/css"` would be a spelled guard: it stays green while a later entry
   * re-adds the directory in a different shape (`"dist/css/button.css"`, a
   * `.npmignore`, a changed negation order). This runs the real packer and
   * counts what it would actually put in the tarball.
   */
  it('the per-component artifacts are NOT published (npm pack ships no dist/css)', () => {
    const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: pkgRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const entries = (JSON.parse(raw) as [{ files: { path: string }[] }])[0].files.map(
      (f) => f.path
    );
    // Positive control FIRST: a zero below must mean "npm packs no dist/css",
    // never "npm printed something this test failed to parse". The whole-pack
    // stylesheet is the thing the package exists to ship, so its absence here
    // means the read is broken, not that the exclusion worked.
    expect(entries, 'npm pack output did not parse into a real file list').toContain(
      'dist/components.css'
    );
    expect(entries.length).toBeGreaterThan(5);
    // And there are real artifacts on disk for it to have shipped, so the zero
    // is a decision rather than an empty directory.
    expect(existsSync(join(pkgRoot, 'dist/css', `${slices[0]?.slug}.css`))).toBe(true);

    const shipped = entries.filter((p) => p.startsWith('dist/css/'));
    expect(
      shipped,
      `npm would publish ${shipped.length} dist/css/ entries. These are private, unnameable ` +
        'artifacts (no `./css/*` export resolves), so shipping them adds install weight no ' +
        'consumer can use. Keep `"!dist/css"` in package.json `files`.'
    ).toEqual([]);
  });

  it('every slice still has BOTH artifacts on disk, complete', () => {
    // What the removed set-equality assertion used to prove via the export
    // map: the emitted set is complete and one file per slice exists.
    for (const slice of slices) {
      const cssFile = join(pkgRoot, 'dist/css', `${slice.slug}.css`);
      const srcTs = join(pkgRoot, 'src/css', `${slice.slug}.generated.ts`);
      expect(existsSync(cssFile), cssFile).toBe(true);
      expect(existsSync(srcTs), srcTs).toBe(true);
      expect(existsSync(join(pkgRoot, 'dist/css', `${slice.slug}.generated.js`)), slice.slug).toBe(
        true
      );
      expect(
        existsSync(join(pkgRoot, 'dist/css', `${slice.slug}.generated.d.ts`)),
        slice.slug
      ).toBe(true);
    }
    expect(slices).toHaveLength(14);
  });
});

describe('build-css.ts prunes src/css/ without wiping it', () => {
  /**
   * 🔴 REGRESSION. `src/css/` is TRACKED. The build writer used to clear it
   * with `rmSync(srcCssDir, { recursive: true, force: true })` on the strength
   * of a comment saying the directory held only generated files — so any
   * hand-written file placed there (a README, a helper) was deleted silently
   * by the next `pnpm build`, with nothing but `git status` to notice.
   *
   * Run against the REAL script, in a throwaway copy of the package so the
   * suite never mutates the checkout (and never races the tests above, which
   * read `dist/css/`).
   */
  it('keeps a hand-written file and still drops a stale *.generated.ts', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'civitai-build-css-'));
    try {
      mkdirSync(join(sandbox, 'src/css'), { recursive: true });
      cpSync(join(pkgRoot, 'scripts'), join(sandbox, 'scripts'), { recursive: true });
      cpSync(join(pkgRoot, 'src/components.css'), join(sandbox, 'src/components.css'));
      const sentinel = join(sandbox, 'src/css/README.md');
      const stale = join(sandbox, 'src/css/deleted-section.generated.ts');
      writeFileSync(sentinel, '# hand-written, tracked, must survive a build\n');
      writeFileSync(stale, 'export const css: string = "stale";\n');

      execFileSync(
        process.execPath,
        [join(pkgRoot, 'node_modules/tsx/dist/cli.mjs'), join(sandbox, 'scripts/build-css.ts')],
        { stdio: 'pipe' }
      );

      expect(existsSync(sentinel), 'tracked hand-written file was deleted by the build').toBe(true);
      expect(readFileSync(sentinel, 'utf8')).toContain('must survive a build');
      expect(existsSync(stale), 'stale generated artifact survived the build').toBe(false);
      // and the real artifacts were still written
      expect(existsSync(join(sandbox, 'src/css/button.generated.ts'))).toBe(true);
      expect(existsSync(join(sandbox, 'dist/css/button.css'))).toBe(true);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
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
