/**
 * THE EVIDENCE FOR "TYPES, NOT WRAPPERS".
 *
 * `@civitai/elements-react` ships no runtime components. That decision rests
 * entirely on React 19 behaviour, so the behaviour is asserted here rather than
 * cited from the Custom Elements Everywhere score. If any of these fail on a
 * future React, wrappers become necessary and this file is the trigger.
 *
 * INVARIANT GUARD, not regression coverage: these pin a REACT property, not a
 * defect this package ever had. They are labelled as such and not counted as
 * coverage of @civitai/elements.
 *
 * ── TIER ── browser. React's event dispatch is React's own code and would run
 * under happy-dom, but the fourth case (`options` reaching a form-associated
 * element that then submits) needs `ElementInternals`, which happy-dom lacks.
 * Keeping the whole file in one tier keeps the evidence in one place.
 */
import { cleanup, render } from '@testing-library/react';
import { createRef, type Ref } from 'react';
import * as ReactDOM from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';

import '../src/index.js';
import type { CivitaiSelect, SelectChangeDetail, SelectOption } from '@civitai/elements';

afterEach(cleanup);

const OPTIONS: SelectOption[] = [
  { value: 'euler', label: 'Euler' },
  { value: 'dpmpp2m', label: 'DPM++ 2M' },
];

async function settle(el: Element & { updateComplete?: Promise<unknown> }): Promise<void> {
  await (el.updateComplete ?? Promise.resolve());
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

describe('React 19 custom-element support (the no-wrapper premise)', () => {
  it('is actually React 19', () => {
    const version = (ReactDOM as unknown as { version: string }).version;
    // The measurement below is only a fact about THIS major.
    expect(version.startsWith('19.')).toBe(true);
  });

  it('sets a non-primitive prop as a PROPERTY, not a stringified attribute', async () => {
    const ref = createRef<CivitaiSelect>();
    render(<civitai-select ref={ref as Ref<CivitaiSelect>} name="sampler" options={OPTIONS} />);
    const el = ref.current as CivitaiSelect;
    await settle(el);

    // React 18 would have written the attribute `options="[object Object]"`.
    expect(el.options).toBe(OPTIONS);
    expect(el.getAttribute('options')).toBeNull();
    // …and the element actually used it.
    expect(el.querySelectorAll('option')).toHaveLength(2);
  });

  it('sets a boolean prop as a property the element can reflect', async () => {
    const ref = createRef<CivitaiSelect>();
    render(<civitai-select ref={ref as Ref<CivitaiSelect>} name="s" required options={OPTIONS} />);
    const el = ref.current as CivitaiSelect;
    await settle(el);
    expect(el.required).toBe(true);
    expect(el.hasAttribute('required')).toBe(true);
  });

  it('`onchange` (lowercase) delivers the raw CustomEvent WITH its detail', async () => {
    const seen: unknown[] = [];
    const ctors: string[] = [];
    const ref = createRef<CivitaiSelect>();
    render(
      <civitai-select
        ref={ref as Ref<CivitaiSelect>}
        name="s"
        options={OPTIONS}
        onchange={(e) => {
          ctors.push(e.constructor.name);
          seen.push(e.detail);
        }}
      />
    );
    const el = ref.current as CivitaiSelect;
    await settle(el);

    const inner = el.querySelector('select') as HTMLSelectElement;
    inner.value = 'dpmpp2m';
    inner.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(el);

    // Exactly once — React must not see both the inner event and the host's.
    expect(seen).toHaveLength(1);
    expect(ctors).toEqual(['CustomEvent']);
    expect(seen[0]).toEqual({ value: 'dpmpp2m' } satisfies SelectChangeDetail);
  });

  it('🔴 `onChange` (camelCase) fires but React DROPS the detail', async () => {
    // This is the trap the generated types encode. It is not a defect in the
    // element — React's synthetic system owns `change`, and a SyntheticEvent
    // has no `detail`. A consumer must read `currentTarget.value` with this
    // spelling, or use `onchange`. If React ever stops wrapping, THIS test
    // fails and the generated types can be simplified.
    const ctors: string[] = [];
    const details: unknown[] = [];
    const values: unknown[] = [];
    const ref = createRef<CivitaiSelect>();
    render(
      <civitai-select
        ref={ref as Ref<CivitaiSelect>}
        name="s"
        options={OPTIONS}
        onChange={(e) => {
          ctors.push(e.constructor.name);
          details.push((e as unknown as CustomEvent).detail);
          values.push((e.currentTarget as CivitaiSelect).value);
        }}
      />
    );
    const el = ref.current as CivitaiSelect;
    await settle(el);
    const inner = el.querySelector('select') as HTMLSelectElement;
    inner.value = 'euler';
    inner.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(el);

    expect(ctors).toEqual(['SyntheticBaseEvent']);
    expect(details).toEqual([undefined]);
    // …but the escape hatch the types point at DOES work.
    expect(values).toEqual(['euler']);
  });

  it('a form built in JSX submits exactly one entry per element', async () => {
    const ref = createRef<HTMLFormElement>();
    const sel = createRef<CivitaiSelect>();
    render(
      <form ref={ref}>
        <civitai-select
          ref={sel as Ref<CivitaiSelect>}
          name="sampler"
          value="euler"
          options={OPTIONS}
        />
        <civitai-slider name="cfg" value={6} min={1} max={20} />
      </form>
    );
    await settle(sel.current as CivitaiSelect);
    await settle(ref.current?.querySelector('civitai-slider') as Element);

    const fd = new FormData(ref.current as HTMLFormElement);
    expect([...fd.keys()].sort()).toEqual(['cfg', 'sampler']);
    expect(fd.getAll('sampler')).toEqual(['euler']);
    expect(fd.getAll('cfg')).toEqual(['6']);
  });

  it('children inside a wrapper element survive a React re-render', async () => {
    const ref = createRef<HTMLElement>();
    const { rerender } = render(
      <civitai-stack ref={ref} gap="sm">
        <p id="kid">hello</p>
      </civitai-stack>
    );
    const kid = document.getElementById('kid');
    expect(kid).not.toBeNull();

    rerender(
      <civitai-stack ref={ref} gap="xl">
        <p id="kid">hello</p>
      </civitai-stack>
    );
    await settle(ref.current as Element);

    // React owns these children; the element must not have moved or replaced
    // them. Same node object, still connected.
    expect(document.getElementById('kid')).toBe(kid);
    expect(kid?.isConnected).toBe(true);
    expect(ref.current?.getAttribute('gap')).toBe('xl');
  });

  it('a ref points at the upgraded element instance, not a wrapper', async () => {
    const ref = createRef<CivitaiSelect>();
    render(<civitai-select ref={ref as Ref<CivitaiSelect>} name="s" />);
    const el = ref.current as CivitaiSelect;
    await settle(el);
    expect(el.tagName.toLowerCase()).toBe('civitai-select');
    // The public FACE surface is reachable straight off the ref — the thing a
    // wrapper would otherwise have to re-expose by hand.
    expect(typeof el.checkValidity).toBe('function');
    expect(el.form).toBeNull();
  });
});
