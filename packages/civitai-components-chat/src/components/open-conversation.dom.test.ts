import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatBackend } from '../backend.js';
import type { ChatConversation } from '../store/conversation-store.js';
import { memoryStore, textReply, urlOf } from '../test-support/fake-backend.js';
import { fakeRunner, RUNNER_URL } from '../test-support/fake-runner.js';
import type { ChatChangeDetail, CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * Deep-linking a conversation: the page opens one by id (`conversation-id`, `conversationId`,
 * `open(id)`) and hears which one is open (`chat-change`), in every store the chat can keep chats in.
 */

/** The deep-link API as a page uses it: `conversationId` and `open()`. */
type Linkable = CivitaiChat & { conversationId?: string | null; open(id: string): Promise<boolean> };

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const T = '2026-10-15T00:00:00Z';
/** What each saved chat's one turn says, so the thread shows which chat is open. */
const WORDS: Record<string, string> = { CONV1: 'about cats', CONV2: 'about dogs' };
const savedTurn = (words: string) => ({ seq: 1, createdAt: T, user: { content: words, attachments: [] }, assistant: { status: 'done', messages: [{ role: 'assistant', content: `Reply ${words}.` }] } });

const head = (conversationId: string) => ({
  id: `head-${conversationId}`,
  status: 'succeeded',
  tags: ['chat-cvt', 'cvt:turn', 'cvt:head', `cvt:conv:${conversationId}`],
  metadata: { v: 2, app: 'chat-cvt', conversationId, title: conversationId, titleSource: 'llm', createdAt: T, updatedAt: T, turns: [savedTurn(WORDS[conversationId]!)] },
});

/** A signed-in viewer whose orchestrator holds chats `CONV1` and `CONV2`, and nothing else. */
function fakeApp() {
  return {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: {
      queryWorkflows: vi.fn(async (query: { tags: string[] }) => {
        const conv = query.tags.find((tag) => tag.startsWith('cvt:conv:'))?.slice('cvt:conv:'.length);
        if (!conv || !query.tags.includes('cvt:head')) return { items: [], next: '' };
        return { items: conv in WORDS ? [head(conv)] : [], next: '' };
      }),
      submitWorkflow: vi.fn(async () => ({ id: '7-1', cost: { total: 0 } })),
    },
  };
}

/** Every request but a read, by method and URL: opening a chat makes none. */
function stubFetch(): string[] {
  const writes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if ((init?.method ?? 'GET') !== 'GET') writes.push(`${init?.method} ${url}`);
      return url.includes('chat/completions') ? textReply('Hello ', 'there.') : new Response('{}');
    }),
  );
  return writes;
}

const record = (id: string, words: string): ChatConversation => ({ id, title: id, titleSource: 'llm', createdAt: T, updatedAt: T, turns: [savedTurn(words) as never] });

/** A host store holding `A` and `B`. */
const hostStore = () => memoryStore([record('A', 'about apples'), record('B', 'about bananas')]);
const backendOf = (store: ReturnType<typeof memoryStore>): ChatBackend => ({ url: '/api/llm', model: 'host/default-model', store });

/** Mounts the chat with a `chat-change` listener on before it starts, so the first announcement is seen. */
async function mount(set: (chat: Linkable) => void): Promise<{ chat: Linkable; seen: (string | null)[] }> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat') as Linkable;
  const seen: (string | null)[] = [];
  chat.addEventListener('chat-change', (event) => seen.push((event as CustomEvent<ChatChangeDetail>).detail.chatId));
  set(chat);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return { chat, seen };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const threadText = (chat: CivitaiChat) => chat.shadowRoot!.querySelector('civitai-chat-thread')?.textContent ?? '';
const toasts = (chat: CivitaiChat) => [...chat.shadowRoot!.querySelectorAll('civitai-toast-region civitai-toast')].map((toast) => toast.textContent?.trim());
/** The store calls opening made: everything but listing the chats. */
const opens = (store: ReturnType<typeof memoryStore>) => store.calls.filter((call) => call !== 'list');

describe('<civitai-chat> deep-linking: orchestrator store', () => {
  const signedIn = (c: CivitaiChat) => {
    c.mcp = { orchestration: false, site: false };
    c.app = fakeApp() as never;
  };

  it('opens the conversation-id it starts with, in place of the last chat, and names only that one', async () => {
    const writes = stubFetch();
    localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
    const { chat, seen } = await mount((c) => {
      c.setAttribute('conversation-id', 'CONV2');
      signedIn(c);
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV2'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('about dogs'));
    await settle();
    expect(seen).toEqual(['CONV2']);
    expect(threadText(chat)).not.toContain('about cats');
    expect(toasts(chat)).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('opens a conversation-id set later, by attribute and by property; one already open is not read again', async () => {
    const writes = stubFetch();
    const { chat, seen } = await mount(signedIn);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    const fresh = seen[0]!;
    const app = chat.app as unknown as ReturnType<typeof fakeApp>;

    chat.setAttribute('conversation-id', 'CONV1');
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV1'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('about cats'));

    chat.conversationId = 'CONV2';
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV2'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('about dogs'));

    const reads = app.orchestration.queryWorkflows.mock.calls.length;
    chat.conversationId = 'CONV2';
    chat.setAttribute('conversation-id', 'CONV2');
    await settle();
    expect(app.orchestration.queryWorkflows.mock.calls.length).toBe(reads);
    expect(seen).toEqual([fresh, 'CONV1', 'CONV2']);
    expect(app.orchestration.submitWorkflow).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('open(id) resolves true once that chat is open', async () => {
    const writes = stubFetch();
    const { chat, seen } = await mount(signedIn);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await expect(chat.open('CONV1')).resolves.toBe(true);
    expect(chat.chatId).toBe('CONV1');
    expect(threadText(chat)).toContain('about cats');
    // The open chat: nothing to do.
    await expect(chat.open('CONV1')).resolves.toBe(true);
    expect(seen.slice(1)).toEqual(['CONV1']);
    expect(writes).toEqual([]);
  });

  it('open(id) called before the chat starts opens that chat once it does', async () => {
    stubFetch();
    const chat = document.createElement('civitai-chat') as Linkable;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const opening = chat.open('CONV2');
    signedIn(chat);
    document.body.append(chat);
    await expect(opening).resolves.toBe(true);
    expect(chat.chatId).toBe('CONV2');
  });

  it('an unknown id says it could not open the chat and starts a new one; it never becomes the open chat', async () => {
    const writes = stubFetch();
    const { chat, seen } = await mount(signedIn);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await chat.open('CONV1');

    await expect(chat.open('NOPE')).resolves.toBe(false);
    expect(chat.chatId).not.toBe('NOPE');
    expect(chat.chatId).not.toBe('CONV1');
    await vi.waitFor(() => expect(toasts(chat)).toEqual(['Could not open that chat.']));
    expect(seen).not.toContain('NOPE');
    expect(seen.slice(1)).toEqual(['CONV1', chat.chatId]);
    expect(writes).toEqual([]);
  });

  it('an unknown conversation-id at start says so and starts a new chat', async () => {
    stubFetch();
    const { chat, seen } = await mount((c) => {
      c.setAttribute('conversation-id', 'NOPE');
      signedIn(c);
    });
    await vi.waitFor(() => expect(toasts(chat)).toEqual(['Could not open that chat.']));
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(expect.any(String));
    expect(seen[0]).not.toBe('NOPE');
    expect(chat.chatId).toBe(seen[0]);
  });
});

describe('<civitai-chat> deep-linking: host store', () => {
  it('opens the conversation-id it starts with, then by property and by open(), reading the store only', async () => {
    stubFetch();
    const store = hostStore();
    const { chat, seen } = await mount((c) => {
      c.setAttribute('conversation-id', 'A');
      c.backend = backendOf(store);
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('A'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('about apples'));

    chat.conversationId = 'B';
    await vi.waitFor(() => expect(chat.chatId).toBe('B'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('about bananas'));
    // Already open: not read again.
    chat.conversationId = 'B';
    await settle();

    await expect(chat.open('A')).resolves.toBe(true);
    expect(threadText(chat)).toContain('about apples');

    expect(seen).toEqual(['A', 'B', 'A']);
    expect(opens(store)).toEqual(['load A', 'load B', 'load A']);
    expect(toasts(chat)).toEqual([]);
  });

  it('an unknown id, and one the store cannot read, start a new chat and say so; nothing is saved', async () => {
    stubFetch();
    const store = hostStore();
    const load = store.load.bind(store);
    store.load = async (id, options) => {
      if (id === 'BROKEN') throw new Error('503');
      return load(id, options);
    };
    const { chat, seen } = await mount((c) => (c.backend = backendOf(store)));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await chat.open('A');

    await expect(chat.open('NOPE')).resolves.toBe(false);
    await vi.waitFor(() => expect(toasts(chat)).toEqual(['Could not open that chat.']));
    const afterUnknown = chat.chatId;
    expect(afterUnknown).not.toBe('NOPE');
    expect(afterUnknown).not.toBe('A');

    await chat.open('A');
    await expect(chat.open('BROKEN')).resolves.toBe(false);
    await vi.waitFor(() => expect(toasts(chat)).toHaveLength(2));
    expect(toasts(chat)[1]).toBe('Could not open that chat.');
    expect(chat.chatId).not.toBe('BROKEN');

    expect(seen).not.toContain('NOPE');
    expect(seen).not.toContain('BROKEN');
    expect(opens(store)).toEqual(['load A', 'load NOPE', 'load A']);
    expect(store.records.has('NOPE')).toBe(false);
  });

  it('chat-change follows a deep-linked chat through new chat and delete', async () => {
    stubFetch();
    const store = hostStore();
    const { chat, seen } = await mount((c) => {
      c.conversationId = 'A';
      c.backend = backendOf(store);
    });
    await vi.waitFor(() => expect(seen).toEqual(['A']));

    chat.newChat();
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).not.toBe('A');

    await chat.open('B');
    expect(seen.slice(2)).toEqual(['B']);
    chat.shadowRoot!.querySelector<{ ask(): Promise<boolean> } & Element>('#cvt-delete-dialog')!.ask = async () => true;
    chat.shadowRoot!.querySelector('civitai-chat-sidebar')!.dispatchEvent(new CustomEvent('cvt-delete', { detail: { id: 'B', title: 'B' }, bubbles: true, composed: true }));
    await vi.waitFor(() => expect(store.records.has('B')).toBe(false));
    await settle();
    expect(seen).toHaveLength(4);
    expect(seen[3]).not.toBe('B');
    expect(chat.chatId).toBe(seen[3]);
  });
});

describe('<civitai-chat> deep-linking: server runner', () => {
  /** Starts a run on the runner for `conversationId`'s second turn, as another tab or device would. */
  async function liveRun(runner: ReturnType<typeof fakeRunner>, conversationId: string, words: string): Promise<string> {
    const started = await runner.fetch(`${RUNNER_URL}/runs`, {
      method: 'POST',
      body: JSON.stringify({ v: 1, idempotencyKey: `k-${conversationId}`, conversationId, turn: { seq: 2, user: { content: words } }, model: 'm', settings: {}, page: {} }),
    });
    return ((await started.json()) as { runId: string }).runId;
  }

  it('opening a chat by conversation-id, property and open() follows its live run again', async () => {
    const writes = stubFetch();
    const runner = fakeRunner();
    const run = await liveRun(runner, 'CONV1', 'draw a fox');
    const lookups = (id: string) => runner.requests.filter((request) => request.method === 'GET' && request.path === `runs?conversationId=${id}`).length;

    const { chat, seen } = await mount((c) => {
      c.setAttribute('conversation-id', 'CONV1');
      c.runner = 'remote';
      c.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch };
      c.app = fakeApp() as never;
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV1'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('draw a fox'));
    await vi.waitFor(() => expect(runner.eventOpens(run)).toHaveLength(1));
    expect(lookups('CONV1')).toBe(1);
    expect(chat.canSend).toBe(false);

    chat.conversationId = 'CONV2';
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV2'));
    await vi.waitFor(() => expect(lookups('CONV2')).toBe(1));
    await vi.waitFor(() => expect(chat.canSend).toBe(true));

    await expect(chat.open('CONV1')).resolves.toBe(true);
    await vi.waitFor(() => expect(runner.eventOpens(run)).toHaveLength(2));
    expect(lookups('CONV1')).toBe(2);
    await vi.waitFor(() => expect(threadText(chat)).toContain('draw a fox'));

    expect(seen).toEqual(['CONV1', 'CONV2', 'CONV1']);
    // Opening started nothing on the runner and wrote nothing.
    expect(runner.requests.filter((request) => request.method !== 'GET')).toHaveLength(1);
    expect(writes).toEqual([]);
    runner.push(run, { type: 'run-ended', status: 'done', messages: [], steps: 1 });
  });
});
