/**
 * `@civitai/components/testing/happy-dom` — every form-associated element can
 * be CONSTRUCTED, CONNECTED and RENDERED under happy-dom once the shim is
 * loaded (A9). happy-dom has no `attachInternals`, so without the shim each of
 * these throws `TypeError: this.attachInternals is not a function` from its
 * field initialiser and a block's suite cannot render a button or an input.
 *
 * 🔴 THE LEDGER IS ENUMERATED, NOT HAND-PICKED. Every tag in
 * `custom-elements.json` is looked up in the registry the package's own
 * entries produce, and the form-associated ones (`static formAssociated`) must
 * equal FORM_ASSOCIATED exactly — so a tenth form control either joins this
 * test or fails it, and one that stops being form-associated fails it too.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { ELEMENT_INTERNALS_SHIM, installElementInternalsShim } from '../src/testing/happy-dom.js';
import '../src/elements/register-site.js';
import '../src/sdk/civitai-sign-in-button.define.js';
import '../src/sdk/civitai-workflow-button.define.js';

const FORM_ASSOCIATED = [
  'civitai-button',
  'civitai-checkbox',
  'civitai-number-input',
  'civitai-radio-group',
  'civitai-segmented-control',
  'civitai-select',
  'civitai-slider',
  // Inherits form association from CivitaiCheckbox; the original A9 count of 9
  // missed it, which is what the enumeration below is for.
  'civitai-switch',
  'civitai-text-input',
  'civitai-textarea',
];

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(pkgRoot, 'custom-elements.json'), 'utf8')) as {
  modules: { declarations?: { customElement?: boolean; tagName?: string }[] }[];
};
const TAGS = manifest.modules
  .flatMap((m) => m.declarations ?? [])
  .filter((d) => d.customElement && d.tagName)
  .map((d) => d.tagName!)
  .sort();

type Lit = HTMLElement & { updateComplete: Promise<unknown> };

afterEach(() => {
  document.body.replaceChildren();
});

describe('the ElementInternals shim under happy-dom', () => {
  it('is the shim, not a native implementation (so this file tests something)', () => {
    const fn = (HTMLElement.prototype as unknown as Record<PropertyKey, unknown>).attachInternals;
    expect(typeof fn).toBe('function');
    expect((fn as unknown as Record<PropertyKey, unknown>)[ELEMENT_INTERNALS_SHIM]).toBe(true);
    // Idempotent: a second import or call installs nothing.
    expect(installElementInternalsShim()).toBe(false);
  });

  it('every manifest tag is registered, and the form-associated ones are the ledger', () => {
    // Positive control on the enumeration itself: an empty manifest read would
    // make the ledger comparison below vacuous.
    expect(TAGS.length).toBeGreaterThanOrEqual(40);
    const missing = TAGS.filter((tag) => customElements.get(tag) === undefined);
    expect(missing, 'tags in custom-elements.json that no entry registered').toEqual([]);
    const formAssociated = TAGS.filter(
      (tag) => (customElements.get(tag) as unknown as { formAssociated?: boolean }).formAssociated === true
    );
    expect(formAssociated).toEqual(FORM_ASSOCIATED);
  });

  it.each(FORM_ASSOCIATED)('<%s> constructs, connects and renders', async (tag) => {
    const Ctor = customElements.get(tag)!;
    const el = new Ctor() as Lit;
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot, `${tag} rendered no shadow root`).not.toBeNull();
    // Also via the parser path, which is how markup in a block reaches it.
    document.body.insertAdjacentHTML('beforeend', `<${tag}></${tag}>`);
    const parsed = document.body.lastElementChild as Lit;
    expect(parsed).toBeInstanceOf(Ctor);
    await parsed.updateComplete;
  });

  it('reports the owning form, as native form association does', async () => {
    document.body.innerHTML = `<form><civitai-text-input name="q"></civitai-text-input><civitai-button type="submit">Go</civitai-button></form>`;
    const form = document.querySelector('form')!;
    const input = document.querySelector('civitai-text-input') as Lit & { form: HTMLFormElement | null };
    const button = document.querySelector('civitai-button') as Lit & { form: HTMLFormElement | null };
    await input.updateComplete;
    expect(input.form).toBe(form);
    expect(button.form).toBe(form);
  });

  it('drives validity from setValidity: required is invalid until filled', async () => {
    const input = document.createElement('civitai-text-input') as Lit & {
      required: boolean;
      value: string;
      validity: ValidityState;
      checkValidity(): boolean;
    };
    input.required = true;
    document.body.append(input);
    await input.updateComplete;

    let invalidEvents = 0;
    input.addEventListener('invalid', () => (invalidEvents += 1));
    expect(input.validity.valueMissing).toBe(true);
    expect(input.validity.valid).toBe(false);
    expect(input.checkValidity()).toBe(false);
    expect(invalidEvents).toBe(1);

    input.value = 'cat';
    await input.updateComplete;
    expect(input.validity.valid).toBe(true);
    expect(input.checkValidity()).toBe(true);
    expect(invalidEvents).toBe(1);
  });

  it('records the value the control hands its form', async () => {
    const input = document.createElement('civitai-text-input') as Lit & { value: string };
    document.body.append(input);
    input.value = 'a prompt';
    await input.updateComplete;
    const internals = (input as unknown as { internals: { formValue: unknown } }).internals;
    expect(internals.formValue).toBe('a prompt');
  });

  it('refuses a second attachInternals on one element, as the platform does', () => {
    customElements.define('shim-probe-element', class extends HTMLElement {});
    const el = document.createElement('shim-probe-element');
    el.attachInternals();
    expect(() => el.attachInternals()).toThrow(/already been attached/);
  });
});
