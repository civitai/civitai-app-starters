import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiBreadcrumb } from '../src/elements/civitai-breadcrumb.js';
import type { CivitaiProgress } from '../src/elements/civitai-progress.js';
import type { CivitaiSwitch } from '../src/elements/civitai-switch.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

async function mount(markup: string): Promise<HTMLElement> {
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

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-switch>', () => {
  it('is a checkbox wearing the switch role, so it keeps the form and keyboard', async () => {
    await mount('<form><civitai-switch name="live" label="Live"></civitai-switch></form>');
    const el = scope!.querySelector<CivitaiSwitch>('civitai-switch')!;
    const input = el.shadowRoot!.querySelector('input')!;

    expect(input.type).toBe('checkbox');
    expect(input.getAttribute('role')).toBe('switch');
  });

  it('submits only when on, exactly as the checkbox it extends does', async () => {
    await mount('<form><civitai-switch name="live" value="yes"></civitai-switch></form>');
    const form = scope!.querySelector('form')!;
    const el = scope!.querySelector<CivitaiSwitch>('civitai-switch')!;
    expect(new FormData(form).has('live')).toBe(false);

    el.shadowRoot!.querySelector('input')!.click();
    await el.updateComplete;

    expect(new FormData(form).get('live')).toBe('yes');
  });

  it('inherits the field contract rather than restating it', async () => {
    await mount('<civitai-switch error="Required"></civitai-switch>');
    const el = scope!.querySelector<CivitaiSwitch>('civitai-switch')!;

    expect(el.reportValidity()).toBe(false);
    expect(el.shadowRoot!.querySelector('[part="error"]')!.textContent?.trim()).toBe('Required');
  });

  it('moves the thumb when it turns on', async () => {
    await mount('<civitai-switch></civitai-switch>');
    const el = scope!.querySelector<CivitaiSwitch>('civitai-switch')!;
    const input = el.shadowRoot!.querySelector('input')!;
    const resting = getComputedStyle(input, '::after').translate;

    input.click();
    await el.updateComplete;

    expect(getComputedStyle(input, '::after').translate).not.toBe(resting);
  });
});

describe('<civitai-progress>', () => {
  it('reports where it has got to', async () => {
    await mount('<civitai-progress value="30" max="120" label="Scanning"></civitai-progress>');
    const bar = scope!.querySelector('civitai-progress')!.shadowRoot!.querySelector('[role="progressbar"]')!;

    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuemax')).toBe('120');
    expect(bar.getAttribute('aria-label')).toBe('Scanning');
  });

  it('fills in proportion to its own max', async () => {
    await mount('<civitai-progress value="30" max="120"></civitai-progress>');
    const el = scope!.querySelector<CivitaiProgress>('civitai-progress')!;
    el.style.width = '400px';
    await el.updateComplete;

    const track = el.shadowRoot!.querySelector('[part="track"]')!.getBoundingClientRect();
    const fill = el.shadowRoot!.querySelector('[part="bar"]')!.getBoundingClientRect();
    expect(fill.width / track.width).toBeCloseTo(0.25, 1);
  });

  it('clamps rather than overflowing its track', async () => {
    await mount('<civitai-progress value="500" max="100"></civitai-progress>');
    const el = scope!.querySelector<CivitaiProgress>('civitai-progress')!;
    el.style.width = '400px';
    await el.updateComplete;

    const track = el.shadowRoot!.querySelector('[part="track"]')!.getBoundingClientRect();
    const fill = el.shadowRoot!.querySelector('[part="bar"]')!.getBoundingClientRect();
    expect(fill.width).toBeLessThanOrEqual(track.width + 1);
  });

  it('drops the value it cannot know when it is indeterminate', async () => {
    await mount('<civitai-progress indeterminate label="Working"></civitai-progress>');
    const bar = scope!.querySelector('civitai-progress')!.shadowRoot!.querySelector('[role="progressbar"]')!;

    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
  });
});

describe('<civitai-breadcrumb>', () => {
  const CRUMBS = [
    { label: 'Jobs', href: '/jobs' },
    { label: 'Workers', href: '/workers' },
    { label: 'sx-4090-12' },
  ];

  it('links every crumb but the one you are on', async () => {
    await mount('<civitai-breadcrumb></civitai-breadcrumb>');
    const el = scope!.querySelector<CivitaiBreadcrumb>('civitai-breadcrumb')!;
    el.data = CRUMBS;
    await el.updateComplete;

    const links = el.shadowRoot!.querySelectorAll('a');
    expect([...links].map((a) => a.textContent?.trim())).toEqual(['Jobs', 'Workers']);
    expect(el.shadowRoot!.querySelector('[aria-current="page"]')!.textContent?.trim()).toBe(
      'sx-4090-12'
    );
  });

  it('keeps the separator out of the trail a screen reader reads', async () => {
    await mount('<civitai-breadcrumb></civitai-breadcrumb>');
    const el = scope!.querySelector<CivitaiBreadcrumb>('civitai-breadcrumb')!;
    el.data = CRUMBS;
    await el.updateComplete;

    const items = [...el.shadowRoot!.querySelectorAll('li')];
    expect(items.map((li) => li.textContent?.trim())).toEqual(['Jobs', 'Workers', 'sx-4090-12']);
    expect(getComputedStyle(items[1]!, '::before').content).not.toBe('none');
    expect(getComputedStyle(items[0]!, '::before').content).toBe('none');
  });
});

describe('<civitai-table>', () => {
  it('styles a table the page owns, because a slotted row is no longer a row', async () => {
    await mount(
      '<civitai-table><table><thead><tr><th>Worker</th></tr></thead>' +
        '<tbody><tr><td>sx-4090-12</td></tr></tbody></table></civitai-table>'
    );
    const table = scope!.querySelector('table')!;
    const cell = scope!.querySelector('td')!;

    expect(table.shadowRoot).toBeNull();
    expect(getComputedStyle(table).borderCollapse).toBe('collapse');
    expect(getComputedStyle(cell).paddingLeft).toBe('12px');
  });

  it('reaches the button a sortable grid puts in its header', async () => {
    await mount(
      '<civitai-table><table><thead><tr><th><button type="button">Worker</button></th></tr></thead>' +
        '<tbody><tr><td>x</td></tr></tbody></table></civitai-table>'
    );
    const header = scope!.querySelector('th')!;
    const button = scope!.querySelector('th button')!;

    expect(getComputedStyle(button).textTransform).toBe(getComputedStyle(header).textTransform);
    expect(getComputedStyle(button).color).toBe(getComputedStyle(header).color);
    expect(getComputedStyle(button).fontSize).toBe(getComputedStyle(header).fontSize);
  });

  it('tightens up when asked', async () => {
    await mount('<civitai-table dense><table><tbody><tr><td>x</td></tr></tbody></table></civitai-table>');
    expect(getComputedStyle(scope!.querySelector('td')!).paddingLeft).toBe('8px');
  });
});
