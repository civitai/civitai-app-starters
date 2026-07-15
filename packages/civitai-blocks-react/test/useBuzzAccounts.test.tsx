import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBuzzAccounts } from '../src/hooks/useBuzzAccounts.js';
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

function lastRequestId(postMessageMock: ReturnType<typeof vi.fn>): string {
  const calls = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_BUZZ_ACCOUNTS');
  const sent = calls[calls.length - 1]![0] as { payload: { requestId: string } };
  return sent.payload.requestId;
}

function dispatchResult(payload: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BUZZ_ACCOUNTS_RESULT', payload },
        origin: PARENT_ORIGIN,
      }),
    );
  });
}

describe('useBuzzAccounts', () => {
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

  it('fetches on mount (GET_BUZZ_ACCOUNTS, no params) and resolves the all-pool accounts', async () => {
    const { result } = renderHook(() => useBuzzAccounts());

    expect(result.current.loading).toBe(true);
    const sent = postMessageMock.mock.calls.find((c) => c[0]?.type === 'GET_BUZZ_ACCOUNTS');
    expect(sent).toBeDefined();
    expect(sent![1]).toBe(PARENT_ORIGIN);
    // Payload carries only the transport-appended requestId.
    expect(Object.keys((sent![0] as { payload: object }).payload)).toEqual(['requestId']);

    dispatchResult({
      requestId: lastRequestId(postMessageMock),
      result: {
        accounts: [
          { accountType: 'yellow', balance: 5000 },
          { accountType: 'cashSettled', balance: 1234 },
        ],
      },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.accounts).toEqual([
      { accountType: 'yellow', balance: 5000 },
      { accountType: 'cashSettled', balance: 1234 },
    ]);
  });

  it('surfaces the free-text error variant', async () => {
    const { result } = renderHook(() => useBuzzAccounts());
    dispatchResult({ requestId: lastRequestId(postMessageMock), error: 'RATE_LIMITED' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe('RATE_LIMITED');
    expect(result.current.accounts).toBeNull();
  });

  it('ignores a mismatched requestId', async () => {
    const { result } = renderHook(() => useBuzzAccounts());
    const realId = lastRequestId(postMessageMock);

    dispatchResult({ requestId: 'nope', result: { accounts: [] } });
    await Promise.resolve();
    expect(result.current.loading).toBe(true);

    dispatchResult({ requestId: realId, result: { accounts: [] } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accounts).toEqual([]);
  });

  it('ignores a late response after unmount (no throw / no state update)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useBuzzAccounts());
    const realId = lastRequestId(postMessageMock);

    unmount();
    dispatchResult({ requestId: realId, result: { accounts: [{ accountType: 'yellow', balance: 9 }] } });
    await Promise.resolve();

    expect(result.current.accounts).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
