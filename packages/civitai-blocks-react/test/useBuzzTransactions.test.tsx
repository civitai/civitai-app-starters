import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBuzzTransactions } from '../src/hooks/useBuzzTransactions.js';
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

function lastRequest(postMessageMock: ReturnType<typeof vi.fn>): {
  payload: { requestId: string; params?: unknown };
} {
  const calls = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_BUZZ_TRANSACTIONS');
  return calls[calls.length - 1]![0] as { payload: { requestId: string; params?: unknown } };
}

function dispatchResult(payload: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BUZZ_TRANSACTIONS_RESULT', payload },
        origin: PARENT_ORIGIN,
      }),
    );
  });
}

describe('useBuzzTransactions', () => {
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

  it('posts GET_BUZZ_TRANSACTIONS with the params (no requestId in the caller payload)', async () => {
    const { result } = renderHook(() => useBuzzTransactions({ type: 'Tip', limit: 20 }));

    expect(result.current.loading).toBe(true);
    expect(result.current.transactions).toBeNull();
    const sent = lastRequest(postMessageMock);
    expect(sent.payload.params).toEqual({ type: 'Tip', limit: 20 });
    expect(typeof sent.payload.requestId).toBe('string');
    // Sent to the pinned parent origin, never '*'.
    const raw = postMessageMock.mock.calls.find((c) => c[0]?.type === 'GET_BUZZ_TRANSACTIONS');
    expect(raw![1]).toBe(PARENT_ORIGIN);
  });

  it('omits params from the outbound payload when called with none', async () => {
    renderHook(() => useBuzzTransactions());
    const sent = lastRequest(postMessageMock);
    expect(sent.payload.params).toBeUndefined();
  });

  it('resolves + REHYDRATES an ISO-string date/cursor to Date/ISO', async () => {
    const { result } = renderHook(() => useBuzzTransactions());
    const requestId = lastRequest(postMessageMock).payload.requestId;

    dispatchResult({
      requestId,
      result: {
        cursor: '2026-07-10T09:30:00.000Z',
        transactions: [
          {
            date: '2026-07-14T12:00:00.000Z',
            type: 'Tip',
            amount: 250,
            fromAccountId: 2,
            toAccountId: 5,
            fromAccountType: 'yellow',
            toAccountType: 'yellow',
            description: 'Tip',
            details: { entityType: 'Image', entityId: 12345 },
            externalTransactionId: null,
            toUser: { id: 5, username: 'creator' },
          },
        ],
      },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.transactions).toHaveLength(1);
    const row = result.current.transactions![0]!;
    expect(row.date).toBeInstanceOf(Date);
    expect(row.date.toISOString()).toBe('2026-07-14T12:00:00.000Z');
    expect(row.type).toBe('Tip');
    expect(row.amount).toBe(250);
    expect(result.current.cursor).toBe('2026-07-10T09:30:00.000Z');
  });

  it('TOLERATES a Date instance on the wire (raw structured-clone from the host)', async () => {
    const { result } = renderHook(() => useBuzzTransactions());
    const requestId = lastRequest(postMessageMock).payload.requestId;

    dispatchResult({
      requestId,
      result: {
        cursor: new Date('2026-07-01T00:00:00.000Z'),
        transactions: [
          {
            date: new Date('2026-07-14T12:00:00.000Z'),
            type: 'Purchase',
            amount: 5000,
            fromAccountId: 0,
            toAccountId: 2,
            fromAccountType: 'yellow',
            toAccountType: 'yellow',
            externalTransactionId: null,
          },
        ],
      },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const row = result.current.transactions![0]!;
    expect(row.date).toBeInstanceOf(Date);
    expect(row.date.toISOString()).toBe('2026-07-14T12:00:00.000Z');
    expect(result.current.cursor).toBe('2026-07-01T00:00:00.000Z');
  });

  it('surfaces the FREE-TEXT error variant (error string, no result)', async () => {
    const { result } = renderHook(() => useBuzzTransactions());
    const requestId = lastRequest(postMessageMock).payload.requestId;

    dispatchResult({ requestId, error: 'buzz:read:self not granted' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('buzz:read:self not granted');
    expect(result.current.transactions).toBeNull();
  });

  it('ignores a response whose requestId does not match the in-flight request', async () => {
    const { result } = renderHook(() => useBuzzTransactions());
    const requestId = lastRequest(postMessageMock).payload.requestId;

    dispatchResult({ requestId: 'other', result: { transactions: [] } });
    await Promise.resolve();
    expect(result.current.loading).toBe(true);

    dispatchResult({ requestId, result: { transactions: [] } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transactions).toEqual([]);
  });

  it('refetch() re-requests', async () => {
    const { result } = renderHook(() => useBuzzTransactions());
    dispatchResult({ requestId: lastRequest(postMessageMock).payload.requestId, result: { transactions: [] } });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const before = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_BUZZ_TRANSACTIONS').length;
    act(() => result.current.refetch());
    expect(result.current.loading).toBe(true);
    const after = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_BUZZ_TRANSACTIONS').length;
    expect(after).toBe(before + 1);
  });
});
