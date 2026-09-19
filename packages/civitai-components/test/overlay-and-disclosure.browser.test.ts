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
    el.addEventListener('close', () => void (closes += 1));

    el.shadowRoot!.querySelector<HTMLButtonElement>('[part="close"]')!.click();
    await el.updateComplete;
    await tick();
    expect(el.open).toBe(false);
    expect(dialogOf(el).open).toBe(false);
    expect(closes).toBe(1);
  });

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
    await userEvent.keyboard('{Escape}');
    await el.updateComplete;
    await tick();
    expect(el.open).toBe(false);
  });

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
