import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useDailyCompensation } from '../src/hooks/useDailyCompensation.js';
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
  const calls = postMessageMock.mock.calls.filter((c) => c[0]?.type === 'GET_DAILY_COMPENSATION');
  return calls[calls.length - 1]![0] as { payload: { requestId: string; params?: unknown } };
}

function dispatchResult(payload: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'DAILY_COMPENSATION_RESULT', payload },
        origin: PARENT_ORIGIN,
      }),
    );
  });
}

describe('useDailyCompensation', () => {
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

  it('posts GET_DAILY_COMPENSATION with the required date param', async () => {
    const { result } = renderHook(() => useDailyCompensation({ date: '2026-07-01' }));

    expect(result.current.loading).toBe(true);
    const sent = lastRequest(postMessageMock);
    expect(sent.payload.params).toEqual({ date: '2026-07-01' });
    expect(typeof sent.payload.requestId).toBe('string');
  });

  it('resolves resources + hasPublishedResources (day-strings NOT rehydrated)', async () => {
    const { result } = renderHook(() => useDailyCompensation({ date: '2026-07-01' }));
    dispatchResult({
      requestId: lastRequest(postMessageMock).payload.requestId,
      result: {
        resources: [
          {
            id: 691639,
            name: 'fp8',
            modelName: 'FLUX.1 [dev]',
            data: [{ createdAt: '2026-07-01', total: 120 }],
            cashData: [{ createdAt: '2026-07-01', total: 45 }],
            totalSum: 120,
            cashCents: 45,
          },
        ],
        hasPublishedResources: true,
      },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.hasPublishedResources).toBe(true);
    expect(result.current.resources).toHaveLength(1);
    // A day-string stays a string (only a transaction's `date` is rehydrated).
    expect(result.current.resources![0]!.data[0]!.createdAt).toBe('2026-07-01');
  });

  it('distinguishes "no published resources" (empty + false) from an earning gap', async () => {
    const { result } = renderHook(() => useDailyCompensation({ date: '2026-07-01' }));
    dispatchResult({
      requestId: lastRequest(postMessageMock).payload.requestId,
      result: { resources: [], hasPublishedResources: false },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resources).toEqual([]);
    expect(result.current.hasPublishedResources).toBe(false);
  });

  it('surfaces the free-text error variant', async () => {
    const { result } = renderHook(() => useDailyCompensation({ date: '2026-07-01' }));
    dispatchResult({
      requestId: lastRequest(postMessageMock).payload.requestId,
      error: 'Daily Buzz compensation is temporarily unavailable, please retry.',
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe(
      'Daily Buzz compensation is temporarily unavailable, please retry.',
    );
    expect(result.current.resources).toBeNull();
  });

  it('ignores a mismatched requestId', async () => {
    const { result } = renderHook(() => useDailyCompensation({ date: '2026-07-01' }));
    const realId = lastRequest(postMessageMock).payload.requestId;

    dispatchResult({ requestId: 'nope', result: { resources: [], hasPublishedResources: true } });
    await Promise.resolve();
    expect(result.current.loading).toBe(true);

    dispatchResult({ requestId: realId, result: { resources: [], hasPublishedResources: true } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasPublishedResources).toBe(true);
  });
});
