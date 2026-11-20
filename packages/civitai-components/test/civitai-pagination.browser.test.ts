import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiPagination } from '../src/elements/civitai-pagination.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

async function mount(attrs: Record<string, string>): Promise<CivitaiPagination> {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  const el = document.createElement('civitai-pagination');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  scope.append(el);
  document.body.append(scope);
  await el.updateComplete;
  return el;
}

const run = (el: CivitaiPagination): string[] =>
  [...el.shadowRoot!.querySelectorAll('[part="page"], [part="gap"]')].map((n) =>
    n.textContent!.trim()
  );

const pageButton = (el: CivitaiPagination, page: number): HTMLButtonElement =>
  el.shadowRoot!.querySelector(`button[data-page="${page}"]`)!;

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-pagination>', () => {
  it('shows every page when they all fit', async () => {
    expect(run(await mount({ total: '5', page: '3' }))).toEqual(['1', '2', '3', '4', '5']);
  });

  it('keeps the first and last page either side of a gap', async () => {
    expect(run(await mount({ total: '20', page: '10' }))).toEqual([
      '1', '…', '9', '10', '11', '…', '20',
    ]);
  });

  it('opens the run out when the current page is near an end', async () => {
    expect(run(await mount({ total: '20', page: '2' }))).toEqual(['1', '2', '3', '…', '20']);
  });

  it('marks only the current page, for a screen reader as well as the eye', async () => {
    const el = await mount({ total: '5', page: '3' });
    const current = el.shadowRoot!.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent?.trim()).toBe('3');
  });

  it('moves on a click and says so once', async () => {
    const el = await mount({ total: '5', page: '3' });
    let changes = 0;
    el.addEventListener('change', () => void (changes += 1));

    pageButton(el, 4).click();
    await el.updateComplete;

    expect(el.page).toBe(4);
    expect(changes).toBe(1);
  });

  it('stays silent when the page you click is the one you are on', async () => {
    const el = await mount({ total: '5', page: '3' });
    let changes = 0;
    el.addEventListener('change', () => void (changes += 1));

    pageButton(el, 3).click();
    await el.updateComplete;

    expect(changes).toBe(0);
  });

  it('cannot step past either end', async () => {
    const first = await mount({ total: '5', page: '1' });
    expect(first.shadowRoot!.querySelector<HTMLButtonElement>('[part="previous"]')!.disabled).toBe(
      true
    );

    const last = await mount({ total: '5', page: '5' });
    expect(last.shadowRoot!.querySelector<HTMLButtonElement>('[part="next"]')!.disabled).toBe(true);
  });

  it('clamps a page set outside the range rather than rendering it', async () => {
    const el = await mount({ total: '5', page: '99' });
    expect(el.shadowRoot!.querySelector('[aria-current="page"]')!.textContent?.trim()).toBe('5');
  });

  it('lets change out of a consumer shadow root', async () => {
    const el = await mount({ total: '5', page: '1' });
    const host = document.createElement('div');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).append(el);
    await el.updateComplete;

    let heard = 0;
    const onChange = (): void => void (heard += 1);
    document.addEventListener('change', onChange);
    pageButton(el, 2).click();
    document.removeEventListener('change', onChange);
    host.remove();

    expect(heard).toBe(1);
  });
});
