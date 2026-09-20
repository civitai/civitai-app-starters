import { html, nothing, type TemplateResult } from 'lit';

import { CivitaiFieldElement } from '../internal/CivitaiFieldElement.js';
import { adoptStyles } from '../internal/adoptStyles.js';
import { fieldCss } from '../generated/field.css.js';
import { sliderCss } from '../generated/slider.css.js';

/** `detail` of `civitai-slider`'s `change` and `input` events. */
export interface SliderChangeDetail {
  value: number;
}

/**
 * `<civitai-slider>` — labelled range input, form-associated.
 *
 * LEAF component: owns its content, takes it via properties.
 *
 * FORM PARTICIPATION (constraint (b)): the inner `<input type="range">` has NO
 * `name`; the host owns it and submits via `setFormValue()`.
 *
 * `required` — THE DIVERGENCE THIS FIXES. `@civitai/components-react`'s
 * `Slider` inherits `required` from its shared `FieldBaseProps` (whose doc
 * comment promises "shows an asterisk and sets the native `required`") and then
 * never forwards it to the input; `@civitai/blocks-react/ui`'s Slider forwards
 * it to a native attribute that does nothing, because a range input ALWAYS has
 * a value and can therefore never be `valueMissing` natively.
 *
 * Here `required` means the only thing it can usefully mean for a range: the
 * user must have MOVED it. Until the first `input`, the element is
 * `valueMissing`, with the message anchored on the real control so the native
 * validation bubble points at the slider. `aria-required="true"` reaches the
 * control and the asterisk reaches the label. Pinned by
 * test/required-reaches-control.test.ts.
 *
 * @element civitai-slider
 *
 * @attr {string} name - Submitted field name. On the HOST, never the control.
 * @attr {number} value - Current value. Defaults to the midpoint of min..max.
 * @attr {number} min - Default `0`.
 * @attr {number} max - Default `100`.
 * @attr {number} step - Default `1`.
 * @attr {string} label - Visible label, linked with `for`/`id`.
 * @attr {string} description - Helper text, linked via `aria-describedby`.
 * @attr {string} error - Error message; sets `aria-invalid` and a `customError`.
 * @attr {boolean} required - The user must move the slider; see above.
 * @attr {boolean} disabled - Disables the control and withdraws the form value.
 * @attr {boolean} show-value - Render the live value beside the label.
 *
 * @fires {CustomEvent<SliderChangeDetail>} input - Every drag/keyboard step.
 * @fires {CustomEvent<SliderChangeDetail>} change - Commit.
 */
export class CivitaiSlider extends CivitaiFieldElement {
  static override componentId = 'civitai-slider';
  static override componentCss = sliderCss;

  static override properties = {
    ...CivitaiFieldElement.properties,
    // `noAccessor` because this class defines its own `value` accessor: the
    // element has to distinguish "the author set a value" from "nobody did",
    // and Lit's generated accessor gives no hook for that. See #value.
    value: { type: Number, reflect: true, noAccessor: true },
    min: { type: Number, reflect: true },
    max: { type: Number, reflect: true },
    step: { type: Number, reflect: true },
    showValue: { type: Boolean, reflect: true, attribute: 'show-value' },
  };

  declare min: number;
  declare max: number;
  declare step: number;
  declare showValue: boolean;

  /**
   * `null` until something sets it — the ONLY reliable way to know whether an
   * author supplied a value.
   *
   * 🔴 An earlier revision defaulted to the midpoint in `connectedCallback`
   * guarded by `if (!this.hasAttribute('value'))`. That is correct for hand-
   * written HTML and WRONG for React: React 19 sets `value` as a PROPERTY and
   * writes no attribute (measured), so the guard saw no attribute and silently
   * overwrote the author's value with the midpoint. `<civitai-slider value={6}
   * min={1} max={20}/>` submitted `10.5`. Caught by
   * elements-react's react19-custom-elements.browser.test.tsx, not by any
   * element-level test — the defect lives in the SEAM between React's
   * property-setting and the element's attribute-shaped default.
   */
  #value: number | null = null;

  /** `required` is satisfied by interaction, not by having a number. */
  #touched = false;
  #initialValue: number | null = null;

  constructor() {
    super();
    this.min = 0;
    this.max = 100;
    this.step = 1;
    this.showValue = false;
  }

  /** The current value; the midpoint of `min`..`max` until one is supplied. */
  get value(): number {
    return this.#value ?? (this.min + this.max) / 2;
  }

  set value(v: number | string | null) {
    const old = this.#value;
    this.#value = v == null || v === '' ? null : Number(v);
    this.requestUpdate('value', old);
  }

  /** `false` while the value is still the computed midpoint. */
  get hasExplicitValue(): boolean {
    return this.#value !== null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    adoptStyles(this, 'civitai-field', fieldCss);
    if (!this.hasAttribute('data-civitai-ui')) this.setAttribute('data-civitai-ui', 'slider');
    this.#initialValue ??= this.value;
  }

  protected override get control(): HTMLInputElement | null {
    return this.querySelector<HTMLInputElement>('input[type="range"]');
  }

  protected override get formValue(): string | null {
    return String(this.value);
  }

  protected override get valueMissing(): boolean {
    return !this.#touched;
  }

  protected override render(): TemplateResult {
    const labelNode = this.label
      ? html`<label for=${this.controlId} data-civitai-ui-label
          >${this.label}${this.required
            ? html`<span data-civitai-ui-required aria-hidden="true">*</span>`
            : nothing}</label
        >`
      : nothing;

    return html`
      ${this.showValue
        ? html`<div data-civitai-ui-slider-header>
            ${labelNode}
            <output for=${this.controlId} data-civitai-ui-slider-value>${this.value}</output>
          </div>`
        : labelNode}
      ${this.description
        ? html`<span id=${this.descId} data-civitai-ui-description>${this.description}</span>`
        : nothing}
      <input
        type="range"
        id=${this.controlId}
        min=${this.min}
        max=${this.max}
        step=${this.step}
        .value=${String(this.value)}
        ?disabled=${this.disabled}
        aria-required=${this.required ? 'true' : nothing}
        aria-invalid=${this.error ? 'true' : nothing}
        aria-describedby=${this.describedBy ?? nothing}
        @input=${this.#onInput}
        @change=${this.#onChange}
      />
      ${this.error
        ? html`<span id=${this.errId} data-civitai-ui-error role="alert">${this.error}</span>`
        : nothing}
    `;
  }

  #onInput = (e: Event): void => {
    this.#touched = true;
    this.value = Number((e.target as HTMLInputElement).value);
    this.syncForm();
    this.retarget<SliderChangeDetail>(e, 'input', { value: this.value });
  };

  #onChange = (e: Event): void => {
    this.#touched = true;
    this.value = Number((e.target as HTMLInputElement).value);
    this.syncForm();
    this.retarget<SliderChangeDetail>(e, 'change', { value: this.value });
  };

  formResetCallback(): void {
    this.#touched = false;
    if (this.#initialValue != null) this.value = this.#initialValue;
    this.syncForm();
  }

  formStateRestoreCallback(state: string | null): void {
    if (state != null) {
      this.value = Number(state);
      this.#touched = true;
    }
    this.syncForm();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-slider': CivitaiSlider;
  }
}
