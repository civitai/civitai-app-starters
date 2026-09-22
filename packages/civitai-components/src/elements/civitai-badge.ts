import { css, html, unsafeCSS, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export type BadgeVariant = 'filled' | 'light' | 'outline';
export type BadgeSize = 'sm' | 'md' | 'lg';
export type Intent = 'info' | 'success' | 'warning' | 'error';

const TAG = 'civitai-badge';

/** Each intent recolours all three variants; absent `color` keeps primary. */
const intent = (value: Intent) => {
  // `unsafeCSS` is Lit's injection guard; `value` is a closed literal union.
  const name = unsafeCSS(value);
  return css`
  :host([color='${name}'][variant='filled']) {
    background: var(--civitai-color-${name});
    border-color: var(--civitai-color-${name});
  }
  :host([color='${name}'][variant='light']) {
    background: color-mix(in srgb, var(--civitai-color-${name}) 14%, transparent);
    color: var(--civitai-color-${name});
  }
  :host([color='${name}'][variant='outline']) {
    color: var(--civitai-color-${name});
    border-color: var(--civitai-color-${name});
  }
  `;
};

export class CivitaiBadge extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        border: 1px solid transparent;
        border-radius: 999px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        text-transform: uppercase;
        letter-spacing: 0.02em;
        height: 22px;
        padding: 0 10px;
        font-size: 11px;
        background: var(--civitai-color-primary);
        color: var(--civitai-color-primary-fg);
        border-color: var(--civitai-color-primary);
      }
      :host([size='sm']) {
        height: 18px;
        padding: 0 8px;
        font-size: 10px;
      }
      :host([size='lg']) {
        height: 26px;
        padding: 0 12px;
        font-size: 13px;
      }
      :host([variant='light']) {
        background: color-mix(in srgb, var(--civitai-color-primary) 14%, transparent);
        color: var(--civitai-color-primary);
        border-color: transparent;
      }
      :host([variant='outline']) {
        background: transparent;
        color: var(--civitai-color-primary);
        border-color: var(--civitai-color-primary);
      }
    `,
    intent('info'),
    intent('success'),
    intent('warning'),
    intent('error'),
  ];

  static override properties: PropertyDeclarations = {
    variant: { reflect: true },
    size: { reflect: true },
    color: { reflect: true },
  };

  declare variant: BadgeVariant;
  declare size: BadgeSize;
  declare color: Intent | '';

  constructor() {
    super();
    this.variant = 'filled';
    this.size = 'md';
    this.color = '';
  }

  override render(): TemplateResult {
    return html`<slot></slot>`;
  }
}

export function defineCivitaiBadge(): void {
  defineElement(TAG, CivitaiBadge);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-badge': CivitaiBadge;
  }
}
