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

  it('keeps a chat deleted while its reply was still running: the reply saves nothing and lists nothing', async () => {
    const store = memoryStore();
    const ids = ['C1', 'C2'];
    const threads = new HostThreadStore({ store, newId: () => ids.shift()! });
    const turn = threads.appendUserTurn('delete me', []);
    await threads.remove('C1');
    threads.startNew();
    turn.assistant = { messages: [{ role: 'assistant', content: 'partial' }], status: 'aborted' };
    await threads.completeTurn(turn);
    expect([...store.records.keys()]).toEqual([]);
    expect(threads.summaries.map((summary) => summary.id)).toEqual([]);
  });

  it('keeps a chat deleted after the viewer moved to a new one, before its reply ended', async () => {
    const store = memoryStore();
    const ids = ['C1', 'C2'];
    const threads = new HostThreadStore({ store, newId: () => ids.shift()! });
    const turn = threads.appendUserTurn('delete me', []);
    threads.startNew();
    await threads.remove('C1');
    turn.assistant = { messages: [{ role: 'assistant', content: 'partial' }], status: 'done' };
    await threads.completeTurn(turn);
    expect([...store.records.keys()]).toEqual([]);
    expect(threads.summaries.map((summary) => summary.id)).toEqual([]);
  });

  it('saves a chat again when its delete failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = memoryStore();
    store.delete = async () => {
      throw new Error('locked');
    };
    const threads = new HostThreadStore({ store, newId: () => 'C1' });
    const turn = threads.appendUserTurn('keep me', []);
    await expect(threads.remove('C1')).rejects.toThrow('locked');
    turn.assistant.status = 'done';
    await threads.completeTurn(turn);
    expect(store.records.get('C1')!.turns[0]!.assistant).toMatchObject({ status: 'done' });
  });

  /** A store whose delete waits until released, then works or throws. */
  function heldDelete(initial: Parameters<typeof memoryStore>[0] = []) {
    const store = memoryStore(initial);
    const remove = store.delete.bind(store);
    let release!: (fail?: boolean) => void;
    store.delete = (id, options) =>
      new Promise<void>((resolve, reject) => {
        release = (fail = false) => (fail ? reject(new Error('delete failed')) : void remove(id, options).then(resolve));
      });
    return { store, release: (fail?: boolean) => release(fail) };
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('F1: renames nothing back into a chat whose delete was on its way', async () => {
    const { store, release } = heldDelete([record(1)]);
    // The rename's load answers only after the delete is done: the order that wrote the chat back.
    const load = store.load.bind(store);
    let answer: (() => void) | undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    store.load = async (id, options) => {
      const found = await load(id, options);
      await answered;
      return found;
    };
    const threads = new HostThreadStore({ store });
    await threads.refreshList();
    const removed = threads.remove('A');
    await tick();
    const renamed = threads.rename('A', 'Renamed');
    await tick();
    release();
    await removed;
    answer!();
    await renamed;
    expect([...store.records.keys()]).toEqual([]);
    expect(threads.summaries).toEqual([]);
  });

  it('F1: renames nothing back after a delete, even from a store whose load still returns the chat', async () => {
    const store = memoryStore([record(1)]);
    // A host whose reads lag its deletes (a replica, a cache): load still finds the deleted chat.
    const stale = structuredClone(record(1));
    store.load = async () => structuredClone(stale);
    const threads = new HostThreadStore({ store });
    await threads.refreshList();
    await threads.remove('A');
    await threads.rename('A', 'Renamed');
    expect([...store.records.keys()]).toEqual([]);
  });

  it('F2: opens a chat whose delete is on its way only once it settles: refused after it worked', async () => {
    const { store, release } = heldDelete([record(1)]);
    const loads = vi.spyOn(store, 'load');
    const threads = new HostThreadStore({ store, newId: () => 'NEW' });
    const removed = threads.remove('A');
    const opening = threads.open('A');
    await tick();
    // Never a load while the delete runs.
    expect(loads).not.toHaveBeenCalled();
    release();
    await removed;
    await expect(opening).rejects.toThrow('That chat was deleted.');
    await expect(threads.open('A')).rejects.toThrow('That chat was deleted.');
    expect(loads).not.toHaveBeenCalled();
    expect(threads.current).toBeNull();
    const turn = threads.appendUserTurn('after', []);
    turn.assistant.status = 'done';
    await threads.completeTurn(turn);
    expect([...store.records.keys()]).toEqual(['NEW']);
  });

  /** A held save on chat A, then `first` and `second` asked in that order; the delete fails. Returns the events seen. */
  async function openAndFailedDelete(order: 'open-first' | 'delete-first') {
    const events: string[] = [];
    const store = memoryStore([record(1)]);
    const save = store.save.bind(store);
    const load = store.load.bind(store);
    let releaseSave!: () => void;
    const saveHeld = new Promise<void>((resolve) => (releaseSave = resolve));
    store.save = async (conversation) => {
      await saveHeld;
      await save(conversation);
    };
    let failDelete!: () => void;
    store.delete = () =>
      new Promise<void>((_, reject) => {
        events.push('delete');
        failDelete = () => {
          events.push('delete failed');
          reject(new Error('delete failed'));
        };
      });
    store.load = async (id, options) => {
      events.push('load start');
      const found = await load(id, options);
      await tick();
      events.push('load end');
      return found;
    };
    const threads = new HostThreadStore({ store });
    await threads.open('A');
    events.length = 0;
    threads.appendUserTurn('m2', []);
    threads.startNew();
    const [opening, removed] =
      order === 'open-first' ? [threads.open('A'), threads.remove('A')] : ((r) => [threads.open('A'), r])(threads.remove('A'));
    releaseSave();
    await vi.waitFor(() => expect(events).toContain('delete'));
    failDelete();
    await expect(removed).rejects.toThrow('delete failed');
    const { conversation } = await opening;
    return { events, turns: conversation.turns.map((turn) => turn.user.content) };
  }

  it('F2: opens a chat as usual once its delete failed, and never loads while the delete runs', async () => {
    const deleteFirst = await openAndFailedDelete('delete-first');
    expect(deleteFirst).toEqual({ events: ['delete', 'delete failed', 'load start', 'load end'], turns: ['m1', 'm2'] });
    const openFirst = await openAndFailedDelete('open-first');
    expect(openFirst).toEqual({ events: ['load start', 'load end', 'delete', 'delete failed'], turns: ['m1', 'm2'] });
  });

  it('F2: a delete asked while a chat loads runs after the load, and leaves no chat open', async () => {
    const store = memoryStore([record(1)]);
    const load = store.load.bind(store);
    let answer!: () => void;
    store.load = (id, options) => new Promise((resolve) => (answer = () => void load(id, options).then(resolve)));
    const deletes = vi.spyOn(store, 'delete');
    const threads = new HostThreadStore({ store });
    const opening = threads.open('A');
    await tick();
    const removed = threads.remove('A');
    await tick();
    expect(deletes).not.toHaveBeenCalled();
    answer();
    await opening;
    await removed;
    expect(threads.current).toBeNull();
    expect([...store.records.keys()]).toEqual([]);
  });

  const two = () => [record(1), { ...record(1), id: 'B', title: 'B', updatedAt: '2026-10-16T00:00:00Z' }];

  it("drops an open that finishes after the viewer opened another chat: theirs stays open", async () => {
    const { store, release } = heldDelete(two());
    const threads = new HostThreadStore({ store });
    const removed = threads.remove('A');
    const late = threads.open('A');
    await tick();
    await threads.open('B');
    release(true);
    await expect(removed).rejects.toThrow('delete failed');
    await expect(late).rejects.toMatchObject({ code: 'superseded' });
    expect(threads.current!.id).toBe('B');
  });

  it('drops an open that fails after the viewer opened another chat, without the failure', async () => {
    const { store, release } = heldDelete(two());
    const threads = new HostThreadStore({ store });
    const removed = threads.remove('A');
    const late = threads.open('A');
    await tick();
    await threads.open('B');
    release();
    await removed;
    // Refused (its delete worked), but stale: superseded, so the caller says nothing and leaves B open.
    await expect(late).rejects.toMatchObject({ code: 'superseded' });
    expect(threads.current!.id).toBe('B');
  });

  it('drops an open that finishes after the viewer started a new chat', async () => {
    const store = memoryStore([record(1)]);
    const load = store.load.bind(store);
    let answer!: () => void;
    store.load = (id, options) => new Promise((resolve) => (answer = () => void load(id, options).then(resolve)));
    const threads = new HostThreadStore({ store, newId: () => 'NEW' });
    const late = threads.open('A');
    await tick();
    threads.startNew();
    answer();
    await expect(late).rejects.toMatchObject({ code: 'superseded' });
    expect(threads.current!.id).toBe('NEW');
  });

  it('takes a chat off the list the moment its delete starts, and puts it back when the delete fails', async () => {
    const { store, release } = heldDelete(two());
    const threads = new HostThreadStore({ store });
    await threads.refreshList();
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B', 'A']);
    const removed = threads.remove('A');
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B']);
    await tick();
    release(true);
    await expect(removed).rejects.toThrow('delete failed');
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B', 'A']);
  });

  it('lists a chat again once its only delete failed', async () => {
    const { store, release } = heldDelete(two());
    const threads = new HostThreadStore({ store });
    const removed = threads.remove('A');
    await tick();
    release(true);
    await expect(removed).rejects.toThrow('delete failed');
    await threads.refreshList();
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B', 'A']);
  });

  it('keeps a chat off the list while its delete still waits behind a slow save', async () => {
    const { store: slow, releaseAll } = slowStore(two());
    const threads = new HostThreadStore({ store: slow });
    await threads.open('A');
    threads.appendUserTurn('m2', []);
    threads.startNew();
    await tick();
    const removed = threads.remove('A');
    await threads.refreshList();
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B']);
    await releaseAll();
    await removed;
  });

  it('holds nothing up when a delete never answers: the chat is off the list, and new chats save', async () => {
    const store = memoryStore(two());
    store.delete = () => new Promise<void>(() => undefined);
    const threads = new HostThreadStore({ store, newId: () => 'NEW' });
    await threads.refreshList();
    void threads.remove('A');
    await threads.refreshList();
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B']);
    const turn = threads.appendUserTurn('still here', []);
    turn.assistant.status = 'done';
    await threads.completeTurn(turn);
    expect(store.records.get('NEW')).toBeDefined();
  });

  it('asks the host to delete a chat once, even when deleted twice', async () => {
    const { store, release } = heldDelete([record(1)]);
    const deletes = vi.spyOn(store, 'delete');
    const threads = new HostThreadStore({ store });
    const first = threads.remove('A');
    const second = threads.remove('A');
    await tick();
    release();
    await first;
    await second;
    expect(deletes).toHaveBeenCalledTimes(1);
  });

  it('keeps a chat off the list while a second delete is on its way after the first failed', async () => {
    const store = memoryStore([record(1), { ...record(1), id: 'B', title: 'B' }]);
    const outcomes: (() => void)[] = [];
    const remove = store.delete.bind(store);
    store.delete = (id, options) =>
      new Promise<void>((resolve, reject) => outcomes.push(outcomes.length === 0 ? () => reject(new Error('first failed')) : () => void remove(id, options).then(resolve)));
    const threads = new HostThreadStore({ store });
    const first = threads.remove('A');
    const second = threads.remove('A');
    await tick();
    outcomes[0]!();
    await expect(first).rejects.toThrow('first failed');
    await tick();
    await threads.refreshList();
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B']);
    outcomes[1]!();
    await second;
    expect([...store.records.keys()]).toEqual(['B']);
  });

  it('F2: lists no chat whose delete is on its way or done', async () => {
    const { store, release } = heldDelete([record(1), { ...record(1), id: 'B', title: 'B' }]);
    const threads = new HostThreadStore({ store });
    const removed = threads.remove('A');
    await threads.refreshList();
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B']);
    release();
    await removed;
    await threads.refreshList();
    expect(threads.summaries.map((summary) => summary.id)).toEqual(['B']);
  });

  it('F3: keeps the reply that ended while a delete was on its way, when the delete fails', async () => {
    const { store, release } = heldDelete();
    const threads = new HostThreadStore({ store, newId: () => 'C1' });
    const turn = threads.appendUserTurn('keep me', []);
    await tick();
    const removed = threads.remove('C1');
    await tick();
    turn.assistant = { messages: [{ role: 'assistant', content: 'the reply' }], status: 'done' };
    const completed = threads.completeTurn(turn);
    release(true);
    await expect(removed).rejects.toThrow('delete failed');
    await completed;
    expect(store.records.get('C1')!.turns[0]!.assistant).toMatchObject({ status: 'done', messages: [{ content: 'the reply' }] });
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
