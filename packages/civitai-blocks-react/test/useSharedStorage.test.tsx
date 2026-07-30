import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useSharedStorage } from '../src/hooks/useSharedStorage.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

/** Fire a parent→block reply from the allowed origin. */
function reply(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, origin: PARENT_ORIGIN }));
}

describe('useSharedStorage', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageMock = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInit() },
        origin: PARENT_ORIGIN,
      }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
  });

  /** The single message the block last posted to the host. */
  function lastSent<T = { type: string; payload: Record<string, unknown> }>(): T {
    const calls = postMessageMock.mock.calls;
    return calls[calls.length - 1][0] as T;
  }

  it('exposes a stable shared object across renders', () => {
    const { result, rerender } = renderHook(() => useSharedStorage());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('never puts a blockToken on any outbound message', () => {
    const { result } = renderHook(() => useSharedStorage());
    // These stay pending (no reply); swallow the disposal rejection in teardown.
    const swallow = () => {};
    act(() => {
      result.current.list().catch(swallow);
      result.current.getCount('k').catch(swallow);
      result.current.getCounts(['a', 'b']).catch(swallow);
      result.current.append({ title: 't' }).catch(swallow);
      result.current.update('k', { title: 't2' }).catch(swallow);
      result.current.vote('k').catch(swallow);
      result.current.unvote('k').catch(swallow);
      result.current.withdraw('k').catch(swallow);
    });
    expect(postMessageMock.mock.calls.length).toBeGreaterThanOrEqual(8);
    for (const call of postMessageMock.mock.calls) {
      const msg = call[0] as { payload?: Record<string, unknown> };
      expect(msg.payload).not.toHaveProperty('blockToken');
      expect(msg.payload).not.toHaveProperty('token');
    }
  });

  // ---- list ----
  it('list() posts SHARED_LIST with args + rehydrates dates, ordering, cursor', async () => {
    const { result } = renderHook(() => useSharedStorage());

    let p!: Promise<unknown>;
    act(() => {
      p = result.current.list({ prefix: 'req:', limit: 5, cursor: 'Y3Vy' });
    });
    const sent = lastSent<{
      type: string;
      payload: { requestId: string; prefix: string; limit: number; cursor: string };
    }>();
    expect(sent.type).toBe('SHARED_LIST');
    expect(sent.payload.prefix).toBe('req:');
    expect(sent.payload.limit).toBe(5);
    expect(sent.payload.cursor).toBe('Y3Vy');
    expect(sent.payload).not.toHaveProperty('blockToken');

    const createdAt = '2026-05-01T00:00:00.000Z';
    const updatedAt = '2026-05-02T00:00:00.000Z';
    act(() => {
      reply({
        type: 'SHARED_LIST_RESULT',
        payload: {
          requestId: sent.payload.requestId,
          items: [
            {
              key: 'req:1',
              authorUserId: 7,
              value: { title: 'Dark mode', body: 'please' },
              count: 3,
              createdAt,
              updatedAt,
            },
          ],
          nextCursor: 'bmV4dA==',
        },
      });
    });

    const out = (await p) as {
      items: Array<{
        key: string;
        authorUserId: number;
        value: { title: string; body?: string };
        count: number;
        createdAt: Date;
        updatedAt: Date;
      }>;
      nextCursor?: string;
    };
    expect(out.items[0].key).toBe('req:1');
    expect(out.items[0].authorUserId).toBe(7);
    expect(out.items[0].value).toEqual({ title: 'Dark mode', body: 'please' });
    expect(out.items[0].count).toBe(3);
    expect(out.items[0].createdAt).toBeInstanceOf(Date);
    expect(out.items[0].createdAt.toISOString()).toBe(createdAt);
    expect(out.items[0].updatedAt.toISOString()).toBe(updatedAt);
    expect(out.nextCursor).toBe('bmV4dA==');
  });

  it('list() rejects on an error reply', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.list();
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_LIST_RESULT',
        payload: { requestId: sent.payload.requestId, items: [], error: 'SHARED_UNAVAILABLE' },
      });
    });
    await expect(p).rejects.toThrow('SHARED_UNAVAILABLE');
  });

  it('list() ignores a mismatched requestId, resolves on the right one', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.list();
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    const settled = vi.fn();
    p.then(settled, settled);

    act(() => {
      reply({
        type: 'SHARED_LIST_RESULT',
        payload: { requestId: 'not-the-right-id', items: [] },
      });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    // The matching requestId still resolves it (and drains the pending request).
    act(() => {
      reply({ type: 'SHARED_LIST_RESULT', payload: { requestId: sent.payload.requestId, items: [] } });
    });
    await expect(p).resolves.toEqual({ items: [], nextCursor: undefined });
  });

  // ---- getCount ----
  it('getCount() posts SHARED_GET_COUNT and resolves the count', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.getCount('req:1');
    });
    const sent = lastSent<{ type: string; payload: { requestId: string; key: string } }>();
    expect(sent.type).toBe('SHARED_GET_COUNT');
    expect(sent.payload.key).toBe('req:1');
    expect(sent.payload).not.toHaveProperty('blockToken');

    act(() => {
      reply({
        type: 'SHARED_GET_COUNT_RESULT',
        payload: { requestId: sent.payload.requestId, count: 42 },
      });
    });
    await expect(p).resolves.toBe(42);
  });

  it('getCount() rejects on an error reply', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.getCount('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_GET_COUNT_RESULT',
        payload: { requestId: sent.payload.requestId, count: 0, error: 'NOT_FOUND' },
      });
    });
    await expect(p).rejects.toThrow('NOT_FOUND');
  });

  it('getCount() ignores a mismatched requestId, resolves on the right one', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.getCount('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    const settled = vi.fn();
    p.then(settled, settled);
    act(() => {
      reply({
        type: 'SHARED_GET_COUNT_RESULT',
        payload: { requestId: 'wrong', count: 9 },
      });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    act(() => {
      reply({ type: 'SHARED_GET_COUNT_RESULT', payload: { requestId: sent.payload.requestId, count: 3 } });
    });
    await expect(p).resolves.toBe(3);
  });

  // ---- getCounts ----
  it('getCounts() posts SHARED_GET_COUNTS with the key array + resolves the map', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.getCounts(['a', 'b', 'c']);
    });
    const sent = lastSent<{ type: string; payload: { requestId: string; keys: string[] } }>();
    expect(sent.type).toBe('SHARED_GET_COUNTS');
    expect(sent.payload.keys).toEqual(['a', 'b', 'c']);
    expect(sent.payload).not.toHaveProperty('blockToken');

    act(() => {
      reply({
        type: 'SHARED_GET_COUNTS_RESULT',
        payload: { requestId: sent.payload.requestId, counts: { a: 1, b: 0, c: 5 } },
      });
    });
    await expect(p).resolves.toEqual({ a: 1, b: 0, c: 5 });
  });

  it('getCounts() rejects on an error reply', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.getCounts(['a']);
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_GET_COUNTS_RESULT',
        payload: { requestId: sent.payload.requestId, counts: {}, error: 'SHARED_UNAVAILABLE' },
      });
    });
    await expect(p).rejects.toThrow('SHARED_UNAVAILABLE');
  });

  it('getCounts() ignores a mismatched requestId, resolves on the right one', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.getCounts(['a']);
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    const settled = vi.fn();
    p.then(settled, settled);
    act(() => {
      reply({
        type: 'SHARED_GET_COUNTS_RESULT',
        payload: { requestId: 'wrong', counts: { a: 1 } },
      });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    act(() => {
      reply({ type: 'SHARED_GET_COUNTS_RESULT', payload: { requestId: sent.payload.requestId, counts: { a: 2 } } });
    });
    await expect(p).resolves.toEqual({ a: 2 });
  });

  // ---- append ----
  it('append() posts SHARED_APPEND with the value + resolves the minted key', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.append({ title: 'Add webhooks', body: 'for CI' });
    });
    const sent = lastSent<{
      type: string;
      payload: { requestId: string; value: { title: string; body?: string } };
    }>();
    expect(sent.type).toBe('SHARED_APPEND');
    expect(sent.payload.value).toEqual({ title: 'Add webhooks', body: 'for CI' });
    expect(sent.payload).not.toHaveProperty('blockToken');

    act(() => {
      reply({
        type: 'SHARED_APPEND_RESULT',
        payload: { requestId: sent.payload.requestId, key: 'shared_9' },
      });
    });
    await expect(p).resolves.toEqual({ key: 'shared_9' });
  });

  it('append() rejects on an error reply', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.append({ title: '' });
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_APPEND_RESULT',
        payload: { requestId: sent.payload.requestId, key: '', error: 'INVALID_VALUE' },
      });
    });
    await expect(p).rejects.toThrow('INVALID_VALUE');
  });

  it('append() ignores a mismatched requestId, resolves on the right one', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.append({ title: 't' });
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    const settled = vi.fn();
    p.then(settled, settled);
    act(() => {
      reply({
        type: 'SHARED_APPEND_RESULT',
        payload: { requestId: 'wrong', key: 'shared_1' },
      });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    act(() => {
      reply({ type: 'SHARED_APPEND_RESULT', payload: { requestId: sent.payload.requestId, key: 'shared_2' } });
    });
    await expect(p).resolves.toEqual({ key: 'shared_2' });
  });

  // ---- update ----
  it('update() posts SHARED_UPDATE with key + value + resolves on ok', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.update('req:1', { title: 'Renamed', body: 'edited' });
    });
    const sent = lastSent<{
      type: string;
      payload: { requestId: string; key: string; value: { title: string; body?: string } };
    }>();
    expect(sent.type).toBe('SHARED_UPDATE');
    expect(sent.payload.key).toBe('req:1');
    expect(sent.payload.value).toEqual({ title: 'Renamed', body: 'edited' });
    expect(sent.payload).not.toHaveProperty('blockToken');
    expect(sent.payload).not.toHaveProperty('token');

    act(() => {
      reply({
        type: 'SHARED_UPDATE_RESULT',
        payload: { requestId: sent.payload.requestId, ok: true },
      });
    });
    await expect(p).resolves.toBeUndefined();
  });

  it('update() rejects on an error reply', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.update('k', { title: 't' });
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_UPDATE_RESULT',
        payload: { requestId: sent.payload.requestId, ok: false, error: 'FORBIDDEN' },
      });
    });
    await expect(p).rejects.toThrow('FORBIDDEN');
  });

  it('update() rejects on ok:false with no error string', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.update('k', { title: 't' });
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_UPDATE_RESULT',
        payload: { requestId: sent.payload.requestId, ok: false },
      });
    });
    await expect(p).rejects.toThrow('shared update failed');
  });

  it('update() ignores a mismatched requestId, resolves on the right one', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.update('k', { title: 't' });
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    const settled = vi.fn();
    p.then(settled, settled);
    act(() => {
      reply({ type: 'SHARED_UPDATE_RESULT', payload: { requestId: 'wrong', ok: true } });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    act(() => {
      reply({ type: 'SHARED_UPDATE_RESULT', payload: { requestId: sent.payload.requestId, ok: true } });
    });
    await expect(p).resolves.toBeUndefined();
  });

  // ---- vote ----
  it('vote() posts SHARED_VOTE + resolves the new count', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.vote('req:1');
    });
    const sent = lastSent<{ type: string; payload: { requestId: string; key: string } }>();
    expect(sent.type).toBe('SHARED_VOTE');
    expect(sent.payload.key).toBe('req:1');
    expect(sent.payload).not.toHaveProperty('blockToken');

    act(() => {
      reply({
        type: 'SHARED_VOTE_RESULT',
        payload: { requestId: sent.payload.requestId, count: 4 },
      });
    });
    await expect(p).resolves.toBe(4);
  });

  it('vote() rejects on an error reply', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.vote('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_VOTE_RESULT',
        payload: { requestId: sent.payload.requestId, count: 0, error: 'NOT_FOUND' },
      });
    });
    await expect(p).rejects.toThrow('NOT_FOUND');
  });

  it('vote() ignores a mismatched requestId, resolves on the right one', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.vote('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    const settled = vi.fn();
    p.then(settled, settled);
    act(() => {
      reply({ type: 'SHARED_VOTE_RESULT', payload: { requestId: 'wrong', count: 1 } });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    act(() => {
      reply({ type: 'SHARED_VOTE_RESULT', payload: { requestId: sent.payload.requestId, count: 5 } });
    });
    await expect(p).resolves.toBe(5);
  });

  // ---- unvote ----
  it('unvote() posts SHARED_UNVOTE + resolves the new count', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.unvote('req:1');
    });
    const sent = lastSent<{ type: string; payload: { requestId: string; key: string } }>();
    expect(sent.type).toBe('SHARED_UNVOTE');
    expect(sent.payload.key).toBe('req:1');
    expect(sent.payload).not.toHaveProperty('blockToken');

    act(() => {
      reply({
        type: 'SHARED_UNVOTE_RESULT',
        payload: { requestId: sent.payload.requestId, count: 2 },
      });
    });
    await expect(p).resolves.toBe(2);
  });

  it('unvote() rejects on an error reply', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.unvote('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_UNVOTE_RESULT',
        payload: { requestId: sent.payload.requestId, count: 0, error: 'NOT_FOUND' },
      });
    });
    await expect(p).rejects.toThrow('NOT_FOUND');
  });

  it('unvote() ignores a mismatched requestId, resolves on the right one', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.unvote('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    const settled = vi.fn();
    p.then(settled, settled);
    act(() => {
      reply({ type: 'SHARED_UNVOTE_RESULT', payload: { requestId: 'wrong', count: 1 } });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    act(() => {
      reply({ type: 'SHARED_UNVOTE_RESULT', payload: { requestId: sent.payload.requestId, count: 0 } });
    });
    await expect(p).resolves.toBe(0);
  });

  // ---- withdraw ----
  it('withdraw() posts SHARED_WITHDRAW + reports whether a row was present', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.withdraw('req:1');
    });
    const sent = lastSent<{ type: string; payload: { requestId: string; key: string } }>();
    expect(sent.type).toBe('SHARED_WITHDRAW');
    expect(sent.payload.key).toBe('req:1');
    expect(sent.payload).not.toHaveProperty('blockToken');

    act(() => {
      reply({
        type: 'SHARED_WITHDRAW_RESULT',
        payload: { requestId: sent.payload.requestId, ok: true, deleted: true },
      });
    });
    await expect(p).resolves.toEqual({ ok: true, deleted: true });
  });

  it('withdraw() resolves deleted:false when the row was already gone', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.withdraw('gone');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_WITHDRAW_RESULT',
        payload: { requestId: sent.payload.requestId, ok: true, deleted: false },
      });
    });
    await expect(p).resolves.toEqual({ ok: true, deleted: false });
  });

  it('withdraw() rejects when the host reports an error', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.withdraw('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_WITHDRAW_RESULT',
        payload: {
          requestId: sent.payload.requestId,
          ok: false,
          deleted: false,
          error: 'SHARED_UNAVAILABLE',
        },
      });
    });
    await expect(p).rejects.toThrow('SHARED_UNAVAILABLE');
  });

  it('withdraw() ignores a mismatched requestId, resolves on the right one', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.withdraw('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    const settled = vi.fn();
    p.then(settled, settled);
    act(() => {
      reply({
        type: 'SHARED_WITHDRAW_RESULT',
        payload: { requestId: 'wrong', ok: true, deleted: true },
      });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    act(() => {
      reply({
        type: 'SHARED_WITHDRAW_RESULT',
        payload: { requestId: sent.payload.requestId, ok: true, deleted: false },
      });
    });
    await expect(p).resolves.toEqual({ ok: true, deleted: false });
  });

  // ---- viewerVoted (Batch-D item 3) ----
  it('list() surfaces viewerVoted per item and defaults a missing flag to false', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.list();
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_LIST_RESULT',
        payload: {
          requestId: sent.payload.requestId,
          items: [
            {
              key: 'req:1',
              authorUserId: 7,
              value: { title: 'voted' },
              count: 2,
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:00.000Z',
              viewerVoted: true,
            },
            {
              // No viewerVoted → an OLD host; the hook must default it to false.
              key: 'req:2',
              authorUserId: 8,
              value: { title: 'old-host' },
              count: 0,
              createdAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:00.000Z',
            },
          ],
        },
      });
    });
    const out = (await p) as { items: Array<{ key: string; viewerVoted: boolean }> };
    expect(out.items[0].viewerVoted).toBe(true);
    expect(out.items[1].viewerVoted).toBe(false);
  });

  // ---- get (Batch-D item 6) ----
  it('get() posts SHARED_GET and resolves the full item (incl. viewerVoted)', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.get('req:1');
    });
    const sent = lastSent<{ type: string; payload: { requestId: string; key: string } }>();
    expect(sent.type).toBe('SHARED_GET');
    expect(sent.payload.key).toBe('req:1');
    expect(sent.payload).not.toHaveProperty('blockToken');

    act(() => {
      reply({
        type: 'SHARED_GET_RESULT',
        payload: {
          requestId: sent.payload.requestId,
          item: {
            key: 'req:1',
            authorUserId: 7,
            value: { title: 'Dark mode' },
            count: 3,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-02T00:00:00.000Z',
            viewerVoted: true,
          },
        },
      });
    });
    const out = (await p) as {
      key: string;
      count: number;
      createdAt: Date;
      viewerVoted: boolean;
    } | null;
    expect(out?.key).toBe('req:1');
    expect(out?.count).toBe(3);
    expect(out?.viewerVoted).toBe(true);
    expect(out?.createdAt).toBeInstanceOf(Date);
  });

  it('get() resolves null when the key is missing/hidden', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.get('gone');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({ type: 'SHARED_GET_RESULT', payload: { requestId: sent.payload.requestId, item: null } });
    });
    await expect(p).resolves.toBeNull();
  });

  it('get() rejects on an error reply', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.get('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_GET_RESULT',
        payload: { requestId: sent.payload.requestId, item: null, error: 'SHARED_UNAVAILABLE' },
      });
    });
    await expect(p).rejects.toThrow('SHARED_UNAVAILABLE');
  });

  // ---- report (Batch-D item 5) ----
  it('report() posts SHARED_REPORT with key + reason and resolves on ok', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.report('req:1', 'harassment');
    });
    const sent = lastSent<{
      type: string;
      payload: { requestId: string; key: string; reason?: string };
    }>();
    expect(sent.type).toBe('SHARED_REPORT');
    expect(sent.payload.key).toBe('req:1');
    expect(sent.payload.reason).toBe('harassment');
    expect(sent.payload).not.toHaveProperty('blockToken');

    act(() => {
      reply({ type: 'SHARED_REPORT_RESULT', payload: { requestId: sent.payload.requestId, ok: true } });
    });
    await expect(p).resolves.toBeUndefined();
  });

  it('report() omits reason when not provided', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.report('req:1');
    });
    const sent = lastSent<{ payload: { requestId: string; reason?: string } }>();
    expect(sent.payload.reason).toBeUndefined();
    act(() => {
      reply({ type: 'SHARED_REPORT_RESULT', payload: { requestId: sent.payload.requestId, ok: true } });
    });
    await expect(p).resolves.toBeUndefined();
  });

  it('report() rejects on an error reply (ok:false)', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.report('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({
        type: 'SHARED_REPORT_RESULT',
        payload: { requestId: sent.payload.requestId, ok: false, error: 'NOT_FOUND' },
      });
    });
    await expect(p).rejects.toThrow('NOT_FOUND');
  });

  it('report() rejects on ok:false with no error string', async () => {
    const { result } = renderHook(() => useSharedStorage());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.report('k');
    });
    const sent = lastSent<{ payload: { requestId: string } }>();
    act(() => {
      reply({ type: 'SHARED_REPORT_RESULT', payload: { requestId: sent.payload.requestId, ok: false } });
    });
    await expect(p).rejects.toThrow('shared report failed');
  });

  // ---- transport-validator: malformed replies surface an ERROR, not silent undefined ----
  // Before the SHARED_* transport validators existed, a reply missing its
  // `count`/`key`/`items` field resolved the promise with `undefined` typed as
  // `number`/`string` — no throw, no timeout (silent corruption). The validator
  // now DROPS a malformed reply at the trust boundary (console.warn), so the
  // request stays pending and REJECTS at its timeout instead of handing corrupt
  // data to the caller.
  it('getCount() drops a malformed reply (missing count) → rejects, never silent undefined', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useSharedStorage());
      let p!: Promise<unknown>;
      act(() => {
        p = result.current.getCount('k');
      });
      const sent = lastSent<{ payload: { requestId: string } }>();
      let settled: 'resolved' | 'rejected' | null = null;
      void p.then(
        () => {
          settled = 'resolved';
        },
        () => {
          settled = 'rejected';
        },
      );
      // `count` omitted — the silent-corruption shape.
      act(() => {
        reply({ type: 'SHARED_GET_COUNT_RESULT', payload: { requestId: sent.payload.requestId } });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // Dropped at the boundary → NOT resolved-with-undefined.
      expect(settled).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SHARED_GET_COUNT_RESULT'));
      // Surfaces an error (timeout reject) rather than hanging silently forever.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(settled).toBe('rejected');
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('list() drops a malformed reply (item missing count) → does not resolve with corrupt data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useSharedStorage());
      let p!: Promise<unknown>;
      act(() => {
        p = result.current.list();
      });
      const sent = lastSent<{ payload: { requestId: string } }>();
      const settled = vi.fn();
      p.then(settled, settled);
      // An item missing `count` (would map to a `count: undefined` corrupt row).
      act(() => {
        reply({
          type: 'SHARED_LIST_RESULT',
          payload: {
            requestId: sent.payload.requestId,
            items: [
              {
                key: 'req:1',
                authorUserId: 7,
                value: { title: 't' },
                createdAt: '2026-05-01T00:00:00.000Z',
                updatedAt: '2026-05-02T00:00:00.000Z',
              },
            ],
          },
        });
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SHARED_LIST_RESULT'));

      // A WELL-FORMED reply on the same requestId still resolves it (the pending
      // request survived the drop).
      act(() => {
        reply({ type: 'SHARED_LIST_RESULT', payload: { requestId: sent.payload.requestId, items: [] } });
      });
      await expect(p).resolves.toEqual({ items: [], nextCursor: undefined });
    } finally {
      warn.mockRestore();
    }
  });
});
