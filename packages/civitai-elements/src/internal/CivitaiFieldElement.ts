import { LitElement } from 'lit';

import { adoptStyles } from './adoptStyles.js';
import { ensureTokens } from './tokens.js';

let seq = 0;
let warned = false;

function attachInternalsOrWarn(el: HTMLElement): ElementInternals | null {
  if (typeof el.attachInternals !== 'function') {
    if (!warned) {
      warned = true;
      console.warn(
        '[@civitai/elements] ElementInternals is unavailable in this environment; ' +
          '<civitai-select>/<civitai-slider> will render but will NOT participate in forms. ' +
          'Form behaviour must be tested in a real browser.'
      );
    }
    return null;
  }
  return el.attachInternals();
}

/**
 * Base class for FORM-ASSOCIATED leaf inputs — `civitai-select`,
 * `civitai-slider`.
 *
 * ── Constraint (b): never double-submit ───────────────────────────────────
 * A form-associated custom element (FACE) participates in submission through
 * `ElementInternals.setFormValue()`. An element that ALSO renders a native
 * control carrying a `name` attribute participates a SECOND time, because the
 * native control is itself a listed, named, form-owned element — the enclosing
 * custom element does not hide it. `new FormData(form)` then yields two entries
 * for one visible control, and whichever the server reads last wins.
 *
 * The rule this package enforces: **the custom element owns `name`; the inner
 * native control must never have one.** Subclasses render their control through
 * `renderControl()` and are asserted by `form-participation.test.ts` — a guard
 * that submits a real `<form>` and counts `FormData` entries, plus a structural
 * ledger over the rendered subtree that fails if ANY descendant grows a `name`.
 *
 * The inner native control is still REQUIRED for a11y and keyboard behaviour
 * (a `<select>` gives combobox semantics, arrow keys, type-ahead and the native
 * popup for free), so removing it is not an option — removing its `name` is.
 *
 * ── Validity reaches the real control ─────────────────────────────────────
 * `setValidity(flags, message, anchor)` takes the inner control as the
 * VALIDATION ANCHOR, so the browser's native validation bubble points at the
 * thing the user actually operates. This is the `required` divergence the audit
 * found: `@civitai/components-react`'s `Slider` documents `required` on its
 * shared field props and then never applies it. Here `required` is wired in the
 * base class, so a subclass cannot forget it.
 */
export abstract class CivitaiFieldElement extends LitElement {
  static formAssociated = true;

  /** Stable style-adoption key. Subclasses MUST override. */
  static componentId = 'civitai-field';
  /** This component's own rule text. Subclasses MUST override. */
  static componentCss = '';

  static override properties = {
    name: { type: String, reflect: true },
    disabled: { type: Boolean, reflect: true },
    required: { type: Boolean, reflect: true },
    label: { type: String },
    description: { type: String },
    error: { type: String, reflect: true },
  };

  /** Submitted field name. Lives on the HOST, never on the inner control. */
  declare name: string;
  declare disabled: boolean;
  declare required: boolean;
  declare label: string | null;
  declare description: string | null;
  declare error: string | null;

  /**
   * `null` only where the platform has no `attachInternals` — MEASURED:
   * happy-dom 20.9.0 does not implement it (`typeof
   * HTMLElement.prototype.attachInternals === 'undefined'`). Throwing there
   * would take down every consumer's happy-dom suite for an unrelated reason,
   * so the element degrades to a non-form-participating control and says so
   * once. The consequence is that NO form behaviour can be observed under
   * happy-dom — which is why every form guard in this package is a
   * `*.browser.test.ts`, and why `test/no-vacuous-form-tests.test.ts` asserts
   * the degraded path is inert rather than silently passing.
   */
  protected readonly internals: ElementInternals | null;

  /** Stable, collision-free ids for label/description/error wiring. */
  protected readonly uid = `ce-${(seq += 1)}`;

  constructor() {
    super();
    this.internals = attachInternalsOrWarn(this);
    this.name = '';
    this.disabled = false;
    this.required = false;
    this.label = null;
    this.description = null;
    this.error = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const ctor = this.constructor as typeof CivitaiFieldElement;
    ensureTokens(this);
    adoptStyles(this, ctor.componentId, ctor.componentCss);
  }

  protected get controlId(): string {
    return `${this.uid}-control`;
  }
  protected get descId(): string {
    return `${this.uid}-desc`;
  }
  protected get errId(): string {
    return `${this.uid}-err`;
  }

  protected get describedBy(): string | undefined {
    const ids: string[] = [];
    if (this.description) ids.push(this.descId);
    if (this.error) ids.push(this.errId);
    return ids.length ? ids.join(' ') : undefined;
  }

  /** The inner native control, once rendered. Used as the validation anchor. */
  protected abstract get control(): HTMLElement | null;

  /** The string this element contributes to `FormData`. */
  protected abstract get formValue(): string | null;

  /** Subclass hook: `true` when `required` is unsatisfied. */
  protected abstract get valueMissing(): boolean;

  /**
   * Publish the current value + validity to the form. Call after every change
   * to `value`, `required` or `disabled`.
   */
  protected syncForm(): void {
    const internals = this.internals;
    if (!internals) return;
    internals.setFormValue(this.disabled ? null : this.formValue);
    const anchor = this.control ?? undefined;
    if (this.required && this.valueMissing && !this.disabled) {
      internals.setValidity(
        { valueMissing: true },
        this.error || 'Please complete this field.',
        anchor
      );
    } else if (this.error) {
      internals.setValidity({ customError: true }, this.error, anchor);
    } else {
      internals.setValidity({});
    }
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    // The anchor only exists after the first render, so validity has to be
    // (re)published once the control is in the DOM — not just on value changes.
    this.syncForm();
  }

  // ── Standard FACE public surface ────────────────────────────────────────
  get form(): HTMLFormElement | null {
    return this.internals?.form ?? null;
  }
  get validity(): ValidityState | null {
    return this.internals?.validity ?? null;
  }
  get validationMessage(): string {
    return this.internals?.validationMessage ?? '';
  }
  get willValidate(): boolean {
    return this.internals?.willValidate ?? false;
  }
  checkValidity(): boolean {
    return this.internals?.checkValidity() ?? true;
  }
  reportValidity(): boolean {
    return this.internals?.reportValidity() ?? true;
  }

  /** `false` where the platform lacks `ElementInternals`; see the field doc. */
  get formAssociationAvailable(): boolean {
    return this.internals !== null;
  }

  formDisabledCallback(disabled: boolean): void {
    this.disabled = disabled;
  }

  /**
   * Re-emit a host-level event for a change that originated on the inner
   * control, and STOP the inner one.
   *
   * Without the stop, a consumer's single `onChange` on the host fires twice:
   * once for the native control's own bubbling `change`, once for ours. React
   * 19 attaches `onChange` on a custom element as a plain `change` listener on
   * the host (measured — see `react19-custom-elements.test.tsx`), so it sees
   * both. Pinned by `event-identity.test.ts`.
   */
  protected retarget<T>(inner: Event, type: 'change' | 'input', detail: T): void {
    inner.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}
