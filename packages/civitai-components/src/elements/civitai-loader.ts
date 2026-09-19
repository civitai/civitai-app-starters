import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline, spinner } from './shared-styles.js';

export type LoaderSize = 'sm' | 'md' | 'lg';

const TAG = 'civitai-loader';

export class CivitaiLoader extends CivitaiElement {
  static override styles = [
    hostBaseline,
    spinner,
    css`
      :host {
        display: inline-block;
      }
      /* Block, so the ring is the host's whole box — an inline child would sit
         on a text baseline and leave descender space below it. */
      .spinner {
        display: block;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    size: { reflect: true },
    label: { reflect: true },
  };

  declare size: LoaderSize;
  /** Announced to assistive tech; empty makes the loader decorative. */
  declare label: string;

  constructor() {
    super();
    this.size = 'md';
    this.label = '';
  }

  override render(): TemplateResult {
    return html`<span
      class="spinner"
      part="spinner"
      data-size=${this.size}
      role=${this.label === '' ? 'presentation' : 'status'}
      aria-label=${this.label === '' ? '' : this.label}
    ></span>`;
  }
}

export function defineCivitaiLoader(): void {
  defineElement(TAG, CivitaiLoader);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-loader': CivitaiLoader;
  }
}
