import {
  css,
  html,
  nothing,
  type PropertyDeclarations,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-text-input';

let sequence = 0;

export class CivitaiTextInput extends CivitaiElement {
  static formAssociated = true;

  static override styles = [
    hostBaseline,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      label {
        font-size: 14px;
        font-weight: 600;
        color: var(--civitai-color-text);
      }
      .required {
        color: var(--civitai-color-error);
        margin-left: 2px;
      }
      .description {
        font-size: 12px;
        color: var(--civitai-color-text-dimmed);
      }
      .error {
        font-size: 12px;
        color: var(--civitai-color-error);
      }

      input {
        width: 100%;
        font-family: var(--civitai-font);
        font-size: 14px;
        color: var(--civitai-color-text);
        background: var(--civitai-color-surface);
        border: 1px solid var(--civitai-color-border);
        border-radius: var(--civitai-radius);
        padding: 8px 12px;
        transition: border-color 120ms ease;
      }
      input:focus {
        outline: none;
        border-color: var(--civitai-color-primary);
      }
      input[aria-invalid='true'] {
        border-color: var(--civitai-color-error);
      }
      input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    name: { reflect: true },
    value: {},
    label: { reflect: true },
    description: { reflect: true },
    error: { reflect: true },
    placeholder: { reflect: true },
    type: { reflect: true },
    required: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    readOnly: { type: Boolean, reflect: true, attribute: 'readonly' },
  };

  declare name: string;
  /** Current text. The `value` ATTRIBUTE is the default, as on a native input. */
  declare value: string;
  declare label: string;
  declare description: string;
  /** Message to show; also marks the control invalid. */
  declare error: string;
  declare placeholder: string;
  declare type: string;
  declare required: boolean;
  declare disabled: boolean;
  declare readOnly: boolean;

  readonly #internals = this.attachInternals();
  readonly #id = `ci-text-input-${(sequence += 1)}`;

  constructor() {
    super();
    this.name = '';
    this.value = '';
    this.label = '';
    this.description = '';
    this.error = '';
    this.placeholder = '';
    this.type = 'text';
    this.required = false;
    this.disabled = false;
    this.readOnly = false;
  }

  get form(): HTMLFormElement | null {
    return this.#internals.form;
  }

  get validity(): ValidityState {
    return this.#internals.validity;
  }

  checkValidity(): boolean {
    return this.#internals.checkValidity();
  }

  reportValidity(): boolean {
    return this.#internals.reportValidity();
  }

  /** Native semantics: reset returns to the `value` attribute, not to empty. */
  formResetCallback(): void {
    this.value = this.getAttribute('value') ?? '';
  }

  formStateRestoreCallback(state: string | null): void {
    this.value = state ?? '';
  }

  get #control(): HTMLInputElement | null {
    return this.renderRoot.querySelector('input');
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#sync();
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.#sync();
  }

  #sync(): void {
    this.#internals.setFormValue(this.value);
    const missing = this.required && this.value === '';
    if (missing) {
      this.#internals.setValidity(
        { valueMissing: true },
        this.error || 'Please fill out this field.',
        this.#control ?? undefined
      );
    } else if (this.error !== '') {
      this.#internals.setValidity({ customError: true }, this.error, this.#control ?? undefined);
    } else {
      this.#internals.setValidity({});
    }
  }

  #onInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
  }

  /**
   * A form does not cross a shadow boundary, so the inner input's implicit
   * submission never reaches it. Enter has to be forwarded by hand.
   */
  #onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    const { form } = this.#internals;
    if (!form) return;
    event.preventDefault();
    form.requestSubmit();
  }

  override render(): TemplateResult {
    const invalid = this.error !== '';
    const describedBy =
      [this.description !== '' ? `${this.#id}-desc` : '', invalid ? `${this.#id}-err` : '']
        .filter(Boolean)
        .join(' ') || undefined;

    return html`
      ${this.label !== ''
        ? html`<label for=${this.#id} part="label"
            >${this.label}${this.required
              ? html`<span class="required" aria-hidden="true">*</span>`
              : nothing}</label
          >`
        : nothing}
      ${this.description !== ''
        ? html`<span id="${this.#id}-desc" class="description" part="description"
            >${this.description}</span
          >`
        : nothing}
      <input
        id=${this.#id}
        part="control"
        .value=${this.value}
        type=${this.type}
        name=${ifDefined(this.name || undefined)}
        placeholder=${ifDefined(this.placeholder || undefined)}
        ?required=${this.required}
        ?disabled=${this.disabled}
        ?readonly=${this.readOnly}
        aria-invalid=${ifDefined(invalid ? 'true' : undefined)}
        aria-describedby=${ifDefined(describedBy)}
        @input=${this.#onInput}
        @keydown=${this.#onKeyDown}
      />
      ${invalid
        ? html`<span id="${this.#id}-err" class="error" part="error" role="alert"
            >${this.error}</span
          >`
        : nothing}
    `;
  }
}

export function defineCivitaiTextInput(): void {
  defineElement(TAG, CivitaiTextInput);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-text-input': CivitaiTextInput;
  }
}
