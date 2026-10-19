import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Attachment } from '../types.js';
import type { BeforeSendDetail, CivitaiChat, QueuedMessage, ReplyResumeDetail } from './civitai-chat.js';
import { QUEUE_TIMEOUT_MS } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * A page that must get something ready before a message can go (wake the app its reply works on) keeps
 * it back with `before-send`'s `queue()`: the chat shows it at once as the viewer's, waiting, and sends
 * it once the page calls `release()`. One that will not go comes back to the viewer.
 */

beforeAll(() => defineElements());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setVisibility('visible');
});

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function fakeApp(requestGrants: () => Promise<boolean> = async () => true) {
  return {
    getToken: async () => 'token',
    requestGrants,
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

/** Safari's words for a connection lost while a phone slept: the reply fails at once, with Retry. */
const lost = () => new TypeError('The network connection was lost.');

/** Every reply request's body, answered from `answers` and then "Done." (a new chat's title request is answered apart). */
function model(answers: (Response | Error)[] = []) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!String(url).includes('chat/completions')) return new Response('{}');
      const body = String(init?.body ?? '');
      if (!(JSON.parse(body) as { stream?: boolean }).stream) return title();
      asked.push(body);
      const next = answers.shift() ?? reply('Done.');
      if (next instanceof Error) throw next;
      return next;
    }),
  );
  return asked;
}

/** How many user messages in a request carry `text`. */
const copies = (body: string, text: string) => (JSON.parse(body) as { messages: { role: string; content: unknown }[] }).messages.filter((m) => m.role === 'user' && JSON.stringify(m.content).includes(text)).length;

const root = (chat: CivitaiChat) => chat.shadowRoot!;

async function mount({ answers, app }: { answers?: (Response | Error)[]; app?: unknown } = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const asked = model(answers);
  const chat = document.createElement('civitai-chat');
  chat.mcp = { orchestration: false, site: false };
  const resumes: ReplyResumeDetail[] = [];
  chat.addEventListener('reply-resume', (event) => resumes.push((event as CustomEvent<ReplyResumeDetail>).detail));
  chat.app = (app ?? fakeApp()) as never;
  document.body.append(chat);
  await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  await vi.waitFor(() => expect(chat.canSend).toBe(true));
  return { chat, asked, resumes, composer: root(chat).querySelector('civitai-chat-composer')! };
}

/** The page keeps the next message back with `queue(waiting)`, as a page whose app is paused does. */
function queueNext(chat: CivitaiChat, waiting = 'Waiting for your app…') {
  const seen: string[] = [];
  let handle: QueuedMessage | undefined;
  let queueIt = true;
  chat.addEventListener('before-send', (event) => {
    const detail = (event as CustomEvent<BeforeSendDetail>).detail;
    seen.push(detail.text);
    if (queueIt) {
      queueIt = false;
      handle = detail.queue(waiting);
    }
  });
  return { seen, handle: () => handle! };
}

const ref = (id: string): Attachment => ({ id, kind: 'image', url: `https://image.example/${id}.png`, name: `${id}.png` }) as Attachment;
const bubble = (chat: CivitaiChat) => root(chat).querySelector('.cvt-queued .cvt-bubble')?.textContent ?? null;
const status = (chat: CivitaiChat) => root(chat).querySelector('.cvt-queued-status')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const announced = (chat: CivitaiChat) => root(chat).querySelector('civitai-chat-thread .cvt-visually-hidden[aria-live="polite"]')?.textContent ?? '';
const sentTurns = (chat: CivitaiChat) => [...root(chat).querySelectorAll('civitai-chat-turn .cvt-bubble')].map((el) => el.textContent);
const unsent = (chat: CivitaiChat) => [...root(chat).querySelectorAll('.cvt-unsent-text')].map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
const button = (chat: CivitaiChat, scope: string, name: string) => [...root(chat).querySelectorAll<HTMLElement>(`${scope} civitai-button`)].find((b) => b.textContent?.trim() === name);
const focusedInBox = (chat: CivitaiChat) => root(chat).activeElement?.closest('civitai-chat-composer') !== null && root(chat).activeElement?.tagName === 'TEXTAREA';
const refIds = (chat: CivitaiChat) => chat.refs.map((r) => r.id);
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a message the page keeps back with queue()', () => {
  it('shows at once as the viewer’s, waiting, in an empty chat, and is announced; nothing goes, and the chat holds', async () => {
    const { chat, asked, composer } = await mount();
    queueNext(chat);
    await chat.send('build me a timer');
    await chat.updateComplete;
    expect(bubble(chat)).toBe('build me a timer');
    expect(status(chat)).toContain('Waiting for your app…');
    expect(root(chat).querySelector('civitai-chat-welcome')).toBeNull();
    await vi.waitFor(() => expect(announced(chat)).toContain('Waiting for your app…'));
    expect(chat.canSend).toBe(false);
    await composer.updateComplete;
    expect(composer.querySelector('.cvt-composer-hold')?.textContent).toBe('Waiting for your app…');
    await settle();
    expect(asked).toHaveLength(0);
  });

  it('🟢 in an empty chat the polite live region is on the page, empty, before the waiting status lands in it', async () => {
    const { chat } = await mount();
    queueNext(chat);
    const atInsert: string[] = [];
    const watch = new MutationObserver(() => {
      const region = root(chat).querySelector('civitai-chat-thread .cvt-visually-hidden[aria-live="polite"]');
      if (region && atInsert.length === 0) atInsert.push(region.textContent ?? '');
    });
    watch.observe(root(chat), { childList: true, subtree: true });
    await chat.send('build me a timer');
    await vi.waitFor(() => expect(announced(chat)).toContain('Waiting for your app…'));
    watch.disconnect();
    expect(atInsert).toEqual(['']);
  });

  it('🟢 a first message that goes within that moment is never announced as waiting', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    await chat.updateComplete;
    // Released at once: it goes, and the same thread shows the reply.
    page.handle().release();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await settle(250);
    expect(root(chat).querySelector('civitai-chat-thread')).not.toBeNull();
    expect(announced(chat)).not.toContain('Waiting for your app…');
  });

  it('goes once released: once, without before-send again, and its bubble becomes the sent one', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    page.handle().release();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(copies(asked[0]!, 'build me a timer')).toBe(1);
    expect(page.seen).toEqual(['build me a timer']);
    await vi.waitFor(() => expect(sentTurns(chat)).toEqual(['build me a timer']));
    expect(bubble(chat)).toBeNull();
  });

  it('released while the page still holds the chat, it goes once the hold lifts too', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    chat.holdReason = 'Your app is starting…';
    page.handle().release();
    await chat.updateComplete;
    expect(status(chat)).toContain('Your app is starting…');
    await settle();
    expect(asked).toHaveLength(0);
    chat.holdReason = undefined;
    await vi.waitFor(() => expect(asked).toHaveLength(1));
  });

  it('🔴 queue() called after before-send has returned does nothing but throw: the message is sent once', async () => {
    const { chat, asked } = await mount();
    let late: unknown;
    chat.addEventListener('before-send', (event) => {
      const { detail } = event as CustomEvent<BeforeSendDetail>;
      // An async handler deciding late.
      setTimeout(() => {
        try {
          detail.queue('too late');
        } catch (error) {
          late = error;
        }
      });
    });
    await chat.send('build me a timer');
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await settle(100);
    expect(asked).toHaveLength(1);
    expect(late).toBeInstanceOf(Error);
    expect(bubble(chat)).toBeNull();
  });

  it('🔴 queue() called twice in one handler is one waiting message, one handle', async () => {
    const { chat, asked } = await mount();
    const handles: QueuedMessage[] = [];
    chat.addEventListener('before-send', (event) => {
      const { detail } = event as CustomEvent<BeforeSendDetail>;
      handles.push(detail.queue('first'), detail.queue('second'));
    });
    await chat.send('build me a timer');
    expect(handles[0]).toBe(handles[1]);
    handles[0]!.release();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await settle();
    expect(asked).toHaveLength(1);
  });

  it('asks the viewer for their Buzz grant from their own send, before it waits; release asks nothing more', async () => {
    const requestGrants = vi.fn(async () => true);
    const { chat, asked } = await mount({ app: fakeApp(requestGrants) });
    const page = queueNext(chat);
    await chat.send('build me a timer');
    expect(requestGrants).toHaveBeenCalledTimes(1);
    page.handle().release();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(requestGrants).toHaveBeenCalledTimes(1);
  });
});

describe('a waiting message that will not go comes back to the viewer', () => {
  it('into the empty message box when the page gives up, with its files', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    chat.refs = [ref('a')];
    await chat.send('build me a timer');
    expect(refIds(chat)).toEqual([]);
    page.handle().cancel();
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer'));
    expect(refIds(chat)).toEqual(['a']);
    expect(bubble(chat)).toBeNull();
    expect(chat.canSend).toBe(true);
    page.handle().release();
    await settle();
    expect(asked).toHaveLength(0);
  });

  it('as a "not sent" notice (an alert) when the viewer typed in the box meanwhile; Put it back puts it ahead, with its files, and focuses the box', async () => {
    const { chat, composer } = await mount();
    const page = queueNext(chat);
    chat.refs = [ref('a')];
    await chat.send('build me a timer');
    composer.draft = 'and make it blue';
    page.handle().cancel();
    await vi.waitFor(() => expect(unsent(chat)).toEqual(['This message was not sent: “build me a timer”']));
    expect(root(chat).querySelector('.cvt-unsent')?.getAttribute('role')).toBe('alert');
    expect(root(chat).querySelector('.cvt-unsent-files')?.textContent).toBe('1 file attached');
    expect(chat.draft).toBe('and make it blue');
    button(chat, '.cvt-unsent', 'Put it back')!.click();
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer\n\nand make it blue'));
    expect(refIds(chat)).toEqual(['a']);
    await chat.updateComplete;
    expect(unsent(chat)).toEqual([]);
    expect(focusedInBox(chat)).toBe(true);
  });

  it('🟡 files come back beside the ones the box holds now, not dropped', async () => {
    const { chat, composer } = await mount();
    const page = queueNext(chat);
    chat.refs = [ref('a')];
    await chat.send('build me a timer');
    composer.draft = 'more';
    chat.refs = [ref('b')];
    page.handle().cancel();
    await vi.waitFor(() => expect(unsent(chat)).toHaveLength(1));
    button(chat, '.cvt-unsent', 'Put it back')!.click();
    await vi.waitFor(() => expect(refIds(chat)).toEqual(['b', 'a']));
  });

  it('NEGATIVE CONTROL: Dismiss takes the notice away, leaves the box alone and focuses it', async () => {
    const { chat, composer } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    composer.draft = 'something else';
    page.handle().cancel();
    await vi.waitFor(() => expect(unsent(chat)).toHaveLength(1));
    button(chat, '.cvt-unsent', 'Dismiss')!.click();
    await vi.waitFor(() => expect(unsent(chat)).toEqual([]));
    expect(chat.draft).toBe('something else');
    expect(focusedInBox(chat)).toBe(true);
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

  it(`after QUEUE_TIMEOUT_MS (${QUEUE_TIMEOUT_MS / 60_000} minutes), not before`, async () => {
    const { chat, asked } = await mount();
    queueNext(chat);
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    await chat.send('build me a timer');
    vi.advanceTimersByTime(QUEUE_TIMEOUT_MS - 1_000);
    await chat.updateComplete;
    expect(bubble(chat)).toBe('build me a timer');
    vi.advanceTimersByTime(2_000);
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer'));
    expect(asked).toHaveLength(0);
  });

  it('NEGATIVE CONTROL: a message that went does not come back when the wait would have run out', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    await chat.send('build me a timer');
    page.handle().release();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    vi.advanceTimersByTime(QUEUE_TIMEOUT_MS + 1_000);
    await settle();
    expect(chat.draft).toBe('');
    expect(unsent(chat)).toEqual([]);
  });

  it('🟡 cancel() or the wait running out as a released message goes does not also send it: one or the other', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    page.handle().release();
    await chat.updateComplete;
    page.handle().cancel();
    await settle(100);
    const sent = asked.length;
    const back = chat.draft === 'build me a timer' || unsent(chat).length > 0;
    expect(sent + (back ? 1 : 0)).toBe(1);
  });

  it('🟢 a chat taken off the page stops its wait: nothing comes back later', async () => {
    const { chat } = await mount();
    queueNext(chat);
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    await chat.send('build me a timer');
    chat.remove();
    vi.advanceTimersByTime(QUEUE_TIMEOUT_MS + 1_000);
    await settle();
    expect(chat.draft).toBe('');
    expect(unsent(chat)).toEqual([]);
  });

  it('NEGATIVE CONTROL: put back on the page, the chat waits its whole wait again, and then gives it back', async () => {
    const { chat } = await mount();
    queueNext(chat);
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    await chat.send('build me a timer');
    chat.remove();
    vi.advanceTimersByTime(QUEUE_TIMEOUT_MS - 1_000);
    document.body.append(chat);
    vi.advanceTimersByTime(QUEUE_TIMEOUT_MS - 1_000);
    await chat.updateComplete;
    expect(bubble(chat)).toBe('build me a timer');
    vi.advanceTimersByTime(2_000);
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer'));
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

  it('🟡 released and then another chat opened at once: it never goes into the new chat', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    const first = chat.chatId;
    page.handle().release();
    chat.newChat();
    await vi.waitFor(() => expect(chat.chatId).not.toBe(first));
    await settle(100);
    // Into the chat it was written in, or back to the viewer: never the new one.
    expect(sentTurns(chat)).toEqual([]);
    expect(asked.length + (chat.draft === 'build me a timer' ? 1 : 0)).toBe(1);
  });

  it('when the chat gets a new app (a sign-in as someone else): nothing goes to either, and nothing of it is shown to the new viewer', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    chat.app = fakeApp();
    await vi.waitFor(() => expect(bubble(chat)).toBeNull());
    await settle();
    expect(unsent(chat)).toEqual([]);
    expect(chat.draft).toBe('');
    page.handle().release();
    await settle();
    expect(asked).toHaveLength(0);
  });

  it('🟡 a "not sent" notice is cleared when the chat gets a new app, and on sign-out', async () => {
    for (const next of [() => fakeApp(), () => undefined]) {
      const { chat, composer } = await mount();
      const page = queueNext(chat);
      chat.refs = [ref('a')];
      await chat.send('build me a timer');
      composer.draft = 'typed';
      page.handle().cancel();
      await vi.waitFor(() => expect(unsent(chat)).toHaveLength(1));
      chat.app = next() as never;
      await vi.waitFor(() => expect(root(chat).querySelector('.cvt-unsent')).toBeNull());
      document.body.replaceChildren();
    }
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

describe('🟡 the viewer changes while their Buzz permission is being asked', () => {
  const SECRET = 'SECRET OF VIEWER A';

  /** Viewer A sends while the permission request is open; the page keeps every message back. */
  async function askingA() {
    let grant!: (ok: boolean) => void;
    const granted = new Promise<boolean>((resolve) => (grant = resolve));
    const mounted = await mount({ app: fakeApp(() => granted) });
    const page = queueNext(mounted.chat);
    void mounted.chat.send(SECRET);
    await vi.waitFor(() => expect(mounted.chat.canSend).toBe(false));
    return { ...mounted, page, grant };
  }

  /** Nothing of A's message is sent, waits or is offered back to the next viewer. */
  async function nothingOfA(chat: CivitaiChat, asked: string[]) {
    await settle(200);
    expect(asked).toHaveLength(0);
    expect(bubble(chat)).toBeNull();
    expect(unsent(chat)).toEqual([]);
    expect(root(chat).textContent ?? '').not.toContain(SECRET);
  }

  it('B signs in, then A answers while B’s chat starts: A’s message never reaches before-send, nor B’s box', async () => {
    const { chat, asked, page, grant } = await askingA();
    chat.app = fakeApp();
    grant(true);
    await nothingOfA(chat, asked);
    expect(page.seen).toEqual([]);
    expect(chat.draft).not.toBe(SECRET);
  });

  it('A answers, then B signs in at once: kept back under A, then dropped unseen', async () => {
    const { chat, asked, grant } = await askingA();
    grant(true);
    await Promise.resolve();
    chat.app = fakeApp();
    await nothingOfA(chat, asked);
    expect(chat.draft).not.toBe(SECRET);
  });

  it('B signs in and their chat is ready, then A answers: A’s message never reaches before-send or waits', async () => {
    const { chat, asked, page, grant } = await askingA();
    chat.app = fakeApp();
    await vi.waitFor(() => expect(chat.canSend).toBe(true));
    grant(true);
    await nothingOfA(chat, asked);
    expect(page.seen).toEqual([]);
    expect(chat.draft).not.toBe(SECRET);
  });

  it('A signs out, then answers: nothing of the message shows in the signed-out chat', async () => {
    const { chat, asked, page, grant } = await askingA();
    chat.app = undefined;
    grant(true);
    await nothingOfA(chat, asked);
    expect(page.seen).toEqual([]);
    expect(chat.draft).not.toBe(SECRET);
  });
});

describe('🟢 the same app handed over again (A, then B, then A) while A is asked for their Buzz permission', () => {
  /** A sends while asked; the page hands over B, then A's own app object again. */
  async function aThenBThenA(queue: boolean) {
    let grant!: (ok: boolean) => void;
    const granted = new Promise<boolean>((resolve) => (grant = resolve));
    const appA = fakeApp(() => granted);
    const mounted = await mount({ app: appA });
    const page = queue ? queueNext(mounted.chat) : { seen: [] as string[] };
    void mounted.chat.send('my own words');
    await vi.waitFor(() => expect(mounted.chat.canSend).toBe(false));
    mounted.chat.app = fakeApp();
    await mounted.chat.updateComplete;
    mounted.chat.app = appA;
    await mounted.chat.updateComplete;
    return { ...mounted, page, grant };
  }

  for (const queue of [false, true]) {
    const kept = queue ? 'kept back by the page' : 'not kept back';
    it(`A answers while A's chat starts again (${kept}): nothing goes on the old session, and the words are back in A's box`, async () => {
      const { chat, asked, grant } = await aThenBThenA(queue);
      grant(true);
      await vi.waitFor(() => expect(chat.canSend).toBe(true));
      await settle(200);
      expect(asked).toHaveLength(0);
      expect(bubble(chat)).toBeNull();
      expect(chat.draft).toBe('my own words');
    });

    it(`A answers once A's chat has started again (${kept}): nothing goes on the old session, and the words are back in A's box`, async () => {
      const { chat, asked, grant } = await aThenBThenA(queue);
      await vi.waitFor(() => expect(chat.canSend).toBe(true));
      grant(true);
      await settle(200);
      expect(asked).toHaveLength(0);
      expect(bubble(chat)).toBeNull();
      expect(chat.draft).toBe('my own words');
    });
  }
});

describe('the viewer’s Edit on a waiting message', () => {
  it('puts it back in the box, ahead of what they typed, with its files, focuses the box, and it does not go', async () => {
    const { chat, composer, asked } = await mount();
    const page = queueNext(chat);
    chat.refs = [ref('a')];
    await chat.send('build me a timer');
    composer.draft = 'blue';
    chat.refs = [ref('b')];
    await chat.updateComplete;
    // One button: Edit takes it out of the wait (there is no separate Cancel).
    expect(button(chat, '.cvt-queued', 'Cancel')).toBeUndefined();
    button(chat, '.cvt-queued', 'Edit')!.click();
    await vi.waitFor(() => expect(chat.draft).toBe('build me a timer\n\nblue'));
    expect(refIds(chat)).toEqual(['b', 'a']);
    expect(bubble(chat)).toBeNull();
    expect(focusedInBox(chat)).toBe(true);
    page.handle().release();
    await settle();
    expect(asked).toHaveLength(0);
  });
});

describe('giveBack(): a message the page could not send comes back the same way', () => {
  it('into an empty box, else as a "not sent" notice', async () => {
    const { chat, composer } = await mount();
    chat.giveBack('Build it');
    await vi.waitFor(() => expect(chat.draft).toBe('Build it'));
    composer.draft = 'typed';
    chat.giveBack('Build it');
    await vi.waitFor(() => expect(unsent(chat)).toEqual(['This message was not sent: “Build it”']));
    expect(chat.draft).toBe('typed');
  });

  it('🟢 the same words twice, with other text in the box, are one notice', async () => {
    const { chat, composer } = await mount();
    composer.draft = 'typed';
    expect(chat.giveBack('Build it')).toBe(true);
    expect(chat.giveBack('Build it')).toBe(true);
    await vi.waitFor(() => expect(unsent(chat)).toEqual(['This message was not sent: “Build it”']));
  });

  it('🟢 before the chat has started (signed out) it does nothing and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chat = document.createElement('civitai-chat');
    chat.signIn = () => new Promise(() => undefined);
    document.body.append(chat);
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
    await chat.compose('typed');
    expect(chat.giveBack('Build it')).toBe(false);
    await settle();
    expect(unsent(chat)).toEqual([]);
    expect(chat.draft).toBe('typed');
  });

  it('🟢 signed out after the chat had started it does nothing and says so', async () => {
    const { chat } = await mount();
    chat.app = undefined;
    await chat.updateComplete;
    expect(chat.giveBack('Build it')).toBe(false);
    await settle();
    expect(unsent(chat)).toEqual([]);
    expect(chat.draft).toBe('');
  });

  it('NEGATIVE CONTROL: not twice over the same words already in the box', async () => {
    const { chat } = await mount();
    chat.giveBack('Build it');
    await vi.waitFor(() => expect(chat.draft).toBe('Build it'));
    chat.giveBack('Build it');
    await settle();
    expect(unsent(chat)).toEqual([]);
  });

  it('sending the same words later clears their "not sent" notice', async () => {
    const { chat, composer, asked } = await mount();
    composer.draft = 'typed';
    chat.giveBack('Build it');
    await vi.waitFor(() => expect(unsent(chat)).toHaveLength(1));
    await chat.send('Build it');
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await chat.updateComplete;
    expect(unsent(chat)).toEqual([]);
  });
});

describe('a waiting message and asking for a failed reply again', () => {
  /** A first reply that lost its connection (Retry is offered), then the viewer's next message kept back by the page. */
  async function failedThenQueued() {
    const mounted = await mount({ answers: [lost()] });
    await mounted.chat.send('first');
    await vi.waitFor(() => expect(root(mounted.chat).querySelector('civitai-chat-turn .cvt-retry')).not.toBeNull());
    const page = queueNext(mounted.chat);
    await mounted.chat.send('second');
    await mounted.chat.updateComplete;
    expect(bubble(mounted.chat)).toBe('second');
    return { ...mounted, page };
  }

  it('Retry, asking again by itself and retryReply() do not fire while a message waits', async () => {
    const { chat, asked, resumes } = await failedThenQueued();
    expect(root(chat).querySelector('civitai-chat-turn .cvt-retry')!.hasAttribute('disabled')).toBe(true);
    (root(chat).querySelector('civitai-chat-turn .cvt-retry') as HTMLElement).click();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(await chat.retryReply()).toBe(false);
    await settle();
    expect(resumes).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(bubble(chat)).toBe('second');
  });

  it('a released message waiting on a hold is not taken over by reply-resume: it goes, and the failed reply is not asked again', async () => {
    const { chat, asked, resumes, page } = await failedThenQueued();
    chat.holdReason = 'Your app is starting…';
    page.handle().release();
    await chat.updateComplete;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(resumes).toEqual([]);
    expect(asked).toHaveLength(1);
    chat.holdReason = undefined;
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(copies(asked[1]!, 'second')).toBe(1);
    await vi.waitFor(() => expect(sentTurns(chat)).toEqual(['first', 'second']));
    expect(resumes).toEqual([]);
  });
});

describe('a message sent while the chat holds', () => {
  it('NEGATIVE CONTROL: holdReason does not queue: the message stays in the box, as before', async () => {
    const { chat } = await mount();
    chat.holdReason = 'Your app is starting…';
    await chat.updateComplete;
    await chat.send('build me a timer');
    await chat.updateComplete;
    expect(bubble(chat)).toBeNull();
    expect(chat.draft).toBe('build me a timer');
  });

  it('while one waits, another send stays in the box', async () => {
    const { chat, asked } = await mount();
    const page = queueNext(chat);
    await chat.send('build me a timer');
    await chat.send('a second one');
    await chat.updateComplete;
    expect(bubble(chat)).toBe('build me a timer');
    expect(chat.draft).toBe('a second one');
    page.handle().release();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(copies(asked[0]!, 'a second one')).toBe(0);
  });
});
