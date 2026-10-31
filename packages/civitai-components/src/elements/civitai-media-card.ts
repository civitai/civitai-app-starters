import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-media-card';

export class CivitaiMediaCard extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        position: relative;
        display: block;
        overflow: hidden;
        border-radius: var(--civitai-radius);
        background: var(--civitai-color-media-placeholder);
        aspect-ratio: var(--civitai-media-card-ratio, 2 / 3);
        /*
         * A card is a pure aspect-ratio box: it carries no intrinsic content
         * width, and the overflow:hidden above already gives it an automatic
         * minimum size of 0 (CSS Flexbox 4.5). So as a flex item in a ROW its
         * auto basis resolves to zero and the card VANISHES -- not "looks
         * broken", invisible, with the aspect ratio taking the height down with
         * it. A gallery of these inside a civitai-group rendered as three 0x0
         * boxes.
         *
         * THE INLINE AXIS IS DELIBERATE -- do not "simplify" this to
         * flex-basis. civitai-stack is flex-direction:column, where a basis sets
         * the MAIN size and would therefore set every stacked card's HEIGHT,
         * silently relaying out every existing stack. min-width cannot reach the
         * block axis, so stacks are untouched. Pinned by the column case in
         * civitai-media-card.browser.test.ts, which asserts a stacked card's
         * height still comes from the aspect ratio.
         *
         * min() against 100% is what keeps BLOCK layout safe: in a slot narrower
         * than the floor the percentage wins, so a card still shrinks to fit
         * instead of overflowing.
         */
        min-width: min(var(--civitai-media-card-min-width, 12rem), 100%);
        /*
         * The same floor, handed to civitai-group. A slotted element cannot win
         * this property from its own :host rule -- for a slotted element the
         * outer tree's declaration beats the inner tree's whatever the
         * specificity -- and civitai-group zeroes every slotted child's
         * min-width so a long label can shrink. That rule reads this property,
         * defaulting to 0, so this is how a tile opts out of being zeroed
         * without changing the behaviour of any other child.
         */
        --civitai-group-item-min-width: min(var(--civitai-media-card-min-width, 12rem), 100%);
      }
      .media,
      .media ::slotted(*) {
        display: block;
        width: 100%;
        height: 100%;
      }
      .media {
        position: absolute;
        inset: 0;
        border-radius: 0;
      }
      .media ::slotted(img) {
        object-fit: cover;
      }

      /* The overlays are SIBLINGS of the link, never children: nesting a menu
         button inside an anchor is both invalid and unreachable by keyboard. */
      .overlay {
        /* A control sitting ON the media takes its contrast from the image, not
           from the page, so these two are the scheme-independent ramp. */
        --civitai-action-button-bg: var(--civitai-color-gray-0);
        --civitai-action-button-fg: var(--civitai-color-gray-9);
        position: absolute;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px;
        pointer-events: none;
      }
      .overlay ::slotted(*) {
        pointer-events: auto;
      }
      .top-start {
        top: 0;
        left: 0;
      }
      /* The site stacks this corner: the kebab sits at the very top and the
         action button hangs under it, both flush right. */
      .top-end {
        top: 0;
        right: 0;
        flex-direction: column;
        align-items: flex-end;
      }
      .bottom {
        right: 0;
        bottom: 0;
        left: 0;
        flex-wrap: wrap;
        padding-top: 28px;
        /* A scrim, so a white image cannot swallow the counts sitting on it. */
        background: linear-gradient(to top, rgb(0 0 0 / 0.72), transparent);
      }
      :host([no-scrim]) .bottom {
        background: none;
        padding-top: 8px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    href: { reflect: true },
    label: { reflect: true },
    noScrim: { type: Boolean, reflect: true, attribute: 'no-scrim' },
  };

  /** Makes the media itself a link, leaving the overlays independently clickable. */
  declare href: string;
  /** Names that link, since the media is the only thing inside it. */
  declare label: string;
  declare noScrim: boolean;

  constructor() {
    super();
    this.href = '';
    this.label = '';
    this.noScrim = false;
  }

  override render(): TemplateResult {
    const media = html`<slot name="media"></slot>`;
    return html`
      ${this.href === ''
        ? html`<div class="media" part="media">${media}</div>`
        : html`<a
            class="media"
            part="media"
            href=${this.href}
            aria-label=${ifDefined(this.label || undefined)}
            >${media}</a
          >`}
      <div class="overlay top-start" part="top-start"><slot name="top-start"></slot></div>
      <div class="overlay top-end" part="top-end"><slot name="top-end"></slot></div>
      <div class="overlay bottom" part="bottom"><slot name="bottom"></slot></div>
    `;
  }
}

export function defineCivitaiMediaCard(): void {
  defineElement(TAG, CivitaiMediaCard);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-media-card': CivitaiMediaCard;
  }
}
