import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiMenu, MenuSelectDetail } from '../src/elements/civitai-menu.js';
import type { CivitaiMenuItem } from '../src/elements/civitai-menu-item.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

const MARKUP = `
  <civitai-menu label="Image actions">
    <button slot="trigger" aria-label="More">&#8942;</button>
    <civitai-menu-item id="save" value="save">Save image to collection</civitai-menu-item>
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
  it('reports the chosen value, and closes', async () => {
    const menu = await opened(mount());
    const seen: string[] = [];
    menu.addEventListener('select', (e) => {
      seen.push((e as CustomEvent<MenuSelectDetail>).detail.value);
    });

    item(menu, 'save').click();
    await menu.updateComplete;

    expect(seen).toEqual(['save']);
    expect(menu.open).toBe(false);
  });

  it('falls back to the item text when it carries no value', async () => {
    const menu = await opened(mount());
    const seen: string[] = [];
    menu.addEventListener('select', (e) => {
      seen.push((e as CustomEvent<MenuSelectDetail>).detail.value);
    });

    item(menu, 'report').click();
    await menu.updateComplete;

    expect(seen).toEqual(['Report image']);
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

/**
 * #485 part 2 — a consumer-owned container is the addressable hook.
 *
 * The panel lives in the shadow root, and `part="panel"` styles it but is not a
 * query target: `document.querySelector('[part="panel"]')` is `null`, because
 * `::part()` is a CSS-only mechanism. Forwarding a `data-panel-*` attribute onto
 * the panel would not have helped either — the forwarded attribute is still
 * inside the shadow root, and `document.querySelector` does not pierce shadow
 * roots. A container the CONSUMER writes is light DOM, so it is genuinely
 * reachable from a document query; the element's job is to tolerate it.
 */
describe('<civitai-menu> with a consumer-owned item container', () => {
  const WRAPPED = `
    <civitai-menu label="Image actions">
      <button slot="trigger" aria-label="More">&#8942;</button>
      <div data-testid="image-actions-items">
        <civitai-menu-item id="save" value="save">Save image to collection</civitai-menu-item>
        <civitai-menu-item id="report">Report image</civitai-menu-item>
        <civitai-menu-label>Moderator</civitai-menu-label>
        <civitai-menu-item id="delete" destructive>Delete</civitai-menu-item>
      </div>
    </civitai-menu>`;

  it('the documented query finds the container, and show() still focuses the first item', async () => {
    // The closing condition, verbatim: set the attribute, assert the documented
    // query finds it, assert `show()` still lands focus on the first item.
    const menu = await opened(mount(WRAPPED));

    const container = document.querySelector('[data-testid="image-actions-items"]');
    expect(container, 'a consumer-owned wrapper is light DOM and IS query-able').not.toBeNull();
    expect(container!.closest('civitai-menu')).toBe(menu);
    expect(focused()).toBe(item(menu, 'save'));
  });

  it('INVARIANT GUARD (green before this change too): a part is NOT a query target', async () => {
    // Recorded as an invariant, not as regression coverage: it was already true
    // and it is the reason the issue's option 3 (`data-panel-*` forwarding onto
    // the panel) was rejected rather than merely not chosen. A forwarded
    // attribute would land here, on the far side of the shadow boundary.
    const menu = await opened(mount(WRAPPED));
    expect(document.querySelector('[part="panel"]')).toBeNull();
    expect(menu.shadowRoot!.querySelector('[part="panel"]')).not.toBeNull();
  });

  it('walks the wrapped items with the arrow keys, in DOM order, skipping the label', async () => {
    // `querySelectorAll` returns tree order, which is what makes the descent
    // order-preserving. Three stops in sequence is what distinguishes "in order"
    // from "found them all"; a set-valued fix passes a single-step assertion.
    const menu = await opened(mount(WRAPPED));
    expect(focused()).toBe(item(menu, 'save'));

    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe(item(menu, 'report'));
    await userEvent.keyboard('{ArrowDown}');
    expect(focused(), 'the label is inside the wrapper too, and is not an item').toBe(
      item(menu, 'delete')
    );
    await userEvent.keyboard('{ArrowDown}');
    expect(focused(), 'wraps to the first').toBe(item(menu, 'save'));
  });

  it('INVARIANT GUARD (green before this change too): still reports a selection made inside the wrapper', async () => {
    // Green at `origin/main` because the panel's click handler walks
    // `composedPath()` and never consulted `#items`, so a wrapper never broke
    // SELECTION — only focus and arrow-key navigation. Kept because that
    // independence is worth pinning: a future `#items`-based rewrite of the click
    // handler would have to keep it true.
    const menu = await opened(mount(WRAPPED));
    const seen: string[] = [];
    menu.addEventListener('select', (e) => {
      seen.push((e as CustomEvent<MenuSelectDetail>).detail.value);
    });

    item(menu, 'report').click();
    await menu.updateComplete;

    expect(seen).toEqual(['Report image']);
    expect(menu.open).toBe(false);
  });

  it('collects items from SEVERAL containers, and mixes wrapped with unwrapped', async () => {
    // The fix must not be "unwrap the single child": a consumer marking two
    // groups, or marking only one of them, is the same mechanism.
    const menu = await opened(
      mount(`
        <civitai-menu label="Mixed">
          <button slot="trigger">T</button>
          <civitai-menu-item id="save" value="save">Bare</civitai-menu-item>
          <div data-testid="group-a"><civitai-menu-item id="report">Wrapped A</civitai-menu-item></div>
          <div data-testid="group-b"><civitai-menu-item id="delete">Wrapped B</civitai-menu-item></div>
        </civitai-menu>`)
    );

    expect(focused()).toBe(item(menu, 'save'));
    await userEvent.keyboard('{End}');
    expect(focused(), 'End reaches the last item across all containers').toBe(
      item(menu, 'delete')
    );
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe(item(menu, 'report'));
  });
});

/**
 * #485 part 1, from the browser side: the two properties popover was chosen FOR
 * must survive the switch to attribute-authored hiding. The top-layer escape is
 * already covered above ("rises into the top layer"); these pin the rest.
 */
describe('<civitai-menu> popover is still driven, not just the attribute', () => {
  it('both mechanisms agree: `data-open` AND `:popover-open` track open state', async () => {
    // Red at `origin/main`, on the `data-open` assertion — the attribute does not
    // exist there. The `:popover-open` half is the INVARIANT: it is what stops
    // this change from quietly degrading into "attribute only", which would lose
    // the top layer and native light dismiss, the two reasons popover was chosen.
    // Asserting the pair in BOTH arms is the point; either alone is satisfiable
    // by deleting the other mechanism.
    const menu = mount();
    await menu.updateComplete;
    expect(panel(menu).matches(':popover-open')).toBe(false);
    expect(panel(menu).hasAttribute('data-open')).toBe(false);

    await opened(menu);
    expect(panel(menu).matches(':popover-open'), 'showPopover() is still called').toBe(true);
    expect(panel(menu).hasAttribute('data-open')).toBe(true);
    expect(getComputedStyle(panel(menu)).display).not.toBe('none');

    menu.hide();
    await menu.updateComplete;
    expect(panel(menu).matches(':popover-open'), 'hidePopover() is still called').toBe(false);
    expect(panel(menu).hasAttribute('data-open')).toBe(false);
    expect(getComputedStyle(panel(menu)).display).toBe('none');
  });

  it('INVARIANT GUARD (green before this change too): a native close then re-opens without throwing', async () => {
    // The bookkeeping that replaced the `:popover-open` reads has to survive a
    // close the element did not initiate. Escape is the reachable one of those in
    // a test (light dismiss needs a real pointer sequence, which a synthetic
    // `click()` is not): the UA hides the popover and the element learns about it
    // only from `toggle`.
    //
    // ⚠️ THIS TEST CANNOT SEE A STALE FLAG, and saying so is the point.
    // Measured in chromium 153: a redundant `showPopover()`, a redundant
    // `hidePopover()` and a `hidePopover()` on a hidden popover ALL return
    // quietly, though the spec says each should throw `InvalidStateError`. So
    // deleting the element's resync survives every test in this file. The one
    // instrument that catches it is the spec-compliant shim — see
    // `packages/civitai-blocks-react/test/popoverShim.test.ts`, "a UA-style
    // dismiss does not leave the element throwing on its next transition".
    //
    // What this DOES pin is the Escape path end to end, and that a re-open after
    // a close the element did not initiate still drives the popover.
    const menu = await opened(mount());
    expect(menu.open).toBe(true);

    await userEvent.keyboard('{Escape}');
    await menu.updateComplete;
    expect(menu.open, 'the toggle listener followed the element').toBe(false);
    expect(panel(menu).matches(':popover-open')).toBe(false);

    menu.show();
    await menu.updateComplete;
    await menu.updateComplete;
    expect(menu.open).toBe(true);
    expect(panel(menu).matches(':popover-open'), 'showPopover() ran again, no throw').toBe(true);

    menu.hide();
    await menu.updateComplete;
    expect(panel(menu).matches(':popover-open'), 'hidePopover() ran, no throw').toBe(false);
  });
});
