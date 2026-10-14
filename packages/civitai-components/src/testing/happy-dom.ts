/**
 * `@civitai/components/testing/happy-dom` — a TEST-ENVIRONMENT shim, not a
 * polyfill for any page. Load it as a vitest setup file:
 *
 *     // vitest.config.ts
 *     test: { environment: 'happy-dom', setupFiles: ['@civitai/components/testing/happy-dom'] }
 *
 * WHY IT EXISTS. happy-dom implements no `ElementInternals` and no
 * `HTMLElement.prototype.attachInternals` (measured on 20.9.0, 20.14.6 and
 * 21.0.1, so a dependency bump does not fix it). Every form-associated element
 * here calls `this.attachInternals()` as a field initialiser — `<civitai-button>`
 * and each `CivitaiField` control (checkbox, number-input, radio-group,
 * segmented-control, select, slider, switch, text-input, textarea; the ledger
 * is enumerated in `test/element-internals-shim.dom.test.ts`) — so without this
 * every one of them throws `TypeError: this.attachInternals is not a function`
 * on construction, and a block's test that renders a button or an input cannot
 * run at all.
 *
 * 🔴 WHY A SHIM HERE AND NOT A GUARD IN THE ELEMENTS. `element-internals` is a
 * required capability (`src/elements/capabilities.ts`): without it the element
 * silently stops taking part in its form. Every target browser has the API, so
 * a guard would buy test convenience by letting production lose form behaviour
 * without a sound. The gap is the test DOM's, so the fix lives at the test DOM.
 *
 * WHAT IT DOES. Only when `attachInternals` is ABSENT, it installs a minimal
 * stand-in covering what the elements call: `form` (the nearest ancestor
 * `<form>`), `labels`, `validity` / `validationMessage` / `willValidate` driven
 * by `setValidity`, `checkValidity` / `reportValidity` (which fire a cancelable
 * `invalid` event when invalid, as native ones do), `setFormValue`, `states`
 * and `shadowRoot`. In a real browser — or any DOM that grows the API — it does
 * nothing at all.
 *
 * WHAT IT DOES NOT DO. It does not make `new FormData(form)` include a custom
 * control's value, run `formResetCallback` on `form.reset()`, or honour the
 * `form="id"` attribute: happy-dom's form machinery does not know about
 * form-associated custom elements, and faking that would be a second DOM.
 * Test those in a real browser.
 *
 * Nothing in the package's runtime entries imports this module
 * (`test/entry-points.test.ts` pins that).
 */

/** Marks the stand-in, so a test can tell it from a native implementation. */
export const ELEMENT_INTERNALS_SHIM = Symbol.for('@civitai/components/testing/element-internals-shim');

const VALIDITY_FLAGS = [
  'badInput',
  'customError',
  'patternMismatch',
  'rangeOverflow',
  'rangeUnderflow',
  'stepMismatch',
  'tooLong',
  'tooShort',
  'typeMismatch',
  'valueMissing',
] as const;

type Flags = Partial<Record<(typeof VALIDITY_FLAGS)[number], boolean>>;

function validityOf(flags: Flags): ValidityState {
  const state: Record<string, boolean> = {};
  for (const flag of VALIDITY_FLAGS) state[flag] = flags[flag] === true;
  state.valid = VALIDITY_FLAGS.every((flag) => !state[flag]);
  return Object.freeze(state) as unknown as ValidityState;
}

class ElementInternalsShim {
  readonly #host: HTMLElement;
  #validity = validityOf({});
  #message = '';
  #value: unknown = null;
  readonly states = new Set<string>();

  constructor(host: HTMLElement) {
    this.#host = host;
  }

  get form(): HTMLFormElement | null {
    return this.#host.closest('form');
  }

  get labels(): NodeList {
    return this.#host.ownerDocument.createDocumentFragment().childNodes;
  }

  get shadowRoot(): ShadowRoot | null {
    return this.#host.shadowRoot;
  }

  get willValidate(): boolean {
    return true;
  }

  get validity(): ValidityState {
    return this.#validity;
  }

  get validationMessage(): string {
    return this.#message;
  }

  /** The last value handed to `setFormValue` — not part of the platform API. */
  get formValue(): unknown {
    return this.#value;
  }

  setFormValue(value: unknown): void {
    this.#value = value;
  }

  setValidity(flags: Flags = {}, message = '', _anchor?: HTMLElement): void {
    const validity = validityOf(flags);
    if (!validity.valid && message === '') {
      // The native method throws on an invalid state with no message.
      throw new TypeError("Failed to execute 'setValidity': the message must not be empty");
    }
    this.#validity = validity;
    this.#message = validity.valid ? '' : message;
  }

  checkValidity(): boolean {
    if (this.#validity.valid) return true;
    this.#host.dispatchEvent(new Event('invalid', { cancelable: true }));
    return false;
  }

  reportValidity(): boolean {
    return this.checkValidity();
  }
}

/**
 * Installs the stand-in if, and only if, the DOM lacks `attachInternals`.
 * Returns whether it installed anything. Safe to call more than once.
 *
 * With NO DOM at all it does nothing: a setup file runs for every test file,
 * including one that opts into `// @vitest-environment node`, and there are no
 * elements to construct there.
 */
export function installElementInternalsShim(): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  const proto = HTMLElement.prototype as unknown as Record<PropertyKey, unknown>;
  if (typeof proto.attachInternals === 'function') return false;

  const attached = new WeakSet<HTMLElement>();
  const attachInternals = function attachInternals(this: HTMLElement): ElementInternals {
    // Native behaviour: one ElementInternals per element, ever.
    if (attached.has(this)) {
      throw new DOMException('ElementInternals has already been attached', 'NotSupportedError');
    }
    attached.add(this);
    return new ElementInternalsShim(this) as unknown as ElementInternals;
  };
  Object.defineProperty(attachInternals, ELEMENT_INTERNALS_SHIM, { value: true });
  Object.defineProperty(proto, 'attachInternals', {
    configurable: true,
    writable: true,
    value: attachInternals,
  });

  const scope = globalThis as unknown as { ElementInternals?: unknown };
  scope.ElementInternals ??= ElementInternalsShim;
  return true;
}

installElementInternalsShim();
