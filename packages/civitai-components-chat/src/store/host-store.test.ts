import { describe, expect, it, vi } from 'vitest';

import { memoryStore } from '../test-support/fake-backend.js';
import type { ChatConversation } from './conversation-store.js';
import { HostThreadStore } from './host-store.js';

const at = (iso: string) => () => new Date(iso);

describe('HostThreadStore', () => {
  it('saves the whole conversation, the message at once and the reply when it ends, one save after another', async () => {
    const store = memoryStore();
    const order: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => (release = resolve));
    const save = store.save.bind(store);
    store.save = vi.fn(async (conversation: ChatConversation) => {
      order.push(`start ${conversation.turns.map((turn) => turn.assistant?.status ?? 'pending').join(',')}`);
      if (order.length === 1) await first;
      await save(conversation);
      order.push('end');
    });
    const threads = new HostThreadStore({ store, scope: 'notes', now: at('2026-10-15T10:00:00Z'), newId: () => 'C1' });

    const turn = threads.appendUserTurn('plan my week', []);
    // As the agent does: the reply streams in only after the message's save has started.
    await new Promise((resolve) => setTimeout(resolve, 0));
    turn.assistant = { messages: [{ role: 'assistant', content: 'Here is a plan.' }], status: 'done' };
    const completed = threads.completeTurn(turn);
    release();
    await completed;

    // The second save waited for the first, and was built from the state at its own start.
    expect(order).toEqual(['start pending', 'end', 'start done', 'end']);
    expect(store.records.get('C1')).toEqual({
      id: 'C1',
      title: 'plan my week',
      titleSource: 'first-message',
      createdAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z',
      turns: [{ seq: 1, createdAt: '2026-10-15T10:00:00.000Z', user: { content: 'plan my week', attachments: [] }, assistant: { messages: [{ role: 'assistant', content: 'Here is a plan.' }], status: 'done' } }],
      scope: 'notes',
    });
  });

  it('opens a conversation saved mid-reply as cut off, and an unknown id as an empty chat', async () => {
    const store = memoryStore([
      { id: 'C1', title: 'Half', titleSource: 'first-message', createdAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-15T10:00:00Z', turns: [{ seq: 1, createdAt: '2026-10-15T10:00:00Z', user: { content: 'hi', attachments: [] } }] },
    ]);
    const threads = new HostThreadStore({ store });
    const { conversation, jobs } = await threads.open('C1');
    expect(jobs).toEqual([]);
    expect(conversation.turns[0]!.assistant).toEqual({ messages: [], status: 'error', error: 'cut-off' });
    expect((await threads.open('NOPE')).conversation).toMatchObject({ id: 'NOPE', title: 'New chat', turns: [] });
  });

  it('pages the list with the cursor the store hands back, keeping each id once', async () => {
    const pages = [
      { items: [{ id: 'B', title: 'Two', updatedAt: '2026-10-14T00:00:00Z' }], next: 'p2' },
      { items: [{ id: 'B', title: 'Two', updatedAt: '2026-10-14T00:00:00Z' }, { id: 'A', title: 'One', updatedAt: '2026-10-13T00:00:00Z' }], next: null },
    ];
    const list = vi.fn(async (_options: { scope?: string; cursor?: string }) => pages.shift()!);
    const threads = new HostThreadStore({ store: { ...memoryStore(), list }, scope: 'notes' });
    await threads.refreshList();
    expect(threads.hasMore).toBe(true);
    await threads.loadMore();
    expect(threads.hasMore).toBe(false);
    expect(list.mock.calls.map(([options]) => options)).toEqual([{ scope: 'notes' }, { scope: 'notes', cursor: 'p2' }]);
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B', 'A']);
  });

  /** A store whose saves wait until released, so a test can act while one is on its way. */
  function slowStore(initial: Parameters<typeof memoryStore>[0] = []) {
    const store = memoryStore(initial);
    const save = store.save.bind(store);
    const held: (() => void)[] = [];
    store.save = (conversation) => new Promise<void>((resolve) => held.push(() => void save(conversation).then(resolve)));
    const releaseAll = async () => {
      // A queued save starts a tick after the change that queued it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (held.length) {
        held.shift()!();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    return { store, releaseAll };
  }

  const record = (turns: number, title = 'A') => ({
    id: 'A',
    title,
    titleSource: 'llm' as const,
    createdAt: '2026-10-15T10:00:00Z',
    updatedAt: '2026-10-15T10:00:00Z',
    turns: Array.from({ length: turns }, (_, i) => ({ seq: i + 1, createdAt: '2026-10-15T10:00:00Z', user: { content: `m${i + 1}`, attachments: [] }, assistant: { messages: [], status: 'done' as const } })),
  });

  it('reopens a chat only after its save still on its way, so no message is lost', async () => {
    const { store, releaseAll } = slowStore([record(1)]);
    const threads = new HostThreadStore({ store });
    await threads.open('A');
    threads.appendUserTurn('m2', []);
    threads.startNew();
    const reopened = threads.open('A');
    await releaseAll();
    await reopened;
    expect(threads.current!.turns.map((turn) => turn.user.content)).toEqual(['m1', 'm2']);
    threads.current!.turns.at(-1)!.assistant = { messages: [], status: 'done' };
    threads.appendUserTurn('m3', []);
    await releaseAll();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.records.get('A')!.turns.map((turn) => `${turn.seq}:${turn.user.content}`)).toEqual(['1:m1', '2:m2', '3:m3']);
  });

  it('renames a chat that is not open after its save still on its way, keeping that save and its scope', async () => {
    const { store, releaseAll } = slowStore([{ ...record(1), scope: 'notes' }]);
    // A host whose load leaves the scope out: the rename must not drop the chat from its scoped list.
    const load = store.load.bind(store);
    store.load = async (id, options) => {
      const found = await load(id, options);
      if (found) delete found.scope;
      return found;
    };
    const threads = new HostThreadStore({ store, scope: 'notes' });
    await threads.open('A');
    threads.appendUserTurn('m2', []);
    threads.startNew();
    await threads.refreshList();
    const renamed = threads.rename('A', 'Renamed');
    await releaseAll();
    await renamed;
    expect(store.records.get('A')).toMatchObject({ title: 'Renamed', titleSource: 'user', scope: 'notes' });
    expect(store.records.get('A')!.turns.map((turn) => turn.user.content)).toEqual(['m1', 'm2']);
  });

  it('tells of a save that failed with a save-error event', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    store.save = async () => {
      throw new Error('disk full');
    };
    const threads = new HostThreadStore({ store, newId: () => 'C1' });
    const failed: unknown[] = [];
    threads.addEventListener('save-error', (event) => failed.push((event as CustomEvent).detail));
    const turn = threads.appendUserTurn('hello', []);
    turn.assistant.status = 'done';
    await expect(threads.completeTurn(turn)).rejects.toThrow('disk full');
    // Once per send: the message's own save, which failed too, is not announced again.
    expect(failed).toEqual([{ id: 'C1', error: expect.objectContaining({ message: 'disk full' }) }]);
    // A rename or a model change says so to its own caller, which tells the viewer: no event.
    await expect(threads.setTitle('Renamed', 'user')).rejects.toThrow('disk full');
    await expect(threads.setModel('host/big')).rejects.toThrow('disk full');
    expect(failed).toHaveLength(1);
  });

  it('saves a reply with its own chat after the viewer started a new one, and the message with it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    const save = store.save.bind(store);
    let saves = 0;
    // The message's own save fails; the one when the reply ends works.
    store.save = async (conversation) => {
      if (++saves === 1) throw new Error('flaky');
      await save(conversation);
    };
    const ids = ['C1', 'C2'];
    const threads = new HostThreadStore({ store, newId: () => ids.shift()! });
    const failed: unknown[] = [];
    threads.addEventListener('save-error', (event) => failed.push((event as CustomEvent).detail));
    const turn = threads.appendUserTurn('important message', []);
    threads.startNew();
    turn.assistant = { messages: [{ role: 'assistant', content: 'Noted.' }], status: 'aborted' };
    await threads.completeTurn(turn);

    expect([...store.records.keys()]).toEqual(['C1']);
    expect(store.records.get('C1')!.turns.map((t) => t.user.content)).toEqual(['important message']);
    expect(failed).toEqual([]);
    expect(threads.current!.id).toBe('C2');
    expect(threads.current!.turns).toEqual([]);
  });

  it("tells of a reply's failed save for its own chat after the viewer started a new one", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    store.save = async () => {
      throw new Error('down');
    };
    const ids = ['C1', 'C2'];
    const threads = new HostThreadStore({ store, newId: () => ids.shift()! });
    const failed: { id: string }[] = [];
    threads.addEventListener('save-error', (event) => failed.push((event as CustomEvent<{ id: string }>).detail));
    const turn = threads.appendUserTurn('important message', []);
    threads.startNew();
    turn.assistant.status = 'aborted';
    await expect(threads.completeTurn(turn)).rejects.toThrow('down');
    expect(failed.map((detail) => detail.id)).toEqual(['C1']);
  });

  it('deletes only after a save still on its way, so the save cannot bring the chat back', async () => {
    const store = memoryStore();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const save = store.save.bind(store);
    store.save = async (conversation) => {
      await held;
      await save(conversation);
    };
    const threads = new HostThreadStore({ store, newId: () => 'C1' });
    threads.appendUserTurn('hello', []);
    const removed = threads.remove('C1');
    release();
    await removed;
    // Long enough for a save the delete did not wait for to land.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.records.has('C1')).toBe(false);
    expect(threads.current).toBeNull();
  });
});
