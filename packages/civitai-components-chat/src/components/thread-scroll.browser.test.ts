import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { LiveTurn } from '../agent/core.js';
import type { TurnPart } from '../agent/parts.js';
import type { ChatBackend } from '../backend.js';
import { completion, memoryStore, textReply, urlOf } from '../test-support/fake-backend.js';
import type { Turn } from '../types.js';
import type { CivitaiChat } from './civitai-chat.js';
import type { CivitaiChatThread } from './civitai-chat-thread.js';
import { chatStyles } from './chat.styles.js';
import { defineElements } from './define.js';

/**
 * Where the thread's scroll goes while a reply streams, in real Chromium (jsdom does no layout).
 *
 * The rule: while the viewer is at the end, new content keeps the end in view; once they have scrolled
 * away from it themselves, nothing moves what they are looking at. Every expectation is read from the
 * layout: "at the end" is `scrollTop === scrollHeight - clientHeight`, and "held" is an element the
 * viewer was looking at keeping its place on screen (within 2px).
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits until nothing moves: the scroll position and the content's height the same for 6 frames in a row. */
async function settle(scroller: HTMLElement): Promise<void> {
  let last = '';
  let same = 0;
  for (let i = 0; i < 400 && same < 6; i++) {
    await frame();
    const now = `${scroller.scrollTop}/${scroller.scrollHeight}`;
    same = now === last ? same + 1 : 0;
    last = now;
  }
}

const maxScroll = (scroller: HTMLElement) => scroller.scrollHeight - scroller.clientHeight;
const where = (scroller: HTMLElement) => JSON.stringify({ scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight });

function expectAtEnd(scroller: HTMLElement, what: string): void {
  // The control: the thread overflows, so "at the end" is not also "at the top".
  expect(maxScroll(scroller), `${what}: the thread does not overflow ${where(scroller)}`).toBeGreaterThan(200);
  expect(Math.abs(scroller.scrollTop - maxScroll(scroller)), `${what}: not at the end ${where(scroller)}`).toBeLessThanOrEqual(1);
}

/** The first element at or below the top of the visible area: what the viewer is looking at. */
function inViewAtTop(scroller: HTMLElement, selector: string): HTMLElement {
  const top = scroller.getBoundingClientRect().top;
  const found = [...scroller.querySelectorAll<HTMLElement>(selector)].find((el) => el.getBoundingClientRect().top >= top);
  if (!found) throw new Error(`nothing matching ${selector} in view ${where(scroller)}`);
  return found;
}

/** The viewer turns the mouse wheel over the thread, and the scroll it makes lands. */
async function wheel(scroller: HTMLElement, y: number): Promise<void> {
  await userEvent.wheel(scroller, { delta: { y } });
  await settle(scroller);
}

// ── a thread on its own, fed a streaming reply the way the chat feeds it ──

const LONG = 'The assistant keeps writing about the timer, its settings, the sounds it plays and the way it counts down. ';
const paragraph = (n: number) => `Paragraph ${n}. ${LONG.repeat(2)}`;
const call = (n: number): TurnPart => ({ kind: 'tool', toolCallId: `c${n}`, toolName: 'sandbox__read_file', input: { path: `/app/src/file-${n}.ts` }, state: 'done', output: { ok: true } });

function doneTurn(seq: number, text: string, parts: TurnPart[] = []): Turn {
  const content = [{ type: 'text' as const, text }, ...parts.filter((p): p is Extract<TurnPart, { kind: 'tool' }> => p.kind === 'tool').map((p) => ({ type: 'tool-call' as const, toolCallId: p.toolCallId, toolName: p.toolName, input: p.input }))];
  const results = parts
    .filter((p): p is Extract<TurnPart, { kind: 'tool' }> => p.kind === 'tool')
    .map((p) => ({ type: 'tool-result' as const, toolCallId: p.toolCallId, toolName: p.toolName, output: { type: 'json' as const, value: p.output as never } }));
  return {
    seq,
    createdAt: '',
    user: { content: `Question ${seq}`, attachments: [] },
    assistant: {
      status: 'done',
      messages: results.length ? [{ role: 'assistant', content }, { role: 'tool', content: results }, { role: 'assistant', content: 'That is all.' }] : [{ role: 'assistant', content: text }],
    },
  } as Turn;
}

const liveTurn = (seq: number): Turn => ({ seq, createdAt: '', user: { content: `Question ${seq}`, attachments: [] }, assistant: { messages: [], status: 'streaming' } }) as Turn;

interface Harness {
  host: HTMLElement;
  thread: CivitaiChatThread;
  scroller: HTMLElement;
  /** The live reply's parts so far; `push` shows the change, as the agent does on each streamed piece. */
  parts: TurnPart[];
  push(change: (parts: TurnPart[]) => void): Promise<void>;
}

/**
 * A thread in a shadow root carrying the chat's styles (as `<civitai-chat>`'s is), `height` tall, its
 * older turns finished and the last one live.
 */
async function mountThread(older: Turn[], options: { height?: number; views?: Record<string, unknown>; end?: HTMLElement } = {}): Promise<Harness> {
  const host = document.createElement('div');
  host.style.cssText = `width:420px;height:${options.height ?? 500}px;display:grid;`;
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [chatStyles.styleSheet!];
  if (options.end) host.append(options.end);
  const thread = document.createElement('civitai-chat-thread') as CivitaiChatThread;
  const seq = older.length + 1;
  const parts: TurnPart[] = [];
  const startedAt = Date.now();
  Object.assign(thread, {
    turns: [...older, liveTurn(seq)],
    live: { seq, parts: [], startedAt } satisfies LiveTurn,
    jobs: { byToolCall: () => undefined, get: () => undefined },
    resolve: () => undefined,
    views: options.views ?? {},
    mcpServerIds: new Set(['sandbox']),
    toolCalls: 'details',
  });
  root.append(thread);
  document.body.append(host);
  await thread.updateComplete;
  const scroller = await vi.waitFor(() => {
    const el = thread.querySelector<HTMLElement>('.cvt-thread-scroll');
    expect(el).not.toBeNull();
    return el!;
  });
  const push = async (change: (parts: TurnPart[]) => void) => {
    change(parts);
    thread.live = { seq, parts: [...parts], startedAt };
    await thread.updateComplete;
  };
  await settle(scroller);
  return { host, thread, scroller, parts, push };
}

/** A reply as it streams: words a paragraph at a time, then 20 calls in a row (one group), then more words. */
async function stream(h: Harness, from: number, paced = 8): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await h.push((parts) => {
      const last = parts.at(-1);
      if (last?.kind === 'text') last.text += `\n\n${paragraph(from + i)}`;
      else parts.push({ kind: 'text', text: paragraph(from + i) });
    });
    await sleep(paced);
  }
  for (let i = 0; i < 20; i++) {
    await h.push((parts) => parts.push(call(from * 100 + i)));
    await sleep(paced);
  }
  for (let i = 0; i < 6; i++) {
    await h.push((parts) => {
      const last = parts.at(-1);
      if (last?.kind === 'text') last.text += `\n\n${paragraph(from + 10 + i)}`;
      else parts.push({ kind: 'text', text: paragraph(from + 10 + i) });
    });
    await sleep(paced);
  }
}

const history = () => [doneTurn(1, `${paragraph(1)}\n\n${paragraph(2)}\n\n${paragraph(3)}`), doneTurn(2, `${paragraph(4)}\n\n${paragraph(5)}`)];

describe('following: at the end, new content keeps the end in view', () => {
  it('(a) a reply streaming words, then 20 calls that group, then more words, stays at the end', async () => {
    await page.viewport(1000, 900);
    const h = await mountThread(history());
    expectAtEnd(h.scroller, 'before the reply');
    await stream(h, 10);
    await settle(h.scroller);
    // The calls did group: one closed "Used 20 tools" line, not 20 rows.
    expect(h.thread.querySelector<HTMLElement>('civitai-chat-turn:last-of-type .cvt-tool-group')?.dataset.count).toBe('20');
    expectAtEnd(h.scroller, 'after the reply');
    expect(h.thread.querySelector('.cvt-jump'), 'Jump to latest shows while at the end').toBeNull();
  });

  it('(f) a smooth Jump to latest still gliding while the reply streams, and a layout clamp, leave it at the end', async () => {
    await page.viewport(1000, 900);
    const end = document.createElement('div');
    end.slot = 'thread-end';
    end.style.cssText = 'height:0px;';
    const h = await mountThread(history(), { end });
    await wheel(h.scroller, -600);
    const jump = await vi.waitFor(() => {
      const el = h.thread.querySelector<HTMLElement>('.cvt-jump');
      expect(el).not.toBeNull();
      return el!;
    });
    // The glide starts; the reply streams on under it.
    jump.click();
    await stream(h, 30, 4);
    await settle(h.scroller);
    expectAtEnd(h.scroller, 'after the glide and the reply');
    // A layout clamp: the content at the end grows, then shrinks back, and the browser pulls scrollTop in.
    end.style.height = '400px';
    await settle(h.scroller);
    expectAtEnd(h.scroller, 'after thread-end grew');
    end.style.height = '0px';
    await settle(h.scroller);
    await stream(h, 50, 4);
    await settle(h.scroller);
    expectAtEnd(h.scroller, 'after the clamp and more of the reply');
    expect(h.thread.querySelector('.cvt-jump')).toBeNull();
  });
});

describe('holding: scrolled away by the viewer, nothing moves their view', () => {
  it('(b) the viewer wheels up 400px and the reply streams on: what they look at stays put', async () => {
    await page.viewport(1000, 900);
    const h = await mountThread(history());
    await stream(h, 10);
    await settle(h.scroller);
    expectAtEnd(h.scroller, 'before the wheel');
    await wheel(h.scroller, -400);
    // The control: the wheel did take them away from the end.
    expect(maxScroll(h.scroller) - h.scroller.scrollTop, where(h.scroller)).toBeGreaterThan(300);
    const anchor = inViewAtTop(h.scroller, '.cvt-md, .cvt-tool-group, .cvt-user');
    const before = anchor.getBoundingClientRect().top;
    const scrollTop = h.scroller.scrollTop;
    await stream(h, 30);
    await settle(h.scroller);
    expect(anchor.isConnected).toBe(true);
    expect(Math.abs(anchor.getBoundingClientRect().top - before), `moved: ${where(h.scroller)} was ${scrollTop}`).toBeLessThanOrEqual(2);
    expect(h.thread.querySelector('.cvt-jump'), 'Jump to latest shows while away from the end').not.toBeNull();
  });

  it('(c) the viewer opens a call row, scrolls past it, and the row regroups: nothing moves', async () => {
    await page.viewport(1000, 900);
    // The page's content after the reply, tall enough to scroll past the row and still be away from the end.
    const end = document.createElement('div');
    end.slot = 'thread-end';
    end.style.cssText = 'height:1200px;';
    const h = await mountThread(history(), { end });
    await h.push((parts) => parts.push({ kind: 'text', text: paragraph(9) }, call(1)));
    await settle(h.scroller);
    const head = h.thread.querySelector<HTMLButtonElement>('civitai-chat-turn:last-of-type .cvt-call-head')!;
    await userEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    await settle(h.scroller);
    // Its body is open and tall, so it collapsing into a closed group would shift what follows.
    const row = head.closest<HTMLElement>('.cvt-call')!;
    const opened = row.getBoundingClientRect().height;
    expect(opened).toBeGreaterThan(80);
    // The viewer is on the row's button: the turn tries to keep them on it when it is drawn anew.
    expect((head.getRootNode() as ShadowRoot).activeElement).toBe(head);
    // Scroll on until the row is wholly above the visible area.
    await wheel(h.scroller, row.getBoundingClientRect().bottom - h.scroller.getBoundingClientRect().top + 60);
    expect(row.getBoundingClientRect().bottom, where(h.scroller)).toBeLessThan(h.scroller.getBoundingClientRect().top);
    expect(maxScroll(h.scroller) - h.scroller.scrollTop, where(h.scroller)).toBeGreaterThan(300);
    const before = end.getBoundingClientRect().top;
    const scrollTop = h.scroller.scrollTop;

    await h.push((parts) => parts.push(call(2)));
    await settle(h.scroller);
    const group = h.thread.querySelector<HTMLElement>('civitai-chat-turn:last-of-type .cvt-tool-group')!;
    expect(group.dataset.count).toBe('2');
    // The control: the content above the view did change height.
    expect(opened - group.getBoundingClientRect().height).toBeGreaterThan(40);
    expect(Math.abs(end.getBoundingClientRect().top - before), `moved: ${where(h.scroller)} was ${scrollTop}`).toBeLessThanOrEqual(2);
  });

  it('(d) content above the view grows (a group opens, a picture sizes itself): what they look at stays put', async () => {
    await page.viewport(1000, 900);
    const photo = document.createElement('div');
    photo.className = 'test-photo';
    photo.style.cssText = 'height:0px;background:#ccc;';
    const older = [
      doneTurn(1, paragraph(1), [call(1), call(2), call(3), call(4), call(5)]),
      doneTurn(2, `${paragraph(2)}\n\n${paragraph(3)}`, [{ kind: 'tool', toolCallId: 'p1', toolName: 'photo', input: {}, state: 'done', output: {} }]),
      doneTurn(3, `${paragraph(4)}\n\n${paragraph(5)}\n\n${paragraph(6)}`),
      doneTurn(4, `${paragraph(7)}\n\n${paragraph(8)}\n\n${paragraph(9)}`),
    ];
    const h = await mountThread(older, { views: { photo: { render: () => photo } } });
    await h.push((parts) => parts.push({ kind: 'text', text: paragraph(10) }));
    await settle(h.scroller);
    expect(photo.isConnected).toBe(true);
    const group = h.thread.querySelector<HTMLElement>('civitai-chat-turn .cvt-tool-group')!;
    // Up from the end until the group and the picture are above the view, and the end is well away.
    await wheel(h.scroller, -400);
    expect(group.getBoundingClientRect().bottom, where(h.scroller)).toBeLessThan(h.scroller.getBoundingClientRect().top);
    expect(photo.getBoundingClientRect().bottom, where(h.scroller)).toBeLessThan(h.scroller.getBoundingClientRect().top);
    expect(maxScroll(h.scroller) - h.scroller.scrollTop, where(h.scroller)).toBeGreaterThan(300);
    const anchor = inViewAtTop(h.scroller, '.cvt-md, .cvt-user');
    const before = anchor.getBoundingClientRect().top;

    const closed = group.getBoundingClientRect().height;
    group.querySelector<HTMLButtonElement>('.cvt-tool-group-head')!.click();
    await settle(h.scroller);
    // The control: the group did open above the view.
    expect(group.getBoundingClientRect().height - closed).toBeGreaterThan(100);
    expect(Math.abs(anchor.getBoundingClientRect().top - before), `moved after the group opened: ${where(h.scroller)}`).toBeLessThanOrEqual(2);

    photo.style.height = '300px';
    await settle(h.scroller);
    expect(Math.abs(anchor.getBoundingClientRect().top - before), `moved after the picture sized itself: ${where(h.scroller)}`).toBeLessThanOrEqual(2);
    expect(h.thread.querySelector('.cvt-jump')).not.toBeNull();
  });
});

// ── the whole chat: a rebuilt thread, and a message the viewer sends ──

const REPLY = 'Here is a plan for the timer: a 25 minute focus block, a 5 minute break, and a soundscape that fades in. '.repeat(8);

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

async function mountChat(): Promise<CivitaiChat> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const frameEl = document.createElement('div');
  frameEl.style.cssText = 'width:600px;height:460px;';
  const chat = document.createElement('civitai-chat');
  chat.backend = backend();
  frameEl.append(chat);
  document.body.append(frameEl);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 15_000 });
  return chat;
}

const chatTurns = (chat: CivitaiChat) => [...chat.shadowRoot!.querySelectorAll<HTMLElement>('civitai-chat-turn')];
const chatScroller = (chat: CivitaiChat) => chat.shadowRoot!.querySelector<HTMLElement>('.cvt-thread-scroll')!;

async function sendAndWait(chat: CivitaiChat, text: string, count: number): Promise<void> {
  await chat.send(text);
  await vi.waitFor(() => {
    expect(chatTurns(chat)).toHaveLength(count);
    expect(chatTurns(chat).at(-1)!.textContent).toContain('Done.');
  }, { timeout: 10_000 });
  await settle(chatScroller(chat));
}

/** The viewer picks the chat that is already open from the history: it is read again, its thread rebuilt behind the loader. */
async function reopenSame(chat: CivitaiChat): Promise<HTMLElement> {
  const old = chatScroller(chat);
  const id = chat.chatId!;
  (chat as unknown as { historyOpen: boolean }).historyOpen = true;
  await chat.updateComplete;
  const sidebar = await vi.waitFor(() => {
    const el = chat.shadowRoot!.querySelector('civitai-chat-sidebar');
    expect(el).not.toBeNull();
    return el!;
  });
  sidebar.dispatchEvent(new CustomEvent('cvt-open', { detail: { id }, bubbles: true, composed: true }));
  const scroller = await vi.waitFor(() => {
    const el = chat.shadowRoot!.querySelector<HTMLElement>('.cvt-thread-scroll');
    expect(el).not.toBeNull();
    expect(el).not.toBe(old);
    return el!;
  });
  await vi.waitFor(() => expect(chatTurns(chat).at(-1)?.textContent).toContain('Done.'));
  await settle(scroller);
  return scroller;
}

describe('a thread rebuilt for the same chat', () => {
  it('(e) keeps the viewer where they had scrolled to', async () => {
    await page.viewport(1000, 900);
    const chat = await mountChat();
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    await sendAndWait(chat, 'Add a dark mode', 2);
    await sendAndWait(chat, 'And a longer break', 3);
    const scroller = chatScroller(chat);
    expectAtEnd(scroller, 'before the wheel');
    await wheel(scroller, -500);
    const kept = scroller.scrollTop;
    expect(maxScroll(scroller) - kept, where(scroller)).toBeGreaterThan(300);
    const rebuilt = await reopenSame(chat);
    expect(Math.abs(rebuilt.scrollTop - kept), `rebuilt at ${where(rebuilt)}, was ${kept}`).toBeLessThanOrEqual(2);
  });

  it('(e) lands at the end when the viewer was at the end', async () => {
    await page.viewport(1000, 900);
    const chat = await mountChat();
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    await sendAndWait(chat, 'Add a dark mode', 2);
    await sendAndWait(chat, 'And a longer break', 3);
    expectAtEnd(chatScroller(chat), 'before the rebuild');
    const rebuilt = await reopenSame(chat);
    expectAtEnd(rebuilt, 'after the rebuild');
  });
});

describe('a message the viewer sends', () => {
  it('(g) brings the end into view even when they had scrolled up', async () => {
    await page.viewport(1000, 900);
    const chat = await mountChat();
    await sendAndWait(chat, 'Build me a pomodoro timer', 1);
    await sendAndWait(chat, 'Add a dark mode', 2);
    const scroller = chatScroller(chat);
    await wheel(scroller, -600);
    expect(maxScroll(scroller) - scroller.scrollTop, where(scroller)).toBeGreaterThan(300);
    await sendAndWait(chat, 'And a longer break', 3);
    expectAtEnd(scroller, 'after sending');
    expect(chat.shadowRoot!.querySelector('.cvt-jump')).toBeNull();
  });
});
