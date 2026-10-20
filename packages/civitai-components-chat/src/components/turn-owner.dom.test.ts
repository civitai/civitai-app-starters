import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatBackend } from '../backend.js';
import type { ChatConversation } from '../store/conversation-store.js';
import { memoryStore, urlOf } from '../test-support/fake-backend.js';
import type { CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * A reply that is still running when the viewer leaves its chat (a deep link, or a new chat) is
 * stopped, and how it ended is saved into ITS OWN chat: never into the chat opened in its place.
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const T = '2026-10-15T00:00:00Z';
const savedTurn = (words: string) => ({ seq: 1, createdAt: T, user: { content: words, attachments: [] }, assistant: { status: 'done', messages: [{ role: 'assistant', content: `Reply ${words}.` }] } });

/** A head as the orchestrator keeps it: workflow `head-<id>`. */
const head = (conversationId: string) => ({
  id: `head-${conversationId}`,
  status: 'succeeded',
  tags: ['chat-cvt', 'cvt:turn', 'cvt:head', `cvt:conv:${conversationId}`],
  metadata: { v: 2, app: 'chat-cvt', conversationId, title: conversationId, titleSource: 'llm', createdAt: T, updatedAt: T, turns: [savedTurn(`in ${conversationId}`)] },
});

interface Template {
  externalId: string;
  metadata: { conversationId: string };
}

/** A viewer whose orchestrator holds chats `A` and `B`; every head submitted is kept, by its externalId. */
function fakeApp() {
  const submitted: Template[] = [];
  const app = {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: {
      queryWorkflows: vi.fn(async (query: { tags: string[] }) => {
        const conv = query.tags.find((tag) => tag.startsWith('cvt:conv:'))?.slice('cvt:conv:'.length);
        if (!conv || !query.tags.includes('cvt:head')) return { items: [], next: '' };
        return { items: conv === 'A' || conv === 'B' ? [head(conv)] : [], next: '' };
      }),
      submitWorkflow: vi.fn(async (template: Template) => {
        submitted.push(template);
        return { id: template.externalId, cost: { total: 0 } };
      }),
    },
  };
  return { app, submitted };
}

interface Write {
  workflowId: string;
  metadata: { conversationId: string; turns: { seq: number; assistant?: unknown }[] };
}

/**
 * Every head write (`PUT …/workflows/<id>`), and model replies that say "Partly" and then run until the
 * page stops them.
 */
function stubFetch(): Write[] {
  const writes: Write[] = [];
  const encoder = new TextEncoder();
  const chunk = { id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'Partly' }, finish_reason: null }] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const put = /\/workflows\/([^/?]+)$/.exec(url);
      if (init?.method === 'PUT' && put) {
        writes.push({ workflowId: decodeURIComponent(put[1]!), metadata: (JSON.parse(String(init.body)) as { metadata: Write['metadata'] }).metadata });
        return new Response(null, { status: 204 });
      }
      if (!url.includes('chat/completions')) return new Response('{}');
      const signal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }),
  );
  return writes;
}

async function mount(set: (chat: CivitaiChat) => void): Promise<CivitaiChat> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  set(chat);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return chat;
}

const threadText = (chat: CivitaiChat) => chat.shadowRoot!.querySelector('civitai-chat-thread')?.textContent ?? '';
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe('<civitai-chat> a running reply left behind: orchestrator store, replies in the browser', () => {
  /** Chat B open, with a reply to "more in B" running in it. */
  async function replyingInB() {
    const writes = stubFetch();
    const { app, submitted } = fakeApp();
    const chat = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.conversationId = 'B';
      c.app = app as never;
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('B'));
    void chat.send('more in B');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Partly'));
    // The new message is saved as B's head for turn 2 as it is sent.
    await vi.waitFor(() => expect(submitted.map((template) => template.externalId)).toEqual(['cvt-head-B-2']));
    return { chat, writes, submitted };
  }

  /** B's head for turn 2 was written with that turn stopped, and nothing was saved for any other chat. */
  async function expectStoppedInB(writes: Write[], submitted: Template[], other: string): Promise<void> {
    await vi.waitFor(() => expect(writes.some((write) => write.workflowId === 'cvt-head-B-2')).toBe(true));
    await settle();
    expect(submitted.map((template) => [template.externalId, template.metadata.conversationId])).toEqual([['cvt-head-B-2', 'B']]);
    expect(writes.map((write) => [write.workflowId, write.metadata.conversationId])).toEqual([['cvt-head-B-2', 'B']]);
    const turns = writes[0]!.metadata.turns;
    expect(turns.map((turn) => turn.seq)).toEqual([1, 2]);
    expect(turns[1]!.assistant).toMatchObject({ status: 'aborted', messages: [{ role: 'assistant', content: 'Partly' }] });
    expect(writes.some((write) => write.metadata.conversationId === other)).toBe(false);
    expect(submitted.some((template) => template.metadata.conversationId === other)).toBe(false);
  }

  it('a deep link to A mid-reply: A is not written, and B keeps the stopped turn', async () => {
    const { chat, writes, submitted } = await replyingInB();
    chat.conversationId = 'A';
    await vi.waitFor(() => expect(chat.chatId).toBe('A'));
    await expectStoppedInB(writes, submitted, 'A');
    expect(writes.some((write) => write.workflowId === 'head-A')).toBe(false);
  });

  it('newChat() mid-reply: the new chat is not written, and B keeps the stopped turn', async () => {
    const { chat, writes, submitted } = await replyingInB();
    chat.newChat();
    const fresh = chat.chatId!;
    expect(fresh).not.toBe('B');
    await expectStoppedInB(writes, submitted, fresh);
  });
});

describe('<civitai-chat> a running reply left behind: host store (unchanged)', () => {
  const T2 = '2026-10-15T00:00:00Z';
  const record = (id: string): ChatConversation => ({ id, title: id, titleSource: 'llm', createdAt: T2, updatedAt: T2, turns: [savedTurn(`in ${id}`) as never] });

  async function replyingInB() {
    stubFetch();
    const store = memoryStore([record('A'), record('B')]);
    const backend: ChatBackend = { url: '/api/llm', model: 'host/m', store };
    const chat = await mount((c) => {
      c.conversationId = 'B';
      c.backend = backend;
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('B'));
    void chat.send('more in B');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Partly'));
    return { chat, store };
  }

  async function expectStoppedInB(store: ReturnType<typeof memoryStore>, other: string): Promise<void> {
    await vi.waitFor(() => expect(store.records.get('B')!.turns[1]?.assistant).toMatchObject({ status: 'aborted' }));
    await settle();
    expect(store.records.get('B')!.turns.map((turn) => turn.seq)).toEqual([1, 2]);
    expect(store.records.get('B')!.turns[1]!.assistant).toMatchObject({ status: 'aborted', messages: [{ role: 'assistant', content: 'Partly' }] });
    expect(store.calls.filter((call) => call.startsWith('save') && call !== 'save B')).toEqual([]);
    expect(store.calls).not.toContain(`save ${other}`);
  }

  it('a deep link to A mid-reply: A is not saved, and B keeps the stopped turn', async () => {
    const { chat, store } = await replyingInB();
    chat.conversationId = 'A';
    await vi.waitFor(() => expect(chat.chatId).toBe('A'));
    await expectStoppedInB(store, 'A');
    expect(store.records.get('A')!.turns).toHaveLength(1);
  });

  it('newChat() mid-reply: the new chat is not saved, and B keeps the stopped turn', async () => {
    const { chat, store } = await replyingInB();
    chat.newChat();
    const fresh = chat.chatId!;
    await expectStoppedInB(store, fresh);
    expect(store.records.has(fresh)).toBe(false);
  });
});
