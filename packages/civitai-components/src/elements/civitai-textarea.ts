import { css, html, type PropertyDeclarations, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiField, fieldStyles } from './field-base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-textarea';

export class CivitaiTextarea extends CivitaiField {
  static override styles = [
    hostBaseline,
    fieldStyles,
    css`
      textarea.control {
        resize: vertical;
        line-height: 1.5;
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    ...CivitaiField.properties,
    placeholder: { reflect: true },
    rows: { type: Number, reflect: true },
    readOnly: { type: Boolean, reflect: true, attribute: 'readonly' },
    maxLength: { type: Number, reflect: true, attribute: 'maxlength' },
    autocomplete: { reflect: true },
  };

  declare placeholder: string;
  /** 0 leaves the native default (2). `blocks-react`'s Textarea picks 3; the
      attribute markup this replaces does not, and that is the contract here. */
  declare rows: number;
  declare readOnly: boolean;
  /** 0 means unbounded, matching an absent native `maxlength`. */
  declare maxLength: number;
  declare autocomplete: string;

  constructor() {
    super();
    this.placeholder = '';
    this.rows = 0;
    this.readOnly = false;
    this.maxLength = 0;
    this.autocomplete = '';
  }

  // No Enter-to-submit: in a textarea, Enter is a newline.
  protected override renderControl(): TemplateResult {
    const { id, part, name, ariaInvalid, ariaDescribedBy } = this.controlAttrs();
    return html`<textarea
      class="control"
      id=${id}
      part=${part}
      .value=${this.value}
      name=${ifDefined(name)}
      rows=${ifDefined(this.rows > 0 ? this.rows : undefined)}
      placeholder=${ifDefined(this.placeholder || undefined)}
      maxlength=${ifDefined(this.maxLength > 0 ? this.maxLength : undefined)}
      autocomplete=${ifDefined(this.autocomplete || undefined)}
      ?required=${this.required}
      ?disabled=${this.disabled}
      ?readonly=${this.readOnly}
      aria-invalid=${ifDefined(ariaInvalid)}
      aria-describedby=${ifDefined(ariaDescribedBy)}
      @input=${this.onControlInput}
    ></textarea>`;
  }
}

export function defineCivitaiTextarea(): void {
  defineElement(TAG, CivitaiTextarea);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-textarea': CivitaiTextarea;
  }
}
