import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiMediaElement } from './media-base.js';
import { defineElement } from './registry.js';

export type ImageFit = 'cover' | 'contain';
export type ImageStatus = 'loading' | 'loaded' | 'error' | 'blocked';

const TAG = 'civitai-image';

export class CivitaiImage extends CivitaiMediaElement {
  static override styles = [
    CivitaiMediaElement.styles,
    css`
      img {
        display: block;
        width: 100%;
        height: 100%;
        max-height: var(--civitai-media-max-height, none);
        object-fit: cover;
        opacity: 1;
        transition: opacity 200ms ease;
      }
      img[data-fit='contain'] {
        object-fit: contain;
      }
      :host([status='loading']) img,
      :host([status='error']) img {
        opacity: 0;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    fit: { reflect: true },
    openable: { type: Boolean, reflect: true },
    label: { reflect: true },
  };

  declare fit: ImageFit;
  /** The image becomes a button that emits `open`, for a viewer or a detail page. */
  declare openable: boolean;
  /** Names the open button when it should say more than `alt`. */
  declare label: string;

  constructor() {
    super();
    this.fit = 'cover';
    this.openable = false;
    this.label = '';
  }

  #open(): void {
    this.dispatchEvent(new Event('open', { bubbles: true, composed: true }));
  }

  protected override renderMedia(): TemplateResult {
    const image = html`<img
      part="image"
      src=${ifDefined(this.src || undefined)}
      alt=${this.alt}
      data-fit=${this.fit}
      @load=${this.settleLoaded}
      @error=${this.settleFailed}
    />`;
    if (!this.openable) return image;
    return html`<button class="open" part="open" type="button" aria-label=${this.label || this.alt || 'Open image'} @click=${this.#open}>
      ${image}
    </button>`;
  }
}

export function defineCivitaiImage(): void {
  defineElement(TAG, CivitaiImage);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-image': CivitaiImage;
  }
}
