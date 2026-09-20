/**
 * A host listener must fire EXACTLY ONCE per user action.
 *
 * The hazard is specific to the light-DOM + inner-native-control shape: the
 * inner `<select>`/`<input>` dispatches its own bubbling `change`/`input`,
 * which reaches a listener on the host; if the element then dispatches its own
 * event too, one interaction fires the consumer's handler twice. MEASURED:
 * React 19 attaches `onChange` on a custom element as a plain `change`
 * listener on the host (see @civitai/elements-react's
 * react19-custom-elements.browser.test.tsx), so React consumers see both.
 *
 * `CivitaiFieldElement.retarget()` stops the inner event and re-dispatches
 * from the host, which is what makes the count 1. Counting is the assertion —
 * "the handler ran and the detail was right" passes at a count of 2.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import '../src/select.js';
import '../src/slider.js';
import type { CivitaiSelect, SelectChangeDetail } from '../src/select.js';
import type { CivitaiSlider, SliderChangeDetail } from '../src/slider.js';

function mount<T extends Element>(html: string): T {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as T;
}

async function settle(el: Element & { updateComplete?: Promise<unknown> }): Promise<void> {
  await (el.updateComplete ?? Promise.resolve());
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('event identity', () => {
  it('POSITIVE CONTROL: an un-retargeted inner event WOULD reach the host twice', () => {
    // Establishes that a bubbling inner event is genuinely observable on the
    // host, so a count of 1 below is the retargeting working and not a
    // listener that never fires.
    const host = mount<HTMLDivElement>('<div><select><option>a</option></select></div>');
    let n = 0;
    host.addEventListener('change', () => (n += 1));
    const inner = host.querySelector('select') as HTMLSelectElement;
    inner.dispatchEvent(new Event('change', { bubbles: true }));
    host.dispatchEvent(new Event('change', { bubbles: true }));
    expect(n).toBe(2);
  });

  it('civitai-select fires change ONCE with a typed detail', async () => {
    const sel = mount<CivitaiSelect>('<civitai-select name="s"></civitai-select>');
    sel.options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    await settle(sel);

    const details: SelectChangeDetail[] = [];
    sel.addEventListener('change', (e) => details.push((e as CustomEvent<SelectChangeDetail>).detail));

    const inner = sel.querySelector('select') as HTMLSelectElement;
    inner.value = 'b';
    inner.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(sel);

    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({ value: 'b' });
    expect(sel.value).toBe('b');
  });

  it('civitai-slider fires input ONCE per step with a numeric detail', async () => {
    const sl = mount<CivitaiSlider>('<civitai-slider name="w" min="0" max="10"></civitai-slider>');
    await settle(sl);

    const details: SliderChangeDetail[] = [];
    sl.addEventListener('input', (e) => details.push((e as CustomEvent<SliderChangeDetail>).detail));

    const inner = sl.querySelector('input[type="range"]') as HTMLInputElement;
    inner.value = '3';
    inner.dispatchEvent(new Event('input', { bubbles: true }));
    inner.value = '4';
    inner.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(sl);

    expect(details).toEqual([{ value: 3 }, { value: 4 }]);
    // A number, not the string the DOM would hand over — the drift the React
    // packages papered over per-call-site.
    expect(typeof details[0]?.value).toBe('number');
  });

  it('the inner event does not escape on its own', async () => {
    const sel = mount<CivitaiSelect>('<civitai-select name="s"></civitai-select>');
    sel.options = [{ value: 'a', label: 'A' }];
    await settle(sel);

    // Listen ABOVE the host: an un-stopped inner event would reach here too,
    // and would arrive with target === the inner <select>.
    const targets: string[] = [];
    (sel.parentElement as HTMLElement).addEventListener('change', (e) => {
      targets.push((e.target as Element).tagName.toLowerCase());
    });

    const inner = sel.querySelector('select') as HTMLSelectElement;
    inner.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(sel);

    expect(targets).toEqual(['civitai-select']);
  });
});
