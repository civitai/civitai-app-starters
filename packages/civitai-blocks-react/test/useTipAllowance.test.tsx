import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useTipAllowance } from '../src/hooks/useTipAllowance.js';
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

function allowanceFetch(body: unknown, { ok = true, status = 200 } = {}) {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

describe('useTipAllowance', () => {
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

  it('GETs /api/v1/blocks/tip-allowance with the token and exposes {cap, spent, remaining}', async () => {
    const fetchMock = allowanceFetch({ cap: 25000, spent: 4000, remaining: 21000 }) as unknown as ReturnType<
      typeof vi.fn
    >;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useTipAllowance());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PARENT_ORIGIN}/api/v1/blocks/tip-allowance`);
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer jwt-tip');
    expect(result.current.allowance).toEqual({ cap: 25000, spent: 4000, remaining: 21000 });
    expect(result.current.error).toBeNull();
  });

  it('surfaces a server error (e.g. 503 fail-closed) as `error`', async () => {
    const fetchMock = allowanceFetch({ error: 'Tip allowance unavailable; please retry' }, {
      ok: false,
      status: 503,
    });
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useTipAllowance());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowance).toBeNull();
    expect(result.current.error?.message).toMatch(/unavailable/i);
  });

  it('refetch() re-reads the allowance (e.g. after a tip)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ cap: 25000, spent: 0, remaining: 25000 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ cap: 25000, spent: 50, remaining: 24950 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useTipAllowance());
    await waitFor(() => expect(result.current.allowance?.remaining).toBe(25000));

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.allowance?.remaining).toBe(24950));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
