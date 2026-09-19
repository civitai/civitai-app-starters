import { html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { choiceStyles } from './choice-styles.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-checkbox';

let sequence = 0;

export class CivitaiCheckbox extends CivitaiElement {
  static formAssociated = true;

  static override styles = [hostBaseline, choiceStyles];

  static override properties: PropertyDeclarations = {
    name: { reflect: true },
    value: { reflect: true },
    label: { reflect: true },
    description: { reflect: true },
    error: { reflect: true },
    // Neither is reflected: the `checked` ATTRIBUTE is the default that
    // `form.reset()` returns to, exactly as on a native checkbox, so writing
    // the live state back to it would make reset a no-op. `indeterminate` has
    // no attribute on a native checkbox at all.
    checked: { type: Boolean },
    indeterminate: { type: Boolean },
    required: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
  };

  declare name: string;
  /** Submitted when checked, exactly as a native checkbox does. */
  declare value: string;
  declare label: string;
  declare description: string;
  declare error: string;
  declare checked: boolean;
  declare indeterminate: boolean;
  declare required: boolean;
  declare disabled: boolean;

  readonly #internals = this.attachInternals();
  readonly #id = `ci-checkbox-${(sequence += 1)}`;

  constructor() {
    super();
    this.name = '';
    this.value = 'on';
    this.label = '';
    this.description = '';
    this.error = '';
    this.checked = false;
    this.indeterminate = false;
    this.required = false;
    this.disabled = false;
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

  /** Native semantics: reset returns to the `checked` ATTRIBUTE. */
  formResetCallback(): void {
    this.checked = this.hasAttribute('checked');
    this.indeterminate = false;
  }

  formStateRestoreCallback(state: string | null): void {
    this.checked = state != null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#sync();
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const control = this.renderRoot.querySelector('input');
    // Indeterminate has no attribute; it is a property only.
    if (control) control.indeterminate = this.indeterminate;
    this.#sync();
  }

  #sync(): void {
    // An unchecked checkbox submits nothing at all, like the native one.
    this.#internals.setFormValue(this.checked ? this.value : null);
    const control = this.renderRoot.querySelector('input') ?? undefined;
    if (this.required && !this.checked) {
      this.#internals.setValidity(
        { valueMissing: true },
        this.error || 'Please check this box if you want to proceed.',
        control
      );
    } else if (this.error !== '') {
      this.#internals.setValidity({ customError: true }, this.error, control);
    } else {
      this.#internals.setValidity({});
    }
  }

  #onChange(event: Event): void {
    this.checked = (event.target as HTMLInputElement).checked;
    this.indeterminate = false;
  }

  override render(): TemplateResult {
    const invalid = this.error !== '';
    const describedBy =
      [this.description !== '' ? `${this.#id}-desc` : '', invalid ? `${this.#id}-err` : '']
        .filter(Boolean)
        .join(' ') || undefined;

    return html`
      <div class="choice" part="choice">
        <input
          id=${this.#id}
          part="control"
          type="checkbox"
          .checked=${this.checked}
          ?required=${this.required}
          ?disabled=${this.disabled}
          aria-invalid=${ifDefined(invalid ? 'true' : undefined)}
          aria-describedby=${ifDefined(describedBy)}
          @change=${this.#onChange}
        />
        ${this.label !== ''
          ? html`<label for=${this.#id} part="label"
              >${this.label}${this.required
                ? html`<span class="required" aria-hidden="true">*</span>`
                : nothing}</label
            >`
          : nothing}
      </div>
      ${this.description !== ''
        ? html`<span id="${this.#id}-desc" class="description" part="description"
            >${this.description}</span
          >`
        : nothing}
      ${invalid
        ? html`<span id="${this.#id}-err" class="error" part="error" role="alert"
            >${this.error}</span
          >`
        : nothing}
    `;
  }
}

export function defineCivitaiCheckbox(): void {
  defineElement(TAG, CivitaiCheckbox);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-checkbox': CivitaiCheckbox;
  }
}
