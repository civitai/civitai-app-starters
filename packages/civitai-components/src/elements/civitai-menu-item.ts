import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-menu-item';

export class CivitaiMenuItem extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 14px;
        color: var(--civitai-color-text);
        font-size: 14px;
        line-height: 1.4;
        cursor: pointer;
        user-select: none;
      }
      :host(:hover),
      :host(:focus) {
        background: color-mix(in srgb, var(--civitai-color-text) 8%, transparent);
        outline: none;
      }
      :host([destructive]) {
        color: var(--civitai-color-error);
      }
      :host([disabled]) {
        opacity: 0.5;
        cursor: not-allowed;
      }
      slot[name='icon']::slotted(*) {
        display: inline-flex;
        flex: 0 0 auto;
        width: 16px;
        height: 16px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    value: { reflect: true },
    disabled: { type: Boolean, reflect: true },
    destructive: { type: Boolean, reflect: true },
  };

  /** `<option>` semantics: the item's own text is the value until you set one. */
  declare value: string;
  declare disabled: boolean;
  /** Paints the item as a destructive action — Delete, Remove, Block. */
  declare destructive: boolean;

  constructor() {
    super();
    this.value = '';
    this.disabled = false;
    this.destructive = false;
  }

  get selectedValue(): string {
    return this.value || (this.textContent ?? '').trim();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'menuitem');
    this.addEventListener('click', this.#gate, { capture: true });
    this.addEventListener('keydown', this.#activateOnKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('click', this.#gate, { capture: true });
    this.removeEventListener('keydown', this.#activateOnKey);
  }

  override updated(): void {
    // A disabled item stays in the menu's focus order the way a native menu's
    // does, so it is announced rather than silently missing.
    this.setAttribute('aria-disabled', this.disabled ? 'true' : 'false');
    this.tabIndex = -1;
  }

  readonly #gate = (event: Event): void => {
    if (!this.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  readonly #activateOnKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.click();
  };

  override render(): TemplateResult {
    return html`<slot name="icon"></slot><slot></slot>`;
  }
}

export function defineCivitaiMenuItem(): void {
  defineElement(TAG, CivitaiMenuItem);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-menu-item': CivitaiMenuItem;
  }
}
