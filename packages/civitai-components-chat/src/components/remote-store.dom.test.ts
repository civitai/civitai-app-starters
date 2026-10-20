import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ChatConversation } from '../store/conversation-store.js';
import { memoryStore } from '../test-support/fake-backend.js';
import { fakeRunner, RUNNER_URL } from '../test-support/fake-runner.js';
import type { CivitaiChat } from './civitai-chat.js';
import { defineElements } from './define.js';

/** `<civitai-chat runner="remote">` on a host's own conversation store (a store-only backend). */

beforeAll(() => defineElements());
afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const root = (chat: CivitaiChat) => chat.shadowRoot!;
const currentId = (chat: CivitaiChat) => root(chat).querySelector('civitai-chat-sidebar')!.currentId;
const toastText = (chat: CivitaiChat) => root(chat).querySelector('civitai-toast-region')?.textContent ?? '';
const busyRows = (chat: CivitaiChat) => root(chat).querySelectorAll('.cvt-chat-row[aria-busy="true"][data-stopping]').length;

interface Options {
  /** The runner's request timeout, which also bounds the wait for a stopped run to end. */
  timeoutMs?: number;
  /** On a stop of r1, as a real runner does: save the chat's final state into the host's store, and only then end the run. */
  savesThenEnds?: boolean;
}

/**
 * A chat on a store-only backend whose replies run on a fake runner. `order` records, in the order they
 * happened, the runner's lookups and stops and the host store's saves and deletes.
 */
async function remoteChat({ timeoutMs, savesThenEnds = false }: Options = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Anything sent outside the runner and the host's store would land here.
  const global = vi.fn(async () => new Response('not here', { status: 404 }));
  vi.stubGlobal('fetch', global);
  const order: string[] = [];
  const runner = fakeRunner();
  const store = memoryStore();
  const knobs = { lookupsFail: false };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).slice(`${RUNNER_URL}/`.length);
    if (path.startsWith('runs?') || path.endsWith('/stop')) order.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.startsWith('runs?') && knobs.lookupsFail) throw new TypeError('fetch failed');
    if (savesThenEnds && path === 'runs/r1/stop') {
      const run = runner.runs.get('r1')!;
      setTimeout(() => {
        const at = '2026-10-20T10:00:00.000Z';
        const saved: ChatConversation = {
          id: run.conversationId,
          title: 'hello',
          titleSource: 'first-message',
          createdAt: at,
          updatedAt: at,
          turns: [{ seq: 1, createdAt: at, user: { content: 'hello', attachments: [] }, assistant: { messages: [], status: 'stopped' as never } }],
        };
        void store.save(saved).then(() => runner.push('r1', { type: 'run-ended', status: 'stopped', messages: [], steps: 1 }));
      }, 50);
    }
    return runner.fetch(input, init);
  }) as typeof globalThis.fetch;
  const save = store.save.bind(store);
  store.save = async (conversation) => {
    order.push(`save ${conversation.id}`);
    await save(conversation);
  };
  const remove = store.delete.bind(store);
  store.delete = async (id, options) => {
    order.push(`delete ${id}`);
    await remove(id, options);
  };
  const chat = document.createElement('civitai-chat');
  chat.runner = 'remote';
  chat.remoteRunner = { url: RUNNER_URL, fetch, reconnectDelaysMs: [0], ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
  chat.backend = { model: 'host/default', store } as never;
  document.body.append(chat);
  await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return { chat, runner, store, order, global, knobs };
}

/** Sends a message, so a run is live for the open chat, and asks to delete that chat. */
async function deleteWhileRunning(chat: CivitaiChat, runner: ReturnType<typeof fakeRunner>, order: string[], before?: () => void): Promise<string> {
  void chat.send('hello');
  await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
  const id = currentId(chat)!;
  expect(id).toBe(runner.runs.get('r1')!.conversationId);
  order.length = 0;
  before?.();
  root(chat).querySelector<{ ask(): Promise<boolean> } & Element>('#cvt-delete-dialog')!.ask = async () => true;
  root(chat).querySelector('civitai-chat-sidebar')!.dispatchEvent(new CustomEvent('cvt-delete', { detail: { id, title: 'hello' }, bubbles: true, composed: true }));
  return id;
}

describe('<civitai-chat runner="remote"> on a host store: deleting a chat whose run is live', () => {
  it('stops the run and waits for it to end (after its final save) before deleting, so the chat stays deleted', async () => {
    const { chat, runner, store, order, global } = await remoteChat({ savesThenEnds: true });
    const id = await deleteWhileRunning(chat, runner, order);
    // The row shows busy while the run is stopping.
    await vi.waitFor(() => expect(busyRows(chat)).toBe(1));
    await vi.waitFor(() => expect(order).toContain(`delete ${id}`), { timeout: 5_000 });
    expect(order.slice(0, 2)).toEqual([`GET runs?conversationId=${id}`, 'POST runs/r1/stop']);
    // The runner's final save landed before the delete, not after it.
    expect(order.indexOf(`save ${id}`)).toBeGreaterThan(1);
    expect(order.indexOf(`save ${id}`)).toBeLessThan(order.indexOf(`delete ${id}`));
    expect(order.at(-1)).toBe(`delete ${id}`);
    // Long enough for a save racing the delete to land.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(store.records.has(id)).toBe(false);
    expect([...store.records.keys()]).toEqual([]);
    await vi.waitFor(() => expect(currentId(chat)).not.toBe(id));
    expect(busyRows(chat)).toBe(0);
    expect(global).not.toHaveBeenCalled();
  });

  it('deletes nothing when the runner refuses the stop, and keeps the viewer on the chat with an error', async () => {
    const { chat, runner, store, order } = await remoteChat();
    runner.knobs.refuseStop = { status: 503 };
    const id = await deleteWhileRunning(chat, runner, order);
    await vi.waitFor(() => expect(toastText(chat)).toContain('Could not stop the reply in that chat, so it was not deleted.'));
    expect(order).toEqual([`GET runs?conversationId=${id}`, 'POST runs/r1/stop']);
    expect(store.calls.filter((call) => call.startsWith('delete'))).toEqual([]);
    expect(currentId(chat)).toBe(id);
    expect(root(chat).querySelector('civitai-chat-sidebar')!.summaries.map((summary) => summary.id)).toContain(id);
    await vi.waitFor(() => expect(busyRows(chat)).toBe(0));
  });

  it('deletes nothing when the stopped run has not ended in time, and says it is still stopping', async () => {
    const { chat, runner, store, order } = await remoteChat({ timeoutMs: 300 });
    const id = await deleteWhileRunning(chat, runner, order);
    await vi.waitFor(() => expect(toastText(chat)).toContain('The reply in that chat is still stopping, so it was not deleted. Try again in a moment.'), { timeout: 5_000 });
    expect(order.slice(0, 2)).toEqual([`GET runs?conversationId=${id}`, 'POST runs/r1/stop']);
    expect(store.calls.filter((call) => call.startsWith('delete'))).toEqual([]);
    expect(currentId(chat)).toBe(id);
    expect(busyRows(chat)).toBe(0);
  });

  it('deletes nothing when the runner cannot be reached, and says so', async () => {
    const { chat, runner, store, order, knobs } = await remoteChat();
    const id = await deleteWhileRunning(chat, runner, order, () => (knobs.lookupsFail = true));
    await vi.waitFor(() => expect(toastText(chat)).toContain('Could not reach the chat runner, so the chat was not deleted. Try again.'));
    expect(toastText(chat)).not.toContain('Could not stop the reply');
    expect(order).toEqual([`GET runs?conversationId=${id}`]);
    expect(store.calls.filter((call) => call.startsWith('delete'))).toEqual([]);
    expect(currentId(chat)).toBe(id);
  });
});

describe('<civitai-chat> given a store-only backend before runner="remote"', () => {
  function refused() {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    const runner = fakeRunner();
    const chat = document.createElement('civitai-chat');
    chat.backend = { model: 'host/default', store } as never;
    document.body.append(chat);
    return { chat, store, runner };
  }

  const REFUSED = "The chat could not start: A backend without url needs runner 'remote': in the browser, replies go to backend.url.";

  it('says why it cannot start instead of spinning, and starts once the runner is set', async () => {
    const { chat, store, runner } = refused();
    await vi.waitFor(() => expect(root(chat).querySelector('.cvt-start-error[role="alert"]')?.textContent).toBe(REFUSED));
    expect(root(chat).querySelector('civitai-chat-composer')).toBeNull();
    expect(store.calls).toEqual([]);

    chat.runner = 'remote';
    chat.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch };
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
    expect(root(chat).querySelector('.cvt-start-error')).toBeNull();
    await vi.waitFor(() => expect(store.calls).toContain('list'));
  });

  it('builds exactly one session for two quick runner changes after a failed start', async () => {
    const { chat, store, runner } = refused();
    await vi.waitFor(() => expect(root(chat).querySelector('.cvt-start-error')).not.toBeNull());
    // Two updates run back to back, each starting a session, before either start's import has settled.
    const update = () => (chat as unknown as { performUpdate(): void }).performUpdate();
    chat.runner = 'remote';
    chat.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch };
    update();
    chat.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch };
    update();
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Each session lists the chats once as it starts.
    expect(store.calls.filter((call) => call === 'list')).toEqual(['list']);
  });

  it('does not restart a session that started: a later runner change leaves it as it is', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    const runner = fakeRunner();
    const chat = document.createElement('civitai-chat');
    chat.runner = 'remote';
    chat.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch };
    chat.backend = { model: 'host/default', store } as never;
    document.body.append(chat);
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
    await vi.waitFor(() => expect(store.calls).toEqual(['list']));
    // Restarting now would refuse these options (a store-only backend in the browser).
    chat.runner = 'browser';
    chat.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch };
    await chat.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(store.calls).toEqual(['list']);
    expect(root(chat).querySelector('.cvt-start-error')).toBeNull();
    expect(root(chat).querySelector('civitai-chat-composer')).not.toBeNull();
  });
});
