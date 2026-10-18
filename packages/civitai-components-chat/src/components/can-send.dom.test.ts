import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { memoryStore, textReply, urlOf } from '../test-support/fake-backend.js';
import { fakeMcpServers } from '../test-support/fake-mcp.js';
import type { CanSendChangeDetail, CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * `canSend` and `can-send-change`: whether a `send()` now would go to the assistant, and an event each
 * time that changes, so a page holding a message of its own sends it once, when the chat can take it,
 * instead of trying again on a timer.
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SANDBOX = 'https://sandbox.example/mcp';

function fakeApp() {
  return {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn() },
  } as never;
}

/** An OpenAI-compatible streamed reply of `words`. */
function reply(words: string): Response {
  const chunks = [
    { id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: words }, finish_reason: null }] },
    { id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  const body = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

/** The chat's model requests, each answering only when the test says so. */
function heldReplies() {
  const waiting: (() => void)[] = [];
  const asked: string[] = [];
  const fetch = vi.fn((url: unknown, init?: RequestInit) => {
    if (!String(url).includes('chat/completions')) return Promise.resolve(new Response('{}'));
    asked.push(String(init?.body ?? ''));
    return new Promise<Response>((resolve) => waiting.push(() => resolve(reply('Done.'))));
  });
  return { fetch, asked, answer: () => waiting.splice(0).forEach((go) => go()) };
}

/** Every `can-send-change` the chat fires, in order, with what `canSend` read as each one fired. */
function recordChanges(chat: CivitaiChat) {
  const seen: { detail: boolean; read: boolean }[] = [];
  chat.addEventListener('can-send-change', (event) => seen.push({ detail: (event as CustomEvent<CanSendChangeDetail>).detail.canSend, read: chat.canSend }));
  return seen;
}

async function mount(setup: (chat: CivitaiChat) => void = () => undefined) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  // No Civitai tool servers, so a reply goes straight to the model.
  chat.mcp = { orchestration: false, site: false };
  const changes = recordChanges(chat);
  setup(chat);
  chat.app = fakeApp();
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return { chat, changes };
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('<civitai-chat> canSend', () => {
  it('is false until the chat has started, then true, announced once', async () => {
    vi.stubGlobal('fetch', heldReplies().fetch);
    expect(document.createElement('civitai-chat').canSend).toBe(false);
    const { chat, changes } = await mount();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    await settle();
    expect(changes).toEqual([{ detail: true, read: true }]);
  });

  it('NEGATIVE CONTROL: a signed-out chat cannot send (a send would ask the viewer to sign in)', async () => {
    const chat = document.createElement('civitai-chat');
    chat.signIn = () => new Promise(() => undefined);
    const changes = recordChanges(chat);
    document.body.append(chat);
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
    await settle();
    expect(chat.canSend).toBe(false);
    expect(changes).toEqual([]);
  });

  it('is false while holdReason is set, and the event says when the hold lifts; a send then goes', async () => {
    const replies = heldReplies();
    vi.stubGlobal('fetch', replies.fetch);
    const { chat, changes } = await mount((el) => (el.holdReason = 'Your app is starting…'));
    await settle();
    expect(chat.canSend).toBe(false);
    expect(changes).toEqual([]);
    // What canSend says is what send() does: held, it goes nowhere.
    await chat.send('build me a timer');
    await settle();
    expect(replies.asked).toHaveLength(0);

    chat.holdReason = undefined;
    await vi.waitFor(() => expect(changes).toEqual([{ detail: true, read: true }]));
    void chat.send('build me a timer');
    await vi.waitFor(() => expect(replies.asked).toHaveLength(1));
  });

  it('is false while an added server lists its tools, and the event fires as the listing ends', async () => {
    const replies = heldReplies();
    const fake = fakeMcpServers({ [SANDBOX]: [{ name: 'run_command' }] });
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    // The server answers only once the test opens it, so its listing stays in flight until then.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).startsWith(SANDBOX)) {
        await opened;
        return fake.fetch(input, init);
      }
      return replies.fetch(input, init);
    });
    const { chat, changes } = await mount();
    // A server added once the chat runs, as a page hands over an app that just started.
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    chat.mcpServers = [{ id: 'sandbox', url: SANDBOX, label: 'Sandbox', token: () => 'tok' }];
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer .cvt-composer-hold')?.textContent).toBe('Connecting to Sandbox…'));
    expect(chat.canSend).toBe(false);
    expect(changes).toEqual([
      { detail: true, read: true },
      { detail: false, read: false },
    ]);
    await chat.send('run the tests');
    await settle();
    expect(replies.asked).toHaveLength(0);

    open();
    await vi.waitFor(() => expect(changes).toHaveLength(3));
    expect(changes[2]).toEqual({ detail: true, read: true });
    expect(chat.shadowRoot!.querySelector('civitai-chat-composer .cvt-composer-hold')).toBeNull();
    void chat.send('run the tests');
    await vi.waitFor(() => expect(replies.asked).toHaveLength(1));
  });

  it('is false while a reply runs, and the event fires as it ends', async () => {
    const replies = heldReplies();
    vi.stubGlobal('fetch', replies.fetch);
    const { chat, changes } = await mount();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    void chat.send('first');
    await vi.waitFor(() => expect(replies.asked).toHaveLength(1));
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ detail: false, read: false }));
    expect(chat.canSend).toBe(false);
    // The running reply keeps sends out (with its Stop button), not a hold: no hold text under it.
    await chat.updateComplete;
    expect(chat.shadowRoot!.querySelector('civitai-chat-composer .cvt-composer-hold')).toBeNull();
    // A send mid-reply goes nowhere, as canSend says.
    await chat.send('second');
    await settle();
    expect(replies.asked).toHaveLength(1);

    replies.answer();
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ detail: true, read: true }));
    expect(changes).toEqual([
      { detail: true, read: true },
      { detail: false, read: false },
      { detail: true, read: true },
    ]);
  });

  it('fires only when canSend changes, not at every render', async () => {
    vi.stubGlobal('fetch', heldReplies().fetch);
    const { chat, changes } = await mount();
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    // Renders that leave canSend as it was.
    chat.placeholder = 'Ask me';
    await chat.updateComplete;
    chat.holdReason = '   ';
    await chat.updateComplete;
    chat.holdReason = undefined;
    await chat.updateComplete;
    await settle();
    expect(changes).toEqual([{ detail: true, read: true }]);
  });

  it('bubbles out of the element and through shadow roots, like the chat’s other events', async () => {
    vi.stubGlobal('fetch', heldReplies().fetch);
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.append(host);
    const heard = vi.fn();
    document.addEventListener('can-send-change', heard);
    try {
      const chat = document.createElement('civitai-chat');
      chat.mcp = { orchestration: false, site: false };
      chat.app = fakeApp();
      shadow.append(chat);
      await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    } finally {
      document.removeEventListener('can-send-change', heard);
    }
  });
});

/** A reply that streams its first words, then waits until the test lets it end or the request is aborted. */
function streamingReply(finished: Promise<void>, signal?: AbortSignal | null): Response {
  const encoder = new TextEncoder();
  const frame = (delta: unknown, finish: string | null) =>
    `data: ${JSON.stringify({ id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return new Response(
    new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(frame({ role: 'assistant', content: 'working' }, null)));
        const aborted = new Promise<'aborted'>((resolve) => signal?.addEventListener('abort', () => resolve('aborted'), { once: true }));
        if ((await Promise.race([finished.then(() => 'done' as const), aborted])) === 'aborted') {
          controller.error(new DOMException('aborted', 'AbortError'));
          return;
        }
        controller.enqueue(encoder.encode(`${frame({}, 'stop')}data: [DONE]\n\n`));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

/** Mounts a chat whose turns `set` decides how to start, recording `can-send-change`. */
async function mountWith(set: (chat: CivitaiChat) => void) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  const changes = recordChanges(chat);
  set(chat);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return { chat, changes };
}

const userTexts = (store: ReturnType<typeof memoryStore>, id: string) => (store.records.get(id)?.turns ?? []).map((turn) => turn.user.content);

describe('<civitai-chat> canSend across transitions', () => {
  it('🔴 opening a saved chat mid-reply: canSend stays false until it is open, so a send on true goes into it, not the chat being left', async () => {
    const store = memoryStore([{ id: 'other', title: 'Other', titleSource: 'llm', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', turns: [] }]);
    const load = store.load.bind(store);
    let answer: (() => void) | undefined;
    store.load = (id, options) => (id === 'other' ? new Promise((resolve) => (answer = () => void load(id, options).then(resolve))) : load(id, options));
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => (urlOf(input).includes('/v1/chat/completions') ? streamingReply(finished, init?.signal) : new Response('{}'))));
    const { chat, changes } = await mountWith((c) => (c.backend = { url: '/api/llm', model: 'host/m', store }));
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    const first = chat.chatId!;
    void chat.send('first');
    await vi.waitFor(() => expect(chat.canSend).toBe(false));

    // The page sends its message the first time the chat says it can.
    const opened: (string | null)[] = [];
    chat.addEventListener('chat-change', (event) => opened.push((event as CustomEvent<{ chatId: string | null }>).detail.chatId));
    let sent = false;
    chat.addEventListener('can-send-change', () => {
      if (!chat.canSend || sent) return;
      sent = true;
      void chat.send('page message');
    });
    const before = changes.length;
    chat.shadowRoot!.querySelector('civitai-chat-sidebar')!.dispatchEvent(new CustomEvent('cvt-open', { detail: { id: 'other' }, bubbles: true, composed: true }));
    await vi.waitFor(() => expect(answer).toBeDefined());
    // Opening stopped the reply; the chat being left is still the open one until the saved one loads.
    await settle(100);
    expect(chat.chatId).toBe(first);
    expect(chat.canSend).toBe(false);
    expect(changes.slice(before).filter((change) => change.detail)).toEqual([]);
    expect(sent).toBe(false);

    answer!();
    await vi.waitFor(() => expect(sent).toBe(true));
    expect(opened).toEqual(['other']);
    await vi.waitFor(() => expect(userTexts(store, 'other')).toEqual(['page message']));
    expect(userTexts(store, first)).toEqual(['first']);
    finish();
  });

  it('🔴 an accepted send makes canSend false at once, also while the viewer is asked to let the chat use their Buzz', async () => {
    let grant!: (ok: boolean) => void;
    const granted = new Promise<boolean>((resolve) => (grant = resolve));
    const replies = heldReplies();
    vi.stubGlobal('fetch', replies.fetch);
    const app = { ...(fakeApp() as object), requestGrants: () => granted } as never;
    const { chat, changes } = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = app;
    });
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    void chat.send('first');
    await chat.updateComplete;
    // Asked for the grant: nothing has gone, but a second send now would be lost, so canSend says no.
    expect(chat.canSend).toBe(false);
    const sends = vi.fn();
    chat.addEventListener('before-send', sends);
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ detail: false, read: false }));
    await settle();
    expect(replies.asked).toHaveLength(0);
    expect(chat.canSend).toBe(false);

    // A second send in the gap is refused, as canSend said; the first goes once the grant is given.
    void chat.send('second');
    grant(true);
    await vi.waitFor(() => expect(replies.asked).toHaveLength(1));
    expect(sends.mock.calls.map(([event]) => (event as CustomEvent<{ text: string }>).detail.text)).toEqual(['first']);
    expect(chat.canSend).toBe(false);
    replies.answer();
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ detail: true, read: true }));
  });

  it('a refused grant ends the send: canSend is true again and the message waits in the box', async () => {
    const replies = heldReplies();
    vi.stubGlobal('fetch', replies.fetch);
    const app = { ...(fakeApp() as object), requestGrants: async () => false } as never;
    const { chat, changes } = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = app;
    });
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    await chat.send('first');
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    await settle();
    expect(chat.draft).toBe('first');
    expect(replies.asked).toHaveLength(0);
    expect(changes.at(-1)).toEqual({ detail: true, read: true });
  });

  it('🔴 handed a new app while a server lists its tools, it never says it can send in between', async () => {
    const fake = fakeMcpServers({ [SANDBOX]: [{ name: 'run_command' }] });
    // The server never answers, so every listing stays in flight.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).startsWith(SANDBOX) ? new Promise<Response>(() => undefined) : heldReplies().fetch(input, init),
    );
    void fake;
    const { chat, changes } = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.mcpServers = [{ id: 'sandbox', url: SANDBOX, label: 'Sandbox', token: () => 'tok' }];
      c.app = fakeApp();
    });
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer .cvt-composer-hold')?.textContent).toBe('Connecting to Sandbox…'));
    await settle();
    const before = changes.length;
    expect(chat.canSend).toBe(false);
    chat.app = fakeApp();
    await chat.updateComplete;
    // The old session's servers are closed at once; the new one lists them again.
    expect(chat.canSend).toBe(false);
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer .cvt-composer-hold')?.textContent).toBe('Connecting to Sandbox…'));
    await settle(100);
    expect(chat.canSend).toBe(false);
    expect(changes.slice(before)).toEqual([]);
  });

  it('signing out (no app any more) makes canSend false', async () => {
    vi.stubGlobal('fetch', heldReplies().fetch);
    const { chat, changes } = await mount();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    chat.app = undefined;
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ detail: false, read: false }));
  });

  it('a server that cannot be reached ends its listing: canSend is true again', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).startsWith(SANDBOX) ? Promise.reject(new TypeError('fetch failed')) : heldReplies().fetch(input, init),
    );
    const { chat, changes } = await mount((el) => (el.mcpServers = [{ id: 'sandbox', url: SANDBOX, label: 'Sandbox', token: () => 'tok' }]));
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ detail: true, read: true }));
  });

  it('a reply that fails ends: canSend is true again', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => (urlOf(input).includes('chat/completions') ? new Response('nope', { status: 400 }) : new Response('{}')));
    vi.stubGlobal('fetch', fetch);
    const { chat, changes } = await mount();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    void chat.send('hello');
    await vi.waitFor(() => expect(fetch.mock.calls.some(([input]) => urlOf(input as RequestInfo).includes('chat/completions'))).toBe(true));
    await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-thread')?.textContent ?? '').not.toBe(''));
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ detail: true, read: true }));
    expect(changes.map((change) => change.detail)).toEqual([true, false, true]);
  });

  it('a reply the viewer stops ends: canSend is true again', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => (urlOf(input).includes('chat/completions') ? streamingReply(finished, init?.signal) : new Response('{}'))));
    const { chat, changes } = await mount();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    void chat.send('hello');
    await vi.waitFor(() => expect(chat.canSend).toBe(false));
    chat.shadowRoot!.querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-stop', { bubbles: true, composed: true }));
    await vi.waitFor(() => expect(changes.at(-1)).toEqual({ detail: true, read: true }));
    expect(changes.map((change) => change.detail)).toEqual([true, false, true]);
    finish();
  });
});

void textReply;

/** Saved chats CONVA and CONVB on Civitai's own store, each answering only when the test opens its gate. */
function gatedHistoryApp() {
  const gates = new Map<string, () => void>();
  const opened = new Map<string, Promise<void>>();
  for (const id of ['CONVA', 'CONVB', 'CONVC']) opened.set(id, new Promise<void>((resolve) => gates.set(id, resolve)));
  const head = (conversationId: string) => ({
    id: `head-${conversationId}`,
    status: 'succeeded',
    tags: ['chat-cvt', 'cvt:turn', 'cvt:head', `cvt:conv:${conversationId}`],
    metadata: { v: 2, app: 'chat-cvt', conversationId, title: conversationId, titleSource: 'llm', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', turns: [] },
  });
  const asked: string[] = [];
  const failing = new Set<string>();
  const app = {
    ...(fakeApp() as object),
    orchestration: {
      queryWorkflows: vi.fn(async (query: { tags: string[] }) => {
        const conv = query.tags.find((tag) => tag.startsWith('cvt:conv:'))?.slice('cvt:conv:'.length);
        if (!conv) return { items: [head('CONVA'), head('CONVB'), head('CONVC')], next: '' };
        asked.push(conv);
        await opened.get(conv);
        if (failing.has(conv)) throw new Error('the request failed');
        return { items: query.tags.includes('cvt:head') ? [head(conv)] : [], next: '' };
      }),
      submitWorkflow: vi.fn(async () => ({ id: '7-1', cost: { total: 0 } })),
    },
  } as never;
  return {
    app,
    asked,
    answer: (id: string) => gates.get(id)!(),
    /** Makes `id`'s requests fail once its gate opens. */
    fail: (id: string) => {
      failing.add(id);
      gates.get(id)!();
    },
    failing,
  };
}

describe('<civitai-chat> canSend with overlapping opens and an unanswered grant', () => {
  const openFromHistory = (chat: CivitaiChat, id: string) =>
    chat.shadowRoot!.querySelector('civitai-chat-sidebar')!.dispatchEvent(new CustomEvent('cvt-open', { detail: { id }, bubbles: true, composed: true }));

  for (const order of [['CONVA', 'CONVB'], ['CONVB', 'CONVA']] as const) {
    it(`🔴 on Civitai's own store, two chats opened in turn: canSend stays false until the LATER one is open, and it stays open (answers ${order.join(' then ')})`, async () => {
      vi.stubGlobal('fetch', heldReplies().fetch);
      const history = gatedHistoryApp();
      const { chat, changes } = await mountWith((c) => {
        c.mcp = { orchestration: false, site: false };
        c.app = history.app;
      });
      await vi.waitFor(() => expect(chat.canSend).toBe(true));
      // What the chat says each time it reports it can send: the chat a page's message would go into.
      const openWhenTrue: (string | null)[] = [];
      chat.addEventListener('can-send-change', () => chat.canSend && openWhenTrue.push(chat.chatId));
      openFromHistory(chat, 'CONVA');
      await vi.waitFor(() => expect(history.asked).toContain('CONVA'));
      openFromHistory(chat, 'CONVB');
      await settle();
      history.answer(order[0]);
      await settle(100);
      history.answer(order[1]);
      await vi.waitFor(() => expect(chat.canSend).toBe(true));
      await settle(100);
      expect(chat.chatId).toBe('CONVB');
      expect(openWhenTrue).toEqual(['CONVB']);
      expect(changes.at(-1)).toEqual({ detail: true, read: true });
    });
  }

  it('🔴 a Buzz request nobody answers (the viewer closed the dialog) does not leave the chat unable to send once it gets a new app', async () => {
    vi.stubGlobal('fetch', heldReplies().fetch);
    // As the SDK's block client: a closed dialog never settles, but a signal ends the wait.
    const ignoring = { ...(fakeApp() as object), requestGrants: () => new Promise<boolean>(() => undefined) } as never;
    const { chat } = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = ignoring;
    });
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    void chat.send('first');
    await vi.waitFor(() => expect(chat.canSend).toBe(false));
    chat.app = fakeApp();
    await settle(500);
    expect(chat.canSend).toBe(true);
  });

  it('🔴 a Buzz request nobody answers ends after a while: the message is back in the box and the chat can send again', async () => {
    vi.stubGlobal('fetch', heldReplies().fetch);
    let signalled: AbortSignal | undefined;
    const closed = {
      ...(fakeApp() as object),
      requestGrants: (_scopes: unknown, options?: { signal?: AbortSignal }) => {
        signalled = options?.signal;
        return new Promise<boolean>(() => undefined);
      },
    } as never;
    const { chat } = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = closed;
    });
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      void chat.send('first');
      await vi.advanceTimersByTimeAsync(0);
      expect(chat.canSend).toBe(false);
      expect(signalled).toBeInstanceOf(AbortSignal);
      // Past the bound (2 minutes), and not so far that the toast it shows times out under fake timers.
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 100);
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    expect(signalled!.aborted).toBe(true);
    expect(chat.draft).toBe('first');
  });

  it('🔴 while a message is on its way the Send button is off and a message sent meanwhile is kept in the box, not lost', async () => {
    let grant!: (ok: boolean) => void;
    const granted = new Promise<boolean>((resolve) => (grant = resolve));
    const replies = heldReplies();
    vi.stubGlobal('fetch', replies.fetch);
    const { chat } = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = { ...(fakeApp() as object), requestGrants: () => granted } as never;
    });
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    const composer = chat.shadowRoot!.querySelector('civitai-chat-composer')!;
    void chat.send('first');
    await vi.waitFor(() => expect(chat.canSend).toBe(false));
    composer.draft = 'second';
    await composer.updateComplete;
    expect(composer.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(true);
    // A send that still arrives (Enter can reach the chat) waits in the empty box.
    composer.draft = '';
    composer.dispatchEvent(new CustomEvent('cvt-send', { bubbles: true, composed: true, detail: { text: 'second' } }));
    await settle();
    expect(composer.draft).toBe('second');
    grant(true);
    await vi.waitFor(() => expect(replies.asked).toHaveLength(1));
    const said = (JSON.parse(replies.asked[0]!) as { messages: { role: string; content: string }[] }).messages.filter((message) => message.role === 'user').map((message) => message.content);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/\bfirst$/);
  });
});

describe('<civitai-chat> canSend when an open never answers, and across a new app', () => {
  const openFromHistory = (chat: CivitaiChat, id: string) =>
    chat.shadowRoot!.querySelector('civitai-chat-sidebar')!.dispatchEvent(new CustomEvent('cvt-open', { detail: { id }, bubbles: true, composed: true }));
  const hold = (chat: CivitaiChat) => chat.shadowRoot!.querySelector('civitai-chat-composer .cvt-composer-hold')?.textContent ?? null;

  async function historyChat() {
    vi.stubGlobal('fetch', heldReplies().fetch);
    const history = gatedHistoryApp();
    const mounted = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = history.app;
    });
    await vi.waitFor(() => expect(mounted.chat.canSend).toBe(true));
    return { ...mounted, history };
  }

  it('🔴 a chat whose open never answers does not block the next one picked: it opens, and the chat can send', async () => {
    const { chat, history } = await historyChat();
    openFromHistory(chat, 'CONVA');
    await vi.waitFor(() => expect(history.asked).toContain('CONVA'));
    openFromHistory(chat, 'CONVB');
    await vi.waitFor(() => expect(history.asked).toContain('CONVB'));
    history.answer('CONVB');
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    expect(chat.chatId).toBe('CONVB');
    expect(hold(chat)).toBeNull();
    // The stalled one answering at last does not take B's place.
    history.answer('CONVA');
    await settle(100);
    expect(chat.chatId).toBe('CONVB');
    expect(chat.canSend).toBe(true);
  });

  it('🔴 a new chat while an open never answers: the hold lifts at once, and the late open does not take its place', async () => {
    const { chat, history } = await historyChat();
    openFromHistory(chat, 'CONVA');
    await vi.waitFor(() => expect(history.asked).toContain('CONVA'));
    await vi.waitFor(() => expect(chat.canSend).toBe(false));
    chat.newChat();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    const fresh = chat.chatId;
    expect(fresh).not.toBe('CONVA');
    history.answer('CONVA');
    await settle(100);
    expect(chat.chatId).toBe(fresh);
    expect(chat.canSend).toBe(true);
  });

  it('an earlier open that fails after a later one landed changes nothing: no new chat, no error', async () => {
    const { chat, history } = await historyChat();
    openFromHistory(chat, 'CONVA');
    await vi.waitFor(() => expect(history.asked).toContain('CONVA'));
    openFromHistory(chat, 'CONVB');
    await vi.waitFor(() => expect(history.asked).toContain('CONVB'));
    history.answer('CONVB');
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    history.fail('CONVA');
    await settle(100);
    expect(chat.chatId).toBe('CONVB');
    expect(chat.canSend).toBe(true);
    expect(chat.shadowRoot!.querySelector('civitai-toast-region')?.textContent ?? '').not.toContain('Could not open that chat.');
  });

  it('three chats picked in a row, the middle one never answering: the last one ends open', async () => {
    const { chat, history } = await historyChat();
    for (const id of ['CONVA', 'CONVB', 'CONVC']) {
      openFromHistory(chat, id);
      await vi.waitFor(() => expect(history.asked).toContain(id));
    }
    history.answer('CONVA');
    history.answer('CONVC');
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    expect(chat.chatId).toBe('CONVC');
  });

  it('🔴 an open that never answers in the old session does not hold the chat once it has a new app', async () => {
    const { chat, history } = await historyChat();
    openFromHistory(chat, 'CONVA');
    await vi.waitFor(() => expect(history.asked).toContain('CONVA'));
    await vi.waitFor(() => expect(chat.canSend).toBe(false));
    chat.app = fakeApp();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    expect(hold(chat)).toBeNull();
  });

  it('🔴 a Buzz permission given only after the chat has a new app sends nothing for the old one, and the message goes back in the box', async () => {
    let grant!: (ok: boolean) => void;
    const granted = new Promise<boolean>((resolve) => (grant = resolve));
    const replies = heldReplies();
    vi.stubGlobal('fetch', replies.fetch);
    const { chat } = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = { ...(fakeApp() as object), requestGrants: () => granted } as never;
    });
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    void chat.send('first');
    await vi.waitFor(() => expect(chat.canSend).toBe(false));
    chat.app = fakeApp();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    grant(true);
    await settle(200);
    expect(replies.asked).toHaveLength(0);
    expect(chat.draft).toBe('first');
  });
});

describe('<civitai-chat> deleting the open chat, then picking another before the delete finishes', () => {
  /** On Civitai's own store: CONVX and CONVY saved; X's delete and Y's open each answer when the test says. */
  function deletableHistoryApp() {
    const head = (conversationId: string) => ({
      id: `head-${conversationId}`,
      status: 'succeeded',
      tags: ['chat-cvt', 'cvt:turn', 'cvt:head', `cvt:conv:${conversationId}`],
      metadata: { v: 2, app: 'chat-cvt', conversationId, title: conversationId, titleSource: 'llm', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', turns: [] },
    });
    let answerDelete!: () => void;
    const deleteAnswered = new Promise<void>((resolve) => (answerDelete = resolve));
    let answerY!: () => void;
    const yAnswered = new Promise<void>((resolve) => (answerY = resolve));
    const app = {
      ...(fakeApp() as object),
      orchestration: {
        queryWorkflows: vi.fn(async (query: { tags: string[] }) => {
          const conv = query.tags.find((tag) => tag.startsWith('cvt:conv:'))?.slice('cvt:conv:'.length);
          if (!conv) return { items: [head('CONVX'), head('CONVY')], next: '' };
          const opening = query.tags.includes('cvt:head') || query.tags.includes('cvt:job');
          // The delete lists everything of X's (no head or job tag), then deletes it.
          if (conv === 'CONVX' && !opening) await deleteAnswered;
          if (conv === 'CONVY') await yAnswered;
          return { items: query.tags.includes('cvt:head') ? [head(conv)] : [], next: '' };
        }),
        submitWorkflow: vi.fn(async () => ({ id: '7-1', cost: { total: 0 } })),
      },
    } as never;
    return { app, answerDelete, answerY };
  }

  async function openXThenDeleteItAndPickY() {
    vi.stubGlobal('fetch', heldReplies().fetch);
    const history = deletableHistoryApp();
    const { chat } = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = history.app;
    });
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    const sidebar = chat.shadowRoot!.querySelector('civitai-chat-sidebar')!;
    sidebar.dispatchEvent(new CustomEvent('cvt-open', { detail: { id: 'CONVX' }, bubbles: true, composed: true }));
    await vi.waitFor(() => expect(chat.chatId).toBe('CONVX'));
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    chat.shadowRoot!.querySelector<{ ask(): Promise<boolean> } & Element>('#cvt-delete-dialog')!.ask = async () => true;
    sidebar.dispatchEvent(new CustomEvent('cvt-delete', { detail: { id: 'CONVX', title: 'CONVX' }, bubbles: true, composed: true }));
    await settle();
    sidebar.dispatchEvent(new CustomEvent('cvt-open', { detail: { id: 'CONVY' }, bubbles: true, composed: true }));
    await settle();
    return { chat, ...history };
  }

  it('🔴 the delete finishes first, then Y loads: the viewer ends on Y, not on a new chat', async () => {
    const { chat, answerDelete, answerY } = await openXThenDeleteItAndPickY();
    answerDelete();
    await settle(100);
    answerY();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    await settle(100);
    expect(chat.chatId).toBe('CONVY');
  });

  it('🔴 Y loads first, then the delete finishes: the viewer stays on Y', async () => {
    const { chat, answerDelete, answerY } = await openXThenDeleteItAndPickY();
    answerY();
    await vi.waitFor(() => expect(chat.chatId).toBe('CONVY'));
    answerDelete();
    await settle(100);
    expect(chat.chatId).toBe('CONVY');
    expect(chat.canSend).toBe(true);
  });

  it('NEGATIVE CONTROL: deleting the open chat with no other pick leaves the viewer on a new chat', async () => {
    vi.stubGlobal('fetch', heldReplies().fetch);
    const history = deletableHistoryApp();
    const { chat } = await mountWith((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = history.app;
    });
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    const sidebar = chat.shadowRoot!.querySelector('civitai-chat-sidebar')!;
    sidebar.dispatchEvent(new CustomEvent('cvt-open', { detail: { id: 'CONVX' }, bubbles: true, composed: true }));
    await vi.waitFor(() => expect(chat.chatId).toBe('CONVX'));
    chat.shadowRoot!.querySelector<{ ask(): Promise<boolean> } & Element>('#cvt-delete-dialog')!.ask = async () => true;
    sidebar.dispatchEvent(new CustomEvent('cvt-delete', { detail: { id: 'CONVX', title: 'CONVX' }, bubbles: true, composed: true }));
    history.answerDelete();
    await vi.waitFor(() => expect(chat.chatId).not.toBe('CONVX'));
    expect(chat.chatId).not.toBe('CONVY');
    expect(chat.chatId).not.toBeNull();
  });
});
