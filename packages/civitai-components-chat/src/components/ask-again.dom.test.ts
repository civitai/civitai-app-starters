import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatBackend } from '../backend.js';
import { completion, memoryStore, sse, textReply, urlOf } from '../test-support/fake-backend.js';
import type { BeforeSendDetail, CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * `askAgain()`: the page asks the viewer's latest message again, as it is, once its own step stood in
 * the reply's way (e.g. the viewer had to free something up first). The reply that followed is
 * replaced by a fresh one, and the message is never added a second time. On a host's store, so what
 * is saved is seen too.
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FIRST = 'Name three rivers in Peru';
const FIRST_REPLY = 'Amazon, Ucayali and Marañón.';
const ASKED = 'Build me a tip calculator';
const REFUSED_REPLY = 'You already have as many apps as you can keep.';
const FRESH_REPLY = 'Your tip calculator is starting.';

const encoder = new TextEncoder();
const chunk = (delta: Record<string, unknown>) => ({ id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: null }] });

/** A reply that writes `words` and never ends, until the request is aborted. */
function hanging(words: string, signal: AbortSignal | null | undefined): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ role: 'assistant', content: words }))}\n\n`));
      signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const textOf = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content));

/** Each streamed reply request is answered from `answers` in order; `asked` holds each one's user messages. */
function gateway(answers: (string | 'hang')[]) {
  const asked: string[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!urlOf(input).includes('/v1/chat/completions')) return new Response('not here', { status: 404 });
      const body = JSON.parse(String(init?.body)) as { stream?: boolean; messages: { role: string; content: unknown }[] };
      if (!body.stream) return completion('Rivers');
      asked.push(body.messages.filter((m) => m.role === 'user').map((m) => textOf(m.content)));
      const next = answers.shift();
      if (next === undefined) return sse({ error: { message: 'the test asked for more replies than it scripted', type: 'server_error' } });
      if (next === 'hang') return hanging('Working', init?.signal);
      return textReply(next);
    }),
  );
  return asked;
}

async function mount(store: ReturnType<typeof memoryStore>): Promise<CivitaiChat> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  chat.backend = { url: '/api/llm', model: 'host/default-model', store } satisfies ChatBackend;
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  await vi.waitFor(() => expect(chat.canSend).toBe(true));
  return chat;
}

const root = (chat: CivitaiChat) => chat.shadowRoot!;
const bubbles = (chat: CivitaiChat) => [...root(chat).querySelectorAll('.cvt-bubble')].map((bubble) => bubble.textContent);
const threadText = (chat: CivitaiChat) => root(chat).querySelector('civitai-chat-thread')?.textContent ?? '';
const running = (chat: CivitaiChat) => root(chat).querySelector('button.cvt-send[aria-label="Stop"]') !== null;

/** FIRST → FIRST_REPLY, then ASKED → REFUSED_REPLY, both finished. */
async function refusedOnce(more: (string | 'hang')[] = []) {
  const asked = gateway([FIRST_REPLY, REFUSED_REPLY, ...more]);
  const store = memoryStore();
  const chat = await mount(store);
  await chat.send(FIRST);
  await vi.waitFor(() => expect(threadText(chat)).toContain(FIRST_REPLY));
  await chat.send(ASKED);
  await vi.waitFor(() => expect(threadText(chat)).toContain(REFUSED_REPLY));
  await vi.waitFor(() => expect(running(chat)).toBe(false));
  return { chat, store, asked };
}

describe('askAgain()', () => {
  it('replaces the reply to the latest message with a fresh one, and never adds the message twice', async () => {
    const { chat, store, asked } = await refusedOnce([FRESH_REPLY]);

    await expect(chat.askAgain()).resolves.toBe(true);
    await vi.waitFor(() => expect(threadText(chat)).toContain(FRESH_REPLY));
    await vi.waitFor(() => expect(running(chat)).toBe(false));

    // On screen: one copy of the message, the refusal gone, the fresh reply in its place.
    expect(bubbles(chat)).toEqual([FIRST, ASKED]);
    expect(threadText(chat)).not.toContain(REFUSED_REPLY);
    // The model was asked once more, with the message once.
    expect(asked).toHaveLength(3);
    expect(asked[2]!.filter((text) => text.includes(ASKED))).toHaveLength(1);
    // Saved the same way: two turns, the second with the fresh reply.
    await vi.waitFor(() => expect(JSON.stringify([...store.records.values()][0]!.turns)).toContain(FRESH_REPLY));
    const saved = [...store.records.values()][0]!;
    expect(saved.turns.map((turn) => turn.user.content)).toEqual([FIRST, ASKED]);
    expect(JSON.stringify(saved)).not.toContain(REFUSED_REPLY);
  });

  it('goes through before-send as an edit, which the page may cancel', async () => {
    const { chat, asked } = await refusedOnce();
    const seen: BeforeSendDetail[] = [];
    chat.addEventListener('before-send', (event) => {
      seen.push((event as CustomEvent<BeforeSendDetail>).detail);
      event.preventDefault();
    });

    await expect(chat.askAgain()).resolves.toBe(false);
    expect(seen.map(({ text, edit }) => ({ text, edit }))).toEqual([{ text: ASKED, edit: true }]);
    expect(asked).toHaveLength(2);
    expect(threadText(chat)).toContain(REFUSED_REPLY);
  });

  it('asks nothing while a reply runs, nor while the page holds the chat', async () => {
    const { chat, asked } = await refusedOnce(['hang']);
    chat.holdReason = 'Starting your app…';
    await chat.updateComplete;
    await expect(chat.askAgain()).resolves.toBe(false);
    expect(asked).toHaveLength(2);

    chat.holdReason = undefined;
    await chat.updateComplete;
    await expect(chat.askAgain()).resolves.toBe(true);
    await vi.waitFor(() => expect(running(chat)).toBe(true));
    await expect(chat.askAgain()).resolves.toBe(false);
    expect(asked).toHaveLength(3);
  });

  it('asks nothing in a chat with no message yet', async () => {
    const asked = gateway([]);
    const chat = await mount(memoryStore());
    await expect(chat.askAgain()).resolves.toBe(false);
    expect(asked).toHaveLength(0);
    expect(bubbles(chat)).toEqual([]);
  });
});
