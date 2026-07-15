import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useSharedStorage } from '../src/hooks/useSharedStorage.js';
import { getTransport } from '../src/internal/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * Coverage for the SHARED-storage mock backend in `createMockHost` (the
 * in-memory, app-scoped, votable store answering the `SHARED_*` protocol).
 * Exercised against the REAL `useSharedStorage` hook + transport, mirroring the
 * `storage scenario (in-memory KV)` block in mockHostScenarios.test.tsx.
 */

const ORIGIN = window.location.origin;

describe('createMockHost — shared scenario (in-memory votable store)', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  async function ready() {
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  it('append() assigns a key; list() returns entries newest-first', async () => {
    host = createMockHost({ shared: {} });
    uninstall = host.install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    const first = await result.current.append({ title: 'first' });
    const second = await result.current.append({ title: 'second', body: 'b' });
    expect(first.key).toBeTruthy();
    expect(second.key).toBeTruthy();
    expect(first.key).not.toBe(second.key);

    const { items } = await result.current.list();
    // Newest-first: the last appended entry leads.
    expect(items.map((i) => i.value.title)).toEqual(['second', 'first']);
    expect(items[0]!.key).toBe(second.key);
    expect(items[0]!.value).toEqual({ title: 'second', body: 'b' });
    expect(items[0]!.count).toBe(0);
    expect(items[0]!.authorUserId).toBe(2); // DEFAULT_VIEWER.id
    expect(items[0]!.createdAt).toBeInstanceOf(Date);
    expect(items[0]!.updatedAt).toBeInstanceOf(Date);
  });

  it('append() echoes the opaque `data` payload back through list()', async () => {
    host = createMockHost({ shared: {} });
    uninstall = host.install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    const data = { spec: { steps: 20, sampler: 'Euler' }, v: 1 };
    const { key } = await result.current.append({ title: 'gen', body: 'notes', data });

    const { items } = await result.current.list();
    const entry = items.find((i) => i.key === key)!;
    expect(entry.value).toEqual({ title: 'gen', body: 'notes', data });
    // An entry appended without `data` has no data key (not an explicit undefined).
    const bare = await result.current.append({ title: 'no-data' });
    const bareEntry = (await result.current.list()).items.find((i) => i.key === bare.key)!;
    expect('data' in bareEntry.value).toBe(false);
  });

  it('seed populates the store (newest-first) with author + votes', async () => {
    host = createMockHost({
      shared: {
        seed: [
          { value: { title: 'oldest' }, authorUserId: 11, voters: [11, 12] },
          { value: { title: 'newest' }, authorUserId: 13 },
        ],
      },
    });
    uninstall = host.install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    const { items } = await result.current.list();
    expect(items.map((i) => i.value.title)).toEqual(['newest', 'oldest']);
    const oldest = items.find((i) => i.value.title === 'oldest')!;
    expect(oldest.authorUserId).toBe(11);
    expect(oldest.count).toBe(2);
  });

  it('vote() is one-per-user (idempotent); unvote() removes it', async () => {
    host = createMockHost({ shared: {} });
    uninstall = host.install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    const { key } = await result.current.append({ title: 'votable' });
    expect(await result.current.getCount(key)).toBe(0);

    expect(await result.current.vote(key)).toBe(1);
    // Voting again by the same (mock) user is a no-op — still 1.
    expect(await result.current.vote(key)).toBe(1);
    expect(await result.current.getCount(key)).toBe(1);

    // Unvote removes the single vote.
    expect(await result.current.unvote(key)).toBe(0);
    // Unvoting again is idempotent.
    expect(await result.current.unvote(key)).toBe(0);
    expect(await result.current.getCount(key)).toBe(0);
  });

  it('getCounts() returns a map, 0 for unknown keys', async () => {
    host = createMockHost({ shared: {} });
    uninstall = host.install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    const a = await result.current.append({ title: 'a' });
    const b = await result.current.append({ title: 'b' });
    await result.current.vote(a.key);

    const counts = await result.current.getCounts([a.key, b.key, 'nope']);
    expect(counts[a.key]).toBe(1);
    expect(counts[b.key]).toBe(0);
    expect(counts['nope']).toBe(0);
  });

  it('withdraw() removes the entry; a second withdraw reports deleted:false', async () => {
    host = createMockHost({ shared: {} });
    uninstall = host.install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    const { key } = await result.current.append({ title: 'temp' });
    expect((await result.current.list()).items).toHaveLength(1);

    expect(await result.current.withdraw(key)).toEqual({ ok: true, deleted: true });
    expect((await result.current.list()).items).toHaveLength(0);
    // Idempotent withdraw.
    expect(await result.current.withdraw(key)).toEqual({ ok: true, deleted: false });
  });

  it('vote() on a missing key rejects with NOT_FOUND', async () => {
    host = createMockHost({ shared: {} });
    uninstall = host.install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();
    await expect(result.current.vote('does-not-exist')).rejects.toThrow('NOT_FOUND');
  });

  it('shared.failNext forces N mutations to error then recovers', async () => {
    host = createMockHost({ shared: { failNext: 1 } });
    uninstall = host.install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    await expect(result.current.append({ title: 'x' })).rejects.toThrow('SHARED_UNAVAILABLE');
    // Recovers on the next call.
    await expect(result.current.append({ title: 'y' })).resolves.toMatchObject({
      key: expect.any(String),
    });
  });

  it('list() paginates with a cursor (newest-first)', async () => {
    host = createMockHost({
      shared: {
        seed: [
          { value: { title: 't1' } },
          { value: { title: 't2' } },
          { value: { title: 't3' } },
        ],
      },
    });
    uninstall = host.install();
    const { result } = renderHook(() => useSharedStorage());
    await ready();

    const page1 = await result.current.list({ limit: 2 });
    expect(page1.items.map((i) => i.value.title)).toEqual(['t3', 't2']);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await result.current.list({ limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((i) => i.value.title)).toEqual(['t1']);
    expect(page2.nextCursor).toBeUndefined();
  });
});
