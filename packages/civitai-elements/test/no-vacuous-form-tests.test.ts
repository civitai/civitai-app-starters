/**
 * Keeps the unit tier's green from being MISREAD as form coverage.
 *
 * The rule this exists for: a suite whose environment pins a capability is
 * structurally blind to that capability's bugs. happy-dom has no
 * `ElementInternals`, so if anyone ever writes a form-participation assertion
 * in the unit project it will pass without observing anything. This guard
 * states the environment's limit as an assertion, so the day happy-dom gains
 * ElementInternals THIS test fails and someone re-reads the tier split
 * deliberately instead of discovering it by a silent false-green.
 *
 * It is an INVARIANT GUARD about the environment, not regression coverage for
 * any defect in this package. Counted as such.
 */
import { describe, expect, it } from 'vitest';

import '../src/select.js';
import type { CivitaiSelect } from '../src/select.js';

describe('unit tier cannot observe form behaviour', () => {
  it('happy-dom has no attachInternals', () => {
    expect(typeof HTMLElement.prototype.attachInternals).toBe('undefined');
  });

  it('the element degrades to NON-participating rather than throwing', async () => {
    const form = document.createElement('form');
    const sel = document.createElement('civitai-select') as CivitaiSelect;
    sel.name = 'sampler';
    sel.options = [{ value: 'euler', label: 'Euler' }];
    sel.value = 'euler';
    form.appendChild(sel);
    document.body.appendChild(form);
    await sel.updateComplete;

    // It renders…
    expect(sel.querySelector('select')).not.toBeNull();
    // …but contributes nothing, because there is no ElementInternals here.
    expect(sel.formAssociationAvailable).toBe(false);
    expect([...new FormData(form).keys()]).toEqual([]);

    document.body.innerHTML = '';
  });
});
