import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatBackend } from '../backend.js';
import type { ChatConversation } from '../store/conversation-store.js';
import { completion, memoryStore, sse, textReply, urlOf } from '../test-support/fake-backend.js';
import type { BeforeSendDetail, CivitaiChat, QueuedMessage } from './civitai-chat.js';
import type { CivitaiChatTurn } from './civitai-chat-turn.js';
import { defineElements } from './define.js';

/**
 * Edit on the viewer's latest message (the page runs the reply): shown only on that message and only
 * while no reply runs; Save replaces its words, drops the reply that followed and asks once more;
 * Cancel leaves it as it was. On a host's store, so what is saved and what a reload shows are seen too.
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
const ORIGINAL = 'plan a picnic for four people';
const ORIGINAL_REPLY = 'Picnic plan ready.';
const EDITED = 'plan a beach day for six people';
const EDITED_REPLY = 'Beach day plan ready.';

const encoder = new TextEncoder();
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id: 'r', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });

/** A reply that writes `words` and then never ends, until the request is aborted (Stop). */
function hanging(words: string, signal: AbortSignal | null | undefined): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk({ role: 'assistant', content: words }))}\n\n`));
      signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

type Answer = string | 'hang' | 'fail';
interface Asked {
  /** The user messages the model was sent, in order, as text. */
  users: string[];
  /** The assistant messages the model was sent, as text. */
  assistants: string[];
}

const textOf = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content));

/**
 * The host's gateway: each reply request (a streamed one) is answered from `answers` in order. Naming a
 * new chat (not streamed) is answered (refused with `titles: false`) and not counted. `asked` holds what
 * each reply request sent.
 */
function gateway(answers: Answer[], { titles = true }: { titles?: boolean } = {}) {
  const asked: Asked[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!urlOf(input).includes('/v1/chat/completions')) return new Response('not here', { status: 404 });
      const body = JSON.parse(String(init?.body)) as { stream?: boolean; messages: { role: string; content: unknown }[] };
      if (!body.stream) return titles ? completion('Rivers') : new Response('no titles here', { status: 500 });
      asked.push({ users: body.messages.filter((m) => m.role === 'user').map((m) => textOf(m.content)), assistants: body.messages.filter((m) => m.role === 'assistant').map((m) => textOf(m.content)) });
      const next = answers.shift();
      if (next === undefined) throw new Error('the test asked for more replies than it scripted');
      if (next === 'hang') return hanging('Planning', init?.signal);
      if (next === 'fail') return sse({ error: { message: 'The model is down', type: 'server_error' } });
      return textReply(next);
    }),
  );
  return asked;
}

const GATEWAY = '/api/llm';
const backendOf = (store: ReturnType<typeof memoryStore>): ChatBackend => ({ url: GATEWAY, model: 'host/default-model', store });

async function mount(store: ReturnType<typeof memoryStore>): Promise<CivitaiChat> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  chat.backend = backendOf(store);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  await vi.waitFor(() => expect(chat.canSend).toBe(true));
  return chat;
}

const root = (chat: CivitaiChat) => chat.shadowRoot!;
const turns = (chat: CivitaiChat) => [...root(chat).querySelectorAll<CivitaiChatTurn>('civitai-chat-turn')];
const editButtons = (chat: CivitaiChat) => [...root(chat).querySelectorAll<HTMLButtonElement>('.cvt-edit-button')];
const bubbles = (chat: CivitaiChat) => [...root(chat).querySelectorAll('.cvt-bubble')].map((bubble) => bubble.textContent);
const toastText = (chat: CivitaiChat) => root(chat).querySelector('civitai-toast-region')?.textContent ?? '';
const editor = (chat: CivitaiChat) => root(chat).querySelector<HTMLTextAreaElement>('.cvt-user-editor textarea');
const threadText = (chat: CivitaiChat) => root(chat).querySelector('civitai-chat-thread')?.textContent ?? '';
const stopButton = (chat: CivitaiChat) => root(chat).querySelector<HTMLButtonElement>('button.cvt-send[aria-label="Stop"]');
const running = (chat: CivitaiChat) => stopButton(chat) !== null;

/** Two exchanges, both finished: FIRST → FIRST_REPLY, ORIGINAL → ORIGINAL_REPLY. */
async function twoExchanges(more: Answer[] = []) {
  const asked = gateway([FIRST_REPLY, ORIGINAL_REPLY, ...more]);
  const store = memoryStore();
  const chat = await mount(store);
  await chat.send(FIRST);
  await vi.waitFor(() => expect(threadText(chat)).toContain(FIRST_REPLY));
  await chat.send(ORIGINAL);
  await vi.waitFor(() => expect(threadText(chat)).toContain(ORIGINAL_REPLY));
  await vi.waitFor(() => expect(running(chat)).toBe(false));
  await vi.waitFor(() => expect(editButtons(chat)).toHaveLength(1));
  return { chat, store, asked };
}

/** Opens the latest message's editor, sets its words to `text` as typing does. */
async function editTo(chat: CivitaiChat, text: string): Promise<HTMLTextAreaElement> {
  editButtons(chat)[0]!.click();
  await vi.waitFor(() => expect(editor(chat)).not.toBeNull());
  const area = editor(chat)!;
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true }));
  await turns(chat).at(-1)!.updateComplete;
  return area;
}

const saveButton = (chat: CivitaiChat) => root(chat).querySelector<HTMLElement>('.cvt-edit-save');
const cancelButton = (chat: CivitaiChat) => root(chat).querySelector<HTMLElement>('.cvt-edit-cancel');

describe('Edit on the latest message', () => {
  it('shows only on the latest message, and only once no reply runs', async () => {
    const asked = gateway([FIRST_REPLY, 'hang']);
    const chat = await mount(memoryStore());
    await chat.send(FIRST);
    await vi.waitFor(() => expect(threadText(chat)).toContain(FIRST_REPLY));
    await vi.waitFor(() => expect(editButtons(chat)).toHaveLength(1));

    void chat.send(ORIGINAL);
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    await vi.waitFor(() => expect(running(chat)).toBe(true));
    await turns(chat).at(-1)!.updateComplete;
    // A reply runs: no Edit anywhere, not on the message it replies to nor on the earlier one.
    expect(editButtons(chat)).toHaveLength(0);

    stopButton(chat)!.click();
    await vi.waitFor(() => expect(running(chat)).toBe(false));
    // After Stop: Edit on the latest message, and only there.
    await vi.waitFor(() => expect(editButtons(chat)).toHaveLength(1));
    expect(turns(chat).at(-1)!.contains(editButtons(chat)[0]!)).toBe(true);
    expect(turns(chat)[0]!.querySelector('.cvt-edit-button')).toBeNull();
    expect(editButtons(chat)[0]!.getAttribute('aria-label')).toBe('Edit your message');
  });

  it('shows after a reply that failed', async () => {
    gateway(['fail']);
    const chat = await mount(memoryStore());
    await chat.send(ORIGINAL);
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-turn civitai-alert[color="error"]')).not.toBeNull());
    await vi.waitFor(() => expect(editButtons(chat)).toHaveLength(1));
  });

  it('Save replaces the message, drops the reply that followed it, and asks once with the edited words', async () => {
    const { chat, asked } = await twoExchanges([EDITED_REPLY]);
    expect(asked).toHaveLength(2);
    await editTo(chat, EDITED);
    saveButton(chat)!.click();

    await vi.waitFor(() => expect(threadText(chat)).toContain(EDITED_REPLY));
    await vi.waitFor(() => expect(running(chat)).toBe(false));
    // Asked exactly once more, with the edited message as the latest, and nothing of the old exchange.
    expect(asked).toHaveLength(3);
    expect(asked[2]!.users.at(-1)).toContain(EDITED);
    expect(asked[2]!.users.some((text) => text.includes(ORIGINAL))).toBe(false);
    expect(asked[2]!.assistants.some((text) => text.includes(ORIGINAL_REPLY))).toBe(false);
    // The earlier exchange is kept as it was.
    expect(asked[2]!.users[0]).toContain(FIRST);
    expect(asked[2]!.assistants.some((text) => text.includes(FIRST_REPLY))).toBe(true);
    // On screen: the edited message in place of the old one, one message per turn, the old reply gone.
    expect(bubbles(chat)).toEqual([FIRST, EDITED]);
    expect(threadText(chat)).not.toContain(ORIGINAL_REPLY);
    expect(turns(chat)).toHaveLength(2);
  });

  it('Cancel leaves the message and its reply as they were, and asks nothing', async () => {
    const { chat, asked, store } = await twoExchanges();
    const saved = JSON.stringify([...store.records.values()]);
    await editTo(chat, EDITED);
    cancelButton(chat)!.click();
    await turns(chat).at(-1)!.updateComplete;

    expect(editor(chat)).toBeNull();
    expect(bubbles(chat)).toEqual([FIRST, ORIGINAL]);
    expect(threadText(chat)).toContain(ORIGINAL_REPLY);
    expect(asked).toHaveLength(2);
    expect(JSON.stringify([...store.records.values()])).toBe(saved);
    // Opened again, the box holds the message's own words, not the cancelled edit.
    editButtons(chat)[0]!.click();
    await vi.waitFor(() => expect(editor(chat)?.value).toBe(ORIGINAL));
  });

  it('keyboard: the box takes focus at the end of the words, Escape cancels back onto Edit, Enter saves', async () => {
    const { chat, asked } = await twoExchanges([EDITED_REPLY]);
    editButtons(chat)[0]!.click();
    await vi.waitFor(() => expect(root(chat).activeElement).toBe(editor(chat)));
    expect(editor(chat)!.value).toBe(ORIGINAL);
    expect(editor(chat)!.selectionStart).toBe(ORIGINAL.length);
    expect(editor(chat)!.getAttribute('aria-label')).toBe('Your message');

    editor(chat)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(editor(chat)).toBeNull());
    await vi.waitFor(() => expect(root(chat).activeElement).toBe(editButtons(chat)[0]));
    expect(bubbles(chat)).toEqual([FIRST, ORIGINAL]);

    const area = await editTo(chat, EDITED);
    // Shift+Enter is a new line, not a save.
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).toHaveLength(2);
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(threadText(chat)).toContain(EDITED_REPLY));
    expect(asked).toHaveLength(3);
    expect(bubbles(chat)).toEqual([FIRST, EDITED]);
  });

  it('saves the edited chat with no reply to the old message and no second copy of it, and a reload shows it', async () => {
    const { chat, store } = await twoExchanges([EDITED_REPLY]);
    await editTo(chat, EDITED);
    saveButton(chat)!.click();
    await vi.waitFor(() => expect(threadText(chat)).toContain(EDITED_REPLY));
    await vi.waitFor(() => expect(running(chat)).toBe(false));

    expect(store.records.size).toBe(1);
    await vi.waitFor(() => expect(JSON.stringify([...store.records.values()][0]!.turns)).toContain(EDITED_REPLY));
    const saved = [...store.records.values()][0]!;
    expect(saved.turns.map((turn) => [turn.seq, turn.user.content])).toEqual([
      [1, FIRST],
      [2, EDITED],
    ]);
    expect(JSON.stringify(saved)).not.toContain(ORIGINAL_REPLY);
    expect(JSON.stringify(saved)).not.toContain(ORIGINAL);
    expect(saved.turns[1]!.assistant).toMatchObject({ status: 'done' });

    chat.remove();
    const again = await mount(store);
    await vi.waitFor(() => expect(threadText(again)).toContain(EDITED_REPLY));
    expect(bubbles(again)).toEqual([FIRST, EDITED]);
    expect(threadText(again)).not.toContain(ORIGINAL_REPLY);
    expect(threadText(again)).toContain(FIRST_REPLY);
  });

  it('saves the edit at once, before its reply ends: a reload mid-reply shows no reply to the old message', async () => {
    const { chat, store } = await twoExchanges(['hang']);
    await editTo(chat, EDITED);
    saveButton(chat)!.click();
    await vi.waitFor(() => expect(running(chat)).toBe(true));
    await vi.waitFor(() => expect(JSON.stringify([...store.records.values()][0]!.turns)).toContain(EDITED));
    const saved = [...store.records.values()][0]!;
    expect(saved.turns.map((turn) => turn.user.content)).toEqual([FIRST, EDITED]);
    expect(saved.turns[1]!.assistant).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain(ORIGINAL_REPLY);
    stopButton(chat)!.click();
    await vi.waitFor(() => expect(running(chat)).toBe(false));
  });

  it('goes through before-send as an edit: a page that queues it sends it as the same edit once released', async () => {
    const { chat, asked } = await twoExchanges([EDITED_REPLY]);
    const seen: { text: string; edit?: boolean }[] = [];
    let waiting: QueuedMessage | undefined;
    chat.addEventListener('before-send', (event) => {
      const detail = (event as CustomEvent<BeforeSendDetail>).detail;
      seen.push({ text: detail.text, ...(detail.edit ? { edit: detail.edit } : {}) });
      waiting = detail.queue('Waking your app…');
    });
    await editTo(chat, EDITED);
    saveButton(chat)!.click();
    await vi.waitFor(() => expect(waiting).toBeDefined());
    expect(seen).toEqual([{ text: EDITED, edit: true }]);
    await vi.waitFor(() => expect(editor(chat)).toBeNull());
    // Waiting: no Edit to press meanwhile, nothing asked yet.
    expect(editButtons(chat)).toHaveLength(0);
    expect(asked).toHaveLength(2);

    waiting!.release();
    await vi.waitFor(() => expect(threadText(chat)).toContain(EDITED_REPLY));
    expect(asked).toHaveLength(3);
    expect(bubbles(chat)).toEqual([FIRST, EDITED]);
    expect(turns(chat)).toHaveLength(2);
  });

  it('a queued edit the page gives up on reopens its edit box with the words, never the message box', async () => {
    const { chat, asked } = await twoExchanges();
    let waiting: QueuedMessage | undefined;
    chat.addEventListener('before-send', (event) => {
      waiting = (event as CustomEvent<BeforeSendDetail>).detail.queue('Waking your app…');
    });
    await editTo(chat, EDITED);
    saveButton(chat)!.click();
    await vi.waitFor(() => expect(waiting).toBeDefined());
    await vi.waitFor(() => expect(editor(chat)).toBeNull());

    waiting!.cancel();
    await vi.waitFor(() => expect(editor(chat)?.value).toBe(EDITED));
    expect(root(chat).activeElement).toBe(editor(chat));
    expect(chat.draft).toBe('');
    expect(root(chat).querySelector('.cvt-unsent')).toBeNull();
    expect(bubbles(chat)).toEqual([FIRST]);
    expect(threadText(chat)).toContain(ORIGINAL_REPLY);
    expect(asked).toHaveLength(2);
  });

  it('an edit the page queues and gives back at once, before Save has its answer, stays open with the words', async () => {
    const { chat, asked } = await twoExchanges();
    chat.addEventListener('before-send', (event) => {
      (event as CustomEvent<BeforeSendDetail>).detail.queue('Waking your app…').cancel();
    });
    await editTo(chat, EDITED);
    saveButton(chat)!.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await vi.waitFor(() => expect(editor(chat)?.value).toBe(EDITED));
    expect(saveButton(chat)!.hasAttribute('loading')).toBe(false);
    expect(chat.draft).toBe('');
    expect(asked).toHaveLength(2);
  });

  it('a returned edit opens its edit box once: not again when the chat is opened again', async () => {
    const { chat, store } = await twoExchanges();
    let waiting: QueuedMessage | undefined;
    chat.addEventListener('before-send', (event) => {
      waiting = (event as CustomEvent<BeforeSendDetail>).detail.queue('Waking your app…');
    });
    await editTo(chat, EDITED);
    saveButton(chat)!.click();
    await vi.waitFor(() => expect(waiting).toBeDefined());
    await vi.waitFor(() => expect(editor(chat)).toBeNull());
    waiting!.cancel();
    await vi.waitFor(() => expect(editor(chat)?.value).toBe(EDITED));
    cancelButton(chat)!.click();
    await vi.waitFor(() => expect(editor(chat)).toBeNull());

    const id = [...store.records.keys()][0]!;
    chat.newChat();
    await vi.waitFor(() => expect(turns(chat)).toHaveLength(0));
    chat.conversationId = id;
    await vi.waitFor(() => expect(bubbles(chat)).toEqual([FIRST, ORIGINAL]));
    await vi.waitFor(() => expect(editButtons(chat)).toHaveLength(1));
    expect(editor(chat)).toBeNull();
  });

  it('a queued edit whose chat was left is dropped with a notice, and never opens in the chat opened instead', async () => {
    const other: ChatConversation = {
      id: 'OTHER',
      title: 'Lakes',
      titleSource: 'llm',
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
      turns: [
        { seq: 1, createdAt: '2026-10-20T00:00:00.000Z', user: { content: 'list two lakes', attachments: [] }, assistant: { messages: [{ role: 'assistant', content: 'Titicaca and Junín.' }], status: 'done' } },
        { seq: 2, createdAt: '2026-10-20T00:00:00.000Z', user: { content: 'and a third', attachments: [] }, assistant: { messages: [{ role: 'assistant', content: 'Poopó.' }], status: 'done' } },
      ],
    };
    const asked = gateway([FIRST_REPLY, ORIGINAL_REPLY]);
    const store = memoryStore([other]);
    const chat = await mount(store);
    await chat.send(FIRST);
    await vi.waitFor(() => expect(threadText(chat)).toContain(FIRST_REPLY));
    await chat.send(ORIGINAL);
    await vi.waitFor(() => expect(threadText(chat)).toContain(ORIGINAL_REPLY));
    await vi.waitFor(() => expect(editButtons(chat)).toHaveLength(1));
    let waiting: QueuedMessage | undefined;
    chat.addEventListener('before-send', (event) => {
      waiting = (event as CustomEvent<BeforeSendDetail>).detail.queue('Waking your app…');
    });
    await editTo(chat, EDITED);
    saveButton(chat)!.click();
    await vi.waitFor(() => expect(waiting).toBeDefined());

    chat.conversationId = 'OTHER';
    await vi.waitFor(() => expect(bubbles(chat)).toEqual(['list two lakes', 'and a third']));
    await vi.waitFor(() => expect(toastText(chat)).toContain('Your edit was not sent.'));
    expect(editor(chat)).toBeNull();
    expect(chat.draft).toBe('');
    expect(asked).toHaveLength(2);
  });

  it('names a chat still named after its first message after the edited message', async () => {
    // No title from the model, so the chat keeps the one its first message gave it.
    gateway([ORIGINAL_REPLY, EDITED_REPLY], { titles: false });
    const store = memoryStore();
    const chat = await mount(store);
    await chat.send(ORIGINAL);
    await vi.waitFor(() => expect(threadText(chat)).toContain(ORIGINAL_REPLY));
    await vi.waitFor(() => expect(editButtons(chat)).toHaveLength(1));
    await vi.waitFor(() => expect([...store.records.values()][0]?.title).toBe(ORIGINAL));
    await editTo(chat, EDITED);
    saveButton(chat)!.click();
    await vi.waitFor(() => expect(threadText(chat)).toContain(EDITED_REPLY));
    await vi.waitFor(() => expect([...store.records.values()][0]?.title).toBe(EDITED));
  });
});
