/**
 * REGRESSION: a PROPERTY-set value must not be overwritten by the midpoint
 * default.
 *
 * Found by `@civitai/elements-react`'s React-19 form test, not by anything in
 * this package: the first implementation defaulted `value` to the midpoint of
 * `min`..`max` in `connectedCallback`, guarded by
 * `if (!this.hasAttribute('value'))`. That reads correctly for hand-written
 * HTML and is wrong for every framework that sets properties — React 19 sets
 * `value` as a property and writes NO attribute, so the guard saw nothing and
 * clobbered the author's value. `<civitai-slider value={6} min={1} max={20}/>`
 * submitted `10.5`.
 *
 * The seam is the point: the element was correct in isolation, React was
 * correct in isolation, and only a fixture that loaded BOTH built the state
 * that broke. These guards pin the element side directly so the next person
 * does not need the React harness to see it.
 */
import { afterEach, describe, expect, it } from 'vitest';

import '../src/slider.js';
import type { CivitaiSlider } from '../src/slider.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('civitai-slider value seeding', () => {
  it('a value set as a PROPERTY before connect survives', async () => {
    const el = document.createElement('civitai-slider') as CivitaiSlider;
    el.min = 1;
    el.max = 20;
    el.value = 6;
    document.body.appendChild(el);
    await el.updateComplete;

    expect(el.value).toBe(6);
    expect(el.hasExplicitValue).toBe(true);
    const input = el.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input.value).toBe('6');
  });

  it('a value set as a PROPERTY after connect survives', async () => {
    const el = document.createElement('civitai-slider') as CivitaiSlider;
    el.min = 1;
    el.max = 20;
    document.body.appendChild(el);
    await el.updateComplete;
    el.value = 6;
    await el.updateComplete;

    expect(el.value).toBe(6);
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('6');
  });

  it('a value set as an ATTRIBUTE survives', async () => {
    document.body.innerHTML = '<civitai-slider min="1" max="20" value="6"></civitai-slider>';
    const el = document.querySelector('civitai-slider') as CivitaiSlider;
    await el.updateComplete;
    expect(el.value).toBe(6);
    expect(el.hasExplicitValue).toBe(true);
  });

  it('with NO value supplied it still defaults to the midpoint', async () => {
    // The behaviour the buggy code was trying to provide — kept, so the fix
    // cannot be "delete the default".
    document.body.innerHTML = '<civitai-slider min="1" max="21"></civitai-slider>';
    const el = document.querySelector('civitai-slider') as CivitaiSlider;
    await el.updateComplete;
    expect(el.value).toBe(11);
    expect(el.hasExplicitValue).toBe(false);
  });

  it('the midpoint tracks min/max while no explicit value is set', async () => {
    const el = document.createElement('civitai-slider') as CivitaiSlider;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.value).toBe(50);

    el.min = 0;
    el.max = 10;
    await el.updateComplete;
    expect(el.value).toBe(5);

    el.value = 9;
    el.max = 100;
    await el.updateComplete;
    // Once explicit, min/max must stop moving it.
    expect(el.value).toBe(9);
  });

  it('setting value back to null re-enables the midpoint', async () => {
    const el = document.createElement('civitai-slider') as CivitaiSlider;
    el.value = 9;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.value).toBe(9);

    (el as unknown as { value: number | null }).value = null;
    await el.updateComplete;
    expect(el.value).toBe(50);
    expect(el.hasExplicitValue).toBe(false);
  });
});
