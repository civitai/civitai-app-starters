import { afterEach, describe, expect, it } from 'vitest';

import '../src/elements/register.js';

/** Every element on the field base, including the three folded onto it later. */
const FIELDS = [
  'civitai-text-input',
  'civitai-textarea',
  'civitai-number-input',
  'civitai-select',
  'civitai-slider',
  'civitai-checkbox',
  'civitai-radio-group',
  'civitai-segmented-control',
] as const;

type Field = HTMLElement & {
  updateComplete: Promise<boolean>;
  error: string;
  reportValidity(): boolean;
  checkValidity(): boolean;
  validity: ValidityState;
  form: HTMLFormElement | null;
};

let scope: HTMLElement | undefined;

async function mount(markup: string): Promise<HTMLElement> {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = markup;
  document.body.append(scope);
  await Promise.all(
    [...scope.querySelectorAll('*')]
      .filter((el): el is Field => 'updateComplete' in el)
      .map((el) => el.updateComplete)
  );
  return scope;
}

const field = (tag: string): Field => scope!.querySelector<Field>(tag)!;

/** Whether the form actually submitted, rather than being stopped by validity. */
function submits(form: HTMLFormElement): boolean {
  let fired = false;
  const onSubmit = (event: Event): void => {
    event.preventDefault();
    fired = true;
  };
  form.addEventListener('submit', onSubmit);
  form.requestSubmit();
  form.removeEventListener('submit', onSubmit);
  return fired;
}

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('every field shares one validity contract', () => {
  it.each(FIELDS)('%s keeps a form from submitting while it carries an error', async (tag) => {
    await mount(`<form><${tag} name="f" error="Not allowed"></${tag}></form>`);
    const form = scope!.querySelector('form')!;

    expect(submits(form)).toBe(false);
    expect(field(tag).validity.customError).toBe(true);
  });

  it.each(FIELDS)('%s lets the form through once the error clears', async (tag) => {
    await mount(`<form><${tag} name="f" error="Not allowed"></${tag}></form>`);
    const form = scope!.querySelector('form')!;
    const el = field(tag);

    el.error = '';
    await el.updateComplete;

    expect(submits(form)).toBe(true);
  });

  it.each(FIELDS)('%s answers reportValidity from its own error', async (tag) => {
    await mount(`<${tag} error="Not allowed"></${tag}>`);
    const el = field(tag);
    expect(el.reportValidity()).toBe(false);

    el.error = '';
    await el.updateComplete;
    expect(el.reportValidity()).toBe(true);
  });

  it.each(FIELDS)('%s announces its error to a screen reader', async (tag) => {
    await mount(`<${tag} error="Not allowed"></${tag}>`);
    const announced = field(tag).shadowRoot!.querySelector('[part="error"]')!;

    expect(announced.getAttribute('role')).toBe('alert');
    expect(announced.textContent?.trim()).toBe('Not allowed');
  });

  it.each(FIELDS)('%s renders the label it is given', async (tag) => {
    await mount(`<${tag} label="Sampler"></${tag}>`);
    const labelled = field(tag).shadowRoot!.querySelector('[part="label"]')!;

    expect(labelled.textContent?.trim()).toBe('Sampler');
  });
});
