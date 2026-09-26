import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import { deepActiveElement } from '../src/elements/internals.js';
import type { CivitaiCollapse } from '../src/elements/civitai-collapse.js';
import type { CivitaiModal } from '../src/elements/civitai-modal.js';
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
      .filter((el): el is HTMLElement & { updateComplete: Promise<boolean> } => 'updateComplete' in el)
      .map((el) => el.updateComplete)
  );
  return scope;
}

/** The dialog's native `close` event is queued as a task, not a microtask. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const EVENT_TIMEOUT_MS = 2000;

/**
 * Per-test timeout for the tests that use {@link eventFired}, DERIVED from its
 * own timeout rather than inherited.
 *
 * 🔴 The helper only "names its own failure instead of arriving as a bare suite
 * timeout" while its 2 s reject beats the test timeout. That relationship was
 * unstated and unpinned: `vitest.config.ts` sets no `testTimeout`, so it rested
 * on vitest's 5 s default, and anyone trimming a slow CI tier to
 * `testTimeout: 1500` would silently turn every one of these back into the bare
 * timeout the helper exists to prevent. Passing this explicitly makes a global
 * change unable to reach them.
 */
const EVENT_TEST_TIMEOUT_MS = EVENT_TIMEOUT_MS * 2.5;

/**
 * Await an event instead of a fixed number of task turns. Use this, not
 * {@link tick}, whenever the assertion is ABOUT an event: the native `close` is
 * queued as a task, so a `tick()` races it rather than waiting for it.
 *
 * 🔴 When this races, `open === false` still passes — the click handler sets
 * the property on an earlier path — so only the event count reads 0. That reads
 * as "the event never fired" when the truth is "the test measured too early".
 *
 * Rejects rather than hanging, so a real regression names itself instead of
 * arriving as a bare suite timeout. Create it as late as possible and await it
 * immediately: a throw between creation and `await` orphans the rejection,
 * which vitest then attributes to whichever test is running 2 s later.
 */
function eventFired(target: EventTarget, type: string): Promise<Event> {
  return new Promise((resolve, reject) => {
    const onEvent = (event: Event): void => {
      clearTimeout(timer);
      target.removeEventListener(type, onEvent);
      resolve(event);
    };
    const timer = setTimeout(() => {
      target.removeEventListener(type, onEvent);
      reject(new Error(`no "${type}" event after ${EVENT_TIMEOUT_MS}ms`));
    }, EVENT_TIMEOUT_MS);
    target.addEventListener(type, onEvent);
  });
}

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-modal>', () => {
  const dialogOf = (el: CivitaiModal): HTMLDialogElement =>
    el.shadowRoot!.querySelector('dialog')!;

  async function open(attrs = ''): Promise<CivitaiModal> {
    await mount(`<civitai-modal heading="Confirm" ${attrs}><p>Costs Buzz.</p></civitai-modal>`);
    const el = scope!.querySelector<CivitaiModal>('civitai-modal')!;
    el.open = true;
    await el.updateComplete;
    return el;
  }

  it('opens as a REAL modal, so the platform traps focus for us', async () => {
    const el = await open();
    const dialog = dialogOf(el);
    expect(dialog.open).toBe(true);
    // `:modal` is true only for showModal(), which is what brings the trap.
    expect(dialog.matches(':modal')).toBe(true);
  });

  it('opens and closes through show, hide and toggle as well as the property', async () => {
    await mount('<civitai-modal heading="Confirm">body</civitai-modal>');
    const el = scope!.querySelector<CivitaiModal>('civitai-modal')!;
    await el.updateComplete;

    el.show();
    await el.updateComplete;
    expect(dialogOf(el).open).toBe(true);

    el.hide();
    await el.updateComplete;
    expect(dialogOf(el).open).toBe(false);

    el.toggle();
    await el.updateComplete;
    expect(dialogOf(el).open).toBe(true);
  });

  it('renders nothing visible until opened', async () => {
    await mount('<civitai-modal heading="Confirm">body</civitai-modal>');
    const el = scope!.querySelector<CivitaiModal>('civitai-modal')!;
    expect(dialogOf(el).open).toBe(false);
  });

  it('moves focus into the dialog and restores it on close', async () => {
    await mount(
      '<button id="opener">Open</button><civitai-modal heading="Confirm">body</civitai-modal>'
    );
    const opener = scope!.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();
    expect(deepActiveElement()).toBe(opener);

    const el = scope!.querySelector<CivitaiModal>('civitai-modal')!;
    el.open = true;
    await el.updateComplete;
    expect(dialogOf(el).contains(deepActiveElement())).toBe(true);

    el.open = false;
    await el.updateComplete;
    expect(deepActiveElement()).toBe(opener);
  });

  it('labels the dialog from its heading', async () => {
    const el = await open();
    const dialog = dialogOf(el);
    const titleId = dialog.getAttribute('aria-labelledby')!;
    expect(el.shadowRoot!.getElementById(titleId)!.textContent?.trim()).toBe('Confirm');
  });

  it('the close button closes it and announces close once', async () => {
    const el = await open();
    let closes = 0;
    // Registered BEFORE `eventFired`'s listener, so `closes` is already
    // incremented by the time the await below resolves.
    el.addEventListener('close', () => void (closes += 1));

    // Resolve the button FIRST: nothing may throw between creating the promise
    // and awaiting it, or the rejection is orphaned and lands 2 s later on an
    // unrelated test. The `!` here is the only throw site, so it goes above.
    const closeButton = el.shadowRoot!.querySelector<HTMLButtonElement>('[part="close"]')!;
    const closed = eventFired(el, 'close');
    closeButton.click();
    await closed;

    // The `once` half needs a budget in which a DUPLICATE could still arrive;
    // awaiting the event only pins the lower bound. This tick is now spent
    // entirely on that, instead of also having to cover the first event.
    //
    // ⚠ THAT BUDGET IS EXACTLY ONE TASK TURN — measured, not assumed. A second
    // `close` dispatched synchronously, one `setTimeout(0)` later, or on the
    // next frame is caught; one dispatched TWO nested timeouts later is NOT.
    // "Strictly stronger than before" is a claim about the OLD form, which
    // missed even the one-task-later case; it is not a claim of unbounded
    // duplicate detection.
    await tick();
    expect(el.open).toBe(false);
    expect(dialogOf(el).open).toBe(false);
    expect(closes).toBe(1);
  }, EVENT_TEST_TIMEOUT_MS);

  it('a click on the backdrop closes it; a click in the panel does not', async () => {
    const el = await open();
    el.shadowRoot!.querySelector<HTMLElement>('[part="panel"]')!.click();
    await el.updateComplete;
    expect(el.open).toBe(true);

    dialogOf(el).click();
    await el.updateComplete;
    expect(el.open).toBe(false);
  });

  it('honours close-on-overlay-click="false"', async () => {
    await mount(
      '<civitai-modal heading="C" close-on-overlay-click="false">b</civitai-modal>'
    );
    const el = scope!.querySelector<CivitaiModal>('civitai-modal')!;
    el.closeOnOverlayClick = false;
    el.open = true;
    await el.updateComplete;

    dialogOf(el).click();
    await el.updateComplete;
    expect(el.open).toBe(true);
  });

  it('Escape closes by default', async () => {
    // A real key press: a synthetic `cancel` has no default action, so
    // dispatching one proves nothing about what Escape actually does.
    const el = await open();
    // Same race as the close-button test: `el.open` only flips once the native
    // close TASK reaches `#onClose`, so a `tick()` races it rather than waiting
    // for it. Await the event — the property is already final when it fires.
    const closed = eventFired(el, 'close');
    // 🔴 Here the listener MUST precede the keypress, so the orphan window the
    // helper's doc warns about is unavoidable rather than removable: if
    // `userEvent.keyboard` rejects, nothing has awaited `closed` yet and its
    // rejection surfaces 2 s later against an unrelated test. Marking it
    // handled costs nothing and does not weaken the `await` below, which still
    // throws the timeout error on the real failing path.
    void closed.catch(() => {});
    await userEvent.keyboard('{Escape}');
    await closed;
    expect(el.open).toBe(false);
  }, EVENT_TEST_TIMEOUT_MS);

  it('Escape is refused when turned off', async () => {
    const el = await open();
    el.closeOnEscape = false;
    await el.updateComplete;

    await userEvent.keyboard('{Escape}');
    await el.updateComplete;
    await tick();
    expect(el.open).toBe(true);
    expect(dialogOf(el).open).toBe(true);
  });

  it('hides the close button when asked', async () => {
    const el = await open();
    expect(el.shadowRoot!.querySelector('[part="close"]')).not.toBeNull();
    el.withCloseButton = false;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[part="close"]')).toBeNull();
  });
});

describe('<civitai-collapse>', () => {
  const trigger = (el: CivitaiCollapse): HTMLButtonElement =>
    el.shadowRoot!.querySelector('button')!;
  const region = (el: CivitaiCollapse): HTMLElement =>
    el.shadowRoot!.querySelector('[part="region"]')!;

  it('starts closed with its region out of the tree', async () => {
    await mount('<civitai-collapse heading="Advanced">body</civitai-collapse>');
    const el = scope!.querySelector<CivitaiCollapse>('civitai-collapse')!;
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false');
    expect(region(el).hidden).toBe(true);
  });

  it('the trigger toggles it and announces toggle', async () => {
    await mount('<civitai-collapse heading="Advanced">body</civitai-collapse>');
    const el = scope!.querySelector<CivitaiCollapse>('civitai-collapse')!;
    let toggles = 0;
    el.addEventListener('toggle', () => void (toggles += 1));

    trigger(el).click();
    await el.updateComplete;
    expect(el.open).toBe(true);
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true');
    expect(region(el).hidden).toBe(false);

    trigger(el).click();
    await el.updateComplete;
    expect(el.open).toBe(false);
    expect(toggles).toBe(2);
  });

  it('wires the trigger to the region both ways', async () => {
    await mount('<civitai-collapse heading="Advanced" open>body</civitai-collapse>');
    const el = scope!.querySelector<CivitaiCollapse>('civitai-collapse')!;
    expect(trigger(el).getAttribute('aria-controls')).toBe(region(el).id);
    expect(region(el).getAttribute('aria-labelledby')).toBe(trigger(el).id);
    expect(region(el).getAttribute('role')).toBe('region');
  });

  it('a disabled trigger does nothing', async () => {
    await mount('<civitai-collapse heading="Advanced" disabled>body</civitai-collapse>');
    const el = scope!.querySelector<CivitaiCollapse>('civitai-collapse')!;
    expect(trigger(el).disabled).toBe(true);
    trigger(el).click();
    await el.updateComplete;
    expect(el.open).toBe(false);
  });
});
