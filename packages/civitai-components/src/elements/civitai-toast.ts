import { css, html, nothing, unsafeCSS, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

import type { Intent } from './civitai-badge.js';

const TAG = 'civitai-toast';

const accent = (value: Intent) => {
  const name = unsafeCSS(value);
  return css`
    :host([color='${name}']) {
      border-left-color: var(--civitai-color-${name});
    }
  `;
};

export class CivitaiToast extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        pointer-events: auto;
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding: 12px 14px;
        border-radius: var(--civitai-radius);
        background: var(--civitai-color-surface);
        color: var(--civitai-color-text);
        border: 1px solid var(--civitai-color-border);
        border-left: 4px solid var(--civitai-color-border);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
        font-size: 14px;
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
    accent('info'),
    accent('success'),
    accent('warning'),
    accent('error'),
  ];

  static override properties: PropertyDeclarations = {
    color: { reflect: true },
    heading: { reflect: true },
    closable: { type: Boolean, reflect: true },
    urgent: { type: Boolean, reflect: true },
    closeLabel: { reflect: true, attribute: 'close-label' },
  };

  declare color: Intent | '';
  /** Not `title`: that attribute is global and would render a tooltip. */
  declare heading: string;
  declare closable: boolean;
  /** Announce assertively rather than politely. */
  declare urgent: boolean;
  declare closeLabel: string;

  constructor() {
    super();
    this.color = '';
    this.heading = '';
    this.closable = false;
    this.urgent = false;
    this.closeLabel = 'Dismiss';
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // On the HOST, not an inner node: the role has to sit on the element the
    // live region actually sees appear.
    if (!this.hasAttribute('role')) {
      this.setAttribute('role', this.urgent ? 'alert' : 'status');
    }
  }

  #close(): void {
    this.dispatchEvent(new Event('close', { bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    return html`
      <div class="body" part="body">
        ${this.heading !== ''
          ? html`<div class="title" part="title">${this.heading}</div>`
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

export function defineCivitaiToast(): void {
  defineElement(TAG, CivitaiToast);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-toast': CivitaiToast;
  }
}
