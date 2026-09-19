import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiCheckbox } from '../src/elements/civitai-checkbox.js';
import type { CivitaiRadioGroup } from '../src/elements/civitai-radio-group.js';
import '../src/elements/register.js';

const OPTIONS = [
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'quality', label: 'Quality', disabled: true },
];

let scope: HTMLElement | undefined;

async function mount(markup: string): Promise<HTMLElement> {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = markup;
  document.body.append(scope);
  await Promise.all(
    [...scope.querySelectorAll('*')]
      .filter((el): el is HTMLElement & { updateComplete: Promise<boolean> } => 'updateComplete' in el)
      .map((el) => el.updateComplete)
  );
  return scope;
}

const click = (input: HTMLInputElement): void => {
  input.click();
};

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-checkbox>', () => {
  it('submits its value only when checked, like a native checkbox', async () => {
    await mount('<form><civitai-checkbox name="tos" value="yes"></civitai-checkbox></form>');
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector<CivitaiCheckbox>('civitai-checkbox')!;
    expect(new FormData(form).has('tos')).toBe(false);

    click(el.shadowRoot!.querySelector('input')!);
    await el.updateComplete;
    expect(new FormData(form).get('tos')).toBe('yes');
  });

  it('defaults its value to "on"', async () => {
    await mount('<form><civitai-checkbox name="tos" checked></civitai-checkbox></form>');
    expect(new FormData(scope!.querySelector('form')!).get('tos')).toBe('on');
  });

  it('resets to the checked attribute, not to unchecked', async () => {
    await mount('<form><civitai-checkbox name="tos" checked></civitai-checkbox></form>');
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector<CivitaiCheckbox>('civitai-checkbox')!;

    click(el.shadowRoot!.querySelector('input')!);
    await el.updateComplete;
    expect(el.checked).toBe(false);

    form.reset();
    await el.updateComplete;
    expect(el.checked).toBe(true);
  });

  it('carries indeterminate, which has no attribute to reflect', async () => {
    await mount('<civitai-checkbox indeterminate></civitai-checkbox>');
    const el = scope!.querySelector<CivitaiCheckbox>('civitai-checkbox')!;
    const control = el.shadowRoot!.querySelector('input')!;
    expect(control.indeterminate).toBe(true);

    click(control);
    await el.updateComplete;
    expect(el.indeterminate).toBe(false);
    expect(control.indeterminate).toBe(false);
  });

  it('required means checked, not merely present', async () => {
    await mount('<civitai-checkbox required></civitai-checkbox>');
    const el = scope!.querySelector<CivitaiCheckbox>('civitai-checkbox')!;
    expect(el.checkValidity()).toBe(false);
    expect(el.validity.valueMissing).toBe(true);

    click(el.shadowRoot!.querySelector('input')!);
    await el.updateComplete;
    expect(el.checkValidity()).toBe(true);
  });

  it('change reaches document despite composed:false', async () => {
    await mount('<civitai-checkbox></civitai-checkbox>');
    const el = scope!.querySelector<CivitaiCheckbox>('civitai-checkbox')!;
    let seen = 0;
    const onChange = (): void => void (seen += 1);
    document.addEventListener('change', onChange);
    try {
      click(el.shadowRoot!.querySelector('input')!);
    } finally {
      document.removeEventListener('change', onChange);
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('<civitai-radio-group>', () => {
  async function group(attrs = ''): Promise<CivitaiRadioGroup> {
    await mount(`<form><civitai-radio-group name="speed" ${attrs}></civitai-radio-group></form>`);
    const el = scope!.querySelector<CivitaiRadioGroup>('civitai-radio-group')!;
    el.data = OPTIONS;
    await el.updateComplete;
    return el;
  }

  const inputs = (el: CivitaiRadioGroup): HTMLInputElement[] =>
    [...el.shadowRoot!.querySelectorAll('input')];

  it('keeps every radio in ONE root, so native exclusion still works', async () => {
    const el = await group();
    const all = inputs(el);
    expect(all).toHaveLength(3);
    // A shared name only groups within a tree — this is why the group renders
    // them rather than coordinating separate elements.
    expect(new Set(all.map((i) => i.name)).size).toBe(1);
    expect(all.every((i) => i.getRootNode() === el.shadowRoot)).toBe(true);

    all[0]!.click();
    all[1]!.click();
    await el.updateComplete;
    expect(all.filter((i) => i.checked)).toHaveLength(1);
    expect(el.value).toBe('balanced');
  });

  it('submits nothing until something is chosen', async () => {
    const el = await group();
    const form = scope!.querySelector('form')!;
    expect(new FormData(form).has('speed')).toBe(false);

    inputs(el)[0]!.click();
    await el.updateComplete;
    expect(new FormData(form).get('speed')).toBe('fast');
  });

  it('resets to the value attribute', async () => {
    const el = await group('value="balanced"');
    const form = scope!.querySelector('form')!;
    expect(el.value).toBe('balanced');

    inputs(el)[0]!.click();
    await el.updateComplete;
    expect(el.value).toBe('fast');

    form.reset();
    await el.updateComplete;
    expect(el.value).toBe('balanced');
    expect(inputs(el)[1]!.checked).toBe(true);
  });

  it('honours a disabled option and a disabled group', async () => {
    const el = await group();
    expect(inputs(el)[2]!.disabled).toBe(true);

    el.disabled = true;
    await el.updateComplete;
    expect(inputs(el).every((i) => i.disabled)).toBe(true);
  });

  it('is a labelled radiogroup with its description and error wired', async () => {
    const el = await group('label="Speed" description="How hard to try" error="Pick one"');
    const root = el.shadowRoot!;
    const groupEl = root.querySelector('[role="radiogroup"]')!;

    expect(groupEl.getAttribute('aria-labelledby')).toBe(root.querySelector('[part="label"]')!.id);
    expect(groupEl.getAttribute('aria-invalid')).toBe('true');
    const described = groupEl.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    for (const id of described) expect(root.getElementById(id), id).not.toBeNull();
    expect(root.querySelector('[part="error"]')!.getAttribute('role')).toBe('alert');
  });

  it('required means one is chosen', async () => {
    const el = await group('required');
    expect(el.checkValidity()).toBe(false);
    expect(el.validity.valueMissing).toBe(true);

    inputs(el)[0]!.click();
    await el.updateComplete;
    expect(el.checkValidity()).toBe(true);
  });

  it('tints the radios with the error token when invalid', async () => {
    const el = await group('error="Pick one"');
    expect(el.hasAttribute('data-invalid')).toBe(true);
    const accent = getComputedStyle(inputs(el)[0]!).accentColor;
    el.error = '';
    await el.updateComplete;
    expect(getComputedStyle(inputs(el)[0]!).accentColor).not.toBe(accent);
  });
});
