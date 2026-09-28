import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useEntitlements } from '../src/hooks/useEntitlements.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt-ent',
      scopes: ['goods:read:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 'app.page' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'alice', status: 'active' },
    theme: 'dark',
    renderMode: 'iframe',
  };
}

const OWNED = {
  goodId: 'extra-slots',
  kind: 'good',
  payload: { slots: 4 },
  grantedAt: '2026-09-28T00:00:00.000Z',
};

function okFetch(entitlements: unknown[] = [OWNED]) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ entitlements }) }));
}

describe('useEntitlements', () => {
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

  it('GETs the entitlements endpoint with the bearer token and exposes what came back', async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PARENT_ORIGIN}/api/v1/blocks/entitlements`);
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer jwt-ent');
    expect(result.current.entitlements).toEqual([OWNED]);
    expect(result.current.error).toBeNull();
  });

  it('owns() answers for a held good and refuses one the viewer does not hold', async () => {
    globalThis.fetch = okFetch() as unknown as typeof fetch;
    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Both arms: a predicate that always returned true, or always false, passes
    // exactly one of these.
    expect(result.current.owns('extra-slots')).toBe(true);
    expect(result.current.owns('something-else')).toBe(false);
  });

  it('🔴 a FAILED read is distinguishable from owning nothing — the hazard owns() cannot express', async () => {
    // This is the whole reason the hook exposes `error` separately, and the
    // reason its docstring tells callers not to gate paid content on `owns()`
    // alone: a refused read makes `owns()` return FALSE for a good the viewer
    // may well have paid for. An app that renders a paywall on `!owns(id)`
    // takes it away on every transient 500.
    //
    // The guard pins the DISCRIMINATOR, not the false: `owns()` is false AND
    // `error` is non-null AND `entitlements` is still null — which is what lets
    // a caller tell "you own nothing" from "we could not find out".
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'upstream exploded' }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.owns('extra-slots')).toBe(false); // the trap
    expect(result.current.error).toBeInstanceOf(Error); // the way out of it
    expect(result.current.error?.message).toContain('upstream exploded');
    expect(result.current.entitlements).toBeNull();
  });

  it('🔴 a 403 sets `unauthenticated` — the one refusal a retry cannot fix', async () => {
    // A page App Block is a PUBLIC surface. A logged-out viewer's block token
    // carries an anonymous subject, and the server refuses BOTH goods scopes for
    // one (`enforceContextBinding` → 403 "<scope> requires authenticated
    // subject"). That is an `error`, so a block rendering a retry notice on
    // `error` alone shows every anonymous first paint a button that can never
    // succeed — in the one case where "you own nothing" is the right answer.
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'goods:read:self requires authenticated subject' }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unauthenticated).toBe(true);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.owns('extra-slots')).toBe(false);
  });

  it('CONTROL — a NON-403 failure is NOT unauthenticated, so a retry is still offered', async () => {
    // Without this arm the assertion above would hold for a hook that set the
    // flag on every failure, which would route a transient 500 to a sign-in
    // screen and strand the viewer.
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'upstream exploded' }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unauthenticated).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('CONTROL — owning nothing is a SUCCESSFUL read, and reports no error', async () => {
    // Without this arm the assertion above would also hold for a hook that
    // errored on an empty list, which would be a different bug wearing the same
    // shape. An empty catalog is a normal answer, not a failure.
    globalThis.fetch = okFetch([]) as unknown as typeof fetch;
    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.owns('extra-slots')).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.entitlements).toEqual([]);
  });

  it('rejects a malformed 200 rather than reporting it as owning nothing', async () => {
    // A 200 whose body is not `{ entitlements: [...] }` is a contract break, and
    // treating it as an empty list would silently revoke every purchase.
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: true }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.entitlements).toBeNull();
  });

  it('refetch re-reads, so a purchase can be reflected without a remount', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ entitlements: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ entitlements: [OWNED] }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.owns('extra-slots')).toBe(false);

    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.owns('extra-slots')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
