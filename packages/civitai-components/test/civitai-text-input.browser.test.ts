import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import { componentsCss } from '../src/styles.generated.js';
import type { CivitaiTextInput } from '../src/elements/civitai-text-input.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

function mount(markup: string, theme: 'light' | 'dark' = 'light'): HTMLElement {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', theme);
  scope.innerHTML = markup;
  document.body.append(scope);
  return scope;
}

const rendered = async (el: CivitaiTextInput): Promise<CivitaiTextInput> => {
  await el.updateComplete;
  return el;
};

const controlOf = (el: CivitaiTextInput): HTMLInputElement =>
  el.shadowRoot!.querySelector('input')!;

/** What a user typing produces: set the value, then fire the native events. */
function type(el: CivitaiTextInput, text: string): void {
  const control = controlOf(el);
  control.value = text;
  control.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-text-input> form participation', () => {
  it('round-trips through FormData under its name', async () => {
    mount('<form><civitai-text-input name="prompt" value="a cat"></civitai-text-input></form>');
    const el = scope!.querySelector('civitai-text-input')!;
    await rendered(el);
    expect(new FormData(scope!.querySelector('form')!).get('prompt')).toBe('a cat');
  });

  it('submits what the user typed, not the initial attribute', async () => {
    mount('<form><civitai-text-input name="prompt" value="a cat"></civitai-text-input></form>');
    const el = scope!.querySelector('civitai-text-input')!;
    await rendered(el);
    type(el, 'a dog');
    await rendered(el);
    expect(new FormData(scope!.querySelector('form')!).get('prompt')).toBe('a dog');
  });

  it('form.reset() restores the attribute value', async () => {
    mount('<form><civitai-text-input name="prompt" value="a cat"></civitai-text-input></form>');
    const el = scope!.querySelector('civitai-text-input')!;
    await rendered(el);
    type(el, 'a dog');
    await rendered(el);
    scope!.querySelector('form')!.reset();
    await rendered(el);
    expect(el.value).toBe('a cat');
    expect(controlOf(el).value).toBe('a cat');
  });

  it('Enter inside the control submits the outer form', async () => {
    mount('<form><civitai-text-input name="q" value="hi"></civitai-text-input></form>');
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector('civitai-text-input')!;
    await rendered(el);
    let submitted: FormData | undefined;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted = new FormData(form);
    });
    controlOf(el).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true })
    );
    expect(submitted?.get('q')).toBe('hi');
  });

  it('a required empty field blocks submission', async () => {
    mount('<form><civitai-text-input name="q" required></civitai-text-input></form>');
    const el = scope!.querySelector('civitai-text-input')!;
    await rendered(el);
    expect(el.checkValidity()).toBe(false);
    expect(el.validity.valueMissing).toBe(true);

    type(el, 'filled in');
    await rendered(el);
    expect(el.checkValidity()).toBe(true);
  });

  it('an error message marks the field invalid, not merely decorated', async () => {
    mount('<civitai-text-input error="Too long"></civitai-text-input>');
    const el = scope!.querySelector('civitai-text-input')!;
    await rendered(el);
    expect(el.checkValidity()).toBe(false);
    expect(el.validity.customError).toBe(true);
  });
});

describe('<civitai-text-input> native input attributes', () => {
  it('caps what a user can type at maxlength', async () => {
    mount('<civitai-text-input maxlength="5"></civitai-text-input>');
    const el = await rendered(scope!.querySelector('civitai-text-input')!);

    controlOf(el).focus();
    await userEvent.keyboard('ABCDEFGHIJ');

    expect(controlOf(el).value).toBe('ABCDE');
    expect(el.value).toBe('ABCDE');
  });

  it('is unbounded with no maxlength', async () => {
    mount('<civitai-text-input></civitai-text-input>');
    const el = await rendered(scope!.querySelector('civitai-text-input')!);

    controlOf(el).focus();
    await userEvent.keyboard('ABCDEFGHIJ');

    expect(el.value).toBe('ABCDEFGHIJ');
    expect(controlOf(el).hasAttribute('maxlength')).toBe(false);
  });

  it('hands autocomplete to the control, which is what the UA reads', async () => {
    mount('<civitai-text-input autocomplete="off"></civitai-text-input>');
    const el = await rendered(scope!.querySelector('civitai-text-input')!);

    expect(controlOf(el).autocomplete).toBe('off');
  });
});

describe('<civitai-text-input> events', () => {
  it('change reaches a document listener despite composed:false', async () => {
    mount('<civitai-text-input name="q"></civitai-text-input>');
    const el = scope!.querySelector('civitai-text-input')!;
    await rendered(el);
    let seen = 0;
    const onChange = (): void => void (seen += 1);
    document.addEventListener('change', onChange);
    try {
      type(el, 'typed');
    } finally {
      document.removeEventListener('change', onChange);
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('<civitai-text-input> labelling', () => {
  it('wires label, description and error to the control', async () => {
    mount(
      '<civitai-text-input label="Prompt" description="What to draw" error="Required" required></civitai-text-input>'
    );
    const el = scope!.querySelector('civitai-text-input')!;
    await rendered(el);
    const control = controlOf(el);
    const root = el.shadowRoot!;

    expect(root.querySelector('label')!.htmlFor).toBe(control.id);
    expect(control.getAttribute('aria-invalid')).toBe('true');

    const described = control.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    for (const id of described) {
      expect(root.getElementById(id), id).not.toBeNull();
    }
    expect(root.querySelector('[part="error"]')!.getAttribute('role')).toBe('alert');
    expect(root.querySelector('.required')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('omits aria-invalid and aria-describedby when there is nothing to say', async () => {
    mount('<civitai-text-input label="Prompt"></civitai-text-input>');
    const el = scope!.querySelector('civitai-text-input')!;
    await rendered(el);
    const control = controlOf(el);
    expect(control.hasAttribute('aria-invalid')).toBe(false);
    expect(control.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('<civitai-text-input> styling', () => {
  it.each(['light', 'dark'] as const)('%s matches the legacy field markup', async (theme) => {
    const style = document.createElement('style');
    style.textContent = componentsCss;
    document.head.append(style);
    try {
      mount(
        '<civitai-text-input label="L" description="D"></civitai-text-input>' +
          '<div data-civitai-ui="text-input">' +
          '<label data-civitai-ui-label for="legacy">L</label>' +
          '<span data-civitai-ui-description>D</span>' +
          '<input id="legacy" data-civitai-ui-control />' +
          '</div>',
        theme
      );
      const [host, legacy] = [...scope!.children] as [CivitaiTextInput, HTMLElement];
      await rendered(host);

      const wrapper = getComputedStyle(host);
      const legacyWrapper = getComputedStyle(legacy);
      for (const prop of ['display', 'flexDirection', 'gap'] as const) {
        expect(wrapper[prop], prop).toBe(legacyWrapper[prop]);
      }

      const a = getComputedStyle(host.shadowRoot!.querySelector('input')!);
      const b = getComputedStyle(legacy.querySelector('input')!);
      for (const prop of [
        'backgroundColor', 'color', 'borderTopColor', 'borderTopWidth', 'borderTopStyle',
        'borderRadius', 'fontFamily', 'fontSize',
        'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
        'transitionDuration', 'transitionProperty',
      ] as const) {
        expect(a[prop], prop).toBe(b[prop]);
      }

      const labelA = getComputedStyle(host.shadowRoot!.querySelector('label')!);
      const labelB = getComputedStyle(legacy.querySelector('label')!);
      for (const prop of ['fontSize', 'fontWeight', 'color'] as const) {
        expect(labelA[prop], `label ${prop}`).toBe(labelB[prop]);
      }

      const descA = getComputedStyle(host.shadowRoot!.querySelector('.description')!);
      const descB = getComputedStyle(legacy.querySelector('[data-civitai-ui-description]')!);
      for (const prop of ['fontSize', 'color'] as const) {
        expect(descA[prop], `description ${prop}`).toBe(descB[prop]);
      }
    } finally {
      style.remove();
    }
  });
});
