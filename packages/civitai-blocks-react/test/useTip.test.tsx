import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useTip } from '../src/hooks/useTip.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt-tip',
      scopes: ['social:tip:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 'app.page' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'alice', status: 'active' },
    theme: 'dark',
    renderMode: 'iframe',
  };
}

/** A fetch that never resolves on its own — only rejects when its signal aborts. */
function hangingFetchRespectingAbort() {
  return vi.fn(
    (_url: string, opts?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        const signal = opts?.signal;
        if (signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
}

function okTipFetch() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      tip: { toUserId: 123, amount: 50, entityType: null, entityId: null },
    }),
  })) as unknown as typeof fetch;
}

describe('useTip', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
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
  });

  afterEach(() => {
    resetTransport();
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('POSTs to /api/v1/blocks/tip with the token, target, amount, and an auto idempotencyKey', async () => {
    const fetchMock = okTipFetch() as unknown as ReturnType<typeof vi.fn>;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useTip());
    await act(async () => {
      await result.current.tip({ toUserId: 123, amount: 50 });
    });

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PARENT_ORIGIN}/api/v1/blocks/tip`);
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer jwt-tip');
    const sentBody = JSON.parse(opts.body as string) as {
      toUserId: number;
      amount: number;
      idempotencyKey?: unknown;
    };
    expect(sentBody.toUserId).toBe(123);
    expect(sentBody.amount).toBe(50);
    expect(typeof sentBody.idempotencyKey).toBe('string');
    expect((sentBody.idempotencyKey as string).length).toBeGreaterThan(0);
  });

  it('reuses a caller-supplied stable idempotencyKey (a retry sends the SAME key)', async () => {
    const fetchMock = okTipFetch() as unknown as ReturnType<typeof vi.fn>;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useTip());
    await act(async () => {
      await result.current.tip({ toUserId: 123, amount: 50 }, { idempotencyKey: 'tip-key-xyz' });
    });
    await act(async () => {
      // A retry of the SAME logical tip reuses the key.
      await result.current.tip({ toUserId: 123, amount: 50 }, { idempotencyKey: 'tip-key-xyz' });
    });

    const key1 = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).idempotencyKey;
    const key2 = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).idempotencyKey;
    expect(key1).toBe('tip-key-xyz');
    expect(key2).toBe('tip-key-xyz');
  });

  it('two auto-keyed tips get DIFFERENT keys (each call is a new logical tip)', async () => {
    const fetchMock = okTipFetch() as unknown as ReturnType<typeof vi.fn>;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useTip());
    await act(async () => {
      await result.current.tip({ toUserId: 123, amount: 50 });
    });
    await act(async () => {
      await result.current.tip({ toUserId: 123, amount: 50 });
    });
    const key1 = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).idempotencyKey;
    const key2 = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).idempotencyKey;
    expect(key1).not.toBe(key2);
  });

  it('forwards entityType/entityId when supplied and resolves with the tip echo', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        tip: { toUserId: 123, amount: 50, entityType: 'Image', entityId: 99 },
      }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useTip());
    let out!: Awaited<ReturnType<typeof result.current.tip>>;
    await act(async () => {
      out = await result.current.tip({ toUserId: 123, amount: 50, entityType: 'Image', entityId: 99 });
    });
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.entityType).toBe('Image');
    expect(sentBody.entityId).toBe(99);
    expect(out.tip.entityType).toBe('Image');
  });

  it('rejects with the server error message on a non-ok response', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "you don't have enough funds" }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useTip());
    // Catch INSIDE act so the hook's setError commits before act resolves (an act
    // that REJECTS can leave the pending state update unflushed).
    let caught: Error | null = null;
    await act(async () => {
      await result.current.tip({ toUserId: 123, amount: 999 }).catch((e: Error) => {
        caught = e;
      });
    });
    expect((caught as Error | null)?.message).toMatch(/funds/);
    await waitFor(() => expect(result.current.error?.message).toMatch(/funds/));
  });

  it('old-shape call (no options) still works — backward compatible', async () => {
    const fetchMock = okTipFetch() as unknown as ReturnType<typeof vi.fn>;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() => useTip());
    await act(async () => {
      await result.current.tip({ toUserId: 123, amount: 50 });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts + rejects a hung request at the timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetchRespectingAbort();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useTip());
    let settled: 'resolved' | 'rejected' | null = null;
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.tip({ toUserId: 123, amount: 50 });
    });
    void p.then(
      () => {
        settled = 'resolved';
      },
      () => {
        settled = 'rejected';
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(settled).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(settled).toBe('rejected');
    const signal = (fetchMock.mock.calls[0][1] as { signal?: AbortSignal }).signal;
    expect(signal?.aborted).toBe(true);
  });
});
