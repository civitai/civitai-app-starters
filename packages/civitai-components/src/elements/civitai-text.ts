import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

/**
 * The tag rendered inside the shadow root. A heading MUST be a real heading
 * element — `role="heading"` on a styled box would satisfy a screen reader but
 * not the document outline, the browser's own heading navigation, or
 * `heading-order` — so the semantic choice is the consumer's, declared here,
 * and never inferred from how big the text looks.
 */
export type TextAs = 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
/**
 * ONE type scale, nine steps. The bottom four are the UI ramp (`sm`/`md`/`lg`
 * byte-identical to Button's); `xl` and up are the heading ramp, and each of
 * those values is one utilities.css already ships as `ci-fs-N` — see the mapping
 * in the stylesheet below. There is no size here that `ci-fs-*` cannot also
 * express, which is the point: not two scales.
 *
 * (utilities.css is deliberately unbackticked, for the same reason the path in
 * the class docblock below is: test/css-templates.test.ts finds css literals by
 * scanning for the three letters c-s-s followed by a backtick, so ANY backticked
 * path ending in .css reads as the start of a tagged template and every real
 * literal after it is parsed from the wrong offset. It caught this exact line —
 * the hazard is a path ending in .css, not only a path to this sheet.)
 */
export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold';

const TAG = 'civitai-text';

/**
 * One template per `as` value, because a Lit template's tag name cannot be
 * interpolated. The alternative is `lit/static-html.js`, which would widen the
 * dependency allowlist `test/entry-points.test.ts` pins and grow a bundle
 * already at 86% of its gzip budget, to save eight one-line templates. Each
 * arrow is its own template literal, so Lit caches them the way it expects.
 */
const TEMPLATES: Record<TextAs, () => TemplateResult> = {
  p: () => html`<p part="text"><slot></slot></p>`,
  span: () => html`<span part="text"><slot></slot></span>`,
  h1: () => html`<h1 part="text"><slot></slot></h1>`,
  h2: () => html`<h2 part="text"><slot></slot></h2>`,
  h3: () => html`<h3 part="text"><slot></slot></h3>`,
  h4: () => html`<h4 part="text"><slot></slot></h4>`,
  h5: () => html`<h5 part="text"><slot></slot></h5>`,
  h6: () => html`<h6 part="text"><slot></slot></h6>`,
};

/**
 * Text and headings — the typography primitive, and the mirror of the
 * `[data-civitai-ui='text']` rules in src/components.css. Every value here
 * computes identically to that attribute markup;
 * `test/presentational-parity.browser.test.ts` is what says so.
 *
 * WHY AN ELEMENT AT ALL, stated accurately because the tempting version is
 * false: it is NOT that every component here ships both tracks. Most do not —
 * the clear majority of the elements in this directory have no
 * `[data-civitai-ui=...]` rule at all (`civitai-modal`, `civitai-menu`,
 * `civitai-table`, `civitai-tabs`, `civitai-switch`, `civitai-avatar`, ...). The
 * relationship that does hold is the CONVERSE — nearly every attribute slug in
 * the sheet also has an element — and Text keeping both is a CHOICE to stay on
 * the side of that pattern and of a published consumption mode, not a rule the
 * pack enforces. Measured counts and the date are in the commit message.
 *
 * (That one path is deliberately unbackticked. `test/css-templates.test.ts`
 * finds css literals by scanning for the three letters c-s-s followed by a
 * backtick, so a backticked stylesheet path reads as a tagged template and
 * every real literal after it is then parsed from the wrong offset. It caught
 * this file twice while it was being written.)
 */
export class CivitaiText extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      /*
       * NO BACKTICKS ANYWHERE IN THIS LITERAL: one ends the css tagged template
       * and the error surfaces hundreds of lines away, which is what
       * test/css-templates.test.ts exists to catch. It caught this block.
       *
       * The scale lives on the HOST and reaches the inner element by
       * inheritance, which is why that element sets font and color to inherit
       * below: a UA h2 is 1.5em bold, so without the reset the size a consumer
       * asked for would be multiplied by whichever tag they chose. The defaults
       * (size=md, weight=normal) sit unconditionally on :host, so a bare
       * civitai-text renders them.
       *
       * THE SIZE RAMP IS ONE SCALE, and every step from lg up is a value
       * utilities.css already ships as ci-fs-N — the same scale under two
       * spellings, not two scales:
       *
       *     lg  16px = ci-fs-6      2xl 24px = ci-fs-4      4xl 32px = ci-fs-2
       *     xl  20px = ci-fs-5      3xl 28px = ci-fs-3      5xl 40px = ci-fs-1
       *
       * Traded away: the t-shirt names do not encode N, and the two sequences
       * run in opposite directions (5xl is ci-fs-1), so the mapping above is
       * required reading. Naming the new steps fs-1..fs-4 instead would have put
       * two naming conventions in one attribute and reversed its direction
       * halfway up. Unit is px (Button's) against ci-fs-*'s rem: equal at the
       * default 16px root, divergent if a consumer moves it — deliberate,
       * because mixing units inside one ramp would make it non-monotonic there.
       *
       * NO COLOUR ATTRIBUTE, by the same predicate this component applies to
       * alignment and truncation: color INHERITS, so ci-muted / ci-text-info /
       * -success / -warning / -error / ci-text-default all reach the inner
       * element through the shadow boundary already, and an outer-document
       * utility on the host beats a :host([color]) rule under CSS scoping
       * anyway. A duplicate predicate here would be published API that could
       * not be withdrawn.
       */
      :host {
        display: block;
        color: var(--civitai-color-text);
        font-size: 14px;
        font-weight: 400;
        line-height: 1.5;
      }
      /* Inline text keeps an inline box; every other as value is block, which
         is what the corresponding light-DOM element would have been. */
      :host([as='span']) {
        display: inline;
      }

      :host([size='xs']) { font-size: 12px; }
      :host([size='sm']) { font-size: 13px; }
      :host([size='md']) { font-size: 14px; }
      :host([size='lg']) { font-size: 16px; }
      :host([size='xl']) { font-size: 20px; line-height: 1.25; }
      :host([size='2xl']) { font-size: 24px; line-height: 1.25; }
      :host([size='3xl']) { font-size: 28px; line-height: 1.25; }
      :host([size='4xl']) { font-size: 32px; line-height: 1.25; }
      :host([size='5xl']) { font-size: 40px; line-height: 1.25; }

      :host([weight='normal']) { font-weight: 400; }
      :host([weight='medium']) { font-weight: 500; }
      :host([weight='semibold']) { font-weight: 600; }
      :host([weight='bold']) { font-weight: 700; }

      p,
      span,
      h1,
      h2,
      h3,
      h4,
      h5,
      h6 {
        margin: 0;
        font: inherit;
        color: inherit;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    as: { reflect: true },
    size: { reflect: true },
    weight: { reflect: true },
  };

  /** The element rendered. `p` by default: a text primitive is prose first. */
  declare as: TextAs;
  declare size: TextSize;
  declare weight: TextWeight;

  constructor() {
    super();
    this.as = 'p';
    this.size = 'md';
    this.weight = 'normal';
  }

  override render(): TemplateResult {
    // An unknown `as` falls back to `p` rather than rendering nothing: a typo in
    // one attribute must not silently delete the copy on the page.
    return (TEMPLATES[this.as] ?? TEMPLATES.p)();
  }
}

export function defineCivitaiText(): void {
  defineElement(TAG, CivitaiText);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-text': CivitaiText;
  }
}
