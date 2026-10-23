import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import type { ChatBackend } from '../backend.js';
import { completion, memoryStore, textReply, urlOf } from '../test-support/fake-backend.js';
import type { CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * The page's own content inside the chat, in real Chromium (jsdom does no layout):
 * - `slot="composer-top"`: just above the message box, e.g. a notice about what the chat is working on;
 * - `slot="thread-end"`: after the last message, inside the thread's scroll, brought into view as a
 *   new message is.
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Long enough that two replies overflow the 420px frame, so "brought into view" means something.
const REPLY = 'Here is a plan for the timer: a 25 minute focus block, a 5 minute break, and a soundscape that fades in. '.repeat(6);

function backend(): ChatBackend {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (!url.includes('/v1/chat/completions')) return new Response('not here', { status: 404 });
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      return body.stream ? textReply(REPLY, 'Done.') : completion('Timer');
    }),
  );
  return { url: '/api/llm', model: 'host/default-model', store: memoryStore() };
}

async function mount(width: number, height = 420): Promise<CivitaiChat> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const frame = document.createElement('div');
  frame.style.cssText = `width:${width}px;height:${height}px;`;
  const chat = document.createElement('civitai-chat');
  chat.backend = backend();
  frame.append(chat);
  document.body.append(frame);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 15_000 });
  return chat;
}

const root = (chat: CivitaiChat) => chat.shadowRoot!;
const turns = (chat: CivitaiChat) => [...root(chat).querySelectorAll<HTMLElement>('civitai-chat-turn')];

async function sendAndWait(chat: CivitaiChat, text: string, count: number): Promise<void> {
  await chat.send(text);
  await vi.waitFor(() => {
    expect(turns(chat)).toHaveLength(count);
    expect(turns(chat).at(-1)!.textContent).toContain('Done.');
  }, { timeout: 10_000 });
}

/** Page content the way a host adds it: a light-DOM child of the chat, named for its slot. */
function slotted(chat: CivitaiChat, slot: 'composer-top' | 'thread-end', text: string, height: number): HTMLElement {
  const el = document.createElement('div');
  el.slot = slot;
  el.textContent = text;
  el.style.cssText = `height:${height}px;background:#eee;`;
  chat.append(el);
  return el;
}

const slotEl = (chat: CivitaiChat, name: string) => root(chat).querySelector<HTMLSlotElement>(`slot[name="${name}"]`);
const rect = (el: Element) => el.getBoundingClientRect();

/** Whether `el` is wholly in the thread's visible scroll area. */
function inView(chat: CivitaiChat, el: Element): boolean {
  const scroller = rect(root(chat).querySelector('.cvt-thread-scroll')!);
  const box = rect(el);
  return box.top >= scroller.top - 1 && box.bottom <= scroller.bottom + 1;
}

/** The checks every case shares: each slotted element is where its slot says, and visible. */
async function expectPlaced(chat: CivitaiChat, top: HTMLElement, end: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    expect(slotEl(chat, 'composer-top')?.assignedElements()).toEqual([top]);
    expect(slotEl(chat, 'thread-end')?.assignedElements()).toEqual([end]);
  });
  const composer = root(chat).querySelector('civitai-chat-composer')!;
  const thread = root(chat).querySelector('civitai-chat-thread')!;
  // composer-top: between the thread and the message box.
  expect(rect(top).height).toBeGreaterThan(0);
  expect(rect(top).bottom).toBeLessThanOrEqual(rect(composer).top + 0.5);
  expect(rect(top).top).toBeGreaterThanOrEqual(rect(thread).bottom - 0.5);
  // thread-end: inside the thread's scroll, after the last message, and scrolled into view.
  expect(root(chat).querySelector('.cvt-thread-scroll')!.contains(slotEl(chat, 'thread-end'))).toBe(true);
  expect(rect(end).top).toBeGreaterThanOrEqual(rect(turns(chat).at(-1)!).bottom - 0.5);
  await vi.waitFor(() => expect(inView(chat, end)).toBe(true), { timeout: 3_000 });
}

describe('<civitai-chat> page slots', () => {
  it('composer-top sits just above the message box, and thread-end after the last message, brought into view', async () => {
    await page.viewport(1280, 900);
    const chat = await mount(900);
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    await sendAndWait(chat, 'Add a dark mode', 2);
    const top = slotted(chat, 'composer-top', 'My app is paused.', 40);
    const end = slotted(chat, 'thread-end', 'Free up a slot', 160);
    await expectPlaced(chat, top, end);
  });

  it('they stay in place through a re-render and a new message, thread-end after the NEW last message', async () => {
    await page.viewport(1280, 900);
    const chat = await mount(900);
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    const top = slotted(chat, 'composer-top', 'My app is paused.', 40);
    const end = slotted(chat, 'thread-end', 'Free up a slot', 160);
    await expectPlaced(chat, top, end);

    chat.placeholder = 'Ask about your app';
    chat.holdReason = 'Your app is starting…';
    await chat.updateComplete;
    chat.holdReason = undefined;
    await chat.updateComplete;
    await expectPlaced(chat, top, end);

    await sendAndWait(chat, 'Add a dark mode', 2);
    await expectPlaced(chat, top, end);
    expect(rect(end).top).toBeGreaterThanOrEqual(rect(turns(chat)[1]).bottom - 0.5);
  });

  it('content added to thread-end while the reader is at the end is brought into view', async () => {
    await page.viewport(1280, 900);
    const chat = await mount(900, 360);
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    await sendAndWait(chat, 'Add a dark mode', 2);
    const scroller = root(chat).querySelector<HTMLElement>('.cvt-thread-scroll')!;
    // The thread overflows: the end is below the fold unless the chat scrolls to it.
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
    const end = slotted(chat, 'thread-end', 'Free up a slot', 200);
    await vi.waitFor(() => expect(inView(chat, end)).toBe(true), { timeout: 3_000 });
  });

  it('with nothing slotted, the slots take no space', async () => {
    await page.viewport(1280, 900);
    const chat = await mount(900);
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    for (const name of ['composer-top', 'thread-end']) {
      const slot = slotEl(chat, name);
      expect(slot, name).not.toBeNull();
      expect(slot!.assignedElements(), name).toEqual([]);
      expect(rect(slot!).height, name).toBe(0);
    }
  });

  it('with no messages yet, thread-end content shows under the greeting, in its scroll, and never pushes the message box out', async () => {
    await page.viewport(1280, 900);
    const chat = await mount(900, 420);
    // Taller than the whole chat.
    const end = slotted(chat, 'thread-end', 'Free up a slot', 600);
    await vi.waitFor(() => expect(slotEl(chat, 'thread-end')?.assignedElements()).toEqual([end]));
    const welcome = root(chat).querySelector<HTMLElement>('civitai-chat-welcome')!;
    expect(welcome.contains(slotEl(chat, 'thread-end'))).toBe(true);
    expect(rect(end).height).toBe(600);
    const host = rect(chat);
    const composer = rect(root(chat).querySelector('civitai-chat-composer')!);
    expect(composer.bottom).toBeLessThanOrEqual(host.bottom + 0.5);
    expect(composer.top).toBeGreaterThanOrEqual(host.top - 0.5);
    // It scrolls in the greeting, and was brought into view: the greeting is scrolled to its end.
    expect(welcome.scrollHeight).toBeGreaterThan(welcome.clientHeight);
    await vi.waitFor(() => expect(welcome.scrollTop + welcome.clientHeight).toBeGreaterThanOrEqual(welcome.scrollHeight - 1));
  });

  it('with no messages yet, thread-end content that grows after it is put in is followed', async () => {
    await page.viewport(1280, 900);
    const chat = await mount(900, 420);
    // Present from the start, empty, and filled later (as a page that renders into it asynchronously).
    const end = slotted(chat, 'thread-end', 'Free up a slot', 0);
    await vi.waitFor(() => expect(slotEl(chat, 'thread-end')?.assignedElements()).toEqual([end]));
    const welcome = root(chat).querySelector<HTMLElement>('civitai-chat-welcome')!;
    await new Promise((resolve) => setTimeout(resolve, 200));
    end.style.height = '600px';
    await vi.waitFor(() => {
      expect(welcome.scrollHeight).toBeGreaterThan(welcome.clientHeight);
      expect(welcome.scrollTop + welcome.clientHeight).toBeGreaterThanOrEqual(welcome.scrollHeight - 1);
    });
  });

  it('content assigned while the reader has scrolled up is still brought into view', async () => {
    await page.viewport(1280, 900);
    const chat = await mount(900, 360);
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    await sendAndWait(chat, 'Add a dark mode', 2);
    const scroller = root(chat).querySelector<HTMLElement>('.cvt-thread-scroll')!;
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(root(chat).querySelector('.cvt-jump')).not.toBeNull());
    const end = slotted(chat, 'thread-end', 'Free up a slot', 120);
    await vi.waitFor(() => expect(inView(chat, end)).toBe(true), { timeout: 3_000 });
  });

  it('content that grows while the reader is at the end stays in view', async () => {
    await page.viewport(1280, 900);
    const chat = await mount(900, 360);
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    await sendAndWait(chat, 'Add a dark mode', 2);
    const end = slotted(chat, 'thread-end', 'Free up a slot', 20);
    await vi.waitFor(() => expect(inView(chat, end)).toBe(true), { timeout: 3_000 });
    // Let any scroll the assignment started land before the content grows.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    end.style.height = '120px';
    await vi.waitFor(() => expect(inView(chat, end)).toBe(true), { timeout: 3_000 });
  });

  it('at phone width both stay inside the chat, composer-top above the message box', async () => {
    await page.viewport(375, 667);
    const chat = await mount(341, 600);
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    const top = slotted(chat, 'composer-top', 'My app is paused.', 40);
    const end = slotted(chat, 'thread-end', 'Free up a slot', 160);
    await expectPlaced(chat, top, end);
    const host = rect(chat);
    for (const el of [top, end]) {
      expect(rect(el).left).toBeGreaterThanOrEqual(host.left - 0.5);
      expect(rect(el).right).toBeLessThanOrEqual(host.right + 0.5);
    }
  });
});
