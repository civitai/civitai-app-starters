import { html, nothing, type TemplateResult } from 'lit';

import { CivitaiFieldElement } from '../internal/CivitaiFieldElement.js';
import { adoptStyles } from '../internal/adoptStyles.js';
import { fieldCss } from '../generated/field.css.js';
import { selectCss } from '../generated/select.css.js';

/** One option for the declarative `options` property. */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** `detail` of `civitai-select`'s `change` and `input` events. */
export interface SelectChangeDetail {
  value: string;
}

/**
 * `<civitai-select>` — labelled dropdown, form-associated.
 *
 * LEAF component: it OWNS its content, which it takes via the `options`
 * property rather than children. That is the other half of the light-DOM
 * answer — wrappers never render, leaves never accept children.
 *
 * RESOLVES THE SHARPEST DRIFT IN THE FLEET. `@civitai/blocks-react/ui`'s
 * `Select` is strictly controlled (`value` + `onChange` both required, a React
 * value never written back to the DOM); `@civitai/components-react`'s is an
 * uncontrolled native `<select>` taking `<option>` children. Neither can be
 * dropped in for the other. The element follows the NATIVE contract, which is
 * the one both were approximating: `value` is a live property, the user can
 * move it, and a `change` event reports the new value. A React consumer that
 * writes `value` every render gets controlled behaviour; one that writes it
 * once gets uncontrolled behaviour. No third contract.
 *
 * FORM PARTICIPATION (constraint (b)): the inner native `<select>` has NO
 * `name`. The host owns `name` and submits via
 * `ElementInternals.setFormValue()`, so a submitted form yields exactly one
 * entry. See `CivitaiFieldElement`.
 *
 * @element civitai-select
 *
 * @attr {string} name - Submitted field name. On the HOST, never the control.
 * @attr {string} value - Selected value.
 * @attr {string} label - Visible label, linked with `for`/`id`.
 * @attr {string} description - Helper text, linked via `aria-describedby`.
 * @attr {string} error - Error message; sets `aria-invalid` and a `customError`.
 * @attr {boolean} required - Sets `aria-required` on the control AND a real
 *   `valueMissing` validity anchored at it.
 * @attr {boolean} disabled - Disables the control and withdraws the form value.
 * @attr {string} placeholder - Disabled empty-valued leading option.
 *
 * @prop {SelectOption[]} options - Declarative options.
 *
 * @fires {CustomEvent<SelectChangeDetail>} change - Commit. Retargeted from the
 *   inner control so a host listener fires exactly once. In React reach it as
 *   `onchange` (lowercase) to receive the real CustomEvent with `detail`;
 *   `onChange` also fires but React wraps it in a SyntheticEvent that DROPS
 *   `detail` — measured, see @civitai/elements-react.
 * @fires {CustomEvent<SelectChangeDetail>} input - Same, on every edit.
 */
export class CivitaiSelect extends CivitaiFieldElement {
  static override componentId = 'civitai-select';
  static override componentCss = selectCss;

  static override properties = {
    ...CivitaiFieldElement.properties,
    value: { type: String, reflect: true },
    placeholder: { type: String },
    options: { attribute: false },
  };

  declare value: string;
  declare placeholder: string | null;
  declare options: SelectOption[];

  /** The value at the time the element joined its form, for `formResetCallback`. */
  #initialValue = '';

  constructor() {
    super();
    this.value = '';
    this.placeholder = null;
    this.options = [];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The shared field chrome is adopted under its OWN key, so select+slider on
    // one page adopt it once and a button-only page never pulls it.
    adoptStyles(this, 'civitai-field', fieldCss);
    if (!this.hasAttribute('data-civitai-ui')) this.setAttribute('data-civitai-ui', 'select');
    this.#initialValue = this.value;
  }

  protected override get control(): HTMLSelectElement | null {
    return this.querySelector<HTMLSelectElement>('select[data-civitai-ui-control]');
  }

  protected override get formValue(): string | null {
    return this.value;
  }

  protected override get valueMissing(): boolean {
    return this.value === '';
  }

  protected override render(): TemplateResult {
    const opts = this.options ?? [];
    return html`
      ${this.label
        ? html`<label for=${this.controlId} data-civitai-ui-label
            >${this.label}${this.required
              ? html`<span data-civitai-ui-required aria-hidden="true">*</span>`
              : nothing}</label
          >`
        : nothing}
      ${this.description
        ? html`<span id=${this.descId} data-civitai-ui-description>${this.description}</span>`
        : nothing}
      <select
        id=${this.controlId}
        data-civitai-ui-control
        ?disabled=${this.disabled}
        aria-required=${this.required ? 'true' : nothing}
        aria-invalid=${this.error ? 'true' : nothing}
        aria-describedby=${this.describedBy ?? nothing}
        @change=${this.#onChange}
        @input=${this.#onInput}
      >
        ${this.placeholder != null
          ? html`<option value="" disabled>${this.placeholder}</option>`
          : nothing}
        ${opts.map(
          (o) => html`<option value=${o.value} ?disabled=${o.disabled === true}>${o.label}</option>`
        )}
      </select>
      ${this.error
        ? html`<span id=${this.errId} data-civitai-ui-error role="alert">${this.error}</span>`
        : nothing}
    `;
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    // Lit commits property parts BEFORE child parts, so `.value=${…}` on a
    // <select> would run against an empty option list. Set it here instead,
    // once the <option>s exist.
    const el = this.control;
    if (el && el.value !== this.value) el.value = this.value;
    super.updated(changed);
  }

  #onChange = (e: Event): void => {
    this.value = (e.target as HTMLSelectElement).value;
    this.syncForm();
    this.retarget<SelectChangeDetail>(e, 'change', { value: this.value });
  };

  #onInput = (e: Event): void => {
    this.value = (e.target as HTMLSelectElement).value;
    this.syncForm();
    this.retarget<SelectChangeDetail>(e, 'input', { value: this.value });
  };

  formResetCallback(): void {
    this.value = this.#initialValue;
    this.syncForm();
  }

  formStateRestoreCallback(state: string | null): void {
    this.value = state ?? '';
    this.syncForm();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-select': CivitaiSelect;
  }
}
