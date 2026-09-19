import { css, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiElement } from './base.js';
import { choiceStyles } from './choice-styles.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export type RadioGroupOrientation = 'vertical' | 'horizontal';

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const TAG = 'civitai-radio-group';

let sequence = 0;

/**
 * Owns the whole set: native `name` exclusion is tree-scoped, so radios in
 * sibling shadow roots never group. One root keeps that behaviour native.
 */
export class CivitaiRadioGroup extends CivitaiElement {
  static formAssociated = true;

  static override styles = [
    hostBaseline,
    choiceStyles,
    css`
      :host {
        gap: 8px;
      }
      .options {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      :host([orientation='horizontal']) .options {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 16px;
      }
      .group-label {
        font-size: 14px;
        font-weight: 600;
        color: var(--civitai-color-text);
      }
      :host([data-invalid]) input {
        accent-color: var(--civitai-color-error);
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    data: { attribute: false },
    // Not reflected: the attribute is the default `form.reset()` returns to.
    value: {},
    name: { reflect: true },
    label: { reflect: true },
    description: { reflect: true },
    error: { reflect: true },
    required: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
    orientation: { reflect: true },
  };

  declare data: RadioOption[];
  declare value: string;
  declare name: string;
  declare label: string;
  declare description: string;
  declare error: string;
  declare required: boolean;
  declare disabled: boolean;
  declare orientation: RadioGroupOrientation;

  readonly #internals = this.attachInternals();
  readonly #id = `ci-radio-group-${(sequence += 1)}`;

  constructor() {
    super();
    this.data = [];
    this.value = '';
    this.name = '';
    this.label = '';
    this.description = '';
    this.error = '';
    this.required = false;
    this.disabled = false;
    this.orientation = 'vertical';
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

  formResetCallback(): void {
    this.value = this.getAttribute('value') ?? '';
  }

  formStateRestoreCallback(state: string | null): void {
    this.value = state ?? '';
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
    this.#internals.setFormValue(this.value === '' ? null : this.value);
    this.toggleAttribute('data-invalid', this.error !== '');
    const first = this.renderRoot.querySelector('input') ?? undefined;
    if (this.required && this.value === '') {
      this.#internals.setValidity(
        { valueMissing: true },
        this.error || 'Please select one of these options.',
        first
      );
    } else if (this.error !== '') {
      this.#internals.setValidity({ customError: true }, this.error, first);
    } else {
      this.#internals.setValidity({});
    }
  }

  #onChange(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
  }

  override render(): TemplateResult {
    const invalid = this.error !== '';
    const describedBy =
      [this.description !== '' ? `${this.#id}-desc` : '', invalid ? `${this.#id}-err` : '']
        .filter(Boolean)
        .join(' ') || undefined;

    return html`
      <div
        class="group"
        part="group"
        role="radiogroup"
        aria-labelledby=${ifDefined(this.label !== '' ? `${this.#id}-label` : undefined)}
        aria-label=${ifDefined(
          this.label === '' ? (this.getAttribute('aria-label') ?? undefined) : undefined
        )}
        aria-describedby=${ifDefined(describedBy)}
        aria-invalid=${ifDefined(invalid ? 'true' : undefined)}
      >
        ${this.label !== ''
          ? html`<span id="${this.#id}-label" class="group-label" part="label"
              >${this.label}${this.required
                ? html`<span class="required" aria-hidden="true">*</span>`
                : nothing}</span
            >`
          : nothing}
        ${this.description !== ''
          ? html`<span id="${this.#id}-desc" class="description" part="description"
              >${this.description}</span
            >`
          : nothing}
        <div class="options" part="options">
          ${this.data.map((option, index) => {
            const optionId = `${this.#id}-${index}`;
            return html`<div class="choice">
              <input
                id=${optionId}
                part="control"
                type="radio"
                name=${this.#id}
                value=${option.value}
                .checked=${option.value === this.value}
                ?disabled=${this.disabled || (option.disabled ?? false)}
                @change=${this.#onChange}
              />
              <label for=${optionId} part="option-label">${option.label}</label>
            </div>`;
          })}
        </div>
        ${invalid
          ? html`<span id="${this.#id}-err" class="error" part="error" role="alert"
              >${this.error}</span
            >`
          : nothing}
      </div>
    `;
  }
}

export function defineCivitaiRadioGroup(): void {
  defineElement(TAG, CivitaiRadioGroup);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-radio-group': CivitaiRadioGroup;
  }
}
