import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBuzzBalance } from '../src/hooks/useBuzzBalance.js';
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
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

/** The requestId of the last GET_BUZZ_BALANCE posted to the parent. */
function lastRequestId(postMessageMock: ReturnType<typeof vi.fn>): string {
  const calls = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_BUZZ_BALANCE');
  const sent = calls[calls.length - 1]![0] as { payload: { requestId: string } };
  return sent.payload.requestId;
}

function dispatchResult(payload: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BUZZ_BALANCE_RESULT', payload },
        origin: PARENT_ORIGIN,
      }),
    );
  });
}

describe('useBuzzBalance', () => {
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
    vi.restoreAllMocks();
  });

  it('fetches on mount and resolves on a BUZZ_BALANCE_RESULT', async () => {
    const { result } = renderHook(() => useBuzzBalance());

    // Fetched on mount → GET_BUZZ_BALANCE posted, hook is loading.
    expect(result.current.loading).toBe(true);
    expect(result.current.balance).toBeNull();
    const sent = postMessageMock.mock.calls.find((c) => c[0]?.type === 'GET_BUZZ_BALANCE');
    expect(sent).toBeDefined();
    // Sent to the pinned parent origin, never '*'.
    expect(sent![1]).toBe(PARENT_ORIGIN);

    dispatchResult({ requestId: lastRequestId(postMessageMock), balance: { blue: 5, green: 10, yellow: 250 } });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toEqual({ blue: 5, green: 10, yellow: 250 });
    expect(result.current.error).toBeNull();
  });

  it('surfaces the error variant (error string, no balance)', async () => {
    const { result } = renderHook(() => useBuzzBalance());

    dispatchResult({ requestId: lastRequestId(postMessageMock), error: 'RATE_LIMITED' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('RATE_LIMITED');
    expect(result.current.balance).toBeNull();
  });

  /**
   * REGRESSION — an EMPTY host error must not surface as an EMPTY Error message.
   * `isValidBuzzBalanceResult` gates `error` on SHAPE only, so `{ error: '' }` is a
   * VALID reply that reaches the hook. `??` preserves `''` (it replaces only
   * null/undefined); `||` falls through to the readable fallback.
   */
  it('falls back to readable copy when the host error is an EMPTY string', async () => {
    const { result } = renderHook(() => useBuzzBalance());

    dispatchResult({ requestId: lastRequestId(postMessageMock), error: '' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('failed to fetch buzz balance');
    expect(result.current.balance).toBeNull();
  });

  it('ignores a response whose requestId does not match the in-flight request', async () => {
    const { result } = renderHook(() => useBuzzBalance());
    const realRequestId = lastRequestId(postMessageMock);

    // A well-formed result carrying a DIFFERENT requestId must not resolve the hook.
    dispatchResult({ requestId: 'some-other-id', balance: { blue: 1, green: 1, yellow: 1 } });
    // Give any (incorrect) state update a chance to flush.
    await Promise.resolve();
    expect(result.current.loading).toBe(true);
    expect(result.current.balance).toBeNull();

    // The correctly-correlated reply resolves it.
    dispatchResult({ requestId: realRequestId, balance: { blue: 2, green: 3, yellow: 4 } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toEqual({ blue: 2, green: 3, yellow: 4 });
  });

  it('ignores a late response that arrives after unmount (no state update / no throw)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useBuzzBalance());
    const realRequestId = lastRequestId(postMessageMock);

    unmount();
    // Late reply after unmount — must be a silent no-op.
    dispatchResult({ requestId: realRequestId, balance: { blue: 9, green: 9, yellow: 9 } });
    await Promise.resolve();

    // Last-rendered state never advanced past its unmount snapshot...
    expect(result.current.balance).toBeNull();
    // ...and React did not warn about a state update on an unmounted component.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('refetch() re-requests and updates the balance', async () => {
    const { result } = renderHook(() => useBuzzBalance());
    dispatchResult({ requestId: lastRequestId(postMessageMock), balance: { blue: 1, green: 1, yellow: 1 } });
    await waitFor(() => expect(result.current.balance).toEqual({ blue: 1, green: 1, yellow: 1 }));

    const beforeCount = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_BUZZ_BALANCE').length;

    act(() => {
      result.current.refetch();
    });
    expect(result.current.loading).toBe(true);
    const afterCount = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_BUZZ_BALANCE').length;
    expect(afterCount).toBe(beforeCount + 1);

    dispatchResult({ requestId: lastRequestId(postMessageMock), balance: { blue: 100, green: 200, yellow: 300 } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toEqual({ blue: 100, green: 200, yellow: 300 });
  });
});
