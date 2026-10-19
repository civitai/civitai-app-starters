import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Turn } from '../types.js';
import type { CivitaiChatTurn } from './civitai-chat-turn.js';
import { AUTO_RESUME_WINDOW_MS, type CivitaiChat, type ReplyResumeDetail } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * Asking again for a reply that lost its connection: a Retry button on the latest reply's error, and
 * once by itself when the page comes back into view or online (a phone that slept mid-reply).
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setVisibility('visible');
  setOnline(true);
});

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

function fakeApp() {
  return {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn() },
  } as never;
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });

function sse(events: unknown[]): Response {
  const body = [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), 'data: [DONE]\n\n'].join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

/** An OpenAI-compatible streamed reply of `words`. */
const reply = (words: string) => sse([chunk({ role: 'assistant', content: words }), chunk({}, 'stop')]);

/** A step that calls the page's `note` tool, which runs and finishes. */
const callsNote = () =>
  sse([chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'note', arguments: '{"text":"hi"}' } }] }), chunk({}, 'tool_calls')]);

/**
 * Safari's words when a phone's connection went while it slept. The chat says the connection was lost;
 * the agent's own quick retries are for the exact drop messages, so this one fails the reply at once.
 */
const lost = () => new TypeError('The network connection was lost.');

/** The service could not run the chat model: an error frame inside a 200 stream. */
const modelDown = () => sse([{ error: { message: 'Chat completion failed', type: 'server_error' } }]);

type Answer = Response | Error | (() => Response | Error);

/** A non-streamed answer, for the request that names a new chat. */
const title = () => new Response(JSON.stringify({ id: 't', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'Timer' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });

/**
 * The chat's reply requests, answered in order from `answers` (then "Done."), with every body sent.
 * The request naming a new chat once its first reply is done is not one of them.
 */
function model(answers: Answer[]) {
  const asked: string[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (!String(url).includes('chat/completions')) return new Response('{}');
    const body = String(init?.body ?? '');
    if (!(JSON.parse(body) as { stream?: boolean }).stream) return title();
    asked.push(body);
    const next = answers.shift() ?? reply('Done.');
    const answer = typeof next === 'function' ? next() : next;
    if (answer instanceof Error) throw answer;
    return answer;
  });
  vi.stubGlobal('fetch', fetch);
  return asked;
}

async function mount(setup: (chat: CivitaiChat) => void = () => undefined, app: unknown = fakeApp()) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  chat.mcp = { orchestration: false, site: false };
  const ran: string[] = [];
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
  setup(chat);
  chat.app = app as never;
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  await vi.waitFor(() => expect(chat.canSend).toBe(true));
  return { chat, ran, resumes };
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const root = (chat: CivitaiChat) => chat.shadowRoot!;
const turns = (chat: CivitaiChat) => [...root(chat).querySelectorAll<CivitaiChatTurn>('civitai-chat-turn')];
const retryButton = (chat: CivitaiChat) => root(chat).querySelector<HTMLElement>('civitai-chat-turn .cvt-retry');
const errorShown = (chat: CivitaiChat) => root(chat).querySelector('civitai-chat-turn civitai-alert[color="error"]');
/** How many times the user's first message went to the model, across every request. */
const userCopies = (body: string, text: string) => (JSON.parse(body) as { messages: { role: string; content: unknown }[] }).messages.filter((m) => m.role === 'user' && JSON.stringify(m.content).includes(text)).length;

function wake(): void {
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
}

async function failedReply(answers: Answer[] = [lost()], setup?: (chat: CivitaiChat) => void) {
  const asked = model(answers);
  const mounted = await mount(setup);
  await mounted.chat.send('build me a timer');
  await vi.waitFor(() => expect(errorShown(mounted.chat)).not.toBeNull());
  return { ...mounted, asked };
}

describe('Retry on a reply that lost its connection', () => {
  it('shows Retry, and asks for the same reply again: the message is not sent twice, and the error goes', async () => {
    const { chat, asked, resumes } = await failedReply();
    expect(errorShown(chat)?.textContent).toContain('Lost the connection to Civitai.');
    expect(retryButton(chat)).not.toBeNull();

    retryButton(chat)!.click();
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-turn .cvt-md')?.textContent).toContain('Done.'));
    expect(asked).toHaveLength(2);
    expect(userCopies(asked[1]!, 'build me a timer')).toBe(1);
    expect(turns(chat)).toHaveLength(1);
    expect(errorShown(chat)).toBeNull();
    expect(resumes).toEqual([{ trigger: 'retry' }]);
  });

  it("does not run again a tool from a step that finished; the step's call goes as it was", async () => {
    const { chat, asked, ran } = await failedReply([callsNote(), lost()]);
    expect(ran).toEqual(['hi']);
    retryButton(chat)!.click();
    await vi.waitFor(() => expect(asked).toHaveLength(3));
    await vi.waitFor(() => expect(errorShown(chat)).toBeNull());
    expect(ran).toEqual(['hi']);
    expect(asked[2]).toContain('call_1');
    expect(userCopies(asked[2]!, 'build me a timer')).toBe(1);
  });

  it('shows Retry when the service could not run the model, which asking again can fix', async () => {
    const { chat } = await failedReply([modelDown()]);
    expect(errorShown(chat)?.textContent).toContain("The assistant isn't available right now.");
    expect(retryButton(chat)).not.toBeNull();
  });

  it('NEGATIVE CONTROL: no Retry for a failure asking again would only repeat', async () => {
    const { chat } = await failedReply([new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 422, headers: { 'content-type': 'application/json' } })]);
    expect(errorShown(chat)?.textContent).toContain('Something went wrong');
    expect(retryButton(chat)).toBeNull();
  });

  it('is offered only on the latest reply', async () => {
    const { chat } = await failedReply([lost(), lost()]);
    await chat.send('and a clock');
    await vi.waitFor(() => expect(turns(chat)).toHaveLength(2));
    await vi.waitFor(() => expect(root(chat).querySelectorAll('civitai-chat-turn .cvt-retry')).toHaveLength(1));
    expect(turns(chat)[1]!.querySelector('.cvt-retry')).not.toBeNull();
    expect(turns(chat)[0]!.querySelector('.cvt-retry')).toBeNull();
  });

  it('does nothing while the page holds the chat', async () => {
    const { chat, asked, resumes } = await failedReply();
    chat.holdReason = 'Your app is starting…';
    await chat.updateComplete;
    retryButton(chat)!.click();
    await settle();
    expect(asked).toHaveLength(1);
    expect(resumes).toEqual([]);
  });

  it('lets the page cancel reply-resume, and then asks for nothing', async () => {
    const { chat, asked, resumes } = await failedReply();
    chat.addEventListener('reply-resume', (event) => event.preventDefault());
    retryButton(chat)!.click();
    await settle();
    expect(resumes).toEqual([{ trigger: 'retry' }]);
    expect(asked).toHaveLength(1);
  });
});

describe('the turn element', () => {
  function turnWith(assistant: Partial<Turn['assistant']>, latest = true): CivitaiChatTurn {
    const el = document.createElement('civitai-chat-turn') as CivitaiChatTurn;
    el.turn = { seq: 1, createdAt: '', user: { content: 'hi', attachments: [] }, assistant: { messages: [], status: 'error', error: 'Lost the connection.', errorKind: 'network', ...assistant } };
    el.latest = latest;
    el.resolve = () => undefined;
    document.body.append(el);
    return el;
  }
  const resume = { messages: [], steps: 0, at: 0 };

  it('offers Retry only with a resume point, on the latest turn, for a retryable kind', async () => {
    const offered = async (el: CivitaiChatTurn) => {
      await el.updateComplete;
      return el.querySelector('.cvt-retry') !== null;
    };
    expect(await offered(turnWith({ resume }))).toBe(true);
    // A reply whose failed step had called a tool (or a chat opened from storage) has no resume point.
    expect(await offered(turnWith({}))).toBe(false);
    expect(await offered(turnWith({ resume }, false))).toBe(false);
    for (const kind of ['rate_limit', 'unavailable', 'assistant_unavailable']) expect(await offered(turnWith({ resume, errorKind: kind }))).toBe(true);
    for (const kind of ['auth', 'blocked', 'insufficient_buzz', 'timeout', 'unknown']) expect(await offered(turnWith({ resume, errorKind: kind }))).toBe(false);
  });
});

describe('asking again by itself when the page wakes', () => {
  it('asks again once the page is visible again, with reply-resume saying so', async () => {
    const { chat, asked, resumes } = await failedReply();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(asked).toHaveLength(1);

    wake();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    await vi.waitFor(() => expect(errorShown(chat)).toBeNull());
    expect(userCopies(asked[1]!, 'build me a timer')).toBe(1);
    expect(turns(chat)).toHaveLength(1);
    expect(resumes).toEqual([{ trigger: 'visible' }]);
  });

  it('asks again when the browser comes back online', async () => {
    const { asked, resumes } = await failedReply();
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(resumes).toEqual([{ trigger: 'online' }]);
  });

  it('waits for online when the page wakes still offline', async () => {
    const { asked, resumes } = await failedReply();
    setOnline(false);
    wake();
    await settle();
    expect(asked).toHaveLength(1);
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(resumes).toEqual([{ trigger: 'online' }]);
  });

  it('asks again by itself only once: a reply that fails again waits for Retry', async () => {
    const { chat, asked, resumes } = await failedReply([lost(), lost()]);
    wake();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    await vi.waitFor(() => expect(errorShown(chat)).not.toBeNull());
    wake();
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(asked).toHaveLength(2);
    expect(resumes).toEqual([{ trigger: 'visible' }]);
    // Retry still works.
    retryButton(chat)!.click();
    await vi.waitFor(() => expect(asked).toHaveLength(3));
  });

  it(`asks again within ${AUTO_RESUME_WINDOW_MS / 60_000} minutes of the failure`, async () => {
    const { asked } = await failedReply();
    const failedAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(failedAt + AUTO_RESUME_WINDOW_MS - 60_000);
    wake();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
  });

  it('does not ask again by itself past that, and Retry still does', async () => {
    const { chat, asked, resumes } = await failedReply();
    const failedAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(failedAt + AUTO_RESUME_WINDOW_MS + 60_000);
    wake();
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(asked).toHaveLength(1);
    expect(resumes).toEqual([]);
    retryButton(chat)!.click();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
  });

  it('does not ask again after the viewer sent another message, even one that then failed too', async () => {
    const { chat, asked } = await failedReply([lost(), new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 422, headers: { 'content-type': 'application/json' } })]);
    await chat.send('and a clock');
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    await vi.waitFor(() => expect(turns(chat)[1]?.querySelector('civitai-alert[color="error"]')).not.toBeNull());
    wake();
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(asked).toHaveLength(2);
  });

  it('does not ask again while the page holds the chat', async () => {
    const { chat, asked } = await failedReply();
    chat.holdReason = 'Your app is starting…';
    await chat.updateComplete;
    wake();
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(asked).toHaveLength(1);
  });

  it('does not ask again while a reply is running', async () => {
    let answer!: () => void;
    const { chat, asked } = await failedReply([lost(), () => reply('Done.')]);
    // The viewer pressed Retry; its request is still out when the page wakes.
    const held = new Promise<void>((resolve) => (answer = resolve));
    const fetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('chat/completions')) await held;
      return fetch(url as never, init);
    });
    retryButton(chat)!.click();
    await vi.waitFor(() => expect(chat.canSend).toBe(false));
    wake();
    window.dispatchEvent(new Event('online'));
    answer();
    await vi.waitFor(() => expect(errorShown(chat)).toBeNull());
    await settle();
    expect(asked).toHaveLength(2);
  });

  it('does not ask again for a failure that was not the connection', async () => {
    const { asked } = await failedReply([modelDown()]);
    wake();
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(asked).toHaveLength(1);
  });

  it('does not ask again, nor offer Retry, without a resume point: a failed reply in a chat opened from storage', async () => {
    // Saved as the viewer saw it: the step that failed had called the page's tool, which ran. A save keeps
    // no resume point, so where to carry on from is unknown and asking again could run that tool twice.
    const failedTurn = {
      seq: 1,
      createdAt: '2026-10-18T00:00:00Z',
      user: { content: 'build me a timer', attachments: [] },
      assistant: {
        status: 'error',
        error: 'Lost the connection to Civitai. Check your network and try again.',
        errorKind: 'network',
        messages: [
          { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'note', input: { text: 'hi' } }] },
          { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'note', output: { type: 'json', value: { ok: true } } }] },
        ],
      },
    };
    const head = {
      id: '7-1',
      status: 'succeeded',
      tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:CONV1'],
      metadata: { v: 2, app: 'chat-cvt', conversationId: 'CONV1', title: 'Timer', titleSource: 'llm', createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', turns: [failedTurn] },
    };
    localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
    const asked = model([]);
    const app = fakeApp() as { orchestration: { queryWorkflows: unknown } };
    app.orchestration.queryWorkflows = async () => ({ items: [head], next: '' });
    const { chat } = await mount(undefined, app);
    await vi.waitFor(() => expect(errorShown(chat)?.textContent).toContain('Lost the connection to Civitai.'));
    expect(retryButton(chat)).toBeNull();
    wake();
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(asked).toHaveLength(0);
  });

  it('stops listening once the chat leaves the page', async () => {
    const { chat, asked } = await failedReply();
    chat.remove();
    wake();
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(asked).toHaveLength(1);
  });
});
