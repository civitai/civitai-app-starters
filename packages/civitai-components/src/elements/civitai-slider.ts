import {
  css,
  html,
  nothing,
  type PropertyDeclarations,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { CivitaiField, fieldStyles } from './field-base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-slider';

export class CivitaiSlider extends CivitaiField {
  static override styles = [
    hostBaseline,
    fieldStyles,
    css`
      :host {
        gap: 6px;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .readout {
        font-size: 13px;
        font-weight: 600;
        color: var(--civitai-color-text-dimmed);
        font-variant-numeric: tabular-nums;
      }
      /* Deliberately not the bordered field chrome: a themed native range,
         the way the attribute markup has it. */
      .range {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 6px;
        margin: 6px 0;
        padding: 0;
        border-radius: 999px;
        accent-color: var(--civitai-color-primary);
        background: var(--civitai-color-track, var(--civitai-color-gray-2));
        cursor: pointer;
      }
      .range:focus-visible {
        outline: 2px solid var(--civitai-color-primary);
        outline-offset: 4px;
      }
      .range:disabled {
        cursor: not-allowed;
        opacity: 0.6;
        accent-color: var(--civitai-color-gray-5);
      }
      :host([data-invalid]) .range {
        accent-color: var(--civitai-color-error);
      }
    `,
  ];

  static override properties: PropertyDeclarations = {
    ...CivitaiField.properties,
    min: { reflect: true },
    max: { reflect: true },
    step: { reflect: true },
    showValue: { type: Boolean, reflect: true, attribute: 'show-value' },
  };

  declare min: string;
  declare max: string;
  declare step: string;
  /** Shows the current value beside the label. */
  declare showValue: boolean;

  constructor() {
    super();
    this.min = '0';
    this.max = '100';
    this.step = '1';
    this.showValue = false;
  }

  get valueAsNumber(): number {
    return Number(this.value);
  }

  protected override get control(): HTMLElement | null {
    return this.renderRoot.querySelector('.range');
  }

  /**
   * An unset range is not empty — the browser parks it at the midpoint of
   * min/max — so derive that before rendering, keeping the element, its
   * readout and FormData agreeing with what the user sees.
   */
  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (this.value !== '') return;
    const min = Number(this.min);
    const max = Number(this.max);
    const step = Number(this.step) || 1;
    const midpoint = min + (max - min) / 2;
    this.value = String(min + Math.round((midpoint - min) / step) * step);
  }

  protected override sync(): void {
    super.sync();
    this.toggleAttribute('data-invalid', this.error !== '');
  }

  protected override renderControl(): TemplateResult {
    const { id, part, name, ariaInvalid, ariaDescribedBy } = this.controlAttrs();
    return html`<input
      class="range"
      id=${id}
      part=${part}
      type="range"
      .value=${this.value}
      name=${ifDefined(name)}
      min=${this.min}
      max=${this.max}
      step=${this.step}
      ?disabled=${this.disabled}
      aria-invalid=${ifDefined(ariaInvalid)}
      aria-describedby=${ifDefined(ariaDescribedBy)}
      @input=${this.onControlInput}
    />`;
  }

  override render(): TemplateResult {
    return html`
      ${this.label !== '' || this.showValue
        ? html`<div class="header" part="header">
            ${this.label !== ''
              ? html`<label for=${this.fieldId} part="label"
                  >${this.label}${this.required
                    ? html`<span class="required" aria-hidden="true">*</span>`
                    : nothing}</label
                >`
              : html`<span></span>`}
            ${this.showValue
              ? html`<span class="readout" part="value">${this.value}</span>`
              : nothing}
          </div>`
        : nothing}
      ${this.description !== ''
        ? html`<span id="${this.fieldId}-desc" class="description" part="description"
            >${this.description}</span
          >`
        : nothing}
      ${this.renderControl()}
      ${this.invalid
        ? html`<span id="${this.fieldId}-err" class="error" part="error" role="alert"
            >${this.error}</span
          >`
        : nothing}
    `;
  }
}

export function defineCivitaiSlider(): void {
  defineElement(TAG, CivitaiSlider);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-slider': CivitaiSlider;
  }
}
