import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatBackend, ChatStoreBackend } from '../backend.js';
import type { ChatConversation } from '../store/conversation-store.js';
import { memoryStore, sse, textReply, urlOf } from '../test-support/fake-backend.js';
import { fakeRunner, RUNNER_URL } from '../test-support/fake-runner.js';
import type { ChatChangeDetail, CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * Deep-linking a conversation: the page opens one by id (`conversation-id`, `conversationId`) and
 * hears which one is open, and whether it is saved (`chat-change`), in every store the chat can keep
 * chats in.
 */

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

/** Every request but a read, by method and URL: opening a chat makes none. `reply` answers the model. */
function stubFetch(reply: (init?: RequestInit) => Response = () => textReply('Hello ', 'there.')): string[] {
  const writes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.includes('chat/completions')) return reply(init);
      if ((init?.method ?? 'GET') !== 'GET') writes.push(`${init?.method} ${url}`);
      return new Response('{}');
    }),
  );
  return writes;
}

/** A streamed reply that says "Partly" and then holds until `finish()`, as a long reply does. */
function heldReply(): { reply: (init?: RequestInit) => Response; finish: () => void } {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const reply = (init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { stream?: boolean };
    if (!body.stream) return Response.json({ id: 'c', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'Title' }, finish_reason: 'stop' }] });
    const encoder = new TextEncoder();
    const first = `data: ${JSON.stringify({ id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'Partly' }, finish_reason: null }] })}\n\n`;
    const rest = sse({ id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: ' done.' }, finish_reason: 'stop' }] });
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(first));
          await finished;
          controller.enqueue(new Uint8Array(await rest.arrayBuffer()));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };
  return { reply, finish };
}

const record = (id: string, words: string): ChatConversation => ({ id, title: id, titleSource: 'llm', createdAt: T, updatedAt: T, turns: [savedTurn(words) as never] });

/** A host store holding `A` and `B`. */
const hostStore = () => memoryStore([record('A', 'about apples'), record('B', 'about bananas')]);
const backendOf = (store: ReturnType<typeof memoryStore>): ChatBackend => ({ url: '/api/llm', model: 'host/default-model', store });

/** Mounts the chat with a `chat-change` listener on before it starts, so the first announcement is seen. */
async function mount(set: (chat: CivitaiChat) => void): Promise<{ chat: CivitaiChat; seen: (string | null)[]; details: ChatChangeDetail[] }> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  const details: ChatChangeDetail[] = [];
  const seen: (string | null)[] = [];
  chat.addEventListener('chat-change', (event) => {
    const detail = (event as CustomEvent<ChatChangeDetail>).detail;
    details.push(detail);
    seen.push(detail.chatId);
  });
  set(chat);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return { chat, seen, details };
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

  it('opens the conversation-id it starts with, in place of the last chat, and names only that one, saved', async () => {
    const writes = stubFetch();
    localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
    const { chat, details } = await mount((c) => {
      c.setAttribute('conversation-id', 'CONV2');
      signedIn(c);
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV2'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('about dogs'));
    await settle();
    expect(details).toEqual([{ chatId: 'CONV2', saved: true }]);
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

  it('an id set in the same update as the app opens in the session that app starts', async () => {
    stubFetch();
    const first = fakeApp();
    const { chat, seen } = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = first as never;
    });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    const second = fakeApp();
    chat.app = second as never;
    chat.conversationId = 'CONV2';
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV2'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('about dogs'));
    // Read through the new viewer's app, not the old one's.
    const headReads = (app: ReturnType<typeof fakeApp>) => app.orchestration.queryWorkflows.mock.calls.filter(([query]) => query.tags.includes('cvt:conv:CONV2') && query.tags.includes('cvt:head')).length;
    expect(headReads(second)).toBe(1);
    expect(headReads(first)).toBe(0);
    expect(toasts(chat)).toEqual([]);
  });

  it('an unknown id leaves the open chat as it is, says it could not open that chat, and is never announced', async () => {
    const writes = stubFetch();
    const { chat, seen } = await mount(signedIn);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    chat.conversationId = 'CONV1';
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV1'));

    chat.conversationId = 'NOPE';
    await vi.waitFor(() => expect(toasts(chat)).toEqual(['Could not open that chat.']));
    await settle();
    expect(chat.chatId).toBe('CONV1');
    expect(threadText(chat)).toContain('about cats');
    expect(seen.slice(1)).toEqual(['CONV1']);
    expect(writes).toEqual([]);
  });

  it('an unknown conversation-id at start says so and starts a new chat', async () => {
    stubFetch();
    const { chat, details } = await mount((c) => {
      c.setAttribute('conversation-id', 'NOPE');
      signedIn(c);
    });
    await vi.waitFor(() => expect(toasts(chat)).toEqual(['Could not open that chat.']));
    await settle();
    expect(details).toHaveLength(1);
    expect(details[0]!.chatId).not.toBe('NOPE');
    expect(details[0]!.saved).toBe(false);
    expect(chat.chatId).toBe(details[0]!.chatId);
  });
});

describe('<civitai-chat> deep-linking: host store', () => {
  it('opens the conversation-id it starts with, then each id set later, reading the store only', async () => {
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

    chat.setAttribute('conversation-id', 'A');
    await vi.waitFor(() => expect(chat.chatId).toBe('A'));
    await settle();

    expect(seen).toEqual(['A', 'B', 'A']);
    expect(opens(store)).toEqual(['load A', 'load B', 'load A']);
    expect(toasts(chat)).toEqual([]);
  });

  it('asking for the open chat again while another is loading ends with the one asked for last open', async () => {
    stubFetch();
    const store = hostStore();
    const load = store.load.bind(store);
    let answerB: (() => void) | undefined;
    store.load = (id, options) => (id === 'B' ? new Promise((resolve) => (answerB = () => void load(id, options).then(resolve))) : load(id, options));
    const { chat } = await mount((c) => {
      c.conversationId = 'A';
      c.backend = backendOf(store);
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('A'));

    chat.conversationId = 'B';
    await vi.waitFor(() => expect(answerB).toBeDefined());
    // A is still the open chat while B loads, but B is about to replace it: A is opened again.
    expect(chat.chatId).toBe('A');
    chat.conversationId = 'A';
    await vi.waitFor(() => expect(opens(store).filter((call) => call === 'load A')).toHaveLength(2));
    answerB!();
    await settle();
    expect(chat.chatId).toBe('A');
    expect(threadText(chat)).toContain('about apples');
  });

  it('a link that cannot be opened (unknown, or a read that fails) keeps the open chat and its running reply; nothing is saved', async () => {
    const held = heldReply();
    stubFetch(held.reply);
    const store = hostStore();
    const load = store.load.bind(store);
    store.load = async (id, options) => {
      if (id === 'BROKEN') throw new Error('503');
      return load(id, options);
    };
    const { chat, seen } = await mount((c) => {
      c.conversationId = 'A';
      c.backend = backendOf(store);
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('A'));
    void chat.send('more about apples');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Partly'));
    expect(chat.canSend).toBe(false);

    chat.conversationId = 'NOPE';
    await vi.waitFor(() => expect(toasts(chat)).toEqual(['Could not open that chat.']));
    chat.conversationId = 'BROKEN';
    await vi.waitFor(() => expect(toasts(chat)).toHaveLength(2));
    expect(toasts(chat)[1]).toBe('Could not open that chat.');
    expect(chat.chatId).toBe('A');
    // The reply was not stopped: it is still running, and ends in A.
    expect(chat.canSend).toBe(false);
    held.finish();
    await vi.waitFor(() => expect(threadText(chat)).toContain('Partly done.'));
    await vi.waitFor(() => expect(store.records.get('A')!.turns).toHaveLength(2));
    expect(store.records.get('A')!.turns[1]?.assistant?.status).toBe('done');

    expect(seen).toEqual(['A']);
    expect(opens(store).filter((call) => call.startsWith('load'))).toEqual(['load A', 'load NOPE']);
    expect(store.records.has('NOPE')).toBe(false);
    const saves = opens(store).filter((call) => call.startsWith('save'));
    expect(saves.length).toBeGreaterThan(0);
    expect(new Set(saves)).toEqual(new Set(['save A']));
  });

  it('chat-change says whether the open chat is saved: a new chat is not, until its first save', async () => {
    stubFetch();
    const store = hostStore();
    const { chat, details } = await mount((c) => {
      c.conversationId = 'A';
      c.backend = backendOf(store);
    });
    await vi.waitFor(() => expect(details).toEqual([{ chatId: 'A', saved: true }]));

    chat.newChat();
    await vi.waitFor(() => expect(details).toHaveLength(2));
    const fresh = details[1]!.chatId!;
    expect(details[1]).toEqual({ chatId: fresh, saved: false });

    await chat.send('hello');
    await vi.waitFor(() => expect(store.records.has(fresh)).toBe(true));
    await vi.waitFor(() => expect(details).toHaveLength(3));
    await settle();
    expect(details.slice(2)).toEqual([{ chatId: fresh, saved: true }]);
  });

  it("the README's URL pattern: a reload of a new chat shows no error, and a reload of a saved one reopens it", async () => {
    stubFetch();
    const store = hostStore();
    // The page's own code from the README: `?c=` only for a saved chat.
    let query: string | null = null;
    const keepUrl = (chat: CivitaiChat) =>
      chat.addEventListener('chat-change', (event) => {
        const { chatId, saved } = (event as CustomEvent<ChatChangeDetail>).detail;
        query = chatId && saved ? chatId : null;
      });
    const page = () =>
      mount((c) => {
        keepUrl(c);
        c.conversationId = query;
        c.backend = backendOf(store);
      });

    const first = await page();
    await vi.waitFor(() => expect(first.details).toHaveLength(1));
    expect(query).toBeNull();
    first.chat.remove();

    // Reloaded before anything was sent: no link to a chat that does not exist yet, so no error.
    const reloaded = await page();
    await vi.waitFor(() => expect(reloaded.details).toHaveLength(1));
    await settle();
    expect(toasts(reloaded.chat)).toEqual([]);
    await reloaded.chat.send('hello');
    const sent = reloaded.chat.chatId!;
    await vi.waitFor(() => expect(query).toBe(sent));
    reloaded.chat.remove();

    const again = await page();
    await vi.waitFor(() => expect(again.chat.chatId).toBe(sent));
    await settle();
    expect(toasts(again.chat)).toEqual([]);
    expect(threadText(again.chat)).toContain('hello');
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

    chat.conversationId = 'B';
    await vi.waitFor(() => expect(seen.slice(2)).toEqual(['B']));
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
  const lookups = (runner: ReturnType<typeof fakeRunner>, id: string) => runner.requests.filter((request) => request.method === 'GET' && request.path === `runs?conversationId=${id}`).length;

  it('orchestrator store: opening a chat by conversation-id and by property follows its live run again', async () => {
    const writes = stubFetch();
    const runner = fakeRunner();
    const run = await liveRun(runner, 'CONV1', 'draw a fox');

    const { chat, seen } = await mount((c) => {
      c.setAttribute('conversation-id', 'CONV1');
      c.runner = 'remote';
      c.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch };
      c.app = fakeApp() as never;
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV1'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('draw a fox'));
    await vi.waitFor(() => expect(runner.eventOpens(run)).toHaveLength(1));
    expect(lookups(runner, 'CONV1')).toBe(1);
    expect(chat.canSend).toBe(false);

    chat.conversationId = 'CONV2';
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV2'));
    await vi.waitFor(() => expect(lookups(runner, 'CONV2')).toBe(1));
    await vi.waitFor(() => expect(chat.canSend).toBe(true));

    chat.conversationId = 'CONV1';
    await vi.waitFor(() => expect(chat.chatId).toBe('CONV1'));
    await vi.waitFor(() => expect(runner.eventOpens(run)).toHaveLength(2));
    expect(lookups(runner, 'CONV1')).toBe(2);
    await vi.waitFor(() => expect(threadText(chat)).toContain('draw a fox'));

    expect(seen).toEqual(['CONV1', 'CONV2', 'CONV1']);
    // Opening started nothing on the runner and wrote nothing.
    expect(runner.requests.filter((request) => request.method !== 'GET')).toHaveLength(1);
    expect(writes).toEqual([]);
    runner.push(run, { type: 'run-ended', status: 'done', messages: [], steps: 1 });
  });

  it("a host's store-only backend: opening by conversation-id and by property follows the live run; an unknown id keeps the open chat", async () => {
    const writes = stubFetch();
    const runner = fakeRunner();
    const store = hostStore();
    const run = await liveRun(runner, 'A', 'draw a fox');
    const backend: ChatStoreBackend = { model: 'host/default-model', store };

    const { chat, seen } = await mount((c) => {
      c.setAttribute('conversation-id', 'A');
      c.runner = 'remote';
      c.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch };
      c.backend = backend;
    });
    await vi.waitFor(() => expect(chat.chatId).toBe('A'));
    await vi.waitFor(() => expect(threadText(chat)).toContain('draw a fox'));
    await vi.waitFor(() => expect(runner.eventOpens(run)).toHaveLength(1));
    expect(lookups(runner, 'A')).toBe(1);

    chat.conversationId = 'B';
    await vi.waitFor(() => expect(chat.chatId).toBe('B'));
    await vi.waitFor(() => expect(lookups(runner, 'B')).toBe(1));
    expect(threadText(chat)).toContain('about bananas');

    chat.conversationId = 'NOPE';
    await vi.waitFor(() => expect(toasts(chat)).toEqual(['Could not open that chat.']));
    expect(chat.chatId).toBe('B');
    expect(lookups(runner, 'NOPE')).toBe(0);

    chat.conversationId = 'A';
    await vi.waitFor(() => expect(runner.eventOpens(run)).toHaveLength(2));
    expect(seen).toEqual(['A', 'B', 'A']);
    expect(opens(store)).toEqual(['load A', 'load B', 'load NOPE', 'load A']);
    expect(writes).toEqual([]);
    runner.push(run, { type: 'run-ended', status: 'done', messages: [], steps: 1 });
  });
});
