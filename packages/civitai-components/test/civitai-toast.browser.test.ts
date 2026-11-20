import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CivitaiToastRegion } from '../src/elements/civitai-toast-region.js';
import type { CivitaiToast } from '../src/elements/civitai-toast.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

function mount(markup = '<civitai-toast-region></civitai-toast-region>'): HTMLElement {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = markup;
  document.body.append(scope);
  return scope;
}

const regionOf = (): CivitaiToastRegion =>
  scope!.querySelector<CivitaiToastRegion>('civitai-toast-region')!;

afterEach(() => {
  vi.useRealTimers();
  scope?.remove();
  scope = undefined;
});

describe('<civitai-toast-region>', () => {
  it('is a polite live region with an accessible name', () => {
    mount();
    const region = regionOf();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('Notifications');
  });

  it('puts toasts in its OWN children, which is what a live region announces', async () => {
    mount();
    const region = regionOf();
    region.show({ message: 'Saved' });

    const [toast] = region.toasts;
    expect(toast).toBeDefined();
    // Shadow content would not be a node ADDED to the live region.
    expect(toast!.parentElement).toBe(region);
    expect(toast!.getRootNode()).toBe(document);
    await toast!.updateComplete;
    expect(toast!.textContent).toContain('Saved');
  });

  it('announces politely by default and assertively when urgent', () => {
    mount();
    const region = regionOf();
    region.show({ message: 'Saved' });
    region.show({ message: 'Failed', urgent: true });

    const [polite, urgent] = region.toasts;
    expect(polite!.getAttribute('role')).toBe('status');
    expect(urgent!.getAttribute('role')).toBe('alert');
  });

  it('auto-dismisses after the duration', () => {
    vi.useFakeTimers();
    mount();
    const region = regionOf();
    region.show({ message: 'Saved', duration: 100 });
    expect(region.toasts).toHaveLength(1);

    vi.advanceTimersByTime(99);
    expect(region.toasts).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(region.toasts).toHaveLength(0);
  });

  it('a duration of 0 is sticky', () => {
    vi.useFakeTimers();
    mount();
    const region = regionOf();
    region.show({ message: 'Stay', duration: 0 });

    vi.advanceTimersByTime(60_000);
    expect(region.toasts).toHaveLength(1);
  });

  it('honours default-duration', () => {
    vi.useFakeTimers();
    mount('<civitai-toast-region default-duration="200"></civitai-toast-region>');
    const region = regionOf();
    expect(region.defaultDuration).toBe(200);
    region.show({ message: 'Saved' });

    vi.advanceTimersByTime(201);
    expect(region.toasts).toHaveLength(0);
  });

  it('dismiss removes one and clear removes all', () => {
    mount();
    const region = regionOf();
    const first = region.show({ message: 'One', duration: 0 });
    region.show({ message: 'Two', duration: 0 });
    expect(region.toasts).toHaveLength(2);

    region.dismiss(first);
    expect(region.toasts).toHaveLength(1);

    region.clear();
    expect(region.toasts).toHaveLength(0);
  });

  it('the toast close button dismisses it', async () => {
    mount();
    const region = regionOf();
    region.show({ message: 'Saved', duration: 0 });
    const toast = region.toasts[0]!;
    await toast.updateComplete;

    toast.shadowRoot!.querySelector<HTMLButtonElement>('[part="close"]')!.click();
    expect(region.toasts).toHaveLength(0);
  });

  it('does not swallow clicks: the strip is inert, each toast is not', async () => {
    mount();
    const region = regionOf();
    region.show({ message: 'Saved', duration: 0 });
    const toast = region.toasts[0]!;
    await toast.updateComplete;

    // The region is a full-width fixed strip. Without this it would block every
    // click along the bottom of the page whether or not a toast is showing.
    expect(getComputedStyle(region).pointerEvents).toBe('none');
    expect(getComputedStyle(toast).pointerEvents).toBe('auto');
  });

  it('clears its timers when removed, so none fire against a detached region', () => {
    vi.useFakeTimers();
    mount();
    const region = regionOf();
    region.show({ message: 'Saved', duration: 100 });
    region.remove();

    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(region.toasts).toHaveLength(1);
  });
});

describe('<civitai-toast>', () => {
  async function toast(attrs = ''): Promise<CivitaiToast> {
    mount(`<civitai-toast ${attrs}>Body text</civitai-toast>`);
    const el = scope!.querySelector<CivitaiToast>('civitai-toast')!;
    await el.updateComplete;
    return el;
  }

  it('renders a heading above the message when given one', async () => {
    const el = await toast('heading="Saved"');
    expect(el.shadowRoot!.querySelector('[part="heading"]')!.textContent?.trim()).toBe('Saved');
  });

  it('has no close button unless closable', async () => {
    let el = await toast();
    expect(el.shadowRoot!.querySelector('[part="close"]')).toBeNull();
    el = await toast('closable');
    expect(el.shadowRoot!.querySelector('[part="close"]')).not.toBeNull();
  });

  it('falls back to the neutral border token with no colour', async () => {
    const el = await toast();
    const style = getComputedStyle(el);
    expect(style.borderLeftWidth).toBe('4px');
    expect(style.borderLeftColor).toBe(style.borderTopColor);
  });

  it.each(['info', 'success', 'warning', 'error'] as const)(
    '%s colours the left accent',
    async (color) => {
      const el = await toast(`color="${color}"`);
      const style = getComputedStyle(el);
      expect(style.borderLeftColor).not.toBe(style.borderTopColor);
    }
  );

  it('keeps the role on the host, where the live region sees it', async () => {
    const el = await toast();
    expect(el.getAttribute('role')).toBe('status');
    expect(el.shadowRoot!.querySelector('[role]')).toBeNull();
  });
});
