import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiNavItem } from '../src/elements/civitai-nav-item.js';
import type { CivitaiNavList } from '../src/elements/civitai-nav-list.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

const MARKUP = `
  <civitai-nav-list label="Sections">
    <civitai-nav-item href="/" label="Summary"></civitai-nav-item>
    <civitai-nav-item label="Jobs">
      <civitai-nav-item href="/jobs" label="Active"></civitai-nav-item>
      <civitai-nav-item label="Archive">
        <civitai-nav-item href="/jobs/replay" label="Replay"></civitai-nav-item>
      </civitai-nav-item>
    </civitai-nav-item>
    <civitai-nav-item href="/workers" label="Workers"></civitai-nav-item>
  </civitai-nav-list>`;

async function mount(current?: string): Promise<CivitaiNavList> {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = MARKUP;
  const list = scope.querySelector<CivitaiNavList>('civitai-nav-list')!;
  if (current !== undefined) list.setAttribute('current', current);
  document.body.append(scope);
  await Promise.all(
    [...scope.querySelectorAll('*')]
      .filter((el): el is CivitaiNavItem => 'updateComplete' in el)
      .map((el) => el.updateComplete)
  );
  await new Promise((resolve) => queueMicrotask(() => resolve(null)));
  await Promise.all([...scope.querySelectorAll<CivitaiNavItem>('civitai-nav-item')].map((el) => el.updateComplete));
  return list;
}

const item = (label: string): CivitaiNavItem =>
  scope!.querySelector<CivitaiNavItem>(`civitai-nav-item[label="${label}"]`)!;

const row = (label: string): HTMLElement => item(label).shadowRoot!.querySelector('.row')!;

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-nav-item>', () => {
  it('is a link when it has an href, and a disclosure when it has children', async () => {
    await mount();

    expect(row('Summary').tagName).toBe('A');
    expect(row('Jobs').tagName).toBe('BUTTON');
    expect(row('Jobs').getAttribute('aria-expanded')).toBe('false');
  });

  it('is a disclosure even when it has an href, rather than an anchor that toggles', async () => {
    scope?.remove();
    scope = document.createElement('div');
    scope.innerHTML =
      '<civitai-nav-list><civitai-nav-item href="/jobs" label="Jobs">' +
      '<civitai-nav-item href="/jobs/active" label="Active"></civitai-nav-item>' +
      '</civitai-nav-item></civitai-nav-list>';
    document.body.append(scope);
    await Promise.all(
      [...scope.querySelectorAll<CivitaiNavItem>('civitai-nav-item')].map((el) => el.updateComplete)
    );
    await item('Jobs').updateComplete;

    expect(item('Jobs').group).toBe(true);
    expect(row('Jobs').tagName).toBe('BUTTON');
    expect(row('Active').tagName).toBe('A');
  });

  it('points its disclosure at the region it actually controls', async () => {
    await mount();
    const controls = row('Jobs').getAttribute('aria-controls')!;

    expect(item('Jobs').shadowRoot!.getElementById(controls)).not.toBeNull();
  });

  it('opens and closes on click', async () => {
    await mount();
    row('Jobs').click();
    await item('Jobs').updateComplete;

    expect(item('Jobs').expanded).toBe(true);
    expect(row('Jobs').getAttribute('aria-expanded')).toBe('true');
  });

  it('indents by how deep it actually sits, not by what the markup says', async () => {
    await mount();
    const depth = (label: string): string =>
      getComputedStyle(item(label)).getPropertyValue('--civitai-nav-depth').trim();

    expect(depth('Summary')).toBe('0');
    expect(depth('Active')).toBe('1');
    expect(depth('Replay')).toBe('2');
  });

  it('gives a collapsed group no height', async () => {
    await mount();
    const children = item('Jobs').shadowRoot!.querySelector('[part="children"]')!;
    expect(children.getBoundingClientRect().height).toBe(0);

    row('Jobs').click();
    await item('Jobs').updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(children.getBoundingClientRect().height).toBeGreaterThan(0);
  });
});

describe('<civitai-nav-list>', () => {
  it('marks the page you are on, and only that one', async () => {
    await mount('/workers');
    const marked = [...scope!.querySelectorAll<CivitaiNavItem>('civitai-nav-item')].filter(
      (el) => el.current
    );
    expect(marked.map((el) => el.label)).toEqual(['Workers']);
    expect(row('Workers').getAttribute('aria-current')).toBe('page');
  });

  it('opens every group above the current page, however deep', async () => {
    await mount('/jobs/replay');

    expect(item('Jobs').expanded).toBe(true);
    expect(item('Archive').expanded).toBe(true);
    expect(row('Replay').getAttribute('aria-current')).toBe('page');
  });

  it('leaves groups that do not contain it alone', async () => {
    await mount('/workers');
    expect(item('Jobs').expanded).toBe(false);
  });

  it('follows the current page when it changes', async () => {
    const list = await mount('/');
    expect(item('Jobs').expanded).toBe(false);

    list.current = '/jobs';
    await list.updateComplete;
    await item('Jobs').updateComplete;

    expect(item('Jobs').expanded).toBe(true);
    expect(row('Active').getAttribute('aria-current')).toBe('page');
    expect(row('Summary').hasAttribute('aria-current')).toBe(false);
  });

  it('is a named landmark, so a screen reader can jump to it', async () => {
    const list = await mount();
    const nav = list.shadowRoot!.querySelector('nav')!;

    expect(nav.getAttribute('aria-label')).toBe('Sections');
  });
});
