import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { memoryStore, textReply, urlOf } from '../test-support/fake-backend.js';
import type { ChatChangeDetail, CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/**
 * `chat-change`: the page learns which chat is open, once per change, so it can keep something per
 * chat (say, the app that chat last worked on) and bring it back when the viewer returns to it.
 */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const head = (conversationId: string) => ({
  id: `head-${conversationId}`,
  status: 'succeeded',
  tags: ['chat-cvt', 'cvt:turn', 'cvt:head', `cvt:conv:${conversationId}`],
  metadata: { v: 2, app: 'chat-cvt', conversationId, title: conversationId, titleSource: 'llm', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', turns: [] },
});

/** A signed-in viewer with saved chats `CONV1` and `CONV2`; each chat's workflows can be found, and deleted. */
function fakeApp() {
  return {
    getToken: async () => 'token',
    requestGrants: async () => true,
    site: { get: async () => ({ username: 'viewer' }) },
    orchestration: {
      queryWorkflows: vi.fn(async (query: { tags: string[] }) => {
        const conv = query.tags.find((tag) => tag.startsWith('cvt:conv:'))?.slice('cvt:conv:'.length);
        if (!conv) return { items: [], next: '' };
        if (query.tags.includes('cvt:head')) return { items: conv === 'CONV1' || conv === 'CONV2' ? [head(conv)] : [], next: '' };
        return { items: [{ id: `w-${conv}`, tags: query.tags }], next: '' };
      }),
      submitWorkflow: vi.fn(async () => ({ id: '7-1', cost: { total: 0 } })),
    },
  };
}

/** Replies to every model call; anything else (workflow writes and deletes) succeeds. */
function stubFetch(): string[] {
  const deleted: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (init?.method === 'DELETE') deleted.push(url);
      return url.includes('chat/completions') ? textReply('Hello ', 'there.') : new Response('{}');
    }),
  );
  return deleted;
}

/** Mounts the chat with a `chat-change` listener on before it starts, so the first announcement is seen. */
async function mount(set: (chat: CivitaiChat) => void): Promise<{ chat: CivitaiChat; seen: (string | null)[] }> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const chat = document.createElement('civitai-chat');
  const seen: (string | null)[] = [];
  chat.addEventListener('chat-change', (event) => seen.push((event as CustomEvent<ChatChangeDetail>).detail.chatId));
  set(chat);
  document.body.append(chat);
  await vi.waitFor(() => expect(chat.shadowRoot!.querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return { chat, seen };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const sidebar = (chat: CivitaiChat) => chat.shadowRoot!.querySelector('civitai-chat-sidebar')!;
const openFromHistory = (chat: CivitaiChat, id: string) => sidebar(chat).dispatchEvent(new CustomEvent('cvt-open', { detail: { id }, bubbles: true, composed: true }));
const threadText = (chat: CivitaiChat) => chat.shadowRoot!.querySelector('civitai-chat-thread')?.textContent ?? '';

async function deleteFromHistory(chat: CivitaiChat, id: string): Promise<void> {
  chat.shadowRoot!.querySelector<{ ask(): Promise<boolean> } & Element>('#cvt-delete-dialog')!.ask = async () => true;
  sidebar(chat).dispatchEvent(new CustomEvent('cvt-delete', { detail: { id, title: id }, bubbles: true, composed: true }));
}

describe('<civitai-chat> chat-change', () => {
  it('names the last chat once it is restored on load, and only once', async () => {
    stubFetch();
    localStorage.setItem('cvt:settings', JSON.stringify({ lastConversationId: 'CONV1' }));
    const { chat, seen } = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = fakeApp() as never;
    });
    await vi.waitFor(() => expect(seen).toEqual(['CONV1']));
    await settle();
    expect(seen).toEqual(['CONV1']);
    expect(chat.chatId).toBe('CONV1');
  });

  it('names the fresh chat a first visit starts with', async () => {
    stubFetch();
    const { chat, seen } = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = fakeApp() as never;
    });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(expect.any(String));
    expect(seen[0]).toBe(chat.chatId);
  });

  it('names each chat opened from history, then the one newChat() starts; reopening the open chat says nothing', async () => {
    stubFetch();
    const { chat, seen } = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = fakeApp() as never;
    });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    const first = seen[0];

    openFromHistory(chat, 'CONV1');
    await vi.waitFor(() => expect(seen).toEqual([first, 'CONV1']));
    openFromHistory(chat, 'CONV2');
    await vi.waitFor(() => expect(seen).toEqual([first, 'CONV1', 'CONV2']));
    // The same chat again: it reloads, but the open chat did not change.
    openFromHistory(chat, 'CONV2');
    await settle();
    expect(seen).toEqual([first, 'CONV1', 'CONV2']);
    expect(chat.chatId).toBe('CONV2');

    chat.newChat();
    await settle();
    expect(seen).toHaveLength(4);
    const fresh = seen[3]!;
    expect(fresh).toEqual(expect.any(String));
    expect([first, 'CONV1', 'CONV2']).not.toContain(fresh);
    expect(chat.chatId).toBe(fresh);
  });

  it('deleting the open chat names the new chat once, and never a moment with no chat open', async () => {
    stubFetch();
    const { chat, seen } = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = fakeApp() as never;
    });
    openFromHistory(chat, 'CONV1');
    await vi.waitFor(() => expect(seen.at(-1)).toBe('CONV1'));
    const before = seen.length;

    await deleteFromHistory(chat, 'CONV1');
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(before));
    await settle();
    const after = seen.slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(expect.any(String));
    expect(after[0]).not.toBe('CONV1');
    expect(chat.chatId).toBe(after[0]);
  });

  it('deleting another chat says nothing', async () => {
    const deleted = stubFetch();
    const { chat, seen } = await mount((c) => {
      c.mcp = { orchestration: false, site: false };
      c.app = fakeApp() as never;
    });
    openFromHistory(chat, 'CONV1');
    await vi.waitFor(() => expect(seen.at(-1)).toBe('CONV1'));
    const before = [...seen];
    await deleteFromHistory(chat, 'CONV2');
    await vi.waitFor(() => expect(deleted.some((url) => url.includes('w-CONV2'))).toBe(true));
    await settle();
    expect(seen).toEqual(before);
  });

  it('on a host backend: deleting the open chat names the new chat once', async () => {
    stubFetch();
    const store = memoryStore();
    const { chat, seen } = await mount((c) => (c.backend = { url: '/api/llm', model: 'host/default-model', store }));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await chat.send('hello');
    await vi.waitFor(() => expect(threadText(chat)).toContain('Hello there.'));
    // Sending saves the chat; it keeps its id.
    expect(seen).toHaveLength(1);
    const sent = seen[0]!;

    await deleteFromHistory(chat, sent);
    await vi.waitFor(() => expect(store.records.has(sent)).toBe(false));
    await settle();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(expect.any(String));
    expect(seen[1]).not.toBe(sent);
    expect(chat.chatId).toBe(seen[1]);
  });
});
