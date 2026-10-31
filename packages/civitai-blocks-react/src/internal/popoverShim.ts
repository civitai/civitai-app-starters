/**
 * A minimal stand-in for the HTML popover API, for NON-BROWSER DOMs.
 *
 * WHY IT EXISTS (#485). `jsdom` and `happy-dom` do not implement the popover
 * API at ANY version we could find: `showPopover`, `hidePopover` and
 * `togglePopover` are `undefined` on happy-dom 20.x and on jsdom 25 and 30 alike.
 * `:popover-open` is worse than absent — it is unreliable in a way that is NOT a
 * property of the runner's version: under jsdom it resolves through `nwsapi`, so
 * the same jsdom 25.0.1 both throws `DOMException: unknown pseudo-class selector`
 * and returns `false` depending on which `nwsapi` a lockfile pulled in (measured
 * `false` on nwsapi 2.2.28). Anything that calls into that API therefore explodes,
 * or lies, in the one environment an App Block's own test suite runs in.
 *
 * 🔴 WHAT THIS DOES **NOT** DO, and you must read this before using it.
 *
 * It does not make a shadow-DOM component fully driveable under happy-dom.
 * Measured on happy-dom 20.9.0: a click on a light-DOM child assigned to a
 * `<slot>` bubbles to the HOST (a listener there fires 1x) but a listener on the
 * `<slot>` ELEMENT ITSELF fires **0x**. Lit binds `@click` to the `<slot>`, so
 * `<civitai-menu>`'s trigger click is SILENT there: no throw, no open, nothing.
 * That is a property of happy-dom's event path through the flattened tree and
 * this shim cannot fix it — installing it changes the count from 0 to 0. (jsdom
 * 25 and 30 both DO deliver it, which is why this is probed rather than asserted.)
 *
 * So under a shimmed DOM you must drive overlay elements through their METHODS
 * (`menu.show()` / `menu.hide()`), never by clicking the trigger. {@link
 * installPopoverShim} PROBES for this on install and returns the result as
 * {@link PopoverShimHandle.slottedClicksReachSlots}, warning loudly when it is
 * false, because a shim that quietly made `show()` work while `click()` no-ops
 * would read as "this element is testable now" while delivering half of it.
 *
 * Other deliberate deviations from the platform, all of them narrow:
 *   - `toggle` is dispatched in a MICROTASK, where the platform queues a task.
 *     A microtask flushes before the next `await`, which is what makes it
 *     observable after `await el.updateComplete` in a test; a real task would
 *     need a `setTimeout` round-trip. `beforetoggle` is not dispatched at all.
 *   - There is no top layer, no anchor positioning, and no LIGHT DISMISS: a
 *     click outside a shown popover does not close it. Those need layout and a
 *     hit-testing event path, neither of which a non-browser DOM has. Light
 *     dismiss is one of the two reasons `<civitai-menu>` uses popover at all, so
 *     if that is what you are testing, use a real browser.
 *   - `popover="manual"` vs `"auto"` is not distinguished (there being no light
 *     dismiss to distinguish them by).
 */

/** The marker attribute a shown popover carries. Internal to the shim. */
const SHOWN_ATTR = 'data-civitai-popover-open';

/** What {@link installPopoverShim} hands back. */
export interface PopoverShimHandle {
  /**
   * `true` when this shim was needed — i.e. the DOM did not already have a
   * popover API. `false` means nothing was patched, which is the correct result
   * in a real browser, and makes the call safe to make unconditionally in a
   * setup file shared between a happy-dom project and a browser-mode project.
   */
  installed: boolean;
  /**
   * 🔴 Whether a click on a slotted light-DOM element reaches a listener on the
   * `<slot>` it is assigned to — measured, on install, with a throwaway element.
   *
   * `true` in a real browser. `false` on happy-dom 20.9.0, and while it is
   * `false` an element that binds its handlers to a `<slot>` (every Lit
   * component that does, `<civitai-menu>`'s trigger included) cannot be driven
   * by clicking. Drive it through its methods instead.
   */
  slottedClicksReachSlots: boolean;
  /** Restores whatever was on the prototypes before. Idempotent. */
  uninstall(): void;
}

/** Options for {@link installPopoverShim}. */
export interface PopoverShimOptions {
  /**
   * Suppress the `console.warn` fired when slotted clicks do not reach slot
   * listeners. The measurement is still returned on the handle. Default `false`
   * — the warning is the point, so silence it only once you have read it.
   */
  quiet?: boolean;
}

interface ShimTarget {
  showPopover?: () => void;
  hidePopover?: () => void;
  togglePopover?: (force?: boolean) => boolean;
}

/**
 * Does a click on a slotted child reach a listener bound to the `<slot>`?
 *
 * Built as its own throwaway tree rather than asked of the component under test,
 * so the answer is about the DOM implementation and not about one element's
 * wiring. Returns `false` if anything in the probe is unsupported — an
 * environment that cannot even run the probe certainly cannot deliver the event.
 */
function probeSlottedClickReachesSlot(doc: Document): boolean {
  let host: HTMLElement | undefined;
  try {
    host = doc.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const slot = doc.createElement('slot');
    root.append(slot);
    const child = doc.createElement('button');
    host.append(child);
    doc.body.append(host);

    let slotSaw = 0;
    slot.addEventListener('click', () => {
      slotSaw += 1;
    });
    child.click();
    return slotSaw > 0;
  } catch {
    return false;
  } finally {
    host?.remove();
  }
}

/**
 * Install the popover shim on the current global DOM. Call it once, in a vitest
 * `setupFiles` entry or at the top of a test file, BEFORE the elements render.
 *
 * Safe and inert in a real browser: it detects a working popover API and patches
 * nothing (`installed: false`).
 *
 * @example
 * ```ts
 * import { installPopoverShim } from '@civitai/blocks-react/testing';
 *
 * const shim = installPopoverShim();
 * // Drive overlay elements through their methods — NOT by clicking the trigger.
 * menu.show();
 * await menu.updateComplete;
 * ```
 */
export function installPopoverShim(options: PopoverShimOptions = {}): PopoverShimHandle {
  const doc = globalThis.document as Document | undefined;
  const win = globalThis as unknown as { Element?: typeof Element; HTMLElement?: typeof HTMLElement };
  if (!doc || !win.Element || !win.HTMLElement) {
    throw new Error(
      'installPopoverShim() needs a DOM. Run it under a vitest `environment` of ' +
        '`happy-dom` or `jsdom`, not `node`.',
    );
  }

  const slottedClicksReachSlots = probeSlottedClickReachesSlot(doc);
  if (!slottedClicksReachSlots && !options.quiet) {
    // Loud on purpose. The popover half being fixed is what makes this the
    // remaining reason a test "does nothing", and a silent no-op click is a far
    // worse diagnostic than a throw.
    console.warn(
      '[civitai] popover shim installed, but THIS DOM DOES NOT DELIVER CLICKS ON SLOTTED ' +
        'CONTENT TO LISTENERS ON THE <slot> (measured on install; happy-dom 20.x behaves this ' +
        'way). Clicking a component\'s trigger will do nothing at all — no throw, no state ' +
        'change. Drive overlay elements through their methods instead: `menu.show()` / ' +
        '`menu.hide()`. See @civitai/blocks-react README § "Testing overlay elements".',
    );
  }

  const proto = win.HTMLElement.prototype as unknown as ShimTarget;
  const already = typeof proto.showPopover === 'function';
  if (already) {
    return { installed: false, slottedClicksReachSlots, uninstall: () => {} };
  }

  const shown = new WeakSet<Element>();

  const fireToggle = (el: Element, from: 'open' | 'closed', to: 'open' | 'closed'): void => {
    queueMicrotask(() => {
      // `ToggleEvent` is undefined in both jsdom and happy-dom, so the two state
      // fields are attached to a plain Event. Consumers read `event.newState`,
      // which is what `<civitai-menu>`'s own handler does.
      const event = new Event('toggle', { bubbles: false, cancelable: false }) as Event & {
        oldState: string;
        newState: string;
      };
      event.oldState = from;
      event.newState = to;
      el.dispatchEvent(event);
    });
  };

  function assertPopover(el: Element): void {
    if (!el.hasAttribute('popover')) {
      throw new Error(
        'InvalidStateError: showPopover/hidePopover called on an element without a `popover` attribute',
      );
    }
  }

  proto.showPopover = function showPopover(this: Element): void {
    assertPopover(this);
    if (shown.has(this)) throw new Error('InvalidStateError: popover is already showing');
    shown.add(this);
    this.setAttribute(SHOWN_ATTR, '');
    fireToggle(this, 'closed', 'open');
  };

  proto.hidePopover = function hidePopover(this: Element): void {
    assertPopover(this);
    if (!shown.has(this)) throw new Error('InvalidStateError: popover is not showing');
    shown.delete(this);
    this.removeAttribute(SHOWN_ATTR);
    fireToggle(this, 'open', 'closed');
  };

  proto.togglePopover = function togglePopover(this: Element, force?: boolean): boolean {
    const want = force ?? !shown.has(this);
    if (want && !shown.has(this)) (this as unknown as ShimTarget).showPopover!();
    else if (!want && shown.has(this)) (this as unknown as ShimTarget).hidePopover!();
    return shown.has(this);
  };

  // `:popover-open` is a SELECTOR, so it cannot be shimmed by adding a method —
  // it has to be rewritten before the engine sees it. `matches` is the entry
  // point the pseudo-class is reached through in practice; the marker attribute
  // the two methods above maintain is what it rewrites to, which makes
  // `:not(:popover-open)` work for free.
  const nativeMatches = win.Element.prototype.matches;
  const POPOVER_OPEN = /:popover-open\b/g;
  win.Element.prototype.matches = function matches(this: Element, selector: string): boolean {
    return nativeMatches.call(this, selector.replace(POPOVER_OPEN, `[${SHOWN_ATTR}]`));
  };

  return {
    installed: true,
    slottedClicksReachSlots,
    uninstall(): void {
      delete proto.showPopover;
      delete proto.hidePopover;
      delete proto.togglePopover;
      win.Element!.prototype.matches = nativeMatches;
    },
  };
}
