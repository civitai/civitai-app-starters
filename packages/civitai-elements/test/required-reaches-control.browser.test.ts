/**
 * `required` must reach the ACTUAL control.
 *
 * The audited divergence: `@civitai/components-react`'s `Slider` inherits
 * `required` from `FieldBaseProps`, whose doc comment promises "shows an
 * asterisk and sets the native `required`", and then forwards it nowhere —
 * a declared prop that is not a code path. `@civitai/blocks-react/ui`'s Slider
 * forwards it to `input[type=range]`, where the native `required` can never
 * fire, because a range input always has a value.
 *
 * Three claims, one per layer, because a fix at one layer leaves the others
 * broken and each has been broken independently in the two React packages:
 *   1. VISUAL     — the required marker is in the label.
 *   2. ASSISTIVE  — `aria-required="true"` is on the control the user operates,
 *                   not on the wrapper (a screen reader reads the control).
 *   3. VALIDATION — the form genuinely refuses to submit, and the validation
 *                   message is ANCHORED on the control so the native bubble
 *                   points at it.
 *
 * ── TIER ── browser only: `setValidity` needs ElementInternals; see
 * form-participation.browser.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import '../src/select.js';
import '../src/slider.js';
import type { CivitaiSelect } from '../src/select.js';
import type { CivitaiSlider } from '../src/slider.js';

function mount(html: string): HTMLFormElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.querySelector('form') as HTMLFormElement;
}

async function settle(el: Element & { updateComplete?: Promise<unknown> }): Promise<void> {
  await (el.updateComplete ?? Promise.resolve());
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('required on civitai-select', () => {
  it('blocks submission while empty and clears once chosen', async () => {
    const form = mount(
      '<form><civitai-select name="sampler" required placeholder="Pick one"></civitai-select></form>'
    );
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    sel.options = [{ value: 'euler', label: 'Euler' }];
    await settle(sel);

    expect(sel.checkValidity()).toBe(false);
    expect(sel.validity?.valueMissing).toBe(true);
    expect(form.checkValidity()).toBe(false);

    sel.value = 'euler';
    await settle(sel);

    expect(sel.checkValidity()).toBe(true);
    expect(form.checkValidity()).toBe(true);
  });

  it('puts aria-required and the marker where the user can perceive them', async () => {
    const form = mount(
      '<form><civitai-select name="s" required label="Sampler"></civitai-select></form>'
    );
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    await settle(sel);

    const control = sel.querySelector('select') as HTMLSelectElement;
    expect(control.getAttribute('aria-required')).toBe('true');
    expect(sel.querySelector('[data-civitai-ui-required]')?.textContent).toBe('*');
    // The label really points at the control — `for`/`id`, not a guess.
    const label = sel.querySelector('label') as HTMLLabelElement;
    expect(label.htmlFor).toBe(control.id);
    expect(label.control).toBe(control);
  });

  it('anchors the validation message on the inner control', async () => {
    const form = mount('<form><civitai-select name="s" required></civitai-select></form>');
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    await settle(sel);

    expect(sel.validationMessage).not.toBe('');
    // `reportValidity()` returning false is the observable that the anchor is
    // live: with no anchor, Chromium cannot focus/point and the call still
    // returns false, so also assert focus lands inside the element.
    const ok = sel.reportValidity();
    expect(ok).toBe(false);
    expect(sel.contains(document.activeElement)).toBe(true);
  });

  it('a non-required select is valid while empty', async () => {
    const form = mount('<form><civitai-select name="s"></civitai-select></form>');
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    await settle(sel);
    expect(sel.checkValidity()).toBe(true);
    expect(form.checkValidity()).toBe(true);
  });
});

describe('required on civitai-slider', () => {
  it('a range input can never be natively valueMissing — CONTROL', () => {
    // The reason `required` had to be redefined for a slider. If this ever
    // fails, the platform changed and the element should follow it.
    const input = document.createElement('input');
    input.type = 'range';
    input.required = true;
    expect(input.validity.valueMissing).toBe(false);
    expect(input.checkValidity()).toBe(true);
  });

  it('is valueMissing until the user moves it, then satisfied', async () => {
    const form = mount(
      '<form><civitai-slider name="w" required min="0" max="10"></civitai-slider></form>'
    );
    const sl = form.querySelector('civitai-slider') as CivitaiSlider;
    await settle(sl);

    expect(sl.validity?.valueMissing).toBe(true);
    expect(form.checkValidity()).toBe(false);

    const input = sl.querySelector('input[type="range"]') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(sl);

    expect(sl.validity?.valueMissing).toBe(false);
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get('w')).toBe('7');
  });

  it('puts aria-required on the range input, not only the wrapper', async () => {
    const form = mount('<form><civitai-slider name="w" required label="Weight"></civitai-slider></form>');
    const sl = form.querySelector('civitai-slider') as CivitaiSlider;
    await settle(sl);

    const input = sl.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(sl.querySelector('[data-civitai-ui-required]')?.textContent).toBe('*');
    expect((sl.querySelector('label') as HTMLLabelElement).control).toBe(input);
  });

  it('form reset makes it untouched again', async () => {
    const form = mount('<form><civitai-slider name="w" required></civitai-slider></form>');
    const sl = form.querySelector('civitai-slider') as CivitaiSlider;
    await settle(sl);
    const input = sl.querySelector('input[type="range"]') as HTMLInputElement;
    input.value = '80';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(sl);
    expect(form.checkValidity()).toBe(true);

    form.reset();
    await settle(sl);
    expect(form.checkValidity()).toBe(false);
  });
});
