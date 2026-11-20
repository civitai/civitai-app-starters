import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CivitaiActionButton } from '../src/elements/civitai-action-button.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

function mount(markup: string): CivitaiActionButton {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'dark');
  scope.innerHTML = markup;
  document.body.append(scope);
  return scope.firstElementChild as CivitaiActionButton;
}

const ICON = '<span slot="icon">&rarr;</span>';
const rendered = async (el: CivitaiActionButton): Promise<CivitaiActionButton> => {
  await el.updateComplete;
  return el;
};
const width = (el: CivitaiActionButton): number =>
  el.shadowRoot!.querySelector('button')!.getBoundingClientRect().width;

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-action-button>', () => {
  it('is a circle until something asks for it', async () => {
    const el = await rendered(mount(`<civitai-action-button label="Remix">${ICON}</civitai-action-button>`));
    const box = el.shadowRoot!.querySelector('button')!.getBoundingClientRect();
    expect(box.width).toBeCloseTo(box.height, 0);
  });

  it('is named by its label even while the label is collapsed', async () => {
    const el = await rendered(mount(`<civitai-action-button label="Remix">${ICON}</civitai-action-button>`));
    expect(el.shadowRoot!.querySelector('button')!.getAttribute('aria-label')).toBe('Remix');
  });

  it('widens on hover, and settles back', async () => {
    const el = await rendered(mount(`<civitai-action-button label="Remix">${ICON}</civitai-action-button>`));
    const collapsed = width(el);

    await userEvent.hover(el);
    await vi.waitFor(() => {
      expect(width(el)).toBeGreaterThan(collapsed + 20);
    });

    await userEvent.unhover(el);
    await vi.waitFor(() => {
      expect(width(el)).toBeCloseTo(collapsed, 0);
    });
  });

  it('opens for the keyboard, which has no hover', async () => {
    const el = await rendered(mount(`<civitai-action-button label="Remix">${ICON}</civitai-action-button>`));
    const collapsed = width(el);

    el.shadowRoot!.querySelector('button')!.focus();
    await userEvent.keyboard('{Tab}');
    el.shadowRoot!.querySelector('button')!.focus();

    await vi.waitFor(() => {
      expect(width(el)).toBeGreaterThan(collapsed + 20);
    });
  });

  it('stays open when held open, which is the whole of touch support', async () => {
    const el = await rendered(mount(`<civitai-action-button label="Remix" expanded>${ICON}</civitai-action-button>`));
    await vi.waitFor(() => {
      expect(width(el)).toBeGreaterThan(60);
    });
  });

  it('does not open when disabled', async () => {
    const el = await rendered(
      mount(`<civitai-action-button label="Remix" disabled>${ICON}</civitai-action-button>`)
    );
    const collapsed = width(el);
    await userEvent.hover(el);
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(width(el)).toBeCloseTo(collapsed, 0);
  });

  it('swaps to a second icon once open, and back', async () => {
    const el = await rendered(
      mount(
        `<civitai-action-button label="Remix">
           <span slot="icon" id="resting">&#10024;</span>
           <span slot="icon-expanded" id="open">&rarr;</span>
         </civitai-action-button>`
      )
    );
    const shown = (id: string): number =>
      Number(getComputedStyle(el.shadowRoot!.querySelector(id === 'resting' ? '.resting' : '.chip')!).opacity);

    expect(shown('resting')).toBe(1);
    expect(shown('open')).toBe(0);

    await userEvent.hover(el);
    await vi.waitFor(() => {
      expect(shown('open')).toBe(1);
      expect(shown('resting')).toBe(0);
    });

    await userEvent.unhover(el);
    await vi.waitFor(() => {
      expect(shown('resting')).toBe(1);
    });
  });

  it('keeps the one icon visible when no second one was given', async () => {
    const el = await rendered(mount(`<civitai-action-button label="Remix">${ICON}</civitai-action-button>`));
    expect(el.hasAttribute('data-swaps')).toBe(false);

    await userEvent.hover(el);
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(Number(getComputedStyle(el.shadowRoot!.querySelector('.resting')!).opacity)).toBe(1);
  });

  it('grows in the inline direction, so the container decides which way it goes', async () => {
    const el = await rendered(
      mount(
        `<div style="display:flex;justify-content:flex-end;width:300px">
           <civitai-action-button label="Remix" expanded>${ICON}</civitai-action-button>
         </div>`
      ).querySelector('civitai-action-button')!
    );
    const row = el.parentElement!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    expect(box.right).toBeCloseTo(row.right, 0);
  });
});
