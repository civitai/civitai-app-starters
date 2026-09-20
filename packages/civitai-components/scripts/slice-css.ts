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
 * text. Slicing lets a bundler consumer import one component's rules.
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
 * consumer of this module before any output is written. Without it a slicer
 * that silently dropped a section would emit per-component CSS missing rules —
 * a defect that renders as "one unstyled element in one app" and is untraceable
 * back to here.
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

/**
 * Component slugs that no section title spells, mapped onto the section that
 * actually holds their rules.
 *
 * `toast-region` is the only one today: its rules live under the `Toast`
 * marker (`[data-civitai-ui='toast-region']`, the fixed-position `aria-live`
 * host) but the marker does not name it. Renaming the marker would change
 * `src/components.css` by a byte and so change `componentsCss`, which is a
 * contract this package holds stable — so the alias lives here instead.
 */
const EXTRA_ALIASES: Readonly<Record<string, string>> = { 'toast-region': 'toast' };

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

/**
 * Section titles name GROUPS (`TextInput / Textarea / NumberInput / Select`)
 * and carry issue refs (`Checkbox / Radio (issue #181 F6)`) or em-dash notes
 * (`RadioGroup (issue #181 F6) — role=radiogroup layout`). Split on the
 * slashes and strip any parenthetical / em-dash suffix.
 */
export function sectionComponentNames(title: string): string[] {
  return title
    .split('/')
    .map((p) => p.replace(/\(.*$/, '').replace(/—.*$/, '').trim())
    .filter((p) => p.length > 0);
}

/** `SegmentedControl` -> `segmented-control`; `Textarea` -> `textarea`. */
export function toSlug(componentName: string): string {
  return componentName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/\s+/g, '-');
}

/** Compose a standalone sheet from one section (always including the base rule). */
export function composeSheet(split: CssSplit, sections: CssSection[]): string {
  return split.header + LAYER_OPEN + split.base + sections.map((s) => s.text).join('') + split.tail;
}

/**
 * Reassembly must be byte-identical or every artifact derived from the split is
 * wrong. Throws naming BOTH byte counts so the gap is in the failure itself.
 */
export function assertLossless(split: CssSplit, original: string): void {
  const all = composeSheet(split, split.sections);
  if (all !== original) {
    throw new Error(
      `[slice] LOSSY: reassembled sheet is ${all.length} B, source is ${original.length} B ` +
        `(gap ${original.length - all.length} B). The per-component split is not a faithful ` +
        'partition of the stylesheet; every artifact derived from it would be missing rules.'
    );
  }
}

/** One emitted per-component artifact. */
export interface CssSlice {
  /** File-name slug — the slug of the section's FIRST component. */
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
 * Callers MUST have run {@link assertLossless} on the same split first — this
 * function does not re-derive that guarantee, it depends on it.
 */
export function cssSlices(split: CssSplit): CssSlice[] {
  const slices = split.sections.map((section) => {
    const slugs = sectionComponentNames(section.title).map(toSlug);
    const head = slugs[0];
    if (!head) throw new Error(`[slice] section "${section.title}" yields no component name`);
    return { slug: head, title: section.title, slugs, css: composeSheet(split, [section]) };
  });

  for (const [alias, ownerSlug] of Object.entries(EXTRA_ALIASES)) {
    const owner = slices.find((s) => s.slug === ownerSlug);
    if (!owner) {
      throw new Error(
        `[slice] alias "${alias}" points at section slug "${ownerSlug}", which no section ` +
          'produces. Either the marker was renamed or the alias is stale.'
      );
    }
    if (!owner.slugs.includes(alias)) owner.slugs.push(alias);
  }

  const seen = new Map<string, string>();
  for (const slice of slices) {
    for (const slug of slice.slugs) {
      const prior = seen.get(slug);
      if (prior) {
        throw new Error(
          `[slice] component slug "${slug}" is claimed by both "${prior}" and "${slice.title}". ` +
            'A slug must resolve to exactly one slice or the export map is ambiguous.'
        );
      }
      seen.set(slug, slice.title);
    }
  }
  return slices;
}
