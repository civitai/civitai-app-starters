import { css, html, nothing, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';

import { CivitaiElement } from './base.js';
import { hostBaseline } from './shared-styles.js';

let sequence = 0;

/** The `[data-civitai-ui-label|description|error|control]` chrome, scoped. */
export const fieldStyles = css`
  :host {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label {
    font-size: 14px;
    font-weight: 600;
    color: var(--civitai-color-text);
  }
  .required {
    color: var(--civitai-color-error);
    margin-left: 2px;
  }
  .description {
    font-size: 12px;
    color: var(--civitai-color-text-dimmed);
  }
  .error {
    font-size: 12px;
    color: var(--civitai-color-error);
  }
  .control {
    width: 100%;
    font-family: var(--civitai-font);
    font-size: 14px;
    color: var(--civitai-color-text);
    background: var(--civitai-color-surface);
    border: 1px solid var(--civitai-color-border);
    border-radius: var(--civitai-radius);
    padding: 8px 12px;
    transition: border-color 120ms ease;
  }
  .control:focus {
    outline: none;
    border-color: var(--civitai-color-primary);
  }
  .control[aria-invalid='true'] {
    border-color: var(--civitai-color-error);
  }
  .control:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

/**
 * A labelled control that participates in its form. Subclasses render the
 * control itself; everything around it — ids, `aria-describedby`, validity and
 * the value the form sees — is the same for all of them.
 */
export abstract class CivitaiField extends CivitaiElement {
  static formAssociated = true;

  static override styles = [hostBaseline, fieldStyles];

  static override properties: PropertyDeclarations = {
    name: { reflect: true },
    value: {},
    label: { reflect: true },
    description: { reflect: true },
    error: { reflect: true },
    required: { type: Boolean, reflect: true },
    disabled: { type: Boolean, reflect: true },
  };

  declare name: string;
  /** Current value. The `value` ATTRIBUTE is the default, as on a native input. */
  declare value: string;
  declare label: string;
  declare description: string;
  /** Message to show; also marks the control invalid. */
  declare error: string;
  declare required: boolean;
  declare disabled: boolean;

  protected readonly internals = this.attachInternals();
  protected readonly fieldId = `ci-field-${(sequence += 1)}`;

  constructor() {
    super();
    this.name = '';
    this.value = '';
    this.label = '';
    this.description = '';
    this.error = '';
    this.required = false;
    this.disabled = false;
  }

  get form(): HTMLFormElement | null {
    return this.internals.form;
  }

  get validity(): ValidityState {
    return this.internals.validity;
  }

  checkValidity(): boolean {
    return this.internals.checkValidity();
  }

  reportValidity(): boolean {
    return this.internals.reportValidity();
  }

  /** Native semantics: reset returns to the `value` attribute, not to empty. */
  formResetCallback(): void {
    this.value = this.getAttribute('value') ?? '';
  }

  formStateRestoreCallback(state: string | null): void {
    this.value = state ?? '';
  }

  protected get control(): HTMLElement | null {
    return this.renderRoot.querySelector('.control');
  }

  protected get invalid(): boolean {
    return this.error !== '';
  }

  protected get describedBy(): string | undefined {
    return (
      [
        this.description !== '' ? `${this.fieldId}-desc` : '',
        this.invalid ? `${this.fieldId}-err` : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.sync();
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.sync();
  }

  protected sync(): void {
    this.internals.setFormValue(this.value);
    const anchor = (this.control as HTMLElement | undefined) ?? undefined;
    if (this.required && this.value === '') {
      this.internals.setValidity(
        { valueMissing: true },
        this.error || 'Please fill out this field.',
        anchor
      );
    } else if (this.invalid) {
      this.internals.setValidity({ customError: true }, this.error, anchor);
    } else {
      this.internals.setValidity({});
    }
  }

  protected onControlInput(event: Event): void {
    this.value = (event.target as HTMLInputElement).value;
  }

  /**
   * A form does not cross a shadow boundary, so the inner control's implicit
   * submission never reaches it. Enter has to be forwarded by hand.
   */
  protected submitOnEnter(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    const { form } = this.internals;
    if (!form) return;
    event.preventDefault();
    form.requestSubmit();
  }

  protected abstract renderControl(): TemplateResult;

  override render(): TemplateResult {
    return html`
      ${this.label !== ''
        ? html`<label for=${this.fieldId} part="label"
            >${this.label}${this.required
              ? html`<span class="required" aria-hidden="true">*</span>`
              : nothing}</label
          >`
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

  /** The attributes every control shares, so a subclass spells out only its own. */
  protected controlAttrs(): {
    id: string;
    part: string;
    name: string | undefined;
    ariaInvalid: string | undefined;
    ariaDescribedBy: string | undefined;
  } {
    return {
      id: this.fieldId,
      part: 'control',
      name: this.name || undefined,
      ariaInvalid: this.invalid ? 'true' : undefined,
      ariaDescribedBy: this.describedBy,
    };
  }
}
