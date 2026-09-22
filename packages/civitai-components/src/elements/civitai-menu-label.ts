import { css, html, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-menu-label';

export class CivitaiMenuLabel extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: block;
        padding: 10px 14px 4px;
        color: var(--civitai-color-text-dimmed);
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    // `presentation` keeps the heading out of the menu's item count; it names
    // the group visually and `role=menu` owns only its items.
    this.setAttribute('role', 'presentation');
  }

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }
}

export function defineCivitaiMenuLabel(): void {
  defineElement(TAG, CivitaiMenuLabel);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-menu-label': CivitaiMenuLabel;
  }
}
