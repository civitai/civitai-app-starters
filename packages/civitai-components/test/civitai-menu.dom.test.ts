/**
 * `<civitai-menu>` IN A NON-BROWSER DOM — the tier every other element test in
 * this package is structurally blind to (#485).
 *
 * This project runs under `environment: 'happy-dom'`, which is where an App
 * Block's own suite runs: `@civitai/blocks-react/testing` is documented as the
 * host simulation that lets a block "run in `vitest`/`happy-dom`", and both
 * React packages' `unit` projects use it. happy-dom does not implement the
 * popover API at any version — `showPopover`/`hidePopover`/`togglePopover` are
 * `undefined` and `:popover-open` silently evaluates to `false` — so 851 green
 * browser tests said nothing about whether a consumer could mount this element.
 *
 * 🔴 WHAT THIS FILE DOES NOT CLAIM. happy-dom does no layout, and — measured on
 * 20.9.0 — does not deliver a click on slotted content to a listener on the
 * `<slot>` it is assigned to. Lit binds `@click` to that `<slot>`, so the
 * trigger is inert here. `show()`/`hide()` are the only route in, and the last
 * test in this file pins that so nobody reads the rest as "fully driveable".
 *
 * NO SHIM IS LOADED ON PURPOSE. `installPopoverShim` from
 * `@civitai/blocks-react/testing` exists for consumers whose own code calls into
 * the popover API, but this element must work WITHOUT it — otherwise the fix is
 * a setup step a consumer has to know about rather than a property of the
 * element. (`@civitai/components` also cannot import `@civitai/blocks-react`:
 * the dependency runs the other way.)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CivitaiMenu } from '../src/elements/civitai-menu.js';
import '../src/elements/register.js';

const MARKUP = `
  <civitai-menu label="Contribute">
    <button slot="trigger">Contribute</button>
    <civitai-menu-item id="first" value="benchmark">Run a benchmark</civitai-menu-item>
    <civitai-menu-item id="second" value="review">Write a review</civitai-menu-item>
  </civitai-menu>`;

/** The same shape a consumer uses: a container of their own around the items. */
const WRAPPED_MARKUP = `
  <civitai-menu label="Contribute">
    <button slot="trigger">Contribute</button>
    <div data-testid="contribute-menu-items">
      <civitai-menu-item id="first" value="benchmark">Run a benchmark</civitai-menu-item>
      <civitai-menu-item id="second" value="review">Write a review</civitai-menu-item>
    </div>
  </civitai-menu>`;

function mount(markup = MARKUP): CivitaiMenu {
  document.body.innerHTML = markup;
  return document.querySelector('civitai-menu')!;
}

const panelOf = (menu: CivitaiMenu): HTMLElement =>
  menu.shadowRoot!.querySelector<HTMLElement>('.panel')!;

/**
 * "Is the panel showing?", asked the way a consumer would in a DOM with no
 * popover API: the attribute the element writes, cross-checked against the
 * computed `display` the shadow stylesheet derives from it. Asserting only the
 * attribute would pass even if the CSS rule still keyed on `:popover-open` and
 * pinned the panel shut, which is the exact hazard the issue names.
 *
 * ⚠️ The `display` half is happy-dom-specific and that is why this project pins
 * happy-dom rather than "any non-browser DOM": jsdom 30.1.1 does not apply a
 * shadow root's stylesheet in `getComputedStyle`, so the panel reads `block`
 * there whether it is open or shut. A consumer on jsdom should assert `data-open`
 * (documented in README § "Testing them in a non-browser DOM").
 */
function panelShowing(menu: CivitaiMenu): { attr: boolean; display: string } {
  const panel = panelOf(menu);
  return { attr: panel.hasAttribute('data-open'), display: getComputedStyle(panel).display };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<civitai-menu> in a non-browser DOM', () => {
  it('INVARIANT GUARD (green before this change too): mounts and renders its panel', async () => {
    // jsdom 25 threw HERE, on `:popover-open`, before anyone interacted with the
    // element. happy-dom returns `false` for that selector instead, so mounting
    // already worked on THIS environment — recorded as an invariant, not as
    // regression coverage for #485. The regression coverage is the next test.
    const menu = mount();
    await menu.updateComplete;

    expect(panelOf(menu)).toBeTruthy();
    expect(menu.open).toBe(false);
  });

  it('opens via show() without throwing, and the panel is showing', async () => {
    // #485 closing condition 1. Before this change: `TypeError: panel.showPopover
    // is not a function`, surfaced by Lit as an unhandled rejection, so the whole
    // run errored even though the call was awaited.
    const menu = mount();
    await menu.updateComplete;

    menu.show();
    await menu.updateComplete;

    expect(menu.open).toBe(true);
    expect(panelShowing(menu)).toEqual({ attr: true, display: 'block' });
  });

  it('hide() puts the panel back, so open state is a round trip and not a latch', async () => {
    const menu = mount();
    await menu.updateComplete;
    menu.show();
    await menu.updateComplete;
    expect(panelShowing(menu).attr).toBe(true);

    menu.hide();
    await menu.updateComplete;

    expect(menu.open).toBe(false);
    expect(panelShowing(menu)).toEqual({ attr: false, display: 'none' });
  });

  it('opens twice in a row without throwing (the idempotence guard still holds)', async () => {
    // The guard that used to read `:popover-open` is now bookkeeping on the
    // element. Open → close → open exercises it in both directions; the old code
    // would have called `showPopover()` on an already-shown popover, which throws
    // `InvalidStateError` in a real browser.
    const menu = mount();
    await menu.updateComplete;

    menu.show();
    await menu.updateComplete;
    menu.show(); // no-op: already open
    await menu.updateComplete;
    menu.hide();
    await menu.updateComplete;
    menu.show();
    await menu.updateComplete;

    expect(menu.open).toBe(true);
    expect(panelShowing(menu).attr).toBe(true);
  });

  it('a consumer-owned wrapper around the items still yields focusable items', async () => {
    // The other half of #485: `assignedElements({ flatten: true })` returns the
    // `<div>`, so the `role=menuitem` filter used to yield 0 items and `show()`
    // focused nothing. `#items` is private, so this asserts the consequence that
    // is observable — `show()` lands focus on the FIRST item, in DOM order.
    //
    // ⚠️ READ THE ATTRIBUTION: at `origin/main` this test is red for the POPOVER
    // reason (`TypeError: panel.showPopover is not a function`), not for the
    // wrapper reason — the throw happens first and masks it. The isolated
    // red→green for the wrapper half is in `civitai-menu.browser.test.ts`, where
    // the popover API exists and the only thing that can fail is `#items`. This
    // test's job is that the two halves hold TOGETHER, in the environment a
    // consumer runs.
    const menu = mount(WRAPPED_MARKUP);
    await menu.updateComplete;

    menu.show();
    await menu.updateComplete;
    await menu.updateComplete; // `show()` focuses in a `updateComplete.then`

    expect(document.querySelector('[data-testid="contribute-menu-items"]')).toBeTruthy();
    expect(document.activeElement?.id).toBe('first');
  });

  it('ENVIRONMENT CHARACTERISATION (green before this change too): a trigger click does NOTHING here', async () => {
    // 🔴 Not a bug in the element, and NOT fixed by this change or by the shim.
    // Measured on happy-dom 20.9.0: a click on the slotted `<button>` bubbles to
    // the HOST (a listener there fires 1x) but a listener on the `<slot>` element
    // — the node Lit bound `@click` to — fires 0x. So `toggle()` is never called
    // and `open` never flips.
    //
    // This is pinned rather than left implicit because the failure is SILENT: no
    // throw, no state change, a test that simply does nothing. If this test ever
    // goes RED, happy-dom has started delivering the event — which is good news,
    // and the thing to do is update the "drive it with show()" wording in
    // packages/civitai-components/README.md and in `installPopoverShim`'s docs,
    // not to make this assertion pass again.
    const menu = mount();
    await menu.updateComplete;

    menu.querySelector<HTMLElement>('[slot="trigger"]')!.click();
    await menu.updateComplete;

    expect(menu.open).toBe(false);
  });
});
