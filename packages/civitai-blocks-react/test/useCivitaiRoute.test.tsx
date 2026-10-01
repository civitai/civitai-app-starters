import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBlockContext } from '../src/hooks/useBlockContext.js';
import { useCivitaiNavigate } from '../src/hooks/useCivitaiNavigate.js';
import { useCivitaiRoute } from '../src/hooks/useCivitaiRoute.js';
import { createLiveHost } from '../src/live.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import { mockParentMessage } from './helpers/mockParentMessage.js';

/**
 * `useCivitaiRoute` end-to-end against the REAL SDK transport, and — in the
 * SEAM block at the bottom — against the real `dev:live` host as well.
 *
 * ## Why the seam block exists, and why a type test would not have done
 *
 * `ROUTE_CHANGED` is a host→block push with FOUR independent links, and only
 * one of them is compiler-enforced:
 *
 *   1. the union member on `ParentToBlockMessage`                 (app-sdk)
 *   2. a validator, and `payloadValidatorFor` mapping the type to it
 *      — the `never` bind in that switch's `default:` arm makes the MAPPING a
 *        build error, which is the one link `tsc` holds
 *   3. a branch in `IframeTransport.handleMessage` that applies it to the
 *      snapshot — NOT forced by anything; without it a perfectly valid,
 *      origin-allowed `ROUTE_CHANGED` falls through the no-op tail
 *   4. a dev host that actually EMITS it
 *
 * A declared type is not a code path. The same PR that added this message had
 * already found that exact defect on the host side — a comment claiming a type
 * gated something, where deleting the type left `tsc` at zero errors — so these
 * tests drive the message through the real origin allowlist, the real payload
 * validator and the real snapshot store, and the seam block drives it from a
 * `navigate()` call rather than from a hand-built message.
 *
 * MUTATION-CHECKED (recorded, not asserted — a test cannot see its own
 * coverage): deleting the `ROUTE_CHANGED` branch from
 * `IframeTransport.handleMessage` leaves `pnpm build` and `pnpm typecheck` at
 * ZERO errors and fails the pushes-and-seam tests below on their own
 * assertions. The matrix is in the PR body.
 */
const ORIGIN = window.location.origin;

function pushRoute(subPath: unknown, origin: string = ORIGIN) {
  window.dispatchEvent(mockParentMessage({ type: 'ROUTE_CHANGED', payload: { subPath } }, origin));
}

/** base64url-encode a UTF-8 string (no padding) — for hand-building a fake JWT. */
function base64url(s: string): string {
  const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fakeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  return `${header}.${base64url(JSON.stringify(payload))}.fake-signature`;
}

const NOW_SEC = Math.floor(Date.now() / 1000);
const DEV_TOKEN = fakeJwt({
  blockId: 'block-abc',
  appId: 'app_xyz',
  blockInstanceId: 'page_apb_123',
  ctx: { slotId: 'app.page', entityType: 'none' },
  scopes: [],
  sub: 'user:42',
  iat: NOW_SEC,
  exp: NOW_SEC + 15 * 60,
});

describe('useCivitaiRoute', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    // jsdom's URL is per-FILE, and the seam tests below really do `pushState`.
    // Reset it so no test inherits another's route.
    window.history.replaceState(null, '', '/');
  });

  it('returns the empty sentinel before BLOCK_INIT lands', () => {
    // `EMPTY_SNAPSHOT.context` is `{ slotId: '' }` — there is no `subPath` to
    // read yet, and the hook's published return type is `string`.
    const { result } = renderHook(() => useCivitaiRoute());
    expect(result.current).toBe('');
  });

  it('returns the sub-path BLOCK_INIT delivered — the FIRST value is not a message', () => {
    // 🔴 THE REASON THE SURFACE IS A VALUE HOOK AND NOT A CALLBACK. The host
    // sends the initial sub-path in `BLOCK_INIT.context` and sends
    // `ROUTE_CHANGED` only on a later CHANGE, so a block subscribed to the
    // message alone can never see where it started.
    uninstall = createMockHost({
      context: {
        slotId: 'app.page',
        entityType: 'none',
        slug: 'seed-explorer',
        subPath: 'compare/42',
        viewerUserId: null,
      },
    }).install();
    const { result } = renderHook(() => useCivitaiRoute());
    return waitFor(() => expect(result.current).toBe('compare/42'));
  });

  it('RE-RENDERS with the new sub-path when the host pushes ROUTE_CHANGED', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useCivitaiRoute());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect(result.current).toBe('');

    pushRoute('compare/42');
    await waitFor(() => expect(result.current).toBe('compare/42'));

    // A different sub-path, then BACK TO THE INDEX — not a one-shot latch, and
    // `''` must be deliverable as a destination rather than read as "no value".
    pushRoute('detail/7');
    await waitFor(() => expect(result.current).toBe('detail/7'));
    pushRoute('');
    await waitFor(() => expect(result.current).toBe(''));
  });

  it('useBlockContext().context.subPath tracks the SAME push (one snapshot, two readers)', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useBlockContext());
    await waitFor(() => expect(result.current.ready).toBe(true));

    pushRoute('compare/42');
    // The context copy is the ONLY copy — there is no top-level snapshot field —
    // so a block that narrowed to `PageSlotContext` and a block that called the
    // hook must read the same value or one of them is rendering the wrong view.
    await waitFor(() =>
      expect((result.current.context as { subPath?: string }).subPath).toBe('compare/42'),
    );
    // The push must not disturb anything else on the snapshot.
    expect(result.current.ready).toBe(true);
    expect(result.current.theme).toBe('dark');
    expect((result.current.context as { slug?: string }).slug).toBe('mock-app');
  });

  it('ignores a malformed push — the last GOOD sub-path survives', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useCivitaiRoute());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    pushRoute('compare/42');
    await waitFor(() => expect(result.current).toBe('compare/42'));

    pushRoute(42);
    pushRoute(null);
    pushRoute(undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe('compare/42');
  });

  it('ignores a push from a DISALLOWED origin', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useCivitaiRoute());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    pushRoute('compare/42', 'https://evil.example.com');
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe('');
  });

  it('a MODEL slot has no route: the push cannot introduce one', async () => {
    // The transport only ever UPDATES a `subPath` the context already carries.
    // Synthesising one here would have this package assert a page context the
    // host never sent — and `ModelSlotContext` has no such field to read.
    uninstall = createMockHost({
      context: {
        slotId: 'model.sidebar_top',
        modelId: 1,
        modelVersionId: 2,
        modelName: 'm',
        modelType: 'Checkpoint',
        modelNsfwLevel: 1,
      },
    }).install();
    const { result } = renderHook(() => useBlockContext());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const contextBefore = result.current.context;

    pushRoute('compare/42');
    await new Promise((r) => setTimeout(r, 20));
    expect('subPath' in (result.current.context as object)).toBe(false);
    // Identity, not just equality: a dropped push must not even re-allocate the
    // context, or every model-slot subscriber re-renders for nothing.
    expect(result.current.context).toBe(contextBefore);
  });

  it('OLD HOST: a host that never pushes leaves the init sub-path in place (no hang)', async () => {
    // Nothing awaits `ROUTE_CHANGED`, so a host that predates it is simply a
    // host whose route never moves — the behaviour every page block had before.
    uninstall = createMockHost({
      context: {
        slotId: 'app.page',
        entityType: 'none',
        slug: 'seed-explorer',
        subPath: 'compare/42',
        viewerUserId: null,
      },
    }).install();
    const { result } = renderHook(() => useCivitaiRoute());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toBe('compare/42');
  });

  /**
   * 🔴 THE SEAM NOBODY OWNS. Every test above drives a HAND-BUILT message, so
   * all of them pass against a dev host that emits nothing at all — which is
   * exactly the state this PR found: production sent `ROUTE_CHANGED`, the SDK
   * modelled it nowhere, and `dev:live` faked a `popstate` instead. These tests
   * build the combined state instead: one real `navigate()` call travelling
   * block → dev host → transport → hook, with no hand-written message anywhere.
   */
  describe('SEAM: a navigate() in the block comes back as the block\'s own route', () => {
    // 🔴 `location.assign` and `window.open` MUST be stubbed here, and not for
    // tidiness: jsdom's `assign` really does move `window.location`, so the
    // site-scope test below would otherwise leave the whole FILE on
    // `https://civitai.com` — every later live host then dispatches `BLOCK_INIT`
    // from an origin the transport's allowlist rejects, and four tests fail with
    // `ready === false` for a reason that names nothing about their subject.
    // (Measured: that is exactly what happened before these two lines existed.)
    beforeEach(() => {
      vi.spyOn(window.location, 'assign').mockImplementation(() => {});
      vi.spyOn(window, 'open').mockImplementation(() => null);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function installLiveHost() {
      const host = createLiveHost({
        blockToken: DEV_TOKEN,
        viewer: { id: 42, username: 'dev-mod' }, // skips the /blocks/me fetch
      });
      uninstall = host.install();
      return host;
    }

    it('an app-scoped navigate moves the hook, not only the URL bar', async () => {
      installLiveHost();
      const route = renderHook(() => useCivitaiRoute());
      const nav = renderHook(() => useCivitaiNavigate());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      expect(route.result.current).toBe('');

      act(() => {
        nav.result.current.navigate('compare/42');
      });

      // The URL moved …
      await waitFor(() => expect(window.location.pathname).toBe('/compare/42'));
      // … AND the block learned where it went. The second assertion is the
      // whole point: the first one passed before this change too, which is the
      // #5209 shape — URL moves, nothing renders.
      await waitFor(() => expect(route.result.current).toBe('compare/42'));
    });

    it('a leading slash lands on the same route — the host owns normalisation', async () => {
      installLiveHost();
      const route = renderHook(() => useCivitaiRoute());
      const nav = renderHook(() => useCivitaiNavigate());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      act(() => {
        nav.result.current.navigate('/compare/42');
      });
      // No leading slash in the sub-path the block is told about: it is the
      // segment BELOW the app root, matching `PageSlotContext.subPath`.
      await waitFor(() => expect(route.result.current).toBe('compare/42'));
    });

    it('a SITE-scoped navigate does NOT move the block\'s own route', async () => {
      installLiveHost();
      const route = renderHook(() => useCivitaiRoute());
      const nav = renderHook(() => useCivitaiNavigate());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      act(() => {
        nav.result.current.navigate('models/123', { scope: 'site' });
      });
      await new Promise((r) => setTimeout(r, 20));
      // Site scope leaves the app entirely; there is no in-app route to report.
      expect(route.result.current).toBe('');
    });

    it('a new_tab navigate does NOT move THIS frame\'s route', async () => {
      installLiveHost();
      const route = renderHook(() => useCivitaiRoute());
      const nav = renderHook(() => useCivitaiNavigate());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      act(() => {
        nav.result.current.navigate('compare/42', { target: 'new_tab' });
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(route.result.current).toBe('');
    });

    it('navigating to the route already showing emits nothing (no redundant re-render)', async () => {
      installLiveHost();
      const route = renderHook(() => useCivitaiRoute());
      const nav = renderHook(() => useCivitaiNavigate());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      act(() => {
        nav.result.current.navigate('compare/42');
      });
      await waitFor(() => expect(route.result.current).toBe('compare/42'));

      let renders = 0;
      const counted = renderHook(() => {
        renders += 1;
        return useCivitaiRoute();
      });
      const before = renders;
      act(() => {
        nav.result.current.navigate('compare/42');
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(counted.result.current).toBe('compare/42');
      expect(renders).toBe(before);
    });

    it('the viewer\'s own BACK button reports a route the block never asked for', async () => {
      // Production's effect is keyed on the resolved sub-path, so it fires for a
      // history move nobody requested. A dev host that only reflected its own
      // pushes would make the back button look broken in `dev:live` alone.
      installLiveHost();
      const route = renderHook(() => useCivitaiRoute());
      const nav = renderHook(() => useCivitaiNavigate());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      act(() => {
        nav.result.current.navigate('compare/42');
      });
      await waitFor(() => expect(route.result.current).toBe('compare/42'));

      // jsdom does not implement real history traversal, so move the URL the way
      // a traversal would and fire the event the browser fires. The host reads
      // the sub-path from `location`, which is what makes this faithful.
      act(() => {
        window.history.replaceState(null, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });
      await waitFor(() => expect(route.result.current).toBe(''));
    });

    it('the popstate listener does not outlive the host', async () => {
      installLiveHost();
      const route = renderHook(() => useCivitaiRoute());
      const nav = renderHook(() => useCivitaiNavigate());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      act(() => {
        nav.result.current.navigate('compare/42');
      });
      await waitFor(() => expect(route.result.current).toBe('compare/42'));

      uninstall?.();
      uninstall = undefined;

      act(() => {
        window.history.replaceState(null, '', '/detail/7');
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      });
      await new Promise((r) => setTimeout(r, 20));
      // A torn-down host pushes nothing — and across a re-install, two hosts
      // would otherwise be reporting the same route.
      expect(route.result.current).toBe('compare/42');
    });
  });
});
