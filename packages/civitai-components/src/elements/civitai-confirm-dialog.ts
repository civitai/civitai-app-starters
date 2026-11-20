import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiModal } from './civitai-modal.js';
import { defineElement } from './registry.js';

const TAG = 'civitai-confirm-dialog';

/**
 * The modal with its two buttons filled in. `ask()` is the reason it exists:
 * a confirmation reads as one awaited line rather than a pair of listeners.
 */
export class CivitaiConfirmDialog extends CivitaiModal {
  static override styles = [
    ...(CivitaiModal.styles as unknown[]),
    css`
      .message {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
        color: var(--civitai-color-text);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 14px 18px;
        border-top: 1px solid var(--civitai-color-border);
      }
      .actions button {
        height: 34px;
        padding: 0 14px;
        border-radius: var(--civitai-radius);
        border: 1px solid var(--civitai-color-border);
        background: var(--civitai-color-surface);
        color: var(--civitai-color-text);
        font-family: var(--civitai-font);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .actions button:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 2px;
      }
      .confirm {
        background: var(--civitai-color-primary);
        border-color: var(--civitai-color-primary);
        color: var(--civitai-color-primary-fg);
      }
      :host([destructive]) .confirm {
        background: var(--civitai-color-error);
        border-color: var(--civitai-color-error);
        color: var(--civitai-color-gray-0);
      }
    `,
  ] as typeof CivitaiModal.styles;

  static override properties: PropertyDeclarations = {
    ...CivitaiModal.properties,
    message: { reflect: true },
    confirmLabel: { reflect: true, attribute: 'confirm-label' },
    cancelLabel: { reflect: true, attribute: 'cancel-label' },
    destructive: { type: Boolean, reflect: true },
  };

  declare message: string;
  declare confirmLabel: string;
  declare cancelLabel: string;
  /** Paints the confirm button as a destructive action, and focuses cancel. */
  declare destructive: boolean;

  #settle: ((confirmed: boolean) => void) | undefined;

  constructor() {
    super();
    this.message = '';
    this.confirmLabel = 'Confirm';
    this.cancelLabel = 'Cancel';
    this.destructive = false;
  }

  /** Opens, and resolves with what the viewer chose. Dismissing is a `false`. */
  ask(): Promise<boolean> {
    this.#settle?.(false);
    this.open = true;
    return new Promise<boolean>((resolve) => {
      this.#settle = resolve;
    });
  }

  #answer(confirmed: boolean): void {
    this.open = false;
    this.#settle?.(confirmed);
    this.#settle = undefined;
    if (confirmed) this.dispatchEvent(new Event('confirm', { bubbles: true, composed: true }));
  }

  /* Escape and the overlay both land here as `close`, so a dismissal answers
     the promise rather than leaving it pending forever. */
  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#settle?.(false);
    this.#settle = undefined;
  }

  protected override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    if (changed.has('open') && !this.open && this.#settle) {
      this.#settle(false);
      this.#settle = undefined;
    }
  }

  protected override renderBody(): TemplateResult {
    return html`<div class="body" part="body">
      ${this.message !== '' ? html`<p class="message" part="message">${this.message}</p>` : nothing}
      <slot></slot>
    </div>`;
  }

  protected override renderFooter(): TemplateResult {
    return html`<div class="actions" part="actions">
      <button
        class="cancel"
        part="cancel"
        type="button"
        autofocus=${ifDefined(this.destructive ? '' : undefined)}
        @click=${() => this.#answer(false)}
      >
        ${this.cancelLabel}
      </button>
      <button
        class="confirm"
        part="confirm"
        type="button"
        autofocus=${ifDefined(this.destructive ? undefined : '')}
        @click=${() => this.#answer(true)}
      >
        ${this.confirmLabel}
      </button>
    </div>`;
  }
}

export function defineCivitaiConfirmDialog(): void {
  defineElement(TAG, CivitaiConfirmDialog);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-confirm-dialog': CivitaiConfirmDialog;
  }
}
