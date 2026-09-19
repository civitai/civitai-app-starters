import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiTabs } from '../src/elements/civitai-tabs.js';
import '../src/elements/register.js';

const TABS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'map', label: 'Map', disabled: true },
  { value: 'feed', label: 'Feed' },
];

let scope: HTMLElement | undefined;

function mount(attrs = ''): CivitaiTabs {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML =
    `<civitai-tabs aria-label="View" ${attrs}>` +
    TABS.map((t) => `<civitai-tab-panel value="${t.value}">${t.label} panel</civitai-tab-panel>`).join('') +
    `</civitai-tabs>`;
  document.body.append(scope);
  const el = scope.querySelector<CivitaiTabs>('civitai-tabs')!;
  el.data = TABS;
  return el;
}

const tabs = (el: CivitaiTabs): HTMLButtonElement[] =>
  [...el.querySelectorAll<HTMLButtonElement>('[data-tab]')];

const press = (el: CivitaiTabs, key: string): void => {
  el.querySelector('[data-tablist]')!.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  );
};

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-tabs>', () => {
  it('wires aria-controls to a panel in the page, which a shadow root could not', () => {
    const el = mount();
    const [gridTab] = tabs(el);
    const gridPanel = el.panels[0]!;

    const controls = gridTab!.getAttribute('aria-controls')!;
    expect(controls).toBe(gridPanel.id);
    // The IDREF must resolve from the tab's own root to mean anything.
    expect(gridTab!.getRootNode()).toBe(document);
    expect(document.getElementById(controls)).toBe(gridPanel);
    expect(gridPanel.getAttribute('aria-labelledby')).toBe(gridTab!.id);
  });

  it('is a tablist of tabs, not a radiogroup', () => {
    const el = mount();
    expect(el.querySelector('[data-tablist]')!.getAttribute('role')).toBe('tablist');
    expect(tabs(el).map((t) => t.getAttribute('role'))).toEqual(['tab', 'tab', 'tab', 'tab']);
    expect(el.panels.every((p) => p.getAttribute('role') === 'tabpanel')).toBe(true);
  });

  it('shows only the selected panel', () => {
    const el = mount();
    expect(el.panels.map((p) => p.hidden)).toEqual([false, true, true, true]);

    tabs(el)[1]!.click();
    expect(el.value).toBe('list');
    expect(el.panels.map((p) => p.hidden)).toEqual([true, false, true, true]);
  });

  it('is one tab stop, with arrows moving selection and focus', () => {
    const el = mount();
    expect(tabs(el).map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);

    press(el, 'ArrowRight');
    expect(el.value).toBe('list');
    expect(document.activeElement).toBe(tabs(el)[1]);
    expect(tabs(el).map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it('skips a disabled tab and wraps', () => {
    const el = mount('value="list"');
    press(el, 'ArrowRight');
    expect(el.value).toBe('feed');

    press(el, 'ArrowRight');
    expect(el.value).toBe('grid');

    press(el, 'ArrowLeft');
    expect(el.value).toBe('feed');
  });

  it('Home and End jump to the ends', () => {
    const el = mount('value="list"');
    press(el, 'End');
    expect(el.value).toBe('feed');
    press(el, 'Home');
    expect(el.value).toBe('grid');
  });

  it('announces change once per real move', () => {
    const el = mount();
    let changes = 0;
    el.addEventListener('change', () => void (changes += 1));

    tabs(el)[1]!.click();
    expect(changes).toBe(1);
    tabs(el)[1]!.click();
    expect(changes).toBe(1);
  });

  it('lets change out of a consumer shadow root', async () => {
    scope?.remove();
    scope = document.createElement('div');
    document.body.append(scope);
    const root = scope.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<civitai-tabs aria-label="View">' +
      TABS.map((t) => `<civitai-tab-panel value="${t.value}">${t.label}</civitai-tab-panel>`).join('') +
      '</civitai-tabs>';
    const el = root.querySelector<CivitaiTabs>('civitai-tabs')!;
    el.data = TABS;
    await el.updateComplete;

    let heard = 0;
    const onChange = (): void => void (heard += 1);
    document.addEventListener('change', onChange);
    tabs(el)[1]!.click();
    document.removeEventListener('change', onChange);

    expect(heard).toBe(1);
  });

  it('leaves other keys to the page', () => {
    const el = mount();
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    el.querySelector('[data-tablist]')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
