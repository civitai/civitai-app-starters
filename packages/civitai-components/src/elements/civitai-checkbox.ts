import { html, type PropertyDeclarations, type PropertyValues, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import { choiceStyles } from './choice-styles.js';
import { CivitaiField, fieldStyles } from './field-base.js';
import { defineElement } from './registry.js';
import { hostBaseline } from './shared-styles.js';

const TAG = 'civitai-checkbox';

export class CivitaiCheckbox extends CivitaiField {
  static override styles = [hostBaseline, fieldStyles, choiceStyles];

  static override properties: PropertyDeclarations = {
    ...CivitaiField.properties,
    value: { reflect: true },
    // Unreflected: `checked` is the attribute reset returns to, so writing the
    // live state back would make reset a no-op.
    checked: { type: Boolean },
    indeterminate: { type: Boolean },
  };

  declare checked: boolean;
  declare indeterminate: boolean;

  constructor() {
    super();
    /** Submitted when checked, exactly as a native checkbox does. */
    this.value = 'on';
    this.checked = false;
    this.indeterminate = false;
  }

  /** An unchecked checkbox submits nothing at all, like the native one. */
  protected override formValue(): string | null {
    return this.checked ? this.value : null;
  }

  protected override get missing(): boolean {
    return !this.checked;
  }

  protected override get missingMessage(): string {
    return 'Please check this box if you want to proceed.';
  }

  /** Native semantics: reset returns to the `checked` ATTRIBUTE. */
  override formResetCallback(): void {
    this.checked = this.hasAttribute('checked');
    this.indeterminate = false;
  }

  override formStateRestoreCallback(state: string | null): void {
    this.checked = state != null;
  }

  protected override updated(changed: PropertyValues): void {
    // Indeterminate has no attribute; it is a property only.
    const control = this.renderRoot.querySelector('input');
    if (control) control.indeterminate = this.indeterminate;
    super.updated(changed);
  }

  #onChange(event: Event): void {
    this.checked = (event.target as HTMLInputElement).checked;
    this.indeterminate = false;
  }

  /** `<civitai-switch>` is this control wearing `role="switch"`. */
  protected get inputRole(): string | undefined {
    return undefined;
  }

  protected override renderControl(): TemplateResult {
    const { id, part, name, ariaInvalid, ariaDescribedBy } = this.controlAttrs();
    return html`
      <div class="choice" part="choice">
        <input
          id=${id}
          part=${part}
          name=${ifDefined(name)}
          role=${ifDefined(this.inputRole)}
          type="checkbox"
          .checked=${this.checked}
          ?required=${this.required}
          ?disabled=${this.disabled}
          aria-invalid=${ifDefined(ariaInvalid)}
          aria-describedby=${ifDefined(ariaDescribedBy)}
          @change=${this.#onChange}
        />
        ${this.renderLabel()}
      </div>
    `;
  }

  /* The label belongs BESIDE the box rather than above it, so the row is the
     control and the base's label-first order does not apply. */
  override render(): TemplateResult {
    return html`${this.renderControl()}${this.renderDescription()}${this.renderError()}`;
  }
}

export function defineCivitaiCheckbox(): void {
  defineElement(TAG, CivitaiCheckbox);
}

declare global {
  interface HTMLElementTagNameMap {
    'civitai-checkbox': CivitaiCheckbox;
  }
}
