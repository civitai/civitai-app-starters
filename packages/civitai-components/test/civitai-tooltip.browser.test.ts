import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import type { CivitaiTooltip } from '../src/elements/civitai-tooltip.js';
import '../src/elements/register.js';

let scope: HTMLElement | undefined;

function mount(markup: string): CivitaiTooltip {
  scope?.remove();
  scope = document.createElement('div');
  scope.setAttribute('data-theme', 'light');
  scope.innerHTML = markup;
  document.body.append(scope);
  return scope.querySelector<CivitaiTooltip>('civitai-tooltip')!;
}

const bubbleOf = (el: CivitaiTooltip): HTMLElement =>
  el.querySelector('[data-tooltip-bubble]')!;

afterEach(() => {
  scope?.remove();
  scope = undefined;
});

describe('<civitai-tooltip>', () => {
  it('describes its trigger, which a shadow root could never do', () => {
    const el = mount('<civitai-tooltip label="Spends Buzz"><button>Go</button></civitai-tooltip>');
    const trigger = el.querySelector('button')!;
    const bubble = bubbleOf(el);

    expect(bubble.getAttribute('role')).toBe('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(bubble.id);
    // The IDREF has to resolve from the trigger's own root to be real.
    expect(trigger.getRootNode()).toBe(document);
    expect((trigger.getRootNode() as Document).getElementById(bubble.id)).toBe(bubble);
  });

  it('renders no shadow root at all', () => {
    const el = mount('<civitai-tooltip label="x"><button>Go</button></civitai-tooltip>');
    expect(el.shadowRoot).toBeNull();
  });

  it('joins an existing aria-describedby rather than replacing it', () => {
    const el = mount(
      '<span id="hint">more</span>' +
        '<civitai-tooltip label="Tip"><button aria-describedby="hint">Go</button></civitai-tooltip>'
    );
    const ids = el.querySelector('button')!.getAttribute('aria-describedby')!.split(' ');
    expect(ids).toContain('hint');
    expect(ids).toContain(bubbleOf(el).id);
  });

  it('is hidden until hovered, focused or forced open', async () => {
    const el = mount('<civitai-tooltip label="Tip"><button>Go</button></civitai-tooltip>');
    const bubble = bubbleOf(el);
    expect(getComputedStyle(bubble).visibility).toBe('hidden');

    el.open = true;
    expect(getComputedStyle(bubble).visibility).toBe('visible');

    el.open = false;
    el.querySelector('button')!.focus();
    expect(getComputedStyle(bubble).visibility).toBe('visible');
  });

  it('Escape hides it even while focus is still inside', async () => {
    const el = mount('<civitai-tooltip label="Tip"><button>Go</button></civitai-tooltip>');
    const trigger = el.querySelector('button')!;
    const bubble = bubbleOf(el);

    trigger.focus();
    expect(getComputedStyle(bubble).visibility).toBe('visible');

    await userEvent.keyboard('{Escape}');
    expect(bubble.hasAttribute('data-dismissed')).toBe(true);
    // Focus has NOT moved — the CSS reveal is gated on the flag, not on focus.
    expect(document.activeElement).toBe(trigger);
    expect(getComputedStyle(bubble).visibility).toBe('hidden');
  });

  it('re-opens on the next focus after a dismissal', async () => {
    const el = mount(
      '<civitai-tooltip label="Tip"><button>Go</button></civitai-tooltip><button id="away">away</button>'
    );
    const trigger = el.querySelector('button')!;
    trigger.focus();
    await userEvent.keyboard('{Escape}');
    expect(getComputedStyle(bubbleOf(el)).visibility).toBe('hidden');

    scope!.querySelector<HTMLButtonElement>('#away')!.focus();
    trigger.focus();
    expect(bubbleOf(el).hasAttribute('data-dismissed')).toBe(false);
    expect(getComputedStyle(bubbleOf(el)).visibility).toBe('visible');
  });

  it('follows a label change', () => {
    const el = mount('<civitai-tooltip label="First"><button>Go</button></civitai-tooltip>');
    expect(bubbleOf(el).textContent).toBe('First');
    el.label = 'Second';
    expect(bubbleOf(el).textContent).toBe('Second');
  });
});
