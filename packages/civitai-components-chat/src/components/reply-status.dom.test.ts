import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { LiveTurn } from '../agent/core.js';
import type { TurnPart } from '../agent/parts.js';
import { memoryStore } from '../test-support/fake-backend.js';
import { fakeRunner, RUNNER_URL } from '../test-support/fake-runner.js';
import type { Turn } from '../types.js';
import type { CivitaiChat } from './civitai-chat.js';
import type { CivitaiChatReplyStatus } from './civitai-chat-reply-status.js';
import { formatElapsed } from './civitai-chat-reply-status.js';
import type { CivitaiChatThread } from './civitai-chat-thread.js';
import { defineElements } from './define.js';

/** The live reply's status line: there from the moment a reply starts until it ends, whatever it shows. */

beforeAll(() => defineElements());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const turn = (): Turn => ({ seq: 1, createdAt: '', user: { content: 'hi', attachments: [] }, assistant: { messages: [], status: 'streaming' } });
const jobs = { byToolCall: () => undefined, get: () => undefined } as never;
/** A page tool whose calls show a card of their own (no "Working on it…" line), as the built-in cards do. */
const views = { own_card: { render: () => 'A card of its own' } };

async function thread(live: LiveTurn | null, extra: Partial<CivitaiChatThread> = {}): Promise<CivitaiChatThread> {
  const el = document.createElement('civitai-chat-thread');
  Object.assign(el, { turns: [turn()], live, jobs, views, ...extra });
  document.body.append(el);
  await el.updateComplete;
  await el.querySelector('civitai-chat-turn')!.updateComplete;
  return el;
}

const line = (root: ParentNode) => root.querySelector<CivitaiChatReplyStatus>('civitai-chat-reply-status');
const label = (root: ParentNode) => line(root)?.querySelector('.cvt-reply-status-label')?.textContent?.trim();

describe('the live reply status line, by what the reply shows last', () => {
  const tool = (state: 'calling' | 'done', toolName = 'find_services'): TurnPart =>
    state === 'done' ? { kind: 'tool', toolCallId: 't1', toolName, input: {}, state, output: 'x' } : { kind: 'tool', toolCallId: 't1', toolName, input: {}, state };
  const cases: [string, TurnPart[]][] = [
    ['nothing yet', []],
    // The model writes words, then a long call it has not sent yet: before, nothing showed it was busy.
    ['words (a step that may still write a call)', [{ kind: 'text', text: 'Let me look.' }]],
    ['words that are only whitespace so far', [{ kind: 'text', text: '  ' }]],
    // A call whose view shows a card of its own: before, no "Working on it…" and no dots.
    ['a running call that shows a card of its own', [tool('calling', 'own_card')]],
    ['a running call', [tool('calling')]],
    ['a finished call (the next step not started)', [tool('done')]],
  ];
  for (const [what, parts] of cases) {
    it(`shows "Working" with the time while the last thing is ${what}`, async () => {
      const el = await thread({ seq: 1, parts, startedAt: Date.now() - 42_000 });
      if (parts[0]?.kind === 'tool' && parts[0].toolName === 'own_card') expect(el.textContent).toContain('A card of its own');
      expect(label(el)).toBe('Working');
      expect(line(el)!.querySelector('.cvt-reply-status-time')!.textContent).toBe('· 0:42');
    });
  }

  it('stays the same line through a step gap: words, a call, its result, more words', async () => {
    const live: LiveTurn = { seq: 1, parts: [], startedAt: Date.now() };
    const el = await thread(live);
    const first = line(el);
    expect(first).not.toBeNull();
    const steps: TurnPart[][] = [
      [{ kind: 'text', text: 'Looking.' }],
      [{ kind: 'text', text: 'Looking.' }, tool('calling')],
      [{ kind: 'text', text: 'Looking.' }, tool('done')],
      [{ kind: 'text', text: 'Looking.' }, tool('done'), { kind: 'text', text: 'Found' }],
    ];
    for (const parts of steps) {
      live.parts = parts;
      el.live = live;
      await el.updateComplete;
      await el.querySelector('civitai-chat-turn')!.updateComplete;
      // The same element each time, never taken off the page between steps.
      expect(line(el)).toBe(first);
      expect(label(el)).toBe('Working');
    }
  });

  it('is gone once the reply is not live', async () => {
    const el = await thread(null);
    expect(line(el)).toBeNull();
  });

  it('is a polite status whose seconds a screen reader does not hear', async () => {
    const el = await thread({ seq: 1, parts: [], startedAt: Date.now() });
    const status = line(el)!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.querySelector('.cvt-reply-status-time')!.getAttribute('aria-hidden')).toBe('true');
    expect(status.querySelector('.cvt-reply-status-dots')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the live reply status line, by the reply’s state', () => {
  it('says "Reconnecting…" while the connection is down, before any other state', async () => {
    const el = await thread({ seq: 1, parts: [], startedAt: Date.now(), reconnecting: true, reattached: true }, { awaitingApproval: true });
    expect(label(el)).toBe('Reconnecting…');
    expect(line(el)!.getAttribute('state')).toBe('reconnecting');
  });

  it('says "Waiting for your approval" while the page says a call waits for the viewer', async () => {
    const el = await thread({ seq: 1, parts: [], startedAt: Date.now(), reattached: true }, { awaitingApproval: true });
    expect(label(el)).toBe('Waiting for your approval');
    el.awaitingApproval = false;
    await el.updateComplete;
    await el.querySelector('civitai-chat-turn')!.updateComplete;
    expect(label(el)).toBe('Still working on the server');
  });

  it('says "Still working on the server" for a reply followed again after a reload', async () => {
    const el = await thread({ seq: 1, parts: [], startedAt: Date.now() - 125_000, reattached: true });
    expect(label(el)).toBe('Still working on the server');
    expect(line(el)!.querySelector('.cvt-reply-status-time')!.textContent).toBe('· 2:05');
  });

  it('does not say an older turn waits for approval', async () => {
    const el = document.createElement('civitai-chat-thread');
    const older = { ...turn(), assistant: { messages: [{ role: 'assistant' as const, content: 'Done.' }], status: 'done' as const } };
    Object.assign(el, { turns: [older, { ...turn(), seq: 2 }], live: { seq: 2, parts: [], startedAt: Date.now() }, jobs, awaitingApproval: true });
    document.body.append(el);
    await el.updateComplete;
    expect(el.querySelectorAll('civitai-chat-reply-status')).toHaveLength(1);
    expect(el.querySelectorAll('civitai-chat-turn')[0]!.hasAttribute('awaiting-approval')).toBe(false);
  });
});

describe('the status line’s time', () => {
  it('reads m:ss, and h:mm:ss from an hour', () => {
    expect([0, 999, 5_000, 42_000, 60_000, 599_000, 3_599_000, 3_600_000, 3_725_000, -5].map(formatElapsed)).toEqual([
      '0:00',
      '0:00',
      '0:05',
      '0:42',
      '1:00',
      '9:59',
      '59:59',
      '1:00:00',
      '1:02:05',
      '0:00',
    ]);
  });

  it('advances every second by itself, without the reply changing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const el = await thread({ seq: 1, parts: [{ kind: 'text', text: 'Thinking' }], startedAt: Date.now() - 7_000 });
    const time = () => line(el)!.querySelector('.cvt-reply-status-time')!.textContent;
    expect(time()).toBe('· 0:07');
    vi.advanceTimersByTime(3_000);
    await line(el)!.updateComplete;
    expect(time()).toBe('· 0:10');
    vi.advanceTimersByTime(60_000);
    await line(el)!.updateComplete;
    expect(time()).toBe('· 1:10');
  });

  it('stops ticking once it is off the page', async () => {
    const started = vi.spyOn(globalThis, 'setInterval');
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    const el = await thread({ seq: 1, parts: [], startedAt: Date.now() });
    expect(line(el)).not.toBeNull();
    const ticks = started.mock.calls.filter(([, ms]) => ms === 1000).length;
    expect(ticks).toBe(1);
    const tick = started.mock.results[started.mock.calls.findIndex(([, ms]) => ms === 1000)]!.value as unknown;
    el.live = null;
    await el.updateComplete;
    await el.querySelector('civitai-chat-turn')!.updateComplete;
    expect(line(el)).toBeNull();
    expect(cleared).toHaveBeenCalledWith(tick);
  });
});

/** `<civitai-chat runner="remote">` on a host store, its replies on a fake runner (as remote-store.dom.test.ts). */
async function remoteChat(reconnectDelaysMs: number[]) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not here', { status: 404 })));
  const runner = fakeRunner();
  const chat = document.createElement('civitai-chat');
  chat.runner = 'remote';
  chat.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch, reconnectDelaysMs };
  chat.backend = { model: 'host/default', store: memoryStore() } as never;
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return { chat, runner };
}

const chatLabel = (chat: CivitaiChat) => label(chat.shadowRoot!);

describe('<civitai-chat runner="remote">: the status line through a whole reply', () => {
  it('shows from the send, through words and a step gap and a dropped stream, and ends with the reply', async () => {
    const { chat, runner } = await remoteChat([150]);
    void chat.send('hello');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    await vi.waitFor(() => expect(chatLabel(chat)).toBe('Working'));

    // Words last: the old indicator hid here.
    runner.push('r1', { type: 'text-delta', index: 0, text: 'Let me check.' });
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('.cvt-md')?.textContent).toContain('Let me check.'));
    expect(chatLabel(chat)).toBe('Working');

    // A call running, then finished (the step gap).
    runner.push('r1', { type: 'tool-call', index: 1, toolCallId: 't1', toolName: 'sandbox__run_command', input: { command: 'ls' } });
    runner.push('r1', { type: 'tool-result', toolCallId: 't1', output: 'ok' });
    await vi.waitFor(() => expect(runner.runs.get('r1')!.journal).toHaveLength(4));
    expect(chatLabel(chat)).toBe('Working');

    // The stream drops, and the first open after it gets no answer: "Reconnecting…" until it is back.
    runner.knobs.failEvents = 1;
    runner.dropStreams('r1');
    await vi.waitFor(() => expect(chatLabel(chat)).toBe('Reconnecting…'));
    expect(chat.shadowRoot!.querySelector('.cvt-md')?.textContent).toContain('Let me check.');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1), { timeout: 5_000 });
    await vi.waitFor(() => expect(chatLabel(chat)).toBe('Working'));

    // The page's approval state, set while a call waits for the viewer.
    chat.awaitingApproval = true;
    await vi.waitFor(() => expect(chatLabel(chat)).toBe('Waiting for your approval'));
    chat.awaitingApproval = false;
    await vi.waitFor(() => expect(chatLabel(chat)).toBe('Working'));

    runner.push('r1', { type: 'text-delta', index: 2, text: 'Done.' });
    runner.push('r1', { type: 'run-ended', status: 'done', messages: [{ role: 'assistant', content: 'Let me check. Done.' }], steps: 2 });
    await vi.waitFor(() => expect(line(chat.shadowRoot!)).toBeNull());
  });
});
