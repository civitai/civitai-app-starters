import { css, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export type ModalSize = 'sm' | 'md' | 'lg';

const TAG = 'civitai-modal';

let sequence = 0;

/**
 * Native `<dialog>.showModal()`: the focus trap, the top layer, the inert
 * background and focus restore all come from the platform. The React binding
 * documents that it traps nothing, so this is a strict upgrade, not a port.
 */
export class CivitaiModal extends CivitaiElement {
  static override styles = [
    hostBaseline,
    css`
      :host {
        display: contents;
      }
      dialog {
        /* Fills the viewport so a click landing on the dialog itself is
           unambiguously a click OUTSIDE the panel. */
        width: 100%;
        height: 100%;
        max-width: none;
        max-height: none;
        margin: 0;
        padding: 32px 16px;
        border: none;
        background: transparent;
        overflow-y: auto;
        align-items: flex-start;
        justify-content: center;
      }
      dialog[open] {
        display: flex;
      }
      dialog::backdrop {
        background: rgba(0, 0, 0, 0.55);
      }
      .panel {
        background: var(--civitai-color-surface);
        color: var(--civitai-color-text);
        border: 1px solid var(--civitai-color-border);
        border-radius: var(--civitai-radius);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
        width: 100%;
        max-width: 440px;
        outline: none;
        height: fit-content;
      }
      :host([size='sm']) .panel {
        max-width: 340px;
      }
      :host([size='lg']) .panel {
        max-width: 620px;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 18px;
        border-bottom: 1px solid var(--civitai-color-border);
      }
      .title {
        font-size: 16px;
        font-weight: 700;
        margin: 0;
      }
      .close {
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--civitai-color-text-dimmed);
        font-size: 20px;
        line-height: 1;
        padding: 0;
      }
      .close:hover {
        color: var(--civitai-color-text);
      }
      .body {
        padding: 18px;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    open: { type: Boolean, reflect: true },
    heading: { reflect: true },
    size: { reflect: true },
    withCloseButton: { type: Boolean, reflect: true, attribute: 'with-close-button' },
    closeOnOverlayClick: {
      type: Boolean,
      reflect: true,
      attribute: 'close-on-overlay-click',
    },
    closeOnEscape: { type: Boolean, reflect: true, attribute: 'close-on-escape' },
    closeLabel: { reflect: true, attribute: 'close-label' },
  };

  declare open: boolean;
  /** Not `title`: that attribute is global and would render a tooltip. */
  declare heading: string;
  declare size: ModalSize;
  declare withCloseButton: boolean;
  declare closeOnOverlayClick: boolean;
  declare closeOnEscape: boolean;
  declare closeLabel: string;

  readonly #id = `ci-modal-${(sequence += 1)}`;

  constructor() {
    super();
    this.open = false;
    this.heading = '';
    this.size = 'md';
    this.withCloseButton = true;
    this.closeOnOverlayClick = true;
    this.closeOnEscape = true;
    this.closeLabel = 'Close';
  }

  show(): void {
    this.open = true;
  }

  hide(): void {
    this.open = false;
  }

  toggle(): void {
    this.open = !this.open;
  }

  get #dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector('dialog');
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const dialog = this.#dialog;
    if (!dialog) return;
    if (this.open && !dialog.open) dialog.showModal();
    else if (!this.open && dialog.open) dialog.close();
  }

  /** Escape reaches the dialog as `cancel`, which is preventable. */
  #onCancel(event: Event): void {
    if (this.closeOnEscape) return;
    event.preventDefault();
  }

  #onClose(): void {
    this.open = false;
    this.dispatchEvent(new Event('close', { bubbles: true, composed: true }));
  }

  #onClick(event: MouseEvent): void {
    if (!this.closeOnOverlayClick) return;
    // The dialog fills the viewport and the panel sits inside it, so the
    // dialog itself is only ever the target for a click outside the panel.
    if (event.target !== this.#dialog) return;
    this.open = false;
  }

  override render(): TemplateResult {
    return html`
      <dialog
        part="dialog"
        aria-labelledby=${ifDefined(this.heading !== '' ? `${this.#id}-title` : undefined)}
        @cancel=${this.#onCancel}
        @close=${this.#onClose}
        @click=${this.#onClick}
      >
        <div class="panel" part="panel">
          ${this.heading !== '' || this.withCloseButton
            ? html`<div class="header" part="header">
                ${this.heading !== ''
                  ? html`<h2 id="${this.#id}-title" class="title" part="heading">
                      ${this.heading}
                    </h2>`
                  : html`<span></span>`}
                ${this.withCloseButton
                  ? html`<button
                      class="close"
                      part="close"
                      type="button"
                      aria-label=${ifDefined(this.closeLabel || undefined)}
                      @click=${() => {
                        this.open = false;
                      }}
                    >
                      &times;
                    </button>`
                  : nothing}
              </div>`
            : nothing}
          <div class="body" part="body"><slot></slot></div>
        </div>
      </dialog>
    `;
  }
}

export function defineCivitaiModal(): void {
  defineElement(TAG, CivitaiModal);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-modal': CivitaiModal;
  }
}
