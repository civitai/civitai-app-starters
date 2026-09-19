import { afterEach, describe, expect, it } from 'vitest';

import { componentsCss } from '../src/styles.generated.js';
import type {
  CivitaiSegmentedControl,
  SegmentItem,
} from '../src/elements/civitai-segmented-control.js';
import '../src/elements/register.js';

const DATA: SegmentItem[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'map', label: 'Map' },
];

let scope: HTMLElement | undefined;

async function mount(
  data: SegmentItem[] = DATA,
  attrs: Record<string, string> = {},
  theme: 'light' | 'dark' = 'light'
): Promise<CivitaiSegmentedControl> {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', theme);
  const el = document.createElement('civitai-segmented-control');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.data = data;
  scope.append(el);
  document.body.append(scope);
  await el.updateComplete;
  return el;
}

const segments = (el: CivitaiSegmentedControl): HTMLButtonElement[] =>
  [...el.shadowRoot!.querySelectorAll('button')];

const focused = (el: CivitaiSegmentedControl): string | undefined =>
  (el.shadowRoot!.activeElement as HTMLButtonElement | null)?.dataset.value;

async function press(el: CivitaiSegmentedControl, key: string): Promise<void> {
  el.shadowRoot!.querySelector('.group')!.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true })
  );
  await el.updateComplete;
  await el.updateComplete;
}

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-segmented-control> roving tabindex', () => {
  it('is one tab stop: only the selected segment is reachable', async () => {
    const el = await mount();
    expect(segments(el).map((b) => b.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves the tab stop with the selection', async () => {
    const el = await mount(DATA, { value: 'list' });
    expect(segments(el).map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
  });
});

describe('<civitai-segmented-control> arrow keys', () => {
  it('ArrowRight advances, with focus following selection', async () => {
    const el = await mount();
    segments(el)[0]!.focus();
    await press(el, 'ArrowRight');
    expect(el.value).toBe('list');
    expect(focused(el)).toBe('list');
  });

  it('wraps at both ends', async () => {
    const el = await mount();
    await press(el, 'ArrowLeft');
    expect(el.value).toBe('map');
    await press(el, 'ArrowRight');
    expect(el.value).toBe('grid');
  });

  it('Up and Down work too, for a vertical rendering', async () => {
    const el = await mount();
    await press(el, 'ArrowDown');
    expect(el.value).toBe('list');
    await press(el, 'ArrowUp');
    expect(el.value).toBe('grid');
  });

  it('Home and End jump to the ends', async () => {
    const el = await mount(DATA, { value: 'list' });
    await press(el, 'End');
    expect(el.value).toBe('map');
    await press(el, 'Home');
    expect(el.value).toBe('grid');
  });

  it('skips disabled segments entirely', async () => {
    const el = await mount([
      { value: 'grid', label: 'Grid' },
      { value: 'list', label: 'List', disabled: true },
      { value: 'map', label: 'Map' },
    ]);
    await press(el, 'ArrowRight');
    expect(el.value).toBe('map');
  });

  it('leaves other keys to the page', async () => {
    const el = await mount();
    const event = new KeyboardEvent('keydown', {
      key: 'a', bubbles: true, composed: true, cancelable: true,
    });
    el.shadowRoot!.querySelector('.group')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(el.value).toBe('');
  });
});

describe('<civitai-segmented-control> ARIA role model', () => {
  it('is a radiogroup of radios', async () => {
    const el = await mount(DATA, { 'aria-label': 'View' });
    const group = el.shadowRoot!.querySelector('.group')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('View');
    expect(segments(el).map((b) => b.getAttribute('role'))).toEqual(['radio', 'radio', 'radio']);
    expect(segments(el).map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(segments(el)[0]!.hasAttribute('aria-selected')).toBe(false);
  });

  it('exposes no tab semantics: tabs are a separate element', async () => {
    const el = await mount(DATA, { 'aria-label': 'View' });
    const group = el.shadowRoot!.querySelector('.group')!;
    expect(group.getAttribute('role')).not.toBe('tablist');
    // An `aria-controls` IDREF cannot reach a light-DOM panel from in here.
    for (const button of segments(el)) {
      expect(button.hasAttribute('aria-controls')).toBe(false);
      expect(button.hasAttribute('aria-selected')).toBe(false);
    }
  });
});

describe('<civitai-segmented-control> value and forms', () => {
  it('clicking a segment selects it and emits change once', async () => {
    const el = await mount();
    let changes = 0;
    document.addEventListener('change', () => void (changes += 1));
    segments(el)[2]!.click();
    await el.updateComplete;
    expect(el.value).toBe('map');
    expect(changes).toBe(1);
    segments(el)[2]!.click();
    await el.updateComplete;
    expect(changes).toBe(1);
  });

  it('submits the selected value under its name', async () => {
    scope = document.createElement('div');
    const form = document.createElement('form');
    const el = document.createElement('civitai-segmented-control');
    el.setAttribute('name', 'view');
    el.data = DATA;
    form.append(el);
    scope.append(form);
    document.body.append(scope);
    await el.updateComplete;

    expect(new FormData(form).get('view')).toBe('grid');
    segments(el)[1]!.click();
    await el.updateComplete;
    expect(new FormData(form).get('view')).toBe('list');

    form.reset();
    await el.updateComplete;
    expect(new FormData(form).get('view')).toBe('grid');
  });
});

describe('<civitai-segmented-control> styling', () => {
  const LEGACY = (size: string) =>
    `<div data-civitai-ui="segmented-control" role="radiogroup" aria-label="View">` +
    `<button type="button" data-civitai-ui-segment data-size="${size}" role="radio" aria-checked="true" tabindex="0">Grid</button>` +
    `<button type="button" data-civitai-ui-segment data-size="${size}" role="radio" aria-checked="false" tabindex="-1">List</button>` +
    `</div>`;

  it.each(
    (['light', 'dark'] as const).flatMap((theme) =>
      (['sm', 'md', 'lg'] as const).map((size) => [theme, size] as const)
    )
  )('%s / %s matches the legacy markup', async (theme, size) => {
    const style = document.createElement('style');
    style.textContent = componentsCss;
    document.head.append(style);
    try {
      const el = await mount(
        [
          { value: 'grid', label: 'Grid' },
          { value: 'list', label: 'List' },
        ],
        { size, 'aria-label': 'View' },
        theme
      );
      scope!.insertAdjacentHTML('beforeend', LEGACY(size));
      const legacy = scope!.lastElementChild as HTMLElement;

      const a = getComputedStyle(el.shadowRoot!.querySelector('.group')!);
      const b = getComputedStyle(legacy);
      // `display` on the HOST: the host is what stands where the legacy wrapper
      // stood, and the inner group blockifies as its flex item.
      expect(getComputedStyle(el).display, 'host display').toBe(b.display);
      for (const prop of ['gap', 'backgroundColor', 'borderRadius',
        'paddingTop', 'paddingLeft'] as const) {
        expect(a[prop], `group ${prop}`).toBe(b[prop]);
      }

      const pairs: [HTMLElement, HTMLElement][] = [
        [segments(el)[0]!, legacy.children[0] as HTMLElement],
        [segments(el)[1]!, legacy.children[1] as HTMLElement],
      ];
      for (const [mine, theirs] of pairs) {
        const x = getComputedStyle(mine);
        const y = getComputedStyle(theirs);
        for (const prop of ['backgroundColor', 'color', 'height', 'fontSize', 'fontWeight',
          'borderRadius', 'paddingLeft', 'paddingRight', 'boxShadow', 'cursor'] as const) {
          expect(x[prop], `segment ${prop}`).toBe(y[prop]);
        }
      }
    } finally {
      style.remove();
    }
  });
});
