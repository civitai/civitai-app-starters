import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { chatConfig, configureChat } from '../config.js';
import { defineElements } from './define.js';

/**
 * Real layout in Chromium: jsdom does none, so a jsdom version of this would pass whatever the CSS says.
 *
 * The bug: the message box's row of controls (add a file, the model picker, the keyboard hint, the
 * voice language, the microphone, Send) never got narrower than its contents, about 298px, because
 * the hint (hidden, but still taking its width) could not shrink. In a narrow chat the row ran past
 * the right edge of the message box and Send landed partly or wholly outside it.
 *
 * The chat as wide as the viewport, and the chat as a page embedded it on a phone: inset about 17px
 * a side, where Send was measured 17px outside the box at a 360px viewport and 57px at 320px.
 */
const LONG_MODEL = 'some-provider/an-unusually-long-model-name-for-this-chat-v2';
type Case = { viewport: number; chat: number; label: string; model?: string };
const CASES: Case[] = [
  { viewport: 360, chat: 360, label: 'Default' },
  { viewport: 360, chat: 326, label: 'Default' },
  { viewport: 320, chat: 320, label: 'Default' },
  { viewport: 320, chat: 286, label: 'Default' },
  // A model name wider than the room left: the picker gives way, by truncating, rather than Send.
  { viewport: 320, chat: 286, label: 'a long name', model: LONG_MODEL },
];

const PAGE_MODEL = chatConfig.model;

beforeAll(() => defineElements());
afterEach(() => {
  configureChat({ model: PAGE_MODEL });
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountSignedIn(width: number, model?: string): Promise<ShadowRoot> {
  if (model) configureChat({ model });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const app = {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn() },
  };
  const frame = document.createElement('div');
  frame.style.cssText = `width:${width}px;height:600px;`;
  const chat = document.createElement('civitai-chat');
  chat.app = app as never;
  frame.append(chat);
  document.body.append(frame);
  const root = chat.shadowRoot!;
  // Signed in, the message box carries the model picker beside the add-file button.
  await vi.waitFor(() => expect(root.querySelector('civitai-chat-composer .cvt-model-chip')).not.toBeNull(), { timeout: 15_000 });
  return root;
}

const rect = (element: Element) => element.getBoundingClientRect();
const inside = (inner: DOMRect, outer: DOMRect) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5;

describe('the message box at phone width', () => {
  it.each(CASES)('keeps Send, the model picker and every button inside the message box: $chat px chat, $viewport px viewport, model $label', async ({ viewport, chat: width, model }) => {
    await page.viewport(viewport, 700);
    const root = await mountSignedIn(width, model);
    const composer = root.querySelector('civitai-chat-composer')!;
    const box = composer.querySelector('.cvt-composer-box')!;
    const actions = composer.querySelector<HTMLElement>('.cvt-composer-actions')!;
    const send = composer.querySelector<HTMLElement>('.cvt-send')!;
    const chip = composer.querySelector<HTMLElement>('.cvt-model-chip')!;
    const buttons = [...actions.querySelectorAll<HTMLElement>('.cvt-icon-button, .cvt-voice-language, .cvt-send')];
    const main = root.querySelector<HTMLElement>('.cvt-main')!;

    const report = JSON.stringify({
      box: [rect(box).left, rect(box).right],
      actions: [actions.scrollWidth, actions.clientWidth, actions.clientHeight],
      send: [rect(send).left, rect(send).right],
      chip: [rect(chip).left, rect(chip).right, chip.textContent?.trim()],
      buttons: buttons.map((button) => [button.getAttribute('aria-label') ?? button.className, Math.round(rect(button).width)]),
      main: [main.scrollWidth, main.clientWidth],
    });

    expect(Math.round(rect(root.host).width)).toBe(width);
    expect(inside(rect(send), rect(box)), `Send outside the message box: ${report}`).toBe(true);
    expect(inside(rect(chip), rect(box)), `model picker outside the message box: ${report}`).toBe(true);
    for (const button of buttons) {
      expect(inside(rect(button), rect(box)), `${button.getAttribute('aria-label')} outside the message box: ${report}`).toBe(true);
      // Still a full-size target: the fix may not squeeze the buttons to make room.
      expect(rect(button).width, `${button.getAttribute('aria-label')} squeezed: ${report}`).toBeGreaterThanOrEqual(31.5);
    }
    expect(actions.scrollWidth, `the row of controls overflows: ${report}`).toBeLessThanOrEqual(actions.clientWidth);
    // One line: nothing in the row (the hidden hint included) wraps to make it taller than its buttons.
    expect(actions.clientHeight, `the row of controls wraps: ${report}`).toBeLessThanOrEqual(34);
    expect(main.scrollWidth, `the chat scrolls sideways: ${report}`).toBeLessThanOrEqual(main.clientWidth);
    expect(document.documentElement.scrollWidth, `the page scrolls sideways: ${report}`).toBeLessThanOrEqual(viewport);
    if (model) {
      const name = chip.querySelector<HTMLElement>('.cvt-model-chip-name')!;
      expect(chip.title).toBe(`Model for this chat: ${model}`);
      expect(name.scrollWidth, `the long model name is not truncated: ${report}`).toBeGreaterThan(name.clientWidth);
    }
  });
});
