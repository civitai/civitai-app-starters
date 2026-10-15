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
