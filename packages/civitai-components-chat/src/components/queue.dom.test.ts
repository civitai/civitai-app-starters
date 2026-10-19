import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BeforeSendDetail, CivitaiChat, QueueChangeDetail, QueuedMessage } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * A message the chat cannot send yet waits instead of being refused: shown at once as the viewer's
 * bubble, marked waiting, and sent once it can go. A page keeps one back with `before-send`'s `queue()`
 * and lets it go with `release()`; one that will not go comes back to the viewer.
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeApp() {
  return {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: { queryWorkflows: async () => ({ items: [], next: '' }), submitWorkflow: vi.fn() },
  } as never;
}

function reply(words: string): Response {
  const chunks = [
    { id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: words }, finish_reason: null }] },
    { id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  const body = [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const title = () => new Response(JSON.stringify({ id: 't', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'Timer' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });

/** Every reply request's body (the request naming a new chat is answered apart and not counted). */
function model() {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).includes('chat/completions')) return new Response('{}');
      const body = String(init?.body ?? '');
      if (!(JSON.parse(body) as { stream?: boolean }).stream) return title();
      asked.push(body);
      return reply('Done.');
    }),
  );
  return asked;
}

/** How many user messages in a request carry `text`. */
const copies = (body: string, text: string) => (JSON.parse(body) as { messages: { role: string; content: unknown }[] }).messages.filter((m) => m.role === 'user' && JSON.stringify(m.content).includes(text)).length;

const root = (chat: CivitaiChat) => chat.shadowRoot!;

async function mount(setup: (chat: CivitaiChat) => void = () => undefined) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const asked = model();
  const chat = document.createElement('civitai-chat');
  chat.mcp = { orchestration: false, site: false };
  const changes: QueueChangeDetail[] = [];
  chat.addEventListener('queue-change', (event) => changes.push((event as CustomEvent<QueueChangeDetail>).detail));
  setup(chat);
  chat.app = fakeApp();
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-welcome')).not.toBeNull());
  return { chat, asked, changes, composer: chat.shadowRoot!.querySelector('civitai-chat-composer')! };
}

/** The page keeps the next message back with `queue(waiting)`, as a page whose app is paused does. */
function queueNext(chat: CivitaiChat, waiting = 'Waiting for your app…') {
  const seen: BeforeSendDetail[] = [];
  let handle: QueuedMessage | undefined;
  let queueIt = true;
  chat.addEventListener('before-send', (event) => {
    const detail = (event as CustomEvent<BeforeSendDetail>).detail;
    seen.push(detail);
    if (queueIt) {
      queueIt = false;
      handle = detail.queue(waiting);
    }
  });
  return { seen, handle: () => handle!, again: () => (queueIt = true) };
}

const bubble = (chat: CivitaiChat) => root(chat).querySelector('.cvt-queued .cvt-bubble')?.textContent ?? null;
const status = (chat: CivitaiChat) => root(chat).querySelector('.cvt-queued-status [role="status"]')?.textContent ?? null;
const sentTurns = (chat: CivitaiChat) => [...root(chat).querySelectorAll('civitai-chat-turn .cvt-bubble')].map((el) => el.textContent);
const unsent = (chat: CivitaiChat) => [...root(chat).querySelectorAll('.cvt-unsent-text')].map((el) => el.textContent);
const button = (chat: CivitaiChat, scope: string, name: string) => [...root(chat).querySelectorAll<HTMLElement>(`${scope} civitai-button`)].find((b) => b.textContent?.trim() === name);
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a message the page keeps back with queue()', () => {
  it('shows at once as the viewer’s, waiting, in an empty chat; nothing goes, and the chat holds', async () => {
    const { chat, asked, changes, composer } = await mount();
    queueNext(chat);
    await chat.send('build me a timer');
    await chat.updateComplete;
    expect(bubble(chat)).toBe('build me a timer');
    expect(status(chat)).toBe('Waiting for your app…');
    expect(root(chat).querySelector('civitai-chat-welcome')).toBeNull();
    expect(chat.canSend).toBe(false);
    expect(chat.queuedMessage).toBe('build me a timer');
    await composer.updateComplete;
    expect(composer.querySelector('.cvt-composer-hold')?.textContent).toBe('Waiting for your app…');
    await settle();
    expect(asked).toHaveLength(0);
    expect(changes).toEqual([{ text: 'build me a timer', state: 'waiting' }]);
  });

  it('goes once released: once, through before-send again (queued), and its bubble becomes the sent one', async () => {
    const { chat, asked, changes } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    page.handle().release();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(copies(asked[0]!, 'build me a timer')).toBe(1);
    expect(page.seen.map((d) => [d.text, d.queued])).toEqual([
      ['build me a timer', false],
      ['build me a timer', true],
    ]);
    await vi.waitFor(() => expect(sentTurns(chat)).toEqual(['build me a timer']));
    expect(bubble(chat)).toBeNull();
    expect(chat.queuedMessage).toBeNull();
    expect(changes.map((c) => c.state)).toEqual(['waiting', 'sent']);
  });

  it('released while the page still holds the chat, it goes once the hold lifts too', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    chat.holdReason = 'Your app is starting…';
    page.handle().release();
    await chat.updateComplete;
    expect(status(chat)).toBe('Your app is starting…');
    await settle();
    expect(asked).toHaveLength(0);
    chat.holdReason = undefined;
    await vi.waitFor(() => expect(asked).toHaveLength(1));
  });

  it('can be kept back again as it goes, and then waits again', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    const first = page.handle();
    page.again();
    first.release();
    await vi.waitFor(() => expect(page.seen).toHaveLength(2));
    await settle();
    expect(asked).toHaveLength(0);
    expect(bubble(chat)).toBe('build me a timer');
    // The same message: the first handle and the second are one.
    expect(page.handle()).toBe(first);
    first.release();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
  });

  it('cancelled by the page as it goes, it is taken away and nothing goes', async () => {
    const { chat, asked, changes } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    chat.addEventListener('before-send', (event) => {
      if ((event as CustomEvent<BeforeSendDetail>).detail.queued) event.preventDefault();
    });
    page.handle().release();
    await vi.waitFor(() => expect(changes.map((c) => c.state)).toEqual(['waiting', 'removed']));
    await settle();
    expect(asked).toHaveLength(0);
    expect(bubble(chat)).toBeNull();
    expect(chat.canSend).toBe(true);
  });
});

describe('a waiting message that will not go comes back to the viewer', () => {
  it('into the empty message box when the page gives up', async () => {
    const { chat, asked, changes } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    page.handle().cancel();
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer'));
    expect(bubble(chat)).toBeNull();
    expect(chat.canSend).toBe(true);
    expect(changes.map((c) => c.state)).toEqual(['waiting', 'returned']);
    // Released after it came back, nothing goes.
    page.handle().release();
    await settle();
    expect(asked).toHaveLength(0);
  });

  it('as a "not sent" notice when the viewer typed in the box meanwhile; Put it back puts it ahead of what they typed', async () => {
    const { chat, composer, changes } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    composer.draft = 'and make it blue';
    page.handle().cancel();
    await vi.waitFor(() => expect(unsent(chat)).toEqual(['This message was not sent: “build me a timer”']));
    expect(chat.draft).toBe('and make it blue');
    expect(changes.at(-1)).toEqual({ text: 'build me a timer', state: 'unsent' });
    button(chat, '.cvt-unsent', 'Put it back')!.click();
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer\n\nand make it blue'));
    await chat.updateComplete;
    expect(unsent(chat)).toEqual([]);
  });

  it('NEGATIVE CONTROL: Dismiss takes the notice away and leaves the box alone', async () => {
    const { chat, composer } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    composer.draft = 'something else';
    page.handle().cancel();
    await vi.waitFor(() => expect(unsent(chat)).toHaveLength(1));
    button(chat, '.cvt-unsent', 'Dismiss')!.click();
    await vi.waitFor(() => expect(unsent(chat)).toEqual([]));
    expect(chat.draft).toBe('something else');
  });

  it('as a notice, not into the box, while the viewer dictates (their words would be joined to it)', async () => {
    const { chat, composer } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    composer.dispatchEvent(new CustomEvent('cvt-voice-start', { bubbles: true, composed: true, detail: { live: false } }));
    await vi.waitFor(() => expect(chat.dictating).toBe(true));
    page.handle().cancel();
    await vi.waitFor(() => expect(unsent(chat)).toHaveLength(1));
    expect(chat.draft).toBe('');
  });

  it(`after queueTimeoutMs, not before`, async () => {
    const { chat, asked, changes } = await mount((el) => (el.queueTimeoutMs = 300));
    queueNext(chat);
    await chat.send('build me a timer');
    await settle(100);
    expect(bubble(chat)).toBe('build me a timer');
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer'));
    expect(changes.map((c) => c.state)).toEqual(['waiting', 'returned']);
    expect(asked).toHaveLength(0);
  });

  it('NEGATIVE CONTROL: a message that went does not come back when the wait would have run out', async () => {
    const { chat, asked, changes } = await mount((el) => (el.queueTimeoutMs = 150));
    const page = queueNext(chat);
    await chat.send('build me a timer');
    page.handle().release();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await settle(300);
    expect(chat.draft).toBe('');
    expect(unsent(chat)).toEqual([]);
    expect(changes.map((c) => c.state)).toEqual(['waiting', 'sent']);
  });

  it('when another chat is opened (New chat): it does not go there', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    const before = chat.chatId;
    chat.newChat();
    await vi.waitFor(() => expect(chat.chatId).not.toBe(before));
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer'));
    page.handle().release();
    await settle();
    expect(asked).toHaveLength(0);
  });

  it('when the chat gets a new app (a sign-in as someone else): a notice, and nothing goes to either', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    chat.app = fakeApp();
    await vi.waitFor(() => expect(unsent(chat)).toEqual(['This message was not sent: “build me a timer”']));
    page.handle().release();
    await settle();
    expect(asked).toHaveLength(0);
  });

  it('when the chat is signed out (no app): it does not wait for one', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    chat.app = undefined;
    await vi.waitFor(() => expect(bubble(chat)).toBeNull());
    page.handle().release();
    await settle();
    expect(asked).toHaveLength(0);
  });
});

describe('the viewer’s own controls on a waiting message', () => {
  it('Edit puts it back in the box, ahead of what they typed, and it does not go', async () => {
    const { chat, composer, asked, changes } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    composer.draft = 'blue';
    await chat.updateComplete;
    button(chat, '.cvt-queued', 'Edit')!.click();
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer\n\nblue'));
    expect(bubble(chat)).toBeNull();
    page.handle().release();
    await settle();
    expect(asked).toHaveLength(0);
    expect(changes.map((c) => c.state)).toEqual(['waiting', 'returned']);
  });

  it('Cancel takes it away, and it does not go', async () => {
    const { chat, asked, changes } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    await chat.updateComplete;
    button(chat, '.cvt-queued', 'Cancel')!.click();
    await vi.waitFor(() => expect(bubble(chat)).toBeNull());
    page.handle().release();
    await settle();
    expect(asked).toHaveLength(0);
    expect(chat.draft).toBe('');
    expect(changes.map((c) => c.state)).toEqual(['waiting', 'removed']);
  });

  it('sending the message itself later clears its "not sent" notice', async () => {
    const { chat, composer, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    composer.draft = 'typed';
    page.handle().cancel();
    await vi.waitFor(() => expect(unsent(chat)).toHaveLength(1));
    await chat.send('build me a timer');
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await chat.updateComplete;
    expect(unsent(chat)).toEqual([]);
  });
});

describe('a message sent while the chat holds until it is ready', () => {
  it('waits for the page’s holdReason to lift, then goes; one message waits at a time', async () => {
    const { chat, asked } = await mount((el) => (el.holdReason = 'Your app is starting…'));
    await chat.send('build me a timer');
    await chat.send('a second one');
    await chat.updateComplete;
    expect(bubble(chat)).toBe('build me a timer');
    // The second is kept in the box, as before.
    expect(chat.draft).toBe('a second one');
    chat.holdReason = undefined;
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(copies(asked[0]!, 'a second one')).toBe(0);
  });

  it('NEGATIVE CONTROL: while a saved chat opens, a message is kept in the box (where it would go is changing)', async () => {
    const { chat, changes } = await mount();
    // Opening a chat that never answers keeps the chat "Opening this chat…".
    const app = fakeApp() as { orchestration: { queryWorkflows: unknown } };
    app.orchestration.queryWorkflows = () => new Promise(() => undefined);
    chat.app = app as never;
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    localStorage.clear();
    // The chat's own hold for an open is set by picking one; a send from the page meanwhile.
    root(chat).querySelector('civitai-chat-sidebar')?.dispatchEvent(new CustomEvent('cvt-open', { detail: { id: 'CONV9' }, bubbles: true, composed: true }));
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-composer .cvt-composer-hold')?.textContent).toBe('Opening this chat…'));
    await chat.send('build me a timer');
    await chat.updateComplete;
    expect(bubble(chat)).toBeNull();
    expect(chat.draft).toBe('build me a timer');
    // It never waited (and so never came back): kept in the box as before.
    expect(changes).toEqual([]);
  });
});
