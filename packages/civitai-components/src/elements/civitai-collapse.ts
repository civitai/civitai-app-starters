import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-collapse';

let sequence = 0;

export class CivitaiCollapse extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: block;
      }
      button {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 6px 0;
        background: transparent;
        border: none;
        font-family: var(--civitai-font);
        font-size: 14px;
        font-weight: 600;
        color: var(--civitai-color-text);
        text-align: left;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      button:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 2px;
      }
      .chevron {
        display: inline-block;
        width: 1em;
        color: var(--civitai-color-text-dimmed);
      }
      .region {
        padding-top: 4px;
      }
      .region[hidden] {
        display: none;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    open: { type: Boolean, reflect: true },
    heading: { reflect: true },
    disabled: { type: Boolean, reflect: true },
  };

  declare open: boolean;
  /** Trigger label. Not `title`, which is a global attribute. */
  declare heading: string;
  declare disabled: boolean;

  readonly #id = `ci-collapse-${(sequence += 1)}`;

  constructor() {
    super();
    this.open = false;
    this.heading = '';
    this.disabled = false;
  }

  #toggle(): void {
    this.open = !this.open;
    this.dispatchEvent(new Event('toggle', { bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    const triggerId = `${this.#id}-trigger`;
    const regionId = `${this.#id}-region`;
    return html`
      <button
        id=${triggerId}
        part="trigger"
        type="button"
        aria-expanded=${String(this.open)}
        aria-controls=${regionId}
        ?disabled=${this.disabled}
        @click=${this.#toggle}
      >
        <span class="chevron" part="chevron" aria-hidden="true">${this.open ? '▾' : '▸'}</span>
        ${this.heading}
      </button>
      <!-- hidden, so collapsed content leaves both the a11y tree and the tab order -->
      <div
        id=${regionId}
        class="region"
        part="region"
        role="region"
        aria-labelledby=${triggerId}
        ?hidden=${!this.open}
      >
        <slot></slot>
      </div>
    `;
  }
}

export function defineCivitaiCollapse(): void {
  defineElement(TAG, CivitaiCollapse);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-collapse': CivitaiCollapse;
  }
}
