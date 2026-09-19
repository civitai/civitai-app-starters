import { css, html, nothing, unsafeCSS, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

import type { Intent } from './civitai-badge.js';

const TAG = 'civitai-alert';

/** Warning carries a heavier tint than the rest; the values are not uniform. */
const tint = (value: Intent, background: number) => {
  const name = unsafeCSS(value);
  const percent = unsafeCSS(String(background));
  return css`
    :host([color='${name}']) {
      background: color-mix(in srgb, var(--civitai-color-${name}) ${percent}%, transparent);
      border-color: color-mix(in srgb, var(--civitai-color-${name}) 35%, transparent);
    }
  `;
};

export class CivitaiAlert extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding: 12px 14px;
        border-radius: var(--civitai-radius);
        border: 1px solid transparent;
        font-size: 14px;
        color: var(--civitai-color-text);
        background: color-mix(in srgb, var(--civitai-color-info) 12%, transparent);
        border-color: color-mix(in srgb, var(--civitai-color-info) 35%, transparent);
      }
      .body {
        flex: 1;
        min-width: 0;
      }
      .title {
        font-weight: 600;
        margin-bottom: 2px;
      }
      .close {
        background: transparent;
        border: none;
        cursor: pointer;
        color: inherit;
        font-size: 16px;
        line-height: 1;
        padding: 0;
        opacity: 0.7;
      }
      .close:hover {
        opacity: 1;
      }
    `,
    tint('info', 12),
    tint('success', 12),
    tint('warning', 14),
    tint('error', 12),
  ];

  static override properties: PropertyDeclarations = {
    color: { reflect: true },
    heading: { reflect: true, attribute: 'heading' },
    closable: { type: Boolean, reflect: true },
    closeLabel: { reflect: true, attribute: 'close-label' },
  };

  declare color: Intent | '';
  /** Not `title`: that attribute is global and would render a tooltip. */
  declare heading: string;
  declare closable: boolean;
  declare closeLabel: string;

  constructor() {
    super();
    this.color = '';
    this.heading = '';
    this.closable = false;
    this.closeLabel = 'Dismiss';
  }

  #close(): void {
    this.dispatchEvent(new Event('close', { bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    return html`
      <div class="body" part="body">
        ${this.heading !== ''
          ? html`<div class="title" part="heading">${this.heading}</div>`
          : nothing}
        <slot></slot>
      </div>
      ${this.closable
        ? html`<button
            class="close"
            part="close"
            type="button"
            aria-label=${ifDefined(this.closeLabel || undefined)}
            @click=${this.#close}
          >
            &times;
          </button>`
        : nothing}
    `;
  }
}

export function defineCivitaiAlert(): void {
  defineElement(TAG, CivitaiAlert);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-alert': CivitaiAlert;
  }
}
