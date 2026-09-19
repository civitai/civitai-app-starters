import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiField, fieldStyles } from './field-base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const TAG = 'civitai-select';

export class CivitaiSelect extends CivitaiField {
  static override styles = [
    hostBaseline,
    fieldStyles,
    css`
      /* The native disclosure caret is kept — most robust and accessible — so
         reserve room on the right for it to sit clear of a long label. */
      select.control {
        cursor: pointer;
        padding-right: 28px;
        line-height: 1.4;
      }
      select.control:disabled {
        cursor: not-allowed;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    ...CivitaiField.properties,
    data: { attribute: false },
    placeholder: { reflect: true },
  };

  /** Options as data; an attribute cannot carry them. */
  declare data: SelectOption[];
  /** Shown as a disabled first option when nothing is selected. */
  declare placeholder: string;

  constructor() {
    super();
    this.data = [];
    this.placeholder = '';
  }

  protected override renderControl(): TemplateResult {
    const { id, part, name, ariaInvalid, ariaDescribedBy } = this.controlAttrs();
    return html`<select
      class="control"
      id=${id}
      part=${part}
      name=${ifDefined(name)}
      ?required=${this.required}
      ?disabled=${this.disabled}
      aria-invalid=${ifDefined(ariaInvalid)}
      aria-describedby=${ifDefined(ariaDescribedBy)}
      @change=${this.onControlInput}
      @keydown=${this.submitOnEnter}
    >
      ${this.placeholder !== ''
        ? html`<option value="" disabled ?selected=${this.value === ''}>
            ${this.placeholder}
          </option>`
        : ''}
      ${this.data.map(
        (option) => html`<option
          value=${option.value}
          ?disabled=${option.disabled ?? false}
          ?selected=${option.value === this.value}
        >
          ${option.label}
        </option>`
      )}
    </select>`;
  }
}

export function defineCivitaiSelect(): void {
  defineElement(TAG, CivitaiSelect);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-select': CivitaiSelect;
  }
}
