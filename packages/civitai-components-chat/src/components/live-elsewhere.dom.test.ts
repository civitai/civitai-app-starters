import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CivitaiChat, ReplyResumeDetail } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * A chat opened while its latest reply had not ended when it was last saved: one still running in
 * another tab or window says so and offers nothing (asking again would pay for it twice); one that is
 * gone says it was cut off, or, saved after a step (v3), offers Continue from the steps it finished.
 *
 * Only `Date` is faked: `NOW` is fixed, and every fixture's save is 1 minute (live) or 30 minutes
 * (gone) before it, well either side of the 5-minute line.
 */

const NOW = Date.parse('2026-10-19T15:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });
const reply = (words: string) =>
  new Response([chunk({ role: 'assistant', content: words }), chunk({}, 'stop')].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });

const user = { content: 'build me a timer', attachments: [] };
const first = { seq: 1, createdAt: ago(60), user: { content: 'hello', attachments: [] }, assistant: { status: 'done', messages: [{ role: 'assistant', content: 'Hi there.' }] } };
/** v2: saved as the reply started, with no reply yet. */
const v2Pending = (createdAt: string) => ({ seq: 2, createdAt, user });
/** v3: saved after its first step, which called the page's `note` and got its result. */
const savedSteps = [
  { role: 'assistant', content: [{ type: 'text', text: 'Laying out the timer first.' }, { type: 'tool-call', toolCallId: 'call_saved', toolName: 'note', input: { text: 'layout' } }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_saved', toolName: 'note', output: { type: 'json', value: { ok: true } } }] },
];
const v3Running = (savedAt: string) => ({ seq: 2, createdAt: ago(40), user, assistant: { status: 'running', savedAt, messages: savedSteps } });
const v2Done = { seq: 2, createdAt: ago(1), user, assistant: { status: 'done', messages: [{ role: 'assistant', content: 'Your timer is ready.' }] } };

const headOf = (v: number, last: unknown) => ({
  id: `${v}-head`,
  status: 'succeeded',
  tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:CONV1'],
  metadata: { v, app: 'chat-cvt', conversationId: 'CONV1', title: 'Timer', titleSource: 'llm', createdAt: ago(60), updatedAt: ago(1), turns: [first, last] },
});

/** Opens the chat on `head()` (read again on every query), with the clock at `NOW`. */
async function openOn(initial: unknown) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  let head = initial;
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).includes('chat/completions')) return new Response('{}');
      asked.push(String(init?.body ?? ''));
      return reply('Done.');
    }),
  );
  localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
  const reads = vi.fn(async (_query: { tags?: string[] }) => ({ items: [head], next: '' }));
  const app = {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: reads, submitWorkflow: vi.fn(async () => ({ id: '7-2', cost: { total: 0 } })) },
  };
  const ran: string[] = [];
  const chat = document.createElement('civitai-chat') as CivitaiChat;
  chat.mcp = { orchestration: false, site: false };
  chat.tools = {
    note: {
      description: 'Notes something down.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async (input: { text?: string }) => {
        ran.push(input.text ?? '');
        return { ok: true };
      },
    },
  } as never;
  const resumes: ReplyResumeDetail[] = [];
  chat.addEventListener('reply-resume', (event) => resumes.push((event as CustomEvent<ReplyResumeDetail>).detail));
  chat.app = app as never;
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  await vi.waitFor(() => expect(chat.canSend).toBe(true));
  // The open chat's head was read: what shows below is that head's, not an empty chat's.
  await vi.waitFor(() => expect(text(chat)).toContain('Hi there.'));
  return { chat, asked, ran, resumes, reads, setHead: (next: unknown) => (head = next) };
}

const text = (chat: CivitaiChat) => chat.shadowRoot!.textContent ?? '';
const latest = (chat: CivitaiChat) => [...chat.shadowRoot!.querySelectorAll('civitai-chat-turn')].at(-1)!;
const note = (chat: CivitaiChat) => latest(chat).querySelector('.cvt-note')?.textContent?.replace(/\s+/g, ' ').trim();
const continueButton = (chat: CivitaiChat) => latest(chat).querySelector<HTMLElement>('.cvt-continue-saved');

/**
 * Nothing asks for the reply again: not `retryReply()` while the chat can send (so only the reply
 * running elsewhere can be what refuses it), and not waking or coming back online.
 */
async function nothingAsksAgain(chat: CivitaiChat) {
  await vi.waitFor(() => expect(chat.canSend).toBe(true));
  expect(await chat.retryReply()).toBe(false);
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('online'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  await vi.waitFor(() => expect(chat.canSend).toBe(true));
  expect(await chat.retryReply()).toBe(false);
}

describe('a reply still running elsewhere, or gone', () => {
  it('v2, saved a minute ago as it started: says it is still replying elsewhere, and offers nothing', async () => {
    const { chat, asked } = await openOn(headOf(2, v2Pending(ago(1))));
    await vi.waitFor(() => expect(note(chat)).toBe('Still replying in another tab or window…'));
    expect(latest(chat).textContent).not.toContain('Ask again');
    expect(latest(chat).querySelector('.cvt-retry, .cvt-continue-saved')).toBeNull();
    await nothingAsksAgain(chat);
    expect(asked).toHaveLength(0);
  });

  it('v2, saved 30 minutes ago as it started: cut off, as before', async () => {
    const { chat } = await openOn(headOf(2, v2Pending(ago(30))));
    await vi.waitFor(() => expect(note(chat)).toBe('This reply was cut off. Ask again?'));
    expect(continueButton(chat)).toBeNull();
  });

  it('v3, its latest step saved a minute ago: still replying elsewhere, its steps shown, no Continue', async () => {
    const { chat, asked, ran } = await openOn(headOf(3, v3Running(ago(1))));
    await vi.waitFor(() => expect(note(chat)).toBe('Still replying in another tab or window…'));
    expect(latest(chat).textContent).toContain('Laying out the timer first.');
    expect(continueButton(chat)).toBeNull();
    await nothingAsksAgain(chat);
    expect(asked).toHaveLength(0);
    expect(ran).toEqual([]);
  });

  it('v3, its latest step saved 30 minutes ago: Continue carries on from its steps, sent once and not run again', async () => {
    const { chat, asked, ran, resumes } = await openOn(headOf(3, v3Running(ago(30))));
    await vi.waitFor(() => expect(continueButton(chat)).not.toBeNull());
    expect(note(chat)).toBe('This reply stopped before it finished. Continue');
    continueButton(chat)!.click();
    await vi.waitFor(() => expect(latest(chat).textContent).toContain('Done.'));
    expect(resumes).toEqual([{ trigger: 'retry' }]);
    expect(asked).toHaveLength(1);
    const body = asked[0]!;
    // The saved step goes once: its call and its result, as they were.
    expect(body.match(/"id":"call_saved"/g)).toHaveLength(1);
    expect(body.match(/"tool_call_id":"call_saved"/g)).toHaveLength(1);
    expect(body.match(/build me a timer/g)).toHaveLength(1);
    expect(ran).toEqual([]);
    // Shown once too, before the new words.
    expect(latest(chat).textContent!.match(/Laying out the timer first\./g)).toHaveLength(1);
    expect(continueButton(chat)).toBeNull();
  });

  it('settles by itself: read again on focus, it shows the reply that ended meanwhile', async () => {
    const { chat, reads, setHead } = await openOn(headOf(2, v2Pending(ago(1))));
    await vi.waitFor(() => expect(note(chat)).toBe('Still replying in another tab or window…'));
    const before = reads.mock.calls.length;
    setHead(headOf(2, v2Done));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(latest(chat).textContent).toContain('Your timer is ready.'));
    expect(reads.mock.calls.length).toBeGreaterThan(before);
    expect(latest(chat).querySelector('.cvt-note')).toBeNull();
  });

  it('settles by itself: read again once the save is old, a reply that never ended reads as cut off', async () => {
    const { chat, reads } = await openOn(headOf(2, v2Pending(ago(1))));
    await vi.waitFor(() => expect(note(chat)).toBe('Still replying in another tab or window…'));
    const before = reads.mock.calls.length;
    vi.setSystemTime(NOW + 30 * 60_000);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(note(chat)).toBe('This reply was cut off. Ask again?'));
    // Read once more as it went past, in case it ended meanwhile.
    await vi.waitFor(() => expect(reads.mock.calls.length).toBeGreaterThan(before));
  });
});
