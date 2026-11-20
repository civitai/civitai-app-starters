/**
 * `installPopoverShim` — the `@civitai/blocks-react/testing` stand-in for the
 * HTML popover API in a non-browser DOM (#485).
 *
 * Runs in the `unit` project, i.e. happy-dom, which is the environment the shim
 * exists for: `showPopover`/`hidePopover`/`togglePopover` are `undefined` there
 * and `:popover-open` silently evaluates to `false`.
 *
 * 🔴 THE LAST DESCRIBE BLOCK IS THE IMPORTANT ONE. A shim that makes `show()`
 * work while a trigger click silently no-ops would read as "this element is
 * testable now" while delivering half of that. The shim measures the click
 * problem on install and says so out loud; these tests pin BOTH — that it warns,
 * and that it does not pretend to have fixed it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installPopoverShim, type PopoverShimHandle } from '../src/testing.js';

let shim: PopoverShimHandle | undefined;

function popoverDiv(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('popover', 'auto');
  document.body.append(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  shim?.uninstall();
  shim = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('installPopoverShim', () => {
  it('the environment really is missing the popover API (positive control)', () => {
    // Without this, every assertion below could be passing because the DOM had a
    // popover API all along and the shim patched nothing.
    const el = popoverDiv();
    expect(typeof (el as unknown as { showPopover?: unknown }).showPopover).toBe('undefined');
    expect(el.matches(':popover-open'), 'happy-dom answers false rather than throwing').toBe(false);
  });

  it('installs, and reports that it did', () => {
    shim = installPopoverShim({ quiet: true });
    expect(shim.installed).toBe(true);
    expect(typeof document.createElement('div').showPopover).toBe('function');
  });

  it('shows and hides, and `:popover-open` follows', () => {
    shim = installPopoverShim({ quiet: true });
    const el = popoverDiv();

    expect(el.matches(':popover-open')).toBe(false);
    el.showPopover();
    expect(el.matches(':popover-open')).toBe(true);
    expect(el.matches('div:not(:popover-open)'), 'the negation form works too').toBe(false);

    el.hidePopover();
    expect(el.matches(':popover-open')).toBe(false);
    expect(el.matches('div:not(:popover-open)')).toBe(true);
  });

  it('throws InvalidStateError on a redundant show or hide, as the platform does', () => {
    // This is what the element's idempotence bookkeeping exists for; a shim that
    // silently tolerated a double show would hide that bug rather than surface it.
    shim = installPopoverShim({ quiet: true });
    const el = popoverDiv();

    el.showPopover();
    expect(() => el.showPopover()).toThrow(/InvalidStateError/);
    el.hidePopover();
    expect(() => el.hidePopover()).toThrow(/InvalidStateError/);
  });

  it('refuses an element with no `popover` attribute', () => {
    shim = installPopoverShim({ quiet: true });
    const plain = document.createElement('div');
    document.body.append(plain);
    expect(() => plain.showPopover()).toThrow(/InvalidStateError/);
  });

  it('togglePopover flips, and honours an explicit force', () => {
    shim = installPopoverShim({ quiet: true });
    const el = popoverDiv();

    expect(el.togglePopover()).toBe(true);
    expect(el.togglePopover()).toBe(false);
    expect(el.togglePopover(true)).toBe(true);
    expect(el.togglePopover(true), 'forcing the state it is already in is a no-op').toBe(true);
    expect(el.togglePopover(false)).toBe(false);
  });

  it('dispatches a `toggle` carrying oldState/newState', async () => {
    shim = installPopoverShim({ quiet: true });
    const el = popoverDiv();
    const seen: string[] = [];
    el.addEventListener('toggle', (e) => {
      const { oldState, newState } = e as Event & { oldState: string; newState: string };
      seen.push(`${oldState}->${newState}`);
    });

    el.showPopover();
    el.hidePopover();
    await Promise.resolve(); // the shim queues the event in a microtask

    expect(seen).toEqual(['closed->open', 'open->closed']);
  });

  it('uninstall puts the DOM back exactly as it was', () => {
    const handle = installPopoverShim({ quiet: true });
    handle.uninstall();

    const el = popoverDiv();
    expect(typeof (el as unknown as { showPopover?: unknown }).showPopover).toBe('undefined');
    // The `matches` patch must come off too, or a later `:popover-open` query
    // would keep resolving against the shim's marker attribute forever.
    expect(el.matches(':popover-open')).toBe(false);
    expect(Element.prototype.matches.call(el, 'div')).toBe(true);
  });

  it('is inert when the DOM already has a popover API', () => {
    // The case a real browser is in. Patched onto the prototype by hand rather
    // than run in a browser project, so this tier can see it at all.
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const native = () => {};
    proto.showPopover = native;
    try {
      const handle = installPopoverShim({ quiet: true });
      expect(handle.installed).toBe(false);
      expect(proto.showPopover, 'the real implementation is left alone').toBe(native);
      handle.uninstall(); // must be safe, and must not delete the real one
      expect(proto.showPopover).toBe(native);
    } finally {
      delete proto.showPopover;
    }
  });
});

describe('installPopoverShim does not pretend clicks work', () => {
  it('measures that slotted clicks do NOT reach a listener on the <slot>', () => {
    // The measurement, reproduced independently of the shim so the two agree:
    // a click on slotted light DOM reaches the HOST but not the `<slot>`, which
    // is the node Lit binds `@click` to.
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<slot></slot>';
    const child = document.createElement('button');
    host.append(child);
    document.body.append(host);
    let hostSaw = 0;
    let slotSaw = 0;
    host.addEventListener('click', () => hostSaw++);
    root.querySelector('slot')!.addEventListener('click', () => slotSaw++);
    child.click();

    expect(hostSaw, 'the click really dispatched and bubbled').toBe(1);
    expect(slotSaw, 'but the <slot> never sees it — this is the cause').toBe(0);

    shim = installPopoverShim({ quiet: true });
    expect(shim.slottedClicksReachSlots, 'the shim reports the same thing').toBe(false);
  });

  it('warns loudly about it, and `quiet` is the only way to silence it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    shim = installPopoverShim();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0] ?? '');
    // Pin the ACTIONABLE half, not just that something was logged: a consumer
    // reading this must learn what to do instead.
    expect(message).toMatch(/menu\.show\(\)/);
    expect(message).toMatch(/<slot>/);

    shim.uninstall();
    warn.mockClear();
    shim = installPopoverShim({ quiet: true });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('the shim and <civitai-menu> together', () => {
  // The SEAM. Each side is tested alone above and in
  // `@civitai/components`'s own `dom` project; neither of those builds the
  // combined state, and "verified in isolation" is where this class of defect
  // lives. The element must not need the shim, and must not be broken BY it.
  it('the element opens with the shim installed, and `:popover-open` agrees', async () => {
    const { defineCivitaiMenu } = await import('@civitai/components/civitai-menu');
    const { defineCivitaiMenuItem } = await import('@civitai/components/civitai-menu-item');
    defineCivitaiMenu();
    defineCivitaiMenuItem();

    shim = installPopoverShim({ quiet: true });

    document.body.innerHTML = `
      <civitai-menu label="Contribute">
        <button slot="trigger">Contribute</button>
        <civitai-menu-item id="first" value="benchmark">Run a benchmark</civitai-menu-item>
      </civitai-menu>`;
    const menu = document.querySelector('civitai-menu')!;
    await menu.updateComplete;

    menu.show();
    await menu.updateComplete;

    const panel = menu.shadowRoot!.querySelector<HTMLElement>('.panel')!;
    expect(menu.open).toBe(true);
    expect(panel.hasAttribute('data-open'), 'the element authors its own state').toBe(true);
    expect(panel.matches(':popover-open'), 'and it really called showPopover()').toBe(true);

    menu.hide();
    await menu.updateComplete;
    expect(panel.matches(':popover-open')).toBe(false);
    expect(panel.hasAttribute('data-open')).toBe(false);
  });

  it('a UA-style dismiss does not leave the element throwing on its next transition', async () => {
    // 🔴 THIS IS THE ONLY INSTRUMENT IN THE REPO THAT CAN SEE THIS BUG, and that
    // is the reason it lives here rather than in the browser suite.
    //
    // The element keeps bookkeeping so it never calls `hidePopover()` on an
    // already-hidden popover, and resyncs it from the `toggle` event — because
    // light dismiss and Escape close the popover WITHOUT going through `hide()`.
    // Per spec a redundant `hidePopover()` throws `InvalidStateError`. **Chromium
    // 153 does not** (measured: redundant show, redundant hide and hide-of-hidden
    // all return quietly), so deleting the resync survives every browser test.
    // This shim is spec-compliant, which makes the hazard observable.
    //
    // `panel.hidePopover()` from outside is exactly what a UA dismiss does: the
    // popover goes away first, and the element finds out from `toggle`.
    const { defineCivitaiMenu } = await import('@civitai/components/civitai-menu');
    const { defineCivitaiMenuItem } = await import('@civitai/components/civitai-menu-item');
    defineCivitaiMenu();
    defineCivitaiMenuItem();
    shim = installPopoverShim({ quiet: true });

    document.body.innerHTML = `
      <civitai-menu label="Contribute">
        <button slot="trigger">Contribute</button>
        <civitai-menu-item id="first" value="benchmark">Run a benchmark</civitai-menu-item>
      </civitai-menu>`;
    const menu = document.querySelector('civitai-menu')!;
    await menu.updateComplete;
    menu.show();
    await menu.updateComplete;
    const panel = menu.shadowRoot!.querySelector<HTMLElement>('.panel')!;
    expect(panel.matches(':popover-open')).toBe(true);

    panel.hidePopover(); // the UA closes it; the element has not been told yet
    await Promise.resolve(); // the shim queues `toggle` in a microtask
    await menu.updateComplete; // ← a stale flag makes this reject here

    expect(menu.open, 'the element followed the popover').toBe(false);

    // And the next transition still works — a stale flag would have thrown above,
    // but assert the round trip so a partial fix cannot pass.
    menu.show();
    await menu.updateComplete;
    expect(panel.matches(':popover-open')).toBe(true);
    menu.hide();
    await menu.updateComplete;
    expect(panel.matches(':popover-open')).toBe(false);
  });

  it('a trigger click is STILL inert with the shim installed', async () => {
    // The honest half. If this ever goes red, happy-dom has started delivering
    // the event: good news, and the thing to do is update the "drive it with
    // show()" wording in `installPopoverShim`'s docs and in both READMEs — not to
    // make this assertion pass again.
    const { defineCivitaiMenu } = await import('@civitai/components/civitai-menu');
    defineCivitaiMenu();
    shim = installPopoverShim({ quiet: true });

    document.body.innerHTML = `
      <civitai-menu label="Contribute"><button slot="trigger">Contribute</button></civitai-menu>`;
    const menu = document.querySelector('civitai-menu')!;
    await menu.updateComplete;

    menu.querySelector<HTMLElement>('[slot="trigger"]')!.click();
    await menu.updateComplete;

    expect(menu.open).toBe(false);
  });
});
