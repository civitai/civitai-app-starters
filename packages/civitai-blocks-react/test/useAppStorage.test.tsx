import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useAppStorage } from '../src/hooks/useAppStorage.js';
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

describe('useAppStorage', () => {
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

  it('exposes a stable storage object across renders', () => {
    const { result, rerender } = renderHook(() => useAppStorage());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('get() round-trips through APP_STORAGE_GET / APP_STORAGE_GET_RESULT', async () => {
    const { result } = renderHook(() => useAppStorage());

    let getPromise!: Promise<unknown>;
    act(() => {
      getPromise = result.current.get('lastPrompt');
    });
    const sent = postMessageMock.mock.calls[0][0] as {
      type: string;
      payload: { requestId: string; key: string };
    };
    expect(sent.type).toBe('APP_STORAGE_GET');
    expect(sent.payload.key).toBe('lastPrompt');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'APP_STORAGE_GET_RESULT',
            payload: { requestId: sent.payload.requestId, value: { value: 'cyberpunk cat' } },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await expect(getPromise).resolves.toEqual({ value: 'cyberpunk cat' });
  });

  it('get() rejects when the host returns an error string', async () => {
    const { result } = renderHook(() => useAppStorage());

    let getPromise!: Promise<unknown>;
    act(() => {
      getPromise = result.current.get('k');
    });
    const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'APP_STORAGE_GET_RESULT',
            payload: { requestId: sent.payload.requestId, value: null, error: 'NOT_FOUND' },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await expect(getPromise).rejects.toThrow('NOT_FOUND');
  });

  it('set() resolves with the host-reported byte size', async () => {
    const { result } = renderHook(() => useAppStorage());

    let setPromise!: Promise<unknown>;
    act(() => {
      setPromise = result.current.set('k', { hello: 'world' });
    });
    const sent = postMessageMock.mock.calls[0][0] as {
      type: string;
      payload: { requestId: string; key: string; value: unknown };
    };
    expect(sent.type).toBe('APP_STORAGE_SET');
    expect(sent.payload.value).toEqual({ hello: 'world' });

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'APP_STORAGE_SET_RESULT',
            payload: { requestId: sent.payload.requestId, ok: true, sizeBytes: 23 },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await expect(setPromise).resolves.toEqual({ ok: true, sizeBytes: 23 });
  });

  it('set() rejects when the host reports an error', async () => {
    const { result } = renderHook(() => useAppStorage());

    let setPromise!: Promise<unknown>;
    act(() => {
      setPromise = result.current.set('k', 'x'.repeat(1000));
    });
    const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'APP_STORAGE_SET_RESULT',
            payload: { requestId: sent.payload.requestId, ok: false, error: 'PAYLOAD_TOO_LARGE' },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await expect(setPromise).rejects.toThrow('PAYLOAD_TOO_LARGE');
  });

  it('delete() reports whether a row was present', async () => {
    const { result } = renderHook(() => useAppStorage());

    let deletePromise!: Promise<unknown>;
    act(() => {
      deletePromise = result.current.delete('k');
    });
    const sent = postMessageMock.mock.calls[0][0] as {
      type: string;
      payload: { requestId: string };
    };
    expect(sent.type).toBe('APP_STORAGE_DELETE');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'APP_STORAGE_DELETE_RESULT',
            payload: { requestId: sent.payload.requestId, ok: true, deleted: true },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await expect(deletePromise).resolves.toEqual({ ok: true, deleted: true });
  });

  it('list() rehydrates updatedAt to Date + carries the cursor through', async () => {
    const { result } = renderHook(() => useAppStorage());

    let listPromise!: Promise<unknown>;
    act(() => {
      listPromise = result.current.list({ prefix: 'foo:', limit: 10 });
    });
    const sent = postMessageMock.mock.calls[0][0] as {
      type: string;
      payload: { requestId: string; prefix: string; limit: number };
    };
    expect(sent.type).toBe('APP_STORAGE_LIST');
    expect(sent.payload.prefix).toBe('foo:');
    expect(sent.payload.limit).toBe(10);

    const iso = '2026-05-27T10:11:12.000Z';
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'APP_STORAGE_LIST_RESULT',
            payload: {
              requestId: sent.payload.requestId,
              keys: [{ key: 'foo:bar', updatedAt: iso }],
              nextCursor: 'Zm9v',
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    const out = (await listPromise) as { keys: Array<{ key: string; updatedAt: Date }>; nextCursor?: string };
    expect(out.keys[0].key).toBe('foo:bar');
    expect(out.keys[0].updatedAt).toBeInstanceOf(Date);
    expect(out.keys[0].updatedAt.toISOString()).toBe(iso);
    expect(out.nextCursor).toBe('Zm9v');
  });

  it('getQuota() forwards the host snapshot verbatim', async () => {
    const { result } = renderHook(() => useAppStorage());

    let promise!: Promise<unknown>;
    act(() => {
      promise = result.current.getQuota();
    });
    const sent = postMessageMock.mock.calls[0][0] as {
      type: string;
      payload: { requestId: string };
    };
    expect(sent.type).toBe('APP_STORAGE_QUOTA');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'APP_STORAGE_QUOTA_RESULT',
            payload: {
              requestId: sent.payload.requestId,
              usedBytes: 4096,
              rowCount: 3,
              limitBytes: 50 * 1024 * 1024,
              limitRows: 1_000_000,
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await expect(promise).resolves.toEqual({
      usedBytes: 4096,
      rowCount: 3,
      limitBytes: 50 * 1024 * 1024,
      limitRows: 1_000_000,
    });
  });

  /** Fire a parent→block reply from the allowed origin. */
  function reply(data: unknown) {
    window.dispatchEvent(new MessageEvent('message', { data, origin: PARENT_ORIGIN }));
  }

  // ---- transport-validator: malformed replies surface an ERROR, not a raw TypeError / silent read ----
  // A malformed APP_STORAGE_LIST_RESULT (e.g. `keys` not an array) used to throw
  // a raw `TypeError` from inside the hook's `.map`. The validator now DROPS it
  // at the boundary so the request rejects cleanly at its timeout instead.
  it('list() drops a malformed reply (keys not an array) → rejects, no raw TypeError', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useAppStorage());
      let p!: Promise<unknown>;
      act(() => {
        p = result.current.list();
      });
      const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };
      let settled: 'resolved' | 'rejected' | null = null;
      void p.then(
        () => {
          settled = 'resolved';
        },
        () => {
          settled = 'rejected';
        },
      );
      act(() => {
        reply({ type: 'APP_STORAGE_LIST_RESULT', payload: { requestId: sent.payload.requestId, keys: 'oops' } });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(settled).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('APP_STORAGE_LIST_RESULT'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(settled).toBe('rejected');
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('getQuota() drops a malformed reply (usedBytes missing) rather than reading NaN', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useAppStorage());
      let p!: Promise<unknown>;
      act(() => {
        p = result.current.getQuota();
      });
      const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };
      const settled = vi.fn();
      p.then(settled, settled);
      act(() => {
        reply({
          type: 'APP_STORAGE_QUOTA_RESULT',
          payload: { requestId: sent.payload.requestId, rowCount: 1, limitBytes: 2, limitRows: 3 },
        });
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('APP_STORAGE_QUOTA_RESULT'));
    } finally {
      warn.mockRestore();
    }
  });
});
