import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

/**
 * A chat on a store-only backend whose replies run on a fake runner. `order` records, in the order
 * they happened, the runner's lookups and stops and the host store's deletes.
 */
async function remoteChat() {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Anything sent outside the runner and the host's store would land here.
  const global = vi.fn(async () => new Response('not here', { status: 404 }));
  vi.stubGlobal('fetch', global);
  const order: string[] = [];
  const runner = fakeRunner();
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).slice(`${RUNNER_URL}/`.length);
    if (path.startsWith('runs?') || path.endsWith('/stop')) order.push(`${init?.method ?? 'GET'} ${path}`);
    return runner.fetch(input, init);
  }) as typeof globalThis.fetch;
  const store = memoryStore();
  const remove = store.delete.bind(store);
  store.delete = async (id, options) => {
    order.push(`delete ${id}`);
    await remove(id, options);
  };
  const chat = document.createElement('civitai-chat');
  chat.runner = 'remote';
  chat.remoteRunner = { url: RUNNER_URL, fetch, reconnectDelaysMs: [0] };
  chat.backend = { model: 'host/default', store } as never;
  document.body.append(chat);
  await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
  return { chat, runner, store, order, global };
}

/** Sends a message, so a run is live for the open chat, and asks to delete that chat. */
async function deleteWhileRunning(chat: CivitaiChat, runner: ReturnType<typeof fakeRunner>, order: string[]): Promise<string> {
  void chat.send('hello');
  await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
  const id = currentId(chat)!;
  expect(id).toBe(runner.runs.get('r1')!.conversationId);
  order.length = 0;
  root(chat).querySelector<{ ask(): Promise<boolean> } & Element>('#cvt-delete-dialog')!.ask = async () => true;
  root(chat).querySelector('civitai-chat-sidebar')!.dispatchEvent(new CustomEvent('cvt-delete', { detail: { id, title: 'hello' }, bubbles: true, composed: true }));
  return id;
}

describe('<civitai-chat runner="remote"> on a host store: deleting a chat whose run is live', () => {
  it('stops the run first, then deletes the chat, and the viewer leaves it', async () => {
    const { chat, runner, store, order, global } = await remoteChat();
    const id = await deleteWhileRunning(chat, runner, order);
    await vi.waitFor(() => expect(order).toContain(`delete ${id}`));
    expect(order).toEqual([`GET runs?conversationId=${id}`, 'POST runs/r1/stop', `delete ${id}`]);
    await vi.waitFor(() => expect(currentId(chat)).not.toBe(id));
    expect(store.calls.filter((call) => call.startsWith('save'))).toEqual([]);
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
  });
});

describe('<civitai-chat> given a store-only backend before runner="remote"', () => {
  it('says why it cannot start instead of spinning, and starts once the runner is set', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    const runner = fakeRunner();
    const chat = document.createElement('civitai-chat');
    chat.backend = { model: 'host/default', store } as never;
    document.body.append(chat);
    await vi.waitFor(() =>
      expect(root(chat).querySelector('.cvt-start-error[role="alert"]')?.textContent).toBe(
        "The chat could not start: A backend without url needs runner 'remote': in the browser, replies go to backend.url.",
      ),
    );
    expect(root(chat).querySelector('civitai-chat-composer')).toBeNull();
    expect(store.calls).toEqual([]);

    chat.runner = 'remote';
    chat.remoteRunner = { url: RUNNER_URL, fetch: runner.fetch };
    await vi.waitFor(() => expect(root(chat).querySelector('civitai-chat-composer')).not.toBeNull(), { timeout: 10_000 });
    expect(root(chat).querySelector('.cvt-start-error')).toBeNull();
    await vi.waitFor(() => expect(store.calls).toContain('list'));
  });
});
