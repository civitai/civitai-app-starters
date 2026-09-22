import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export type Gap = 'sm' | 'md' | 'lg';

const TAG = 'civitai-stack';

export class CivitaiStack extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      :host([gap='sm']) {
        gap: 8px;
      }
      :host([gap='md']) {
        gap: 16px;
      }
      :host([gap='lg']) {
        gap: 24px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = { gap: { reflect: true } };

  declare gap: Gap | '';

  constructor() {
    super();
    this.gap = '';
  }

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }
}

export function defineCivitaiStack(): void {
  defineElement(TAG, CivitaiStack);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-stack': CivitaiStack;
  }
}
