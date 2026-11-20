import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useEntitlements } from '../src/hooks/useEntitlements.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(viewer: BlockInitPayload['viewer'] = {
  id: 7,
  username: 'alice',
  status: 'active',
}): BlockInitPayload {
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
    viewer,
    theme: 'dark',
    renderMode: 'iframe',
  };
}

/**
 * Re-run the handshake with `viewer: null` — the ONE anonymous value on the
 * wire, from every host version (`isSignedIn`'s doc adjudicates the spellings).
 * The `beforeEach` has already dispatched a SIGNED-IN init, so this replaces the
 * transport wholesale rather than layering a second `BLOCK_INIT` on top of it.
 */
function initAnonymous() {
  resetTransport();
  getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'BLOCK_INIT', payload: buildInit(null) },
      origin: PARENT_ORIGIN,
    }),
  );
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

  it('🔴 an ANONYMOUS VIEWER sets `unauthenticated` — derived from BLOCK_INIT, before any request', async () => {
    // A page App Block is a PUBLIC surface, so a logged-out viewer is the
    // COMMON path. `BlockInitPayload.viewer === null` is what the platform sends
    // for one, and it is the only anonymous value on the wire.
    //
    // 🔴 THIS REPLACES A RESPONSE-DERIVED PREDICATE THAT COULD NEVER FIRE. The
    // hook used to set the flag on `status === 403 && code == null`, and the
    // fixture that "proved" it invented a body the server cannot send on this
    // route: `entitlements.ts` wraps the handler in `withBlockScope(…,
    // { requiredScope: 'goods:read:self' })`, whose `:self` arm rejects an
    // anonymous subject as `code: 'context_binding'`. Every 403 here is CODED,
    // so `code == null` was false in every reachable case and the flag was dead
    // for the one case it exists for — while the fixture kept the suite green.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ entitlements: [OWNED] }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    initAnonymous();

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unauthenticated).toBe(true);
    // 🔴 NOT an error. Nothing failed — we never asked. A retry notice would be
    // wrong twice over, and the documented render order checks this flag first.
    expect(result.current.error).toBeNull();
    expect(result.current.owns('extra-slots')).toBe(false);
    // 🔴 AND NO REQUEST WAS ISSUED. The `fetch` above would have RESOLVED with a
    // full entitlement list, so this asserts the skip rather than a refusal:
    // without it, a hook that fired anyway would still pass every line above.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.entitlements).toBeNull();
  });

  it('CONTROL — a SIGNED-IN viewer is not unauthenticated, and the request IS issued', async () => {
    // The arm that stops the flag being hardcoded `true`, and the one that
    // proves the skip above is keyed on the viewer rather than on "never fetch".
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unauthenticated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.entitlements).toEqual([OWNED]);
  });

  it('CONTROL — an anonymous `refetch()` stays a no-op, so a retry button cannot spend a request', async () => {
    // `unauthenticated` is derived, not latched, so it must survive the one
    // action an app is most likely to wire to it by mistake.
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    initAnonymous();

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unauthenticated).toBe(true);
    expect(result.current.error).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('🔴 CONTROL — a CODED 403 is NOT unauthenticated, and its real cause reaches `error`', async () => {
    // A signed-in viewer can still be refused, and none of those refusals is a
    // sign-in problem. `withBlockScope`
    // (`src/server/middleware/block-scope.middleware.ts`) emits five of them —
    // `instance_revoked`, `consent_revoked`, `app_not_approved`,
    // `insufficient_scope`, `context_binding` — and carries a `code` on EVERY
    // 403 it emits, "so an app can treat it as always-present".
    //
    // `insufficient_scope` is the likeliest in practice: a manifest that simply
    // forgot `goods:read:self`. Routing any of them to `unauthenticated` tells
    // an app to show a SIGNED-IN viewer a sign-in screen, and buries the one
    // message that names the actual fix. This is the arm that fails if anyone
    // re-derives the flag from a status or a code.
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'missing required scope: goods:read:self',
        code: 'insufficient_scope',
      }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unauthenticated).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    // The server's own wording, not a status stand-in — this is what a
    // developer reads to find out their manifest is missing a scope.
    expect(result.current.error?.message).toBe('missing required scope: goods:read:self');
  });

  it.each([
    ['instance_revoked', 'block instance revoked'],
    ['consent_revoked', 'consent revoked for scope: goods:read:self'],
    ['app_not_approved', 'app block is not approved'],
    ['context_binding', 'block token is not bound to this context'],
  ])('CONTROL — the coded 403 `%s` is an error, never a sign-in prompt', async (code, message) => {
    // The remaining middleware 403s, enumerated rather than sampled. 🔴
    // `context_binding` is the row that matters most: it is ALSO what the
    // middleware sends for an anonymous subject on a `:self` scope, which is
    // why the flag must not be keyed on it — the same code covers a wrong
    // `modelId` and an array-form query param, and a signed-in viewer hitting
    // either must not be told to sign in.
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: message, code }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unauthenticated).toBe(false);
    expect(result.current.error?.message).toBe(message);
  });

  it('a 403 whose body did not parse is an ERROR, not a sign-in prompt', async () => {
    // The last shape a response-derived predicate used to claim: an unparseable
    // 403 has no `code`, so `status === 403 && code == null` routed it to
    // `unauthenticated`. It cannot be one — the viewer is signed in, which the
    // hook knows from `BLOCK_INIT` before it ever issues the request. A body
    // the block could not read is a failure to report, so it reaches `error`
    // with the status in the message and the retry notice stays available.
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => {
        throw new Error('invalid json');
      },
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useEntitlements());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.unauthenticated).toBe(false);
    expect(result.current.error?.message).toContain('403');
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
