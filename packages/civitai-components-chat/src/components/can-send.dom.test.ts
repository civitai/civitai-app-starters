import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
