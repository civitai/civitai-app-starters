import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { completion, memoryStore, textReply, urlOf } from '../test-support/fake-backend.js';
import { defineElements } from './define.js';

/**
 * The edit box of the latest message, laid out in Chromium (jsdom does no layout): at phone width it
 * fits the chat with its Cancel and Save, and nothing scrolls sideways; in a wide chat it is no wider
 * than a message bubble may be.
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MESSAGE = 'Write a packing list for a three-day hike along the coast, with a tent, a stove and enough water for two people';

async function mountWithEditor(width: number): Promise<ShadowRoot> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!urlOf(input).includes('/v1/chat/completions')) return new Response('not here', { status: 404 });
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      return body.stream ? textReply('Here is ', 'your list.') : completion('Packing');
    }),
  );
  const frame = document.createElement('div');
  frame.style.cssText = `width:${width}px;height:640px;`;
  const chat = document.createElement('civitai-chat');
  chat.backend = { url: '/api/llm', model: 'host/default-model', store: memoryStore() };
  frame.append(chat);
  document.body.append(frame);
  const root = chat.shadowRoot!;
  await vi.waitFor(() => expect(chat.canSend).toBe(true), { timeout: 15_000 });
  await chat.send(MESSAGE);
  await vi.waitFor(() => expect(root.querySelector('.cvt-edit-button')).not.toBeNull());
  root.querySelector<HTMLButtonElement>('.cvt-edit-button')!.click();
  await vi.waitFor(() => expect(root.querySelector('.cvt-user-editor textarea')).not.toBeNull());
  return root;
}

const rect = (element: Element) => element.getBoundingClientRect();
const inside = (inner: DOMRect, outer: DOMRect) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5;

describe('the edit box', () => {
  it.each([320, 360])('fits a %ipx chat with Cancel and Save, and nothing scrolls sideways', async (width) => {
    await page.viewport(width, 700);
    const root = await mountWithEditor(width);
    const turn = root.querySelector('civitai-chat-turn')!;
    const box = root.querySelector('.cvt-user-editor')!;
    const area = box.querySelector('textarea')!;
    const save = box.querySelector('.cvt-edit-save')!;
    const cancel = box.querySelector('.cvt-edit-cancel')!;
    const scroller = root.querySelector<HTMLElement>('.cvt-thread-scroll')!;
    const report = JSON.stringify({ turn: [rect(turn).left, rect(turn).right], box: [rect(box).left, rect(box).right], save: [rect(save).left, rect(save).right], cancel: [rect(cancel).left, rect(cancel).right], scroller: [scroller.scrollWidth, scroller.clientWidth] });

    expect(inside(rect(box), rect(turn)), `the edit box is wider than the chat: ${report}`).toBe(true);
    expect(inside(rect(area), rect(box)), `the text runs out of the box: ${report}`).toBe(true);
    expect(inside(rect(save), rect(box)), `Save outside the box: ${report}`).toBe(true);
    expect(inside(rect(cancel), rect(box)), `Cancel outside the box: ${report}`).toBe(true);
    expect(rect(save).height, `Save is too small to tap: ${report}`).toBeGreaterThanOrEqual(24);
    expect(area.value).toBe(MESSAGE);
    expect(scroller.scrollWidth, `the chat scrolls sideways: ${report}`).toBeLessThanOrEqual(scroller.clientWidth);
    expect(document.documentElement.scrollWidth, `the page scrolls sideways: ${report}`).toBeLessThanOrEqual(width);
  });

  it('is no wider than a message bubble may be in a wide chat', async () => {
    await page.viewport(1200, 800);
    const root = await mountWithEditor(1100);
    expect(rect(root.querySelector('.cvt-user-editor')!).width).toBeLessThanOrEqual(600.5);
  });
});
