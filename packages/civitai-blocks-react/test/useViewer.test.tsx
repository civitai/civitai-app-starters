import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useViewer } from '../src/hooks/useViewer.js';
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

/** The requestId of the last GET_VIEWER posted to the parent. */
function lastRequestId(postMessageMock: ReturnType<typeof vi.fn>): string {
  const calls = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_VIEWER');
  const sent = calls[calls.length - 1]![0] as { payload: { requestId: string } };
  return sent.payload.requestId;
}

function dispatchResult(payload: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'VIEWER_RESULT', payload },
        origin: PARENT_ORIGIN,
      }),
    );
  });
}

describe('useViewer', () => {
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

  it('fetches on mount with an EMPTY payload (no caller-supplied requestId) and resolves on a VIEWER_RESULT', async () => {
    const { result } = renderHook(() => useViewer());

    // Fetched on mount → GET_VIEWER posted, hook is loading.
    expect(result.current.loading).toBe(true);
    expect(result.current.viewer).toBeNull();
    const sent = postMessageMock.mock.calls.find((c) => c[0]?.type === 'GET_VIEWER');
    expect(sent).toBeDefined();
    // The caller passes an empty payload; the transport appends the requestId.
    // So the message the caller built carries ONLY requestId (no other fields).
    const sentMsg = sent![0] as { type: string; payload: Record<string, unknown> };
    expect(sentMsg.type).toBe('GET_VIEWER');
    expect(Object.keys(sentMsg.payload)).toEqual(['requestId']);
    // Sent to the pinned parent origin, never '*'.
    expect(sent![1]).toBe(PARENT_ORIGIN);

    dispatchResult({
      requestId: lastRequestId(postMessageMock),
      viewer: { id: 7, username: 'viewer', status: 'active', buzzBudget: 200 },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewer).toEqual({
      id: 7,
      username: 'viewer',
      status: 'active',
      buzzBudget: 200,
    });
    expect(result.current.error).toBeNull();
  });

  // NULLABILITY (host PR #3152): `username` and `buzzBudget` are present-but-null.
  // The transport-level validator must ACCEPT this reply (not drop it) and the
  // hook surfaces the nulls as-is — a dropped valid reply would hang to timeout.
  it('resolves a viewer with NULL username and NULL buzzBudget (present-but-nullable)', async () => {
    const { result } = renderHook(() => useViewer());

    dispatchResult({
      requestId: lastRequestId(postMessageMock),
      viewer: { id: 7, username: null, status: 'muted', buzzBudget: null },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewer).toEqual({
      id: 7,
      username: null,
      status: 'muted',
      buzzBudget: null,
    });
    expect(result.current.error).toBeNull();
  });

  it('surfaces the error variant (error string, no viewer) — throws into error state', async () => {
    const { result } = renderHook(() => useViewer());

    dispatchResult({ requestId: lastRequestId(postMessageMock), error: 'not signed in' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('not signed in');
    expect(result.current.viewer).toBeNull();
  });

  /**
   * REGRESSION — an EMPTY host error must not surface as an EMPTY Error message.
   * `isValidViewerResult` gates `error` on SHAPE only (`typeof p.error !== 'string'`
   * → reject), so `{ error: '' }` is a VALID reply that reaches the hook. `??`
   * replaces only null/undefined, so it PRESERVES `''` and the block gets an
   * exception carrying no message at all — the whole failure is undebuggable.
   * `||` falls through to the readable fallback.
   */
  it('falls back to readable copy when the host error is an EMPTY string', async () => {
    const { result } = renderHook(() => useViewer());

    dispatchResult({ requestId: lastRequestId(postMessageMock), error: '' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('failed to fetch viewer');
    expect(result.current.viewer).toBeNull();
  });

  it('ignores a response whose requestId does not match the in-flight request', async () => {
    const { result } = renderHook(() => useViewer());
    const realRequestId = lastRequestId(postMessageMock);

    // A well-formed result carrying a DIFFERENT requestId must not resolve the hook.
    dispatchResult({
      requestId: 'some-other-id',
      viewer: { id: 1, username: 'x', status: 'active', buzzBudget: 1 },
    });
    // Give any (incorrect) state update a chance to flush.
    await Promise.resolve();
    expect(result.current.loading).toBe(true);
    expect(result.current.viewer).toBeNull();

    // The correctly-correlated reply resolves it.
    dispatchResult({
      requestId: realRequestId,
      viewer: { id: 7, username: 'viewer', status: 'active', buzzBudget: 50 },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewer).toEqual({
      id: 7,
      username: 'viewer',
      status: 'active',
      buzzBudget: 50,
    });
  });

  it('ignores a late response that arrives after unmount (no state update / no throw)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useViewer());
    const realRequestId = lastRequestId(postMessageMock);

    unmount();
    // Late reply after unmount — must be a silent no-op.
    dispatchResult({
      requestId: realRequestId,
      viewer: { id: 7, username: 'viewer', status: 'active', buzzBudget: 50 },
    });
    await Promise.resolve();

    // Last-rendered state never advanced past its unmount snapshot...
    expect(result.current.viewer).toBeNull();
    // ...and React did not warn about a state update on an unmounted component.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('refetch() re-requests and updates the viewer', async () => {
    const { result } = renderHook(() => useViewer());
    dispatchResult({
      requestId: lastRequestId(postMessageMock),
      viewer: { id: 7, username: 'viewer', status: 'active', buzzBudget: 100 },
    });
    await waitFor(() =>
      expect(result.current.viewer).toEqual({
        id: 7,
        username: 'viewer',
        status: 'active',
        buzzBudget: 100,
      }),
    );

    const beforeCount = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_VIEWER').length;

    act(() => {
      result.current.refetch();
    });
    expect(result.current.loading).toBe(true);
    const afterCount = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_VIEWER').length;
    expect(afterCount).toBe(beforeCount + 1);

    dispatchResult({
      requestId: lastRequestId(postMessageMock),
      viewer: { id: 7, username: 'viewer', status: 'muted', buzzBudget: 5 },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewer).toEqual({
      id: 7,
      username: 'viewer',
      status: 'muted',
      buzzBudget: 5,
    });
  });
});
