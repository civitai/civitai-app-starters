import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

import type { Gap } from './civitai-stack.js';

const TAG = 'civitai-group';

export class CivitaiGroup extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      :host([nowrap]) {
        flex-wrap: nowrap;
      }
      :host([gap='sm']) {
        gap: 6px;
      }
      :host([gap='md']) {
        gap: 16px;
      }
      :host([gap='lg']) {
        gap: 24px;
      }
      /* A flex item refuses to shrink below its content width, so one long
         label pushes the row past its slot even with wrap. */
      ::slotted(*) {
        min-width: 0;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    gap: { reflect: true },
    nowrap: { type: Boolean, reflect: true },
  };

  declare gap: Gap | '';
  declare nowrap: boolean;

  constructor() {
    super();
    this.gap = '';
    this.nowrap = false;
  }

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }
}

export function defineCivitaiGroup(): void {
  defineElement(TAG, CivitaiGroup);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-group': CivitaiGroup;
  }
}
