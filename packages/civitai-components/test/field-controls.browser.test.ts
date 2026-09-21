import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiNumberInput } from '../src/elements/civitai-number-input.js';
import type { CivitaiSelect } from '../src/elements/civitai-select.js';
import type { CivitaiTextarea } from '../src/elements/civitai-textarea.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

async function mount<T extends HTMLElement>(markup: string): Promise<HTMLElement> {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = markup;
  document.body.append(scope);
  await Promise.all(
    [...scope.querySelectorAll('*')]
      .filter((el): el is HTMLElement & { updateComplete: Promise<boolean> } =>
        'updateComplete' in el
      )
      .map((el) => el.updateComplete)
  );
  return scope;
}

/** What a user typing produces. */
function type(control: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  control.value = text;
  control.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-number-input>', () => {
  it('is a native number control, so the browser gives spinners and arrow keys', async () => {
    await mount('<civitai-number-input label="Steps" min="1" max="150" step="5"></civitai-number-input>');
    const el = scope!.querySelector<CivitaiNumberInput>('civitai-number-input')!;
    const control = el.shadowRoot!.querySelector('input')!;
    expect(control.type).toBe('number');
    expect(control.min).toBe('1');
    expect(control.max).toBe('150');
    expect(control.step).toBe('5');
  });

  it('follows the native stepper', async () => {
    await mount('<civitai-number-input value="20" min="0" max="100" step="5"></civitai-number-input>');
    const el = scope!.querySelector<CivitaiNumberInput>('civitai-number-input')!;
    const control = el.shadowRoot!.querySelector('input')!;

    control.stepUp();
    control.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.value).toBe('25');

    control.stepDown();
    control.stepDown();
    control.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.value).toBe('15');
  });

  it('exposes the value as a number, never NaN', async () => {
    await mount('<civitai-number-input value="42"></civitai-number-input>');
    const el = scope!.querySelector<CivitaiNumberInput>('civitai-number-input')!;
    expect(el.valueAsNumber).toBe(42);
    el.value = '';
    expect(el.valueAsNumber).toBeNull();
    el.value = 'not a number';
    expect(el.valueAsNumber).toBeNull();
  });

  it('round-trips through the form and Enter submits', async () => {
    await mount('<form><civitai-number-input name="steps" value="30"></civitai-number-input></form>');
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector<CivitaiNumberInput>('civitai-number-input')!;
    expect(new FormData(form).get('steps')).toBe('30');

    let submits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submits += 1;
    });
    el.shadowRoot!.querySelector('input')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true })
    );
    expect(submits).toBe(1);
  });
});

describe('<civitai-textarea>', () => {
  it('round-trips through the form and resets to the attribute', async () => {
    await mount('<form><civitai-textarea name="prompt" value="a cat"></civitai-textarea></form>');
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector<CivitaiTextarea>('civitai-textarea')!;
    expect(new FormData(form).get('prompt')).toBe('a cat');

    type(el.shadowRoot!.querySelector('textarea')!, 'a dog');
    await el.updateComplete;
    expect(new FormData(form).get('prompt')).toBe('a dog');

    form.reset();
    await el.updateComplete;
    expect(el.value).toBe('a cat');
  });

  it('leaves Enter alone, because Enter is a newline here', async () => {
    await mount('<form><civitai-textarea name="prompt"></civitai-textarea></form>');
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector<CivitaiTextarea>('civitai-textarea')!;
    let submits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submits += 1;
    });
    el.shadowRoot!.querySelector('textarea')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true })
    );
    expect(submits).toBe(0);
  });

  it('honours rows', async () => {
    await mount('<civitai-textarea rows="7"></civitai-textarea>');
    const el = scope!.querySelector<CivitaiTextarea>('civitai-textarea')!;
    expect(el.shadowRoot!.querySelector('textarea')!.rows).toBe(7);
  });
});

describe('<civitai-select>', () => {
  const OPTIONS = [
    { value: 'sdxl', label: 'SDXL' },
    { value: 'flux', label: 'Flux' },
    { value: 'sd15', label: 'SD 1.5', disabled: true },
  ];

  async function mountSelect(attrs = ''): Promise<CivitaiSelect> {
    await mount(`<form><civitai-select name="model" ${attrs}></civitai-select></form>`);
    const el = scope!.querySelector<CivitaiSelect>('civitai-select')!;
    el.data = OPTIONS;
    await el.updateComplete;
    return el;
  }

  it('renders its options from data, disabled ones included', async () => {
    const el = await mountSelect();
    const options = [...el.shadowRoot!.querySelectorAll('option')];
    expect(options.map((o) => o.value)).toEqual(['sdxl', 'flux', 'sd15']);
    expect(options[2]!.disabled).toBe(true);
  });

  it('adds a placeholder as a disabled first option', async () => {
    const el = await mountSelect('placeholder="Pick a model"');
    const first = el.shadowRoot!.querySelector('option')!;
    expect(first.textContent?.trim()).toBe('Pick a model');
    expect(first.disabled).toBe(true);
    expect(first.value).toBe('');
  });

  it('selects the option matching value, set before the options existed', async () => {
    await mount('<form><civitai-select name="model" value="flux"></civitai-select></form>');
    const el = scope!.querySelector<CivitaiSelect>('civitai-select')!;
    el.data = OPTIONS;
    await el.updateComplete;

    const control = el.shadowRoot!.querySelector('select')!;
    expect(control.value).toBe('flux');
    expect(control.selectedIndex).toBe(1);
    expect(new FormData(scope!.querySelector('form')!).get('model')).toBe('flux');
  });

  it('follows a value set on the element afterwards', async () => {
    const el = await mountSelect();
    el.value = 'sdxl';
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('select')!.value).toBe('sdxl');
  });

  /* A select CLIPS rather than scrolls, so `scrollWidth` reports nothing —
     the only way to see it is to compare against an unsqueezed render. */
  it('refuses to shrink below its longest option', async () => {
    const OPTIONS = [
      { value: 'a', label: 'All' },
      { value: 'b', label: 'A considerably longer option than the others' },
    ];
    const widthIn = async (boxStyle: string): Promise<number> => {
      await mount(`<div style="${boxStyle}"><civitai-select></civitai-select></div>`);
      const el = scope!.querySelector<CivitaiSelect>('civitai-select')!;
      el.data = OPTIONS;
      await el.updateComplete;
      return el.shadowRoot!.querySelector('select')!.getBoundingClientRect().width;
    };

    expect(await widthIn('width: 600px')).toBeCloseTo(600, 0);
    expect(await widthIn('width: 60px')).toBeGreaterThan(200);
  });

  it('submits the chosen value and change reaches document', async () => {
    const el = await mountSelect();
    const form = scope!.querySelector('form')!;
    const control = el.shadowRoot!.querySelector('select')!;

    let seen = 0;
    const onChange = (): void => void (seen += 1);
    document.addEventListener('change', onChange);
    try {
      control.value = 'flux';
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await el.updateComplete;
    } finally {
      document.removeEventListener('change', onChange);
    }

    expect(el.value).toBe('flux');
    expect(new FormData(form).get('model')).toBe('flux');
    expect(seen).toBeGreaterThan(0);
  });
});

describe('native control theming', () => {
  it.each(['light', 'dark'] as const)(
    '%s reaches the native controls inside the shadow root',
    async (theme) => {
      scope?.remove();
      scope = document.createElement('div');
      scope.setAttribute('data-theme', theme);
      scope.innerHTML =
        '<civitai-number-input value="1"></civitai-number-input><civitai-select></civitai-select>';
      document.body.append(scope);
      await Promise.all(
        [...scope.children].map((el) => (el as CivitaiNumberInput).updateComplete)
      );

      // Without this the browser paints the spinner and the caret in light mode
      // whatever the surface under them looks like.
      for (const el of scope.children) {
        const control = el.shadowRoot!.querySelector('.control')!;
        expect(getComputedStyle(control).colorScheme, el.tagName).toBe(theme);
      }
    }
  );
});

describe('shared field chrome', () => {
  it.each(['civitai-textarea', 'civitai-number-input', 'civitai-select'])(
    '%s wires label, description and error to its control',
    async (tag) => {
      await mount(`<${tag} label="L" description="D" error="E" required></${tag}>`);
      const el = scope!.querySelector(tag)!;
      const root = el.shadowRoot!;
      const control = root.querySelector('.control')!;

      expect(root.querySelector('label')!.getAttribute('for')).toBe(control.id);
      expect(control.getAttribute('aria-invalid')).toBe('true');
      const described = control.getAttribute('aria-describedby')!.split(' ');
      expect(described).toHaveLength(2);
      for (const id of described) expect(root.getElementById(id), id).not.toBeNull();
      expect(root.querySelector('[part="error"]')!.getAttribute('role')).toBe('alert');
    }
  );

  it.each(['civitai-textarea', 'civitai-number-input', 'civitai-select'])(
    '%s reports invalid when required and empty',
    async (tag) => {
      await mount(`<${tag} required></${tag}>`);
      const el = scope!.querySelector(tag) as HTMLElement & {
        checkValidity(): boolean;
        validity: ValidityState;
      };
      expect(el.checkValidity()).toBe(false);
      expect(el.validity.valueMissing).toBe(true);
    }
  );
});
