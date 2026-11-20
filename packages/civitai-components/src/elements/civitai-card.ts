import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export type CardPadding = 'sm' | 'md' | 'lg';

const TAG = 'civitai-card';

export class CivitaiCard extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: block;
        background: var(--civitai-color-surface);
        border-radius: var(--civitai-radius);
        color: var(--civitai-color-text);
        border: var(--civitai-card-border-width, 1px) solid
          color-mix(in srgb, var(--civitai-color-border) 55%, transparent);
      }
      :host([with-border]) {
        border: 1px solid var(--civitai-color-border);
      }
      :host([padding='sm']) {
        padding: 10px;
      }
      :host([padding='md']) {
        padding: 16px;
      }
      :host([padding='lg']) {
        padding: 24px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    padding: { reflect: true },
    withBorder: { type: Boolean, reflect: true, attribute: 'with-border' },
  };

  declare padding: CardPadding | '';
  declare withBorder: boolean;

  constructor() {
    super();
    this.padding = '';
    this.withBorder = false;
  }

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }
}

export function defineCivitaiCard(): void {
  defineElement(TAG, CivitaiCard);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-card': CivitaiCard;
  }
}
