import { css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { choiceStyles } from './choice-styles.js';
import { CivitaiField, fieldStyles } from './field-base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export type RadioGroupOrientation = 'vertical' | 'horizontal';

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const TAG = 'civitai-radio-group';

/**
 * Owns the whole set: native `name` exclusion is tree-scoped, so radios in
 * sibling shadow roots never group. One root keeps that behaviour native.
 */
export class CivitaiRadioGroup extends CivitaiField {
  static override styles = [
    hostBaseline,
    fieldStyles,
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
    ...CivitaiField.properties,
    data: { attribute: false },
    orientation: { reflect: true },
  };

  declare data: RadioOption[];
  declare orientation: RadioGroupOrientation;

  constructor() {
    super();
    this.data = [];
    this.orientation = 'vertical';
  }

  protected override formValue(): string | null {
    return this.value === '' ? null : this.value;
  }

  protected override get missingMessage(): string {
    return 'Please select one of these options.';
  }

  protected override sync(): void {
    this.toggleAttribute('data-invalid', this.invalid);
    super.sync();
  }

  #onChange(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
  }

  /* A span rather than a `<label for>`: the group is a radiogroup, not a
     labelable control, so it takes its name by reference. */
  protected override renderLabel(): TemplateResult | typeof nothing {
    if (this.label === '') return nothing;
    return html`<span id="${this.fieldId}-label" class="group-label" part="label"
      >${this.label}${this.renderRequiredMark()}</span
    >`;
  }

  protected override renderControl(): TemplateResult {
    return html`<div class="options" part="options">
      ${this.data.map((option, index) => {
        const optionId = `${this.fieldId}-${index}`;
        return html`<div class="choice">
          <input
            id=${optionId}
            part="control"
            type="radio"
            name=${this.fieldId}
            value=${option.value}
            .checked=${option.value === this.value}
            ?disabled=${this.disabled || (option.disabled ?? false)}
            @change=${this.#onChange}
          />
          <label for=${optionId} part="option-label">${option.label}</label>
        </div>`;
      })}
    </div>`;
  }

  override render(): TemplateResult {
    return html`
      <div
        class="group"
        part="group"
        role="radiogroup"
        aria-labelledby=${ifDefined(this.label !== '' ? `${this.fieldId}-label` : undefined)}
        aria-label=${ifDefined(
          this.label === '' ? (this.getAttribute('aria-label') ?? undefined) : undefined
        )}
        aria-describedby=${ifDefined(this.describedBy)}
        aria-invalid=${ifDefined(this.invalid ? 'true' : undefined)}
      >
        ${this.renderLabel()}${this.renderDescription()}${this.renderControl()}${this.renderError()}
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
