/**
 * Per-component slicing of `src/components.css`.
 *
 * PROVENANCE — this is lifted, near-verbatim, from the bundle-cost measurement
 * script on `feat/civitai-elements-phase1`
 * (`packages/civitai-elements/scripts/measure-bundle.mjs`, `sliceComponentsCss`
 * + `assertLossless`). It was written there to make a measurement honest; it is
 * moved here because the measurement said the split is worth shipping. The
 * lossless assertion came with it and is the whole reason to trust the output.
 *
 * WHY A SPLIT AT ALL
 * ==================
 * `src/components.css` is one sheet. `componentsCss` embeds all of it, and a
 * bundle that wants Button's rules therefore also carries SegmentedControl,
 * Toast, Tooltip, NumberInput and fifteen others. Measured (esbuild, minified,
 * ESM, React external): a `blocks-react/ui` Button bundle is ~95% stylesheet
 * text. The slices are what `pnpm measure:css-split` prices that against, and
 * what a future `/ui` refactor (issue #358) would import.
 *
 * 🔴 NOT A PUBLIC SURFACE (yet), AND NOT PUBLISHED. The emitted artifacts are
 * not reachable through package.json `exports` — no consumer can name them —
 * and `files` carries `"!dist/css"`, so they do not enter the tarball either.
 * They exist on disk, in this repo, for `pnpm measure:css-split` and #358.
 * Files on disk are reversible; an `exports` key on a package with ~1.4k
 * downloads/month is not, and nothing imports these yet. The export block is
 * deliberately held until #358 decides the shape. See the README.
 *
 * HOW
 * ===
 * The sheet already carries `  /* ----- Name ----- *\/` section markers, so no
 * CSS parser is needed and none is used. The file is split into:
 *
 *   header        — the leading comment, everything before `@layer … {`
 *   base          — the rules between the layer opener and the FIRST section
 *                   marker (`[data-civitai-ui] { box-sizing; font-family; … }`)
 *   sections[]    — one chunk per marker, marker line included, running to the
 *                   next marker (or to the layer closer for the last one)
 *   tail          — the layer closer and anything after it
 *
 * `header + LAYER_OPEN + base + every section + tail` must reproduce the input
 * BYTE-FOR-BYTE. `assertLossless()` checks exactly that and is called by every
 * consumer of this module before any output is written.
 *
 * 🔴 STATED NARROWLY, BECAUSE IT USED TO BE STATED WIDELY. `assertLossless`
 * proves the PARTITION ARITHMETIC of {@link sliceComponentsCss} and
 * {@link composeSheet} — that the pieces handed back, recomposed in order, are
 * exactly the string handed in. That is all it proves. It does NOT prove the
 * sheet was cut in the right PLACES, and the failure it was once documented as
 * catching — "a slicer that silently dropped a section" — is precisely the one
 * it cannot see: this function partitions ONE string BY INDEX, so every piece
 * is a substring and the boundaries are contiguous by construction. A marker
 * `SECTION_RE` does not recognise (three leading spaces instead of two, say) is
 * not "dropped" — its rules simply merge into the PREVIOUS section, that
 * section never gets its own `.css`, and reassembly is still byte-perfect.
 * Measured on this sheet: indenting one real marker by a single space takes the
 * section count from 14 to 13 while `assertLossless` does not throw.
 *
 * What DOES see that is a count of the raw `/* ----- ` occurrences in the sheet
 * against `sections.length`, derived independently of `SECTION_RE` —
 * `test/css-slice.test.ts` carries it as the boundary guard, watched red on
 * exactly the mutant above. It is not the only red on that mutant today: three
 * assertions pinned to the literal 14 also fail. It is the only one that keeps
 * failing once the sheet grows past 14 sections, because it compares two counts
 * of the same sheet instead of a count against a typed-in number — measured in
 * that test's docblock.
 *
 * Each emitted slice is `header + LAYER_OPEN + base + <its section> + tail`, so
 * every slice is a STANDALONE, valid, layered stylesheet. Importing two of them
 * duplicates the base rule and the layer wrapper; both are idempotent in CSS,
 * and that duplication is what the measurement in the PR body priced in.
 */

/** The exact layer opener as it appears in `src/components.css`. */
export const LAYER_OPEN = '@layer civitai.components {\n';

/** `  /* ----- Button ----- *\/` — the section markers already in the sheet. */
const SECTION_RE = /^ {2}\/\* ----- (.+?) ----- \*\/$/gm;

export interface CssSection {
  /** The raw marker title, e.g. `TextInput / Textarea / NumberInput / Select`. */
  title: string;
  /** The marker line plus every rule up to the next marker. */
  text: string;
}

export interface CssSplit {
  header: string;
  base: string;
  tail: string;
  sections: CssSection[];
}

/**
 * Split `src/components.css` into a shared preamble plus one chunk per
 * `/* ----- Name ----- *\/` section.
 *
 * Reassembling header + LAYER_OPEN + base + every section's text + tail must
 * reproduce the input EXACTLY; callers assert that via {@link assertLossless}.
 */
export function sliceComponentsCss(css: string): CssSplit {
  const open = css.indexOf(LAYER_OPEN);
  if (open === -1) throw new Error('[slice] @layer opener not found in components.css');
  const header = css.slice(0, open);
  const body = css.slice(open + LAYER_OPEN.length);
  const close = body.lastIndexOf('}');
  if (close === -1) throw new Error('[slice] @layer closer not found in components.css');
  const inner = body.slice(0, close);
  const tail = body.slice(close);

  const marks: { title: string; at: number }[] = [];
  SECTION_RE.lastIndex = 0;
  for (let m = SECTION_RE.exec(inner); m; m = SECTION_RE.exec(inner)) {
    marks.push({ title: m[1] as string, at: m.index });
  }
  if (marks.length === 0) throw new Error('[slice] no `/* ----- X ----- */` sections found');

  const first = marks[0] as { title: string; at: number };
  const base = inner.slice(0, first.at);
  const sections = marks.map((mark, i) => {
    const next = marks[i + 1];
    return { title: mark.title, text: inner.slice(mark.at, next ? next.at : inner.length) };
  });
  return { header, base, tail, sections };
}

/* ── slug derivation ──────────────────────────────────────────────────────
 *
 * 🔴 SLUGS COME FROM SELECTORS, NOT FROM THE COMMENT TITLE.
 *
 * The first version of this file derived slugs from the English inside the
 * `/* ----- … ----- *\/` markers: split the title on `/`, strip parentheticals,
 * kebab-case each word, then patch the gaps with a hand-maintained alias table.
 * That made the component vocabulary a function of PROSE, and it produced a
 * component that does not exist — the title `SegmentedControl / Tabs` yielded
 * a `tabs` slug, but `tabs` is not in `COMPONENT_NAMES` and is not a
 * `data-civitai-ui` value anywhere in the sheet; MARKUP.md documents it as a
 * `role="tab"` MODE of segmented-control. The inverse gap needed the alias
 * table: `toast-region` is a real component whose title does not spell it.
 *
 * So the vocabulary is now read off the thing that actually decides which
 * rules a slice carries — the `[data-civitai-ui='…']` selectors in the
 * section. A title can be reworded freely; a component appears exactly when a
 * rule selects it. There is no alias table, and there is nothing to keep in
 * sync: `test/css-slice.test.ts` asserts the derived slug set EQUALS
 * `COMPONENT_NAMES` in both directions.
 * ─────────────────────────────────────────────────────────────────────────── */

/** A selector's LEADING compound, e.g. `[data-civitai-ui='button'] .x` -> `button`. */
const LEADING_SLUG_RE = /^\[data-civitai-ui=(['"])([a-z0-9-]+)\1\]/;

/** CSS block comments; stripped before parsing so prose cannot look like code. */
const COMMENT_RE = /\/\*[\s\S]*?\*\//g;

/**
 * The selector preludes of a section's TOP-LEVEL rules, in source order.
 *
 * Depth-0 only: a nested `&[data-size='sm']` is a variant of the rule it sits
 * in, never a component of its own. At-rule preludes (`@keyframes
 * civitai-ui-spin`) simply do not match the slug pattern.
 *
 * Comments are stripped FIRST, which is load-bearing rather than tidy: the
 * sheet's prose mentions component names constantly (`the shared
 * [data-civitai-ui-error] styling`, `a BARE `<span data-civitai-ui="loader">``)
 * and letting any of it reach the matcher would reintroduce the prose
 * dependency this module exists to remove.
 */
function topLevelPreludes(sectionText: string): string[] {
  const src = sectionText.replace(COMMENT_RE, '');
  const preludes: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) preludes.push(src.slice(start, i));
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (ch === ';' && depth === 0) {
      start = i + 1;
    }
  }
  return preludes;
}

/**
 * Every component slug a section's own top-level rules SELECT, in source order.
 *
 * Only the LEADING compound of each comma-separated selector counts: a rule
 * whose subject is `X` is a rule about `X`, whatever its ancestors name.
 *
 * 🔴 That narrowing is NOT what resolves the cross-section rule. Measured on
 * the sheet at the time of writing, reading every compound instead produces
 * the IDENTICAL slug set, section for section — because
 * `[data-civitai-ui='button'] [data-civitai-ui='loader']` sits in the Loader
 * section, and `button` is discarded there either way by
 * {@link cssSlices}'s FIRST-SECTION-WINS rule (the Button section claimed it
 * 400 lines earlier). First-section-wins is the guarantee; leading-compound is
 * the narrower reading that keeps this function honest on its own terms, so a
 * future descendant rule naming a component NO earlier section owns cannot
 * silently mint a slug here.
 */
export function sectionSlugs(sectionText: string): string[] {
  const slugs: string[] = [];
  for (const prelude of topLevelPreludes(sectionText)) {
    for (const selector of prelude.split(',')) {
      const m = LEADING_SLUG_RE.exec(selector.trim());
      if (m && !slugs.includes(m[2] as string)) slugs.push(m[2] as string);
    }
  }
  return slugs;
}

/** Compose a standalone sheet from one section (always including the base rule). */
export function composeSheet(split: CssSplit, sections: CssSection[]): string {
  return split.header + LAYER_OPEN + split.base + sections.map((s) => s.text).join('') + split.tail;
}

/**
 * Reassembly must be exact or every artifact derived from the split is wrong.
 *
 * Scope: this proves the PARTITION ARITHMETIC only — see the module docblock.
 * It cannot see a section boundary the slicer failed to recognise.
 *
 * The message names both SIZES and the gap between them, in UTF-16 code units
 * (`String.length`), which is what the comparison itself runs on. It does NOT
 * say "B": the sheet carries em dashes, so its byte length and its code-unit
 * length genuinely differ (31,970 vs 31,900 at the time of writing) and a ` B`
 * suffix on `String.length` is a wrong number that looks right. A maintainer
 * reading this error is about to go count bytes on disk; the unit has to match.
 */
export function assertLossless(split: CssSplit, original: string): void {
  const all = composeSheet(split, split.sections);
  if (all !== original) {
    throw new Error(
      `[slice] LOSSY: reassembled sheet is ${all.length} UTF-16 code units, source is ` +
        `${original.length} (gap ${original.length - all.length}; these are String.length, ` +
        'NOT bytes — the sheet has multi-byte characters). The per-component split is not a ' +
        'faithful partition of the stylesheet; every artifact derived from it would be ' +
        'missing rules.'
    );
  }
}

/** One emitted per-component artifact. */
export interface CssSlice {
  /**
   * File-name slug — the FIRST slug this section selects, in source order.
   *
   * Source order, not the title: the `Toast` section's first rule selects
   * `[data-civitai-ui='toast-region']`, so its artifacts are named
   * `toast-region.*`. Nothing outside this package names these files (they are
   * not in `exports`), so the rule is chosen to be mechanical rather than
   * pretty — a title-derived name is exactly the prose dependency this module
   * removed.
   */
  slug: string;
  /** The raw section title, for the generated file's doc comment. */
  title: string;
  /** Every component slug that resolves to this slice (includes {@link slug}). */
  slugs: string[];
  /** A standalone, layered stylesheet carrying only this section's rules. */
  css: string;
}

/**
 * The full set of artifacts to emit, in sheet order.
 *
 * Slugs come from {@link sectionSlugs} — the section's own selectors — under
 * FIRST-SECTION-WINS: a slug already claimed by an earlier section belongs to
 * that section, not to this one. Today that rule resolves exactly one case,
 * the cross-component `[data-civitai-ui='button'] [data-civitai-ui='loader']`
 * override sitting in the Loader section, and it is what makes `button` a
 * Button slug rather than a duplicate. Sheet order is therefore load-bearing.
 *
 * Callers MUST have run {@link assertLossless} on the same split first — this
 * function does not re-derive that guarantee, it depends on it.
 */
export function cssSlices(split: CssSplit): CssSlice[] {
  const claimed = new Map<string, string>();
  return split.sections.map((section) => {
    const slugs: string[] = [];
    for (const slug of sectionSlugs(section.text)) {
      if (claimed.has(slug)) continue;
      claimed.set(slug, section.title);
      slugs.push(slug);
    }
    const head = slugs[0];
    if (!head) {
      throw new Error(
        `[slice] section "${section.title}" selects no component: none of its top-level rules ` +
          'lead with `[data-civitai-ui=\'…\']`, and every slug it does name was already claimed ' +
          'by an earlier section. A section that owns no component cannot be named by anything, ' +
          'so its rules would ship only inside the whole-pack sheet.'
      );
    }
    return { slug: head, title: section.title, slugs, css: composeSheet(split, [section]) };
  });
}
