import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiMenu } from '../src/elements/civitai-menu.js';
import type { CivitaiMenuItem } from '../src/elements/civitai-menu-item.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

const MARKUP = `
  <civitai-menu label="Image actions">
    <button slot="trigger" aria-label="More">&#8942;</button>
    <civitai-menu-item id="save">Save image to collection</civitai-menu-item>
    <civitai-menu-item id="report">Report image</civitai-menu-item>
    <civitai-menu-label>Moderator</civitai-menu-label>
    <civitai-menu-item id="rescan" disabled>Rescan image</civitai-menu-item>
    <civitai-menu-item id="delete" destructive>Delete</civitai-menu-item>
  </civitai-menu>`;

function mount(markup = MARKUP): CivitaiMenu {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'dark');
  scope.innerHTML = markup;
  document.body.append(scope);
  return scope.querySelector('civitai-menu')!;
}

const opened = async (menu: CivitaiMenu): Promise<CivitaiMenu> => {
  await menu.updateComplete;
  menu.show();
  await menu.updateComplete;
  return menu;
};

const panel = (menu: CivitaiMenu): HTMLElement => menu.shadowRoot!.querySelector('.panel')!;
const trigger = (menu: CivitaiMenu): HTMLElement => menu.querySelector('[slot="trigger"]')!;
const item = (menu: CivitaiMenu, id: string): CivitaiMenuItem => menu.querySelector(`#${id}`)!;
const focused = (): Element | null => {
  let node: Element | null = document.activeElement;
  while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
  return node;
};

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-menu> opening', () => {
  it('opens on the trigger and lands focus on the first item', async () => {
    const menu = mount();
    await menu.updateComplete;
    trigger(menu).click();
    await menu.updateComplete;
    await menu.updateComplete;

    expect(menu.open).toBe(true);
    expect(panel(menu).matches(':popover-open')).toBe(true);
    expect(focused()).toBe(item(menu, 'save'));
  });

  it('tells a screen reader the trigger owns a menu, and whether it is open', async () => {
    const menu = mount();
    await menu.updateComplete;
    expect(trigger(menu).getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger(menu).getAttribute('aria-expanded')).toBe('false');

    await opened(menu);
    expect(trigger(menu).getAttribute('aria-expanded')).toBe('true');
  });

  it('rises into the top layer, so a clipping ancestor cannot hide it', async () => {
    const menu = mount(
      `<div style="overflow: hidden; width: 40px; height: 22px">${MARKUP}</div>`
    );
    await opened(menu);

    const box = panel(menu).getBoundingClientRect();
    expect(box.width).toBeGreaterThan(40);
    expect(document.elementFromPoint(box.left + box.width / 2, box.top + 10)).not.toBeNull();
  });
});

describe('<civitai-menu> keyboard', () => {
  it('walks the items with the arrow keys, wrapping at the ends', async () => {
    const menu = await opened(mount());

    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe(item(menu, 'report'));
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe(item(menu, 'save'));
    await userEvent.keyboard('{ArrowUp}');
    expect(focused(), 'wraps to the last item').toBe(item(menu, 'delete'));
  });

  it('skips the section label, which is not an item', async () => {
    const menu = await opened(mount());
    await userEvent.keyboard('{End}');
    expect(focused()).toBe(item(menu, 'delete'));
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe(item(menu, 'rescan'));
    // The label sits between `report` and `rescan`; stepping over it is the
    // whole assertion, and stopping short of it is what a bad filter does.
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe(item(menu, 'report'));
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const menu = await opened(mount());
    await userEvent.keyboard('{Escape}');
    await menu.updateComplete;

    expect(menu.open).toBe(false);
    expect(focused()).toBe(trigger(menu));
  });

  it('opens from the keyboard on the trigger', async () => {
    const menu = mount();
    await menu.updateComplete;
    trigger(menu).focus();
    await userEvent.keyboard('{ArrowDown}');
    await menu.updateComplete;
    await menu.updateComplete;

    expect(menu.open).toBe(true);
    expect(focused()).toBe(item(menu, 'save'));
  });
});

describe('<civitai-menu> selection', () => {
  it('reports which item was chosen, and closes', async () => {
    const menu = await opened(mount());
    const seen: string[] = [];
    menu.addEventListener('select', (e) => {
      seen.push(((e as CustomEvent<{ item: CivitaiMenuItem }>).detail.item).id);
    });

    item(menu, 'report').click();
    await menu.updateComplete;

    expect(seen).toEqual(['report']);
    expect(menu.open).toBe(false);
  });

  it('refuses a disabled item, staying open', async () => {
    const menu = await opened(mount());
    const seen: string[] = [];
    menu.addEventListener('select', () => seen.push('selected'));

    item(menu, 'rescan').click();
    await menu.updateComplete;

    expect(seen).toEqual([]);
    expect(menu.open).toBe(true);
  });

  it('hands focus back to the trigger after a choice', async () => {
    const menu = await opened(mount());
    item(menu, 'report').click();
    await menu.updateComplete;
    expect(focused()).toBe(trigger(menu));
  });

  it('swallows a click on a disabled item before any listener sees it', async () => {
    const menu = await opened(mount());
    const seen: string[] = [];
    item(menu, 'rescan').addEventListener('click', () => seen.push('clicked'));

    item(menu, 'rescan').click();
    await menu.updateComplete;

    expect(seen).toEqual([]);
  });

  it('reaches a listener outside an enclosing shadow root', async () => {
    const outer = document.createElement('div');
    const root = outer.attachShadow({ mode: 'open' });
    root.innerHTML = MARKUP;
    scope = document.createElement('div');
    scope.append(outer);
    document.body.append(scope);

    const menu = await opened(root.querySelector('civitai-menu')!);
    const seen: string[] = [];
    const onSelect = () => seen.push('selected');
    document.addEventListener('select', onSelect);
    try {
      (root.querySelector('#save') as HTMLElement).click();
      expect(seen).toEqual(['selected']);
    } finally {
      document.removeEventListener('select', onSelect);
    }
  });

  it('marks a disabled item disabled rather than removing it', async () => {
    const menu = await opened(mount());
    expect(item(menu, 'rescan').getAttribute('aria-disabled')).toBe('true');
    expect(item(menu, 'save').getAttribute('aria-disabled')).toBe('false');
  });
});
