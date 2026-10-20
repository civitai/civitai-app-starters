import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatBackend } from '../backend.js';
import type { ChatConversation } from '../store/conversation-store.js';
import { completion, memoryStore, textReply, urlOf } from '../test-support/fake-backend.js';
import type { CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * `newChatModel`: the model a host's new chats start on (say, the viewer's last pick), while every
 * saved chat keeps its own model, or keeps following `model` when it never had one.
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const T = '2026-10-15T00:00:00Z';
const MODELS = [
  { id: 'host/big', label: 'Big' },
  { id: 'host/small', label: 'Small' },
];

/** The model each streamed reply was asked of, in order. */
function spyOnReplies(): string[] {
  const models: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!urlOf(input).includes('/v1/chat/completions')) return new Response('not here', { status: 404 });
      const body = JSON.parse(String(init?.body)) as { stream?: boolean; model: string };
      if (!body.stream) return completion('A title');
      models.push(body.model);
      return textReply('Hello ', 'there.');
    }),
  );
  return models;
}

/** `newChatModel` is not on the backend type before this change: set it through a cast. */
const backendOf = (store: ReturnType<typeof memoryStore>, newChatModel?: string): ChatBackend =>
  ({ url: '/api/llm', model: 'host/default-model', models: MODELS, store, ...(newChatModel !== undefined ? { newChatModel } : {}) }) as ChatBackend;

const saved = (id: string, model?: string): ChatConversation => ({
  id,
  title: id,
  titleSource: 'llm',
  createdAt: T,
  updatedAt: T,
  turns: [{ seq: 1, createdAt: T, user: { content: `in ${id}`, attachments: [] }, assistant: { status: 'done', messages: [{ role: 'assistant', content: 'Sure.' }] } } as never],
  ...(model ? { model } : {}),
});

async function mount(set: (chat: CivitaiChat) => void): Promise<CivitaiChat> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  set(chat);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return chat;
}

/** The model button as the viewer reads it: the name, and " · default" when the chat follows the default. */
async function chip(chat: CivitaiChat): Promise<string> {
  await chat.updateComplete;
  const picker = chat.shadowRoot!.querySelector('civitai-chat-model-picker')!;
  await (picker as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  const name = picker.querySelector('.cvt-model-chip-name')?.textContent ?? '';
  return name + (picker.querySelector('.cvt-model-chip-marker')?.textContent ?? '');
}

const openFromHistory = (chat: CivitaiChat, id: string) =>
  chat.shadowRoot!.querySelector('civitai-chat-sidebar')!.dispatchEvent(new CustomEvent('cvt-open', { detail: { id }, bubbles: true, composed: true }));
const threadText = (chat: CivitaiChat) => chat.shadowRoot!.querySelector('civitai-chat-thread')?.textContent ?? '';

describe('<civitai-chat> backend newChatModel (host store with a gateway)', () => {
  it('starts a new chat on newChatModel, saves it with the chat, and starts the next new chat on it too', async () => {
    const replies = spyOnReplies();
    const store = memoryStore();
    const chat = await mount((c) => (c.backend = backendOf(store, 'host/big')));
    expect(await chip(chat)).toBe('Big');

    await chat.send('hello');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
    expect(replies).toEqual(['host/big']);
    const id = chat.chatId!;
    await vi.waitFor(() => expect(store.records.get(id)?.model).toBe('host/big'));

    chat.newChat();
    expect(await chip(chat)).toBe('Big');
  });

  it('starts on the default when newChatModel is not one of models, or is the default itself', async () => {
    for (const newChatModel of ['host/gone', 'host/default-model']) {
      const replies = spyOnReplies();
      const store = memoryStore();
      const chat = await mount((c) => (c.backend = backendOf(store, newChatModel)));
      expect(await chip(chat)).toBe('host/default-model · default');

      await chat.send('hello');
      await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
      expect(replies).toEqual(['host/default-model']);
      await vi.waitFor(() => expect(store.records.get(chat.chatId!)).toBeDefined());
      expect('model' in store.records.get(chat.chatId!)!).toBe(false);
      chat.remove();
      vi.unstubAllGlobals();
    }
  });

  it('a saved chat with its own model keeps it', async () => {
    const replies = spyOnReplies();
    const store = memoryStore([saved('A', 'host/small')]);
    const chat = await mount((c) => (c.backend = backendOf(store, 'host/big')));
    openFromHistory(chat, 'A');
    await vi.waitFor(() => expect(chat.chatId).toBe('A'));
    expect(await chip(chat)).toBe('Small');

    await chat.send('more');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
    expect(replies).toEqual(['host/small']);
    await vi.waitFor(() => expect(store.records.get('A')!.turns).toHaveLength(2));
    expect(store.records.get('A')!.model).toBe('host/small');
  });

  it('a saved chat with no model of its own keeps following the default, not newChatModel', async () => {
    const replies = spyOnReplies();
    const store = memoryStore([saved('OLD')]);
    const chat = await mount((c) => (c.backend = backendOf(store, 'host/big')));
    openFromHistory(chat, 'OLD');
    await vi.waitFor(() => expect(chat.chatId).toBe('OLD'));
    expect(await chip(chat)).toBe('host/default-model · default');

    await chat.send('more');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
    expect(replies).toEqual(['host/default-model']);
    await vi.waitFor(() => expect(store.records.get('OLD')!.turns).toHaveLength(2));
    expect('model' in store.records.get('OLD')!).toBe(false);
  });

  it('model-change names the chat and the model the viewer picked; opening or starting a chat fires none', async () => {
    spyOnReplies();
    const store = memoryStore([saved('A', 'host/small'), saved('OLD')]);
    const changes: unknown[] = [];
    const chat = await mount((c) => {
      c.addEventListener('model-change', (event) => changes.push((event as CustomEvent).detail));
      c.backend = backendOf(store, 'host/big');
    });
    openFromHistory(chat, 'A');
    await vi.waitFor(() => expect(chat.chatId).toBe('A'));
    openFromHistory(chat, 'OLD');
    await vi.waitFor(() => expect(chat.chatId).toBe('OLD'));
    chat.newChat();
    await chat.updateComplete;
    expect(changes).toEqual([]);

    const fresh = chat.chatId!;
    const picker = () => chat.shadowRoot!.querySelector('civitai-chat-model-picker')!;
    picker().dispatchEvent(new CustomEvent('cvt-model-pick', { detail: { model: 'host/small' }, bubbles: true, composed: true }));
    expect(changes).toEqual([{ chatId: fresh, model: 'host/small' }]);
    // The same model again is no change.
    picker().dispatchEvent(new CustomEvent('cvt-model-pick', { detail: { model: 'host/small' }, bubbles: true, composed: true }));
    expect(changes).toHaveLength(1);

    // The command too; following the default is `null`.
    chat.shadowRoot!.querySelector('civitai-chat-composer')!.dispatchEvent(new CustomEvent('cvt-send', { detail: { text: '/model default' }, bubbles: true, composed: true }));
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(changes[1]).toEqual({ chatId: fresh, model: null });
    expect(await chip(chat)).toBe('host/default-model · default');
  });
});
