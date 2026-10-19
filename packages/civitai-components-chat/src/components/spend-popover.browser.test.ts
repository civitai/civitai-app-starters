import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { chatStyles } from './chat.styles.js';
import type { CivitaiChatSpend } from './civitai-chat-spend.js';
import { defineElements } from './define.js';

/**
 * The Buzz badge in the top bar opens its breakdown on a click or a key, in a real browser: focus,
 * Escape, a click elsewhere and the size of the touch target need real input and real layout.
 * The badge used to carry the breakdown only in a hover `title`, which a phone never shows.
 */

// Pairwise distinct, and none equal to another's sum but the total's: a swapped or dropped figure shows.
const SPEND = { total: 1_237, generations: 1_200, assistant: 37 };

beforeAll(() => defineElements());
afterEach(() => document.body.replaceChildren());

/** The badge in a top bar, in a shadow root carrying the chat's own stylesheet, at phone width. */
async function mount(spend = SPEND) {
  await page.viewport(375, 700);
  const host = document.createElement('div');
  host.style.cssText = 'width:375px;height:600px;';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [chatStyles.styleSheet!];
  const bar = document.createElement('header');
  bar.className = 'cvt-topbar';
  bar.innerHTML = '<h1 class="cvt-title"><span class="cvt-title-text">A chat</span></h1>';
  const badge = document.createElement('civitai-chat-spend') as CivitaiChatSpend;
  badge.spend = spend;
  bar.append(badge);
  const elsewhere = document.createElement('p');
  elsewhere.textContent = 'Somewhere else in the chat';
  // Below where the open breakdown reaches, so a click lands on it and not on the breakdown.
  elsewhere.style.marginTop = '320px';
  root.append(bar, elsewhere);
  await badge.updateComplete;
  const button = () => badge.querySelector<HTMLButtonElement>('.cvt-spend');
  const panel = () => badge.querySelector<HTMLElement>('.cvt-spend-panel');
  const shown = () => {
    const el = panel();
    return el !== null && !el.hidden && el.getBoundingClientRect().height > 0;
  };
  const figures = () => Object.fromEntries([...badge.querySelectorAll<HTMLElement>('[data-spend]')].map((dd) => [dd.dataset.spend, dd.textContent!.trim()]));
  return { host, root, badge, button, panel, shown, figures, elsewhere };
}

describe('the Buzz badge', () => {
  it('opens the breakdown on a click, with the three figures and what they are', async () => {
    const { button, panel, shown, figures, badge } = await mount();
    const target = button()!;
    expect(target.getAttribute('aria-expanded')).toBe('false');
    expect(target.getAttribute('aria-controls')).toBe(panel()!.id);
    expect(shown()).toBe(false);

    await userEvent.click(target);
    await badge.updateComplete;
    expect(target.getAttribute('aria-expanded')).toBe('true');
    expect(shown()).toBe(true);
    expect(figures()).toEqual({ total: '≈ 1,237', generations: '1,200', assistant: '37' });
    const text = panel()!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('For what was made');
    expect(text).toContain('For the assistant');
    expect(text).toContain('An estimate of the Buzz spent in this chat');

    // A second click closes it.
    await userEvent.click(target);
    await badge.updateComplete;
    expect(shown()).toBe(false);
    expect(target.getAttribute('aria-expanded')).toBe('false');
  });

  it.each(['{Enter}', ' '])('opens from the keyboard (%s), and Escape closes it and puts focus back on the badge', async (key) => {
    const { button, shown, badge } = await mount();
    const target = button()!;
    target.focus();
    await userEvent.keyboard(key);
    await badge.updateComplete;
    expect(shown()).toBe(true);
    // Focus is moved off the badge, as it is when a viewer selects text in the breakdown.
    target.blur();
    await userEvent.keyboard('{Escape}');
    await badge.updateComplete;
    expect(shown()).toBe(false);
    expect(target.getAttribute('aria-expanded')).toBe('false');
    expect((badge.getRootNode() as ShadowRoot).activeElement).toBe(target);
  });

  it('closes on a click anywhere else, but not on a click inside the breakdown', async () => {
    const { button, panel, shown, badge, elsewhere } = await mount();
    await userEvent.click(button()!);
    await badge.updateComplete;
    await userEvent.click(panel()!.querySelector('.cvt-spend-note')!);
    await badge.updateComplete;
    expect(shown()).toBe(true);
    await userEvent.click(elsewhere);
    await badge.updateComplete;
    expect(shown()).toBe(false);
    expect(button()!.getAttribute('aria-expanded')).toBe('false');
  });

  it('is a touch target of at least 44px, and the open breakdown stays inside a phone-width chat', async () => {
    const { button, panel, badge, host } = await mount();
    const rect = button()!.getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
    await userEvent.click(button()!);
    await badge.updateComplete;
    const box = panel()!.getBoundingClientRect();
    const chat = host.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(chat.left);
    expect(box.right).toBeLessThanOrEqual(chat.right);
  });

  it('shows nothing when nothing has been spent', async () => {
    const { button, panel } = await mount({ total: 0, generations: 0, assistant: 0 });
    expect(button()).toBeNull();
    expect(panel()).toBeNull();
  });
});
