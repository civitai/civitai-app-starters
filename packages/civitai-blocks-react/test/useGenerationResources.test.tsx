import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useGenerationResources } from '../src/hooks/useGenerationResources.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt-1', scopes: ['models:read:self'], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 'model.sidebar_top', modelId: 42 },
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

describe('useGenerationResources', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'BLOCK_INIT', payload: buildInit() }, origin: PARENT_ORIGIN }),
    );
  });

  afterEach(() => {
    resetTransport();
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('aborts + rejects a hung request at the timeout (does not hang forever)', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetchRespectingAbort();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useGenerationResources());

    let settled: 'resolved' | 'rejected' | null = null;
    let err: unknown;
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.fetch([691639]);
    });
    void p.then(
      () => {
        settled = 'resolved';
      },
      (e) => {
        settled = 'rejected';
        err = e;
      },
    );

    // Still pending well before the 30s bound.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(settled).toBeNull();

    // Cross the timeout → the controller aborts the fetch → the hook rejects.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(settled).toBe('rejected');
    expect((err as Error).message).toMatch(/aborted/i);
    // The abort signal was actually delivered to fetch.
    const signal = (fetchMock.mock.calls[0][1] as { signal?: AbortSignal }).signal;
    expect(signal?.aborted).toBe(true);
  });

  it('aborts the in-flight request on unmount', async () => {
    const fetchMock = hangingFetchRespectingAbort();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result, unmount } = renderHook(() => useGenerationResources());

    let settled: 'resolved' | 'rejected' | null = null;
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.fetch([691639]);
    });
    void p.then(
      () => {
        settled = 'resolved';
      },
      () => {
        settled = 'rejected';
      },
    );

    const signal = (fetchMock.mock.calls[0][1] as { signal?: AbortSignal }).signal;
    expect(signal?.aborted).toBe(false);

    // Unmount cancels the in-flight controller → the request aborts + rejects.
    unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe('rejected');
  });
});
