import { html, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiField } from './field-base.js';
import { defineElement } from './registry.js';

const TAG = 'civitai-number-input';

export class CivitaiNumberInput extends CivitaiField {
  static override properties: PropertyDeclarations = {
    ...CivitaiField.properties,
    placeholder: { reflect: true },
    min: { reflect: true },
    max: { reflect: true },
    step: { reflect: true },
  };

  declare placeholder: string;
  declare min: string;
  declare max: string;
  declare step: string;

  constructor() {
    super();
    this.placeholder = '';
    this.min = '';
    this.max = '';
    this.step = '';
  }

  /** `null` when the field is empty or not a number, never `NaN`. */
  get valueAsNumber(): number | null {
    if (this.value === '') return null;
    const parsed = Number(this.value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  protected override renderControl(): TemplateResult {
    const { id, part, name, ariaInvalid, ariaDescribedBy } = this.controlAttrs();
    return html`<input
      class="control"
      id=${id}
      part=${part}
      type="number"
      .value=${this.value}
      name=${ifDefined(name)}
      min=${ifDefined(this.min || undefined)}
      max=${ifDefined(this.max || undefined)}
      step=${ifDefined(this.step || undefined)}
      placeholder=${ifDefined(this.placeholder || undefined)}
      ?required=${this.required}
      ?disabled=${this.disabled}
      aria-invalid=${ifDefined(ariaInvalid)}
      aria-describedby=${ifDefined(ariaDescribedBy)}
      @input=${this.onControlInput}
      @keydown=${this.submitOnEnter}
    />`;
  }
}

export function defineCivitaiNumberInput(): void {
  defineElement(TAG, CivitaiNumberInput);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-number-input': CivitaiNumberInput;
  }
}
