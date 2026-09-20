/**
 * civitai-button behaviour that does NOT need a real browser.
 *
 * `color` is the prop `@civitai/components-react`'s Button drops entirely
 * (it `Omit`s `color` from the HTML attributes and never adds it back), while
 * `@civitai/blocks-react/ui`'s has it — so an app that switches imports loses
 * every semantic accent silently. It is pinned here.
 *
 * Activation semantics (Enter on keydown, Space on keyup, disabled swallowing
 * the click) live here too because a custom element gets NONE of them for free:
 * `<civitai-button>` is not a `<button>`, so `:disabled`, the tab order and
 * keyboard activation are all hand-written and all regressible.
 */
import { afterEach, describe, expect, it } from 'vitest';

import '../src/button.js';
import type { CivitaiButton } from '../src/button.js';

afterEach(() => {
  document.body.innerHTML = '';
});

async function button(attrs = '', inner = 'Generate'): Promise<CivitaiButton> {
  const host = document.createElement('div');
  host.innerHTML = `<civitai-button ${attrs}>${inner}</civitai-button>`;
  document.body.appendChild(host);
  const el = host.firstElementChild as CivitaiButton;
  await el.updateComplete;
  return el;
}

describe('civitai-button', () => {
  it('reflects the documented defaults', async () => {
    const el = await button();
    expect(el.getAttribute('variant')).toBe('filled');
    expect(el.getAttribute('size')).toBe('md');
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.type).toBe('button');
  });

  it('maps a semantic color onto the accent custom property', async () => {
    const el = await button('color="error"');
    expect(el.style.getPropertyValue('--civitai-color-primary')).toBe('var(--civitai-color-error)');
    expect(el.style.getPropertyValue('--civitai-color-primary-hover')).toBe(
      'var(--civitai-color-error)'
    );
  });

  it('passes an arbitrary CSS color straight through', async () => {
    const el = await button();
    el.color = '#ff0088';
    await el.updateComplete;
    expect(el.style.getPropertyValue('--civitai-color-primary')).toBe('#ff0088');
  });

  it('color="primary" sets NO override', async () => {
    const el = await button('color="primary"');
    expect(el.style.getPropertyValue('--civitai-color-primary')).toBe('');
  });

  it('clears the override when color returns to primary', async () => {
    const el = await button('color="success"');
    expect(el.style.getPropertyValue('--civitai-color-primary')).not.toBe('');
    el.color = 'primary';
    await el.updateComplete;
    expect(el.style.getPropertyValue('--civitai-color-primary')).toBe('');
  });

  it('loading sets aria-busy and leaves the tab order', async () => {
    const el = await button();
    el.loading = true;
    await el.updateComplete;
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.getAttribute('tabindex')).toBe('-1');
  });

  it('disabled swallows a click before any consumer listener', async () => {
    const el = await button('disabled');
    let fired = 0;
    el.addEventListener('click', () => (fired += 1));
    el.click();
    expect(fired).toBe(0);
  });

  it('loading swallows a click too', async () => {
    const el = await button();
    let fired = 0;
    el.addEventListener('click', () => (fired += 1));
    el.loading = true;
    await el.updateComplete;
    el.click();
    expect(fired).toBe(0);

    el.loading = false;
    await el.updateComplete;
    el.click();
    expect(fired).toBe(1);
  });

  it('Enter activates on keydown and Space on keyup, like a native button', async () => {
    const el = await button();
    const seen: string[] = [];
    el.addEventListener('click', () => seen.push('click'));

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(seen).toEqual(['click']);

    // Space must NOT activate on keydown (it would double-fire with keyup).
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(seen).toEqual(['click']);

    el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    expect(seen).toEqual(['click', 'click']);
  });

  it('a disabled button is not keyboard-activatable either', async () => {
    const el = await button('disabled');
    let fired = 0;
    el.addEventListener('click', () => (fired += 1));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    expect(fired).toBe(0);
  });

  it('keeps the data-civitai-ui back-compat hook', async () => {
    const el = await button();
    expect(el.getAttribute('data-civitai-ui')).toBe('button');
  });

  it('does not clobber an author-supplied role', async () => {
    const el = await button('role="menuitem"');
    expect(el.getAttribute('role')).toBe('menuitem');
  });
});
