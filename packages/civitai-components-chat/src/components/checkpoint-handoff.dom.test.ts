import { jsonSchema, tool } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Agent } from '../agent/agent.js';
import { JobManager } from '../orchestration/jobs.js';
import { ThreadStore } from '../store/thread-store.js';
import { fakeHeads, fakeLocks, tabStorage } from '../test-support/fake-heads.js';
import type { CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * A reply that runs in tab A and dies there, as tab B sees it through A's per-step checkpoints: still
 * replying while they are fresh, then Continue, which carries on from exactly the steps A saved, once.
 * And the same reply found by A's own tab after a reload: gone at once.
 *
 * Only `Date` is faked. A saves at `NOW`; B looks 1 minute later (fresh) and 30 minutes later (gone).
 */

const NOW = Date.parse('2026-10-19T15:00:00Z');

beforeAll(() => defineElements());
afterEach(() => {
  delete (navigator as { locks?: unknown }).locks;
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type StreamPart = Record<string, unknown>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const callsNote = (id: string, text: string): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: id, toolName: 'note', input: JSON.stringify({ text }) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];

/** This browser's Web Locks, as every tab sees them; tab B (the element) gets `tab('B')` as `navigator.locks`. */
function browserLocks() {
  const locks = fakeLocks();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks.tab('B') });
  return locks;
}

/**
 * Tab A: runs `build me a timer` over three steps on `heads` (two that call `note`, a third that never
 * ends), holding its lock in `locks` as tab `A` while it runs.
 */
async function tabADiesOnStep3(heads: ReturnType<typeof fakeHeads>, own: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, locks: ReturnType<typeof fakeLocks>) {
  const ranInA: string[] = [];
  const answers: (StreamPart[] | 'hangs')[] = [callsNote('call_1', 'layout'), callsNote('call_2', 'buttons'), 'hangs'];
  let asked = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      asked++;
      const step = asked;
      await vi.waitFor(() => expect((JSON.stringify(heads.writes.at(-1)?.metadata ?? {}).match(/"type":"tool-result"/g) ?? []).length).toBeGreaterThanOrEqual(step - 1));
      const next = answers.shift()!;
      if (next === 'hangs') return { stream: new ReadableStream<StreamPart>({ start: (c) => c.enqueue({ type: 'stream-start', warnings: [] }) }) as never };
      return { stream: convertArrayToReadableStream(next) as never };
    },
  });
  const store = new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, newId: () => 'CONV1', ownReplies: own, locks: locks.tab('A') });
  const agent = new Agent({
    model: () => model,
    store,
    jobs: new JobManager({} as never),
    toolSet: async () => ({
      note: tool({
        inputSchema: jsonSchema<{ text: string }>({ type: 'object', properties: { text: { type: 'string' } } }),
        execute: async ({ text }) => {
          ranInA.push(text);
          return { ok: true };
        },
      }),
    }),
    attachments: () => [],
  });
  void agent.send('build me a timer');
  // Two steps saved; the third is asked for and never ends.
  await vi.waitFor(() => expect(JSON.stringify(heads.writes.at(-1)?.metadata ?? {}).match(/"type":"tool-result"/g)).toHaveLength(2));
  await vi.waitFor(() => expect(asked).toBe(3));
  return { ranInA };
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });
const reply = (words: string) =>
  new Response([chunk({ role: 'assistant', content: words }), chunk({}, 'stop')].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });

/** Tab B: the chat element on the same heads, opening CONV1. */
async function tabB(heads: ReturnType<typeof fakeHeads>) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).includes('chat/completions')) return new Response('{}');
      const body = String(init?.body ?? '');
      // Naming a new chat once its first reply ends is not a reply request: it is answered and not counted.
      if (!(JSON.parse(body) as { stream?: boolean }).stream) return new Response(JSON.stringify({ id: 't', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'Timer' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
      asked.push(body);
      return reply('Done.');
    }),
  );
  localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
  const ranInB: string[] = [];
  const chat = document.createElement('civitai-chat') as CivitaiChat;
  chat.mcp = { orchestration: false, site: false };
  chat.tools = {
    note: {
      description: 'Notes something down.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async (input: { text?: string }) => {
        ranInB.push(input.text ?? '');
        return { ok: true };
      },
    },
  } as never;
  chat.app = { getToken: async () => 'token', requestGrants: async () => true, site: { get: async () => ({ username: 'viewer' }) }, orchestration: heads.orchestration } as never;
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  await vi.waitFor(() => expect(chat.canSend).toBe(true));
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-turn')).not.toBeNull());
  return { chat, asked, ranInB };
}

const latest = (chat: CivitaiChat) => [...chat.shadowRoot!.querySelectorAll('civitai-chat-turn')].at(-1)!;
const note = (chat: CivitaiChat) => latest(chat).querySelector('.cvt-note')?.textContent?.replace(/\s+/g, ' ').trim();
const continueButton = (chat: CivitaiChat) => latest(chat).querySelector<HTMLElement>('.cvt-continue-saved');

describe('a reply that died in another tab, seen through its checkpoints', () => {
  it('reads still replying while they are fresh, then Continue, which sends exactly the saved steps once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const heads = fakeHeads();
    const locks = browserLocks();
    const { ranInA } = await tabADiesOnStep3(heads, tabStorage(), locks);
    // Tab A is gone: the browser let go of its lock.
    locks.kill('A');

    vi.setSystemTime(NOW + 60_000);
    const { chat, asked, ranInB } = await tabB(heads);
    await vi.waitFor(() => expect(note(chat)).toBe('Still replying in another tab or window…'));
    expect(continueButton(chat)).toBeNull();

    vi.setSystemTime(NOW + 30 * 60_000);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(continueButton(chat)).not.toBeNull());
    expect(note(chat)).toBe('This reply stopped before it finished. Continue');
    continueButton(chat)!.click();
    await vi.waitFor(() => expect(latest(chat).textContent).toContain('Done.'));

    expect(asked).toHaveLength(1);
    const body = asked[0]!;
    for (const id of ['call_1', 'call_2']) {
      expect(body.match(new RegExp(`"id":"${id}"`, 'g'))).toHaveLength(1);
      expect(body.match(new RegExp(`"tool_call_id":"${id}"`, 'g'))).toHaveLength(1);
    }
    expect(body.match(/build me a timer/g)).toHaveLength(1);
    expect(ranInA).toEqual(['layout', 'buttons']);
    expect(ranInB).toEqual([]);
  });

  it('read again by the tab that ran it, after a reload a minute later: gone at once, with Continue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const heads = fakeHeads();
    const locks = browserLocks();
    // Tab A keeps its note in this window's sessionStorage, which a reload of the same tab keeps; reloading lets go of its lock.
    await tabADiesOnStep3(heads, sessionStorage, locks);
    locks.kill('A');
    vi.setSystemTime(NOW + 60_000);
    const { chat } = await tabB(heads);
    await vi.waitFor(() => expect(continueButton(chat)).not.toBeNull());
    expect(note(chat)).toBe('This reply stopped before it finished. Continue');
  });

  it('a copy of the tab made while the reply runs (same note, the lock held by the original): still replying, no Continue, until the original is gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const heads = fakeHeads();
    const locks = browserLocks();
    // The copy carries the original's sessionStorage: its note says the reply is this tab's.
    await tabADiesOnStep3(heads, sessionStorage, locks);
    // Long past the time rule: only the lock can say it still runs.
    vi.setSystemTime(NOW + 30 * 60_000);
    const { chat, asked, ranInB } = await tabB(heads);
    await vi.waitFor(() => expect(note(chat)).toBe('Still replying in another tab or window…'));
    expect(continueButton(chat)).toBeNull();
    expect(await chat.retryReply()).toBe(false);
    // The original goes (closed, or unloaded): its lock goes with it.
    locks.kill('A');
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(continueButton(chat)).not.toBeNull());
    expect(asked).toHaveLength(0);
    expect(ranInB).toEqual([]);
  });
});
