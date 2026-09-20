/**
 * 🔴 CONSTRAINT (b): a form-associated element that ALSO renders a native
 * NAMED control double-submits.
 *
 * Mechanism: a FACE contributes its value through
 * `ElementInternals.setFormValue()`. It does NOT hide its descendants from the
 * form owner, so a nested `<select name=…>` / `<input name=…>` is ALSO a
 * listed, named, form-owned element and contributes a second entry. Both
 * entries share the key, so `FormData.get()` silently returns whichever came
 * first and the server sees a duplicate it never asked for.
 *
 * These guards SUBMIT A REAL FORM and read `FormData`. Three layers, because
 * each catches something the others cannot:
 *   1. VALUE      — `fd.get(name)` is the host's value.
 *   2. CARDINALITY— `fd.getAll(name).length === 1`. This is the one that goes
 *                   red on a double-submit; layer 1 passes right through it
 *                   when the duplicate happens to carry the same string.
 *   3. LEDGER     — no descendant of the host carries `name` at all, asserted
 *                   over the whole rendered subtree. Structural, so it fails
 *                   when a FUTURE control is added with a name, before anyone
 *                   writes a behavioural test for it.
 *
 * ── TIER ── This file is `*.browser.test.ts` and cannot move to the unit
 * project. MEASURED: happy-dom 20.9.0 has no `HTMLElement.prototype.
 * attachInternals` (`typeof … === 'undefined'`), so there is no form
 * association to observe there at all and every assertion below would pass
 * vacuously. `test/no-vacuous-form-tests.test.ts` pins that.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import '../src/select.js';
import '../src/slider.js';
import '../src/button.js';
import type { CivitaiSelect } from '../src/select.js';
import type { CivitaiSlider } from '../src/slider.js';

const OPTIONS = [
  { value: 'euler', label: 'Euler' },
  { value: 'dpmpp2m', label: 'DPM++ 2M' },
];

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

/** Every descendant of `host` that would participate in a form on its own. */
function namedDescendants(host: Element): string[] {
  return [...host.querySelectorAll('[name]')].map(
    (e) => `${e.tagName.toLowerCase()}[name=${e.getAttribute('name')}]`
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('form participation: exactly one entry per control', () => {
  it('POSITIVE CONTROL: the harness CAN see a duplicate', () => {
    // A hand-built double-submit, so a zero below is a measurement and not a
    // FormData call that never observes anything.
    const form = mount(
      '<form><input name="dup" value="a"><input name="dup" value="b"></form>'
    );
    const fd = new FormData(form);
    expect(fd.getAll('dup')).toEqual(['a', 'b']);
  });

  it('POSITIVE CONTROL: ElementInternals is really present in this tier', () => {
    expect(typeof HTMLElement.prototype.attachInternals).toBe('function');
  });

  it('civitai-select submits its value exactly ONCE', async () => {
    const form = mount('<form><civitai-select name="sampler"></civitai-select></form>');
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    sel.options = OPTIONS;
    sel.value = 'dpmpp2m';
    await settle(sel);

    const fd = new FormData(form);
    expect(fd.get('sampler')).toBe('dpmpp2m');
    expect(fd.getAll('sampler')).toHaveLength(1);
    expect([...fd.keys()]).toEqual(['sampler']);
  });

  it('civitai-select renders a real <select> that carries NO name', async () => {
    const form = mount('<form><civitai-select name="sampler"></civitai-select></form>');
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    sel.options = OPTIONS;
    await settle(sel);

    // The native control must EXIST — the a11y/keyboard behaviour depends on
    // it, so "there is no inner control" is not an acceptable way to pass.
    const inner = sel.querySelector('select');
    expect(inner).not.toBeNull();
    expect(inner?.options.length).toBe(2);

    expect(namedDescendants(sel)).toEqual([]);
  });

  it('civitai-slider submits its value exactly ONCE', async () => {
    const form = mount('<form><civitai-slider name="weight" max="10"></civitai-slider></form>');
    const sl = form.querySelector('civitai-slider') as CivitaiSlider;
    sl.value = 7;
    await settle(sl);

    const fd = new FormData(form);
    expect(fd.get('weight')).toBe('7');
    expect(fd.getAll('weight')).toHaveLength(1);
    expect([...fd.keys()]).toEqual(['weight']);
  });

  it('civitai-slider renders a real range input that carries NO name', async () => {
    const form = mount('<form><civitai-slider name="weight"></civitai-slider></form>');
    const sl = form.querySelector('civitai-slider') as CivitaiSlider;
    await settle(sl);

    const inner = sl.querySelector('input[type="range"]');
    expect(inner).not.toBeNull();
    expect(namedDescendants(sl)).toEqual([]);
  });

  it('a whole form of elements yields one entry per control and nothing else', async () => {
    const form = mount(`
      <form>
        <civitai-select name="sampler"></civitai-select>
        <civitai-slider name="cfg" min="1" max="20"></civitai-slider>
        <input name="prompt" value="a cat">
        <civitai-button name="go" type="submit">Go</civitai-button>
      </form>
    `);
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    sel.options = OPTIONS;
    sel.value = 'euler';
    const sl = form.querySelector('civitai-slider') as CivitaiSlider;
    sl.value = 6;
    await settle(sel);
    await settle(sl);

    const fd = new FormData(form);
    expect([...fd.keys()].sort()).toEqual(['cfg', 'prompt', 'sampler']);
    expect(fd.get('sampler')).toBe('euler');
    expect(fd.get('cfg')).toBe('6');
    // civitai-button is form-associated (so type=submit can find the form) but
    // never calls setFormValue, so it contributes nothing — same as a native
    // <button type="button">.
    expect(fd.has('go')).toBe(false);
  });

  it('an ACTUAL submit carries the same single value', async () => {
    const form = mount(
      '<form><civitai-select name="sampler"></civitai-select><button type="submit">go</button></form>'
    );
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    sel.options = OPTIONS;
    sel.value = 'euler';
    await settle(sel);

    // Read the data the browser itself assembled at submit time, not a
    // FormData we constructed — the constructor and the submit algorithm are
    // different code paths and only the second one is what ships.
    const seen = await new Promise<[string, FormDataEntryValue][]>((resolve) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        resolve([...new FormData(e.target as HTMLFormElement).entries()]);
      });
      (form.querySelector('button') as HTMLButtonElement).click();
    });
    expect(seen).toEqual([['sampler', 'euler']]);
  });

  it('a disabled field withdraws its value entirely', async () => {
    const form = mount('<form><civitai-select name="sampler" disabled></civitai-select></form>');
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    sel.options = OPTIONS;
    sel.value = 'euler';
    await settle(sel);
    expect([...new FormData(form).keys()]).toEqual([]);
  });

  it('form reset restores the initial value, still once', async () => {
    const form = mount(
      '<form><civitai-select name="sampler" value="euler"></civitai-select></form>'
    );
    const sel = form.querySelector('civitai-select') as CivitaiSelect;
    sel.options = OPTIONS;
    await settle(sel);
    sel.value = 'dpmpp2m';
    await settle(sel);

    form.reset();
    await settle(sel);

    const fd = new FormData(form);
    expect(fd.getAll('sampler')).toEqual(['euler']);
  });
});
