import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { requestRefresh, useBlockToken } from '../src/hooks/useBlockToken.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(expiresInMs: number): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt-1', scopes: ['models:read:self'], expiresAt: new Date(Date.now() + expiresInMs).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('useBlockToken', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    postMessageMock = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    resetTransport();
    vi.useRealTimers();
  });

  it('schedules REQUEST_TOKEN 2 minutes before expiry', () => {
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    renderHook(() => useBlockToken());
    // Init with a 10-minute token; refresh should fire at the 8-minute mark.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit(10 * 60_000) },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    postMessageMock.mockClear();

    // Advance just under 8 minutes: no refresh yet.
    act(() => {
      vi.advanceTimersByTime(8 * 60_000 - 100);
    });
    expect(postMessageMock).not.toHaveBeenCalled();

    // Cross the threshold.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const sent = postMessageMock.mock.calls[0][0] as { type: string; payload: { blockInstanceId: string } };
    expect(sent.type).toBe('REQUEST_TOKEN');
    expect(sent.payload.blockInstanceId).toBe('inst-1');
  });

  it('refresh() forces an immediate REQUEST_TOKEN (for 401 retry paths)', async () => {
    vi.useRealTimers(); // refresh() returns a real Promise.
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useBlockToken());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit(60 * 60_000) },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    postMessageMock.mockClear();

    const refreshPromise = result.current.refresh();
    // sendMessage was synchronous; pick the requestId off the wire and reply.
    const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'TOKEN_REFRESH_RESPONSE',
          payload: {
            requestId: sent.payload.requestId,
            token: {
              raw: 'jwt-2',
              scopes: ['models:read:self'],
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          },
        },
        origin: PARENT_ORIGIN,
      }),
    );
    await refreshPromise;
    expect(postMessageMock.mock.calls[0][0]).toMatchObject({ type: 'REQUEST_TOKEN' });
  });

  it('updates the snapshot when TOKEN_REFRESH_RESPONSE arrives (solicited path)', async () => {
    vi.useRealTimers();
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useBlockToken());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit(60 * 60_000) },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    expect(result.current.raw).toBe('jwt-1');
    postMessageMock.mockClear();

    const refreshPromise = result.current.refresh();
    const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };
    const newExpiry = new Date(Date.now() + 30 * 60_000);
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'TOKEN_REFRESH_RESPONSE',
            payload: {
              requestId: sent.payload.requestId,
              token: {
                raw: 'jwt-2',
                scopes: ['models:read:self'],
                expiresAt: newExpiry.toISOString(),
              },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    await refreshPromise;
    // Snapshot must reflect the new token — otherwise the auto-refresh effect
    // never re-schedules (its deps include token.expiresAt) and the token
    // silently expires.
    expect(result.current.raw).toBe('jwt-2');
    expect(result.current.expiresAt.getTime()).toBe(newExpiry.getTime());
  });

  it('dedupes concurrent refresh() calls to a single REQUEST_TOKEN', async () => {
    vi.useRealTimers();
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    const { result } = renderHook(() => useBlockToken());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit(60 * 60_000) },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    postMessageMock.mockClear();

    // Two concurrent refreshes — must coalesce.
    const p1 = result.current.refresh();
    const p2 = result.current.refresh();
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const sent = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'TOKEN_REFRESH_RESPONSE',
          payload: {
            requestId: sent.payload.requestId,
            token: {
              raw: 'jwt-2',
              scopes: ['models:read:self'],
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          },
        },
        origin: PARENT_ORIGIN,
      }),
    );
    await Promise.all([p1, p2]);
    expect(postMessageMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT coalesce refreshes across DIFFERENT blockInstanceIds (inline v2 multi-instance)', async () => {
    vi.useRealTimers();
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    // BLOCK_INIT so the transport is ready and REQUEST_TOKENs flush immediately.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit(60 * 60_000) },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    postMessageMock.mockClear();

    // Two concurrent refreshes for DIFFERENT instances (inline mode shares one
    // module context). The pre-fix module-global singleton coalesced these to a
    // SINGLE REQUEST_TOKEN, so instance B never minted its own token. Keyed by
    // blockInstanceId, each instance fires its own request.
    const a = requestRefresh('inst-A');
    const b = requestRefresh('inst-B');
    // Same instance again while in-flight → coalesced (still 2 total, not 3).
    const a2 = requestRefresh('inst-A');
    // Swallow the never-answered pending promises (resetTransport rejects them).
    void Promise.allSettled([a, b, a2]);

    expect(postMessageMock).toHaveBeenCalledTimes(2);
    const instanceIds = postMessageMock.mock.calls.map(
      (c) => (c[0] as { payload: { blockInstanceId: string } }).payload.blockInstanceId,
    );
    expect(new Set(instanceIds)).toEqual(new Set(['inst-A', 'inst-B']));
  });

  it('re-schedules the next refresh after a successful TOKEN_REFRESH_RESPONSE', async () => {
    // 10-min token; refresh should arm at the 8-min mark.
    // After refresh succeeds with a new 10-min token, a second refresh should
    // arm 8 minutes later. This is the regression test for the dead-code
    // bug where TOKEN_REFRESH_RESPONSE never updated the snapshot.
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    renderHook(() => useBlockToken());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit(10 * 60_000) },
          origin: PARENT_ORIGIN,
        }),
      );
    });
    postMessageMock.mockClear();

    // Trip the first scheduled refresh.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60_000 + 10);
    });
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const firstReq = postMessageMock.mock.calls[0][0] as { payload: { requestId: string } };

    // Host replies with a new 10-minute token. Use async act + a microtask
    // flush so the in-flight-refresh dedup releases before the next timer
    // fires (the .finally that clears it is a microtask, which fake-timer
    // `advanceTimersByTime` does NOT pump on its own).
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'TOKEN_REFRESH_RESPONSE',
            payload: {
              requestId: firstReq.payload.requestId,
              token: {
                raw: 'jwt-2',
                scopes: ['models:read:self'],
                expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
              },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    postMessageMock.mockClear();

    // Second refresh should arm at the new 8-minute mark.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60_000 + 10);
    });
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(postMessageMock.mock.calls[0][0]).toMatchObject({ type: 'REQUEST_TOKEN' });
  });
});
