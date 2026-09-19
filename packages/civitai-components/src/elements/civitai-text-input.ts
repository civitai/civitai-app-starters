import { html, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiField } from './field-base.js';
import { defineElement } from './registry.js';

const TAG = 'civitai-text-input';

export class CivitaiTextInput extends CivitaiField {
  static override properties: PropertyDeclarations = {
    ...CivitaiField.properties,
    placeholder: { reflect: true },
    type: { reflect: true },
    readOnly: { type: Boolean, reflect: true, attribute: 'readonly' },
    maxLength: { type: Number, reflect: true, attribute: 'maxlength' },
    autocomplete: { reflect: true },
  };

  declare placeholder: string;
  declare type: string;
  declare readOnly: boolean;
  /** 0 means unbounded, matching an absent native `maxlength`. */
  declare maxLength: number;
  declare autocomplete: string;

  constructor() {
    super();
    this.placeholder = '';
    this.type = 'text';
    this.readOnly = false;
    this.maxLength = 0;
    this.autocomplete = '';
  }

  protected override renderControl(): TemplateResult {
    const { id, part, name, ariaInvalid, ariaDescribedBy } = this.controlAttrs();
    return html`<input
      class="control"
      id=${id}
      part=${part}
      .value=${this.value}
      type=${this.type}
      name=${ifDefined(name)}
      placeholder=${ifDefined(this.placeholder || undefined)}
      maxlength=${ifDefined(this.maxLength > 0 ? this.maxLength : undefined)}
      autocomplete=${ifDefined(this.autocomplete || undefined)}
      ?required=${this.required}
      ?disabled=${this.disabled}
      ?readonly=${this.readOnly}
      aria-invalid=${ifDefined(ariaInvalid)}
      aria-describedby=${ifDefined(ariaDescribedBy)}
      @input=${this.onControlInput}
      @keydown=${this.submitOnEnter}
    />`;
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
