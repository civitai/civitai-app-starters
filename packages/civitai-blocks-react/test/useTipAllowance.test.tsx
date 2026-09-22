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

/**
 * #398 — NO HOST ORIGIN, NO ETERNAL SPINNER.
 *
 * `useTipAllowance` initialises `loading: true` and `refetch` bails on `!host`
 * before touching it, so on any surface where `BLOCK_INIT` never lands (a direct
 * / unembedded load, `InlineTransport` before bootstrap) the documented
 * `if (loading) return <Spinner/>` pattern renders forever with no diagnostic.
 *
 * 🔴 THE FIX IS A BOUNDED WAIT, NOT AN IMMEDIATE ERROR. The host origin is
 * ABSENT during every normal boot too — it arrives a tick or two after mount —
 * so erroring on the first `!host` would flash a spurious error on every healthy
 * block. The hook therefore waits `HOST_ORIGIN_WAIT_MS` (30s, the same bound
 * every postMessage hook inherits for "the host never answered") and only then
 * surfaces a named terminal error. The second test here is the control for that:
 * a host that arrives LATE must still load normally.
 *
 * The sibling hooks' divergence is deliberate and stays: `useTip` and
 * `useGenerationResources` are IMPERATIVE (the caller holds a promise), so they
 * reject immediately with a named error — already settled, never a spinner.
 * `useWildcardPack`'s early `setLoading(false)` is a `modelVersionId` validity
 * guard, not a host-origin guard; it does not read the host origin at all.
 */
describe('useTipAllowance — the host origin never arrives (#398)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
    // Transport created, but NO BLOCK_INIT dispatched — `useHostOrigin()` stays
    // undefined for the whole test.
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
  });

  afterEach(() => {
    resetTransport();
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('settles into a NAMED error instead of spinning forever', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useTipAllowance());

    // Still loading right after mount — the hook is legitimately waiting.
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe(
      'useTipAllowance: host origin not established after 30000ms (no BLOCK_INIT — the block is probably not embedded).',
    );
    expect(result.current.allowance).toBeNull();
    // It never invented a request against an unvalidated origin.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CONTROL: a host origin that arrives LATE still loads normally (no spurious error)', async () => {
    const fetchMock = allowanceFetch({ cap: 1000, spent: 100, remaining: 900 });
    globalThis.fetch = fetchMock;

    const { result } = renderHook(() => useTipAllowance());
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    // BLOCK_INIT lands well inside the bound.
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'BLOCK_INIT', payload: buildInit() },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.allowance).toEqual({ cap: 1000, spent: 100, remaining: 900 });
  });
});

/**
 * The OTHER half of #398's bounded wait: the bound must be DISARMED once a host
 * origin exists. Without the `if (host) return;` gate on that effect, every
 * healthy embedded block would grow a bogus "host origin not established" error
 * 30 seconds after mount, on top of a perfectly good allowance.
 *
 * This lives in the BLOCK_INIT-present suite deliberately — it is the case the
 * no-host suite structurally cannot see.
 */
describe('useTipAllowance — the bound is disarmed once the host origin arrives (#398)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
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

  it('does NOT grow a host-origin error long after a successful load', async () => {
    globalThis.fetch = allowanceFetch({ cap: 1000, spent: 100, remaining: 900 });

    const { result } = renderHook(() => useTipAllowance());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.allowance).toEqual({ cap: 1000, spent: 100, remaining: 900 });

    // Well past HOST_ORIGIN_WAIT_MS.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.allowance).toEqual({ cap: 1000, spent: 100, remaining: 900 });
  });
});
