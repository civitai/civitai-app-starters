import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useCivitaiNavigate } from '../src/hooks/useCivitaiNavigate.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * Fire-and-forget NAVIGATE bridge hook. The iframe transport QUEUES outbound
 * messages until BLOCK_INIT captures the parent origin, so — like the
 * useResourcePicker scaffold — we dispatch a BLOCK_INIT first, then clear the
 * mock (which also swallows the auto-sent BLOCK_READY) before asserting.
 */

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('useCivitaiNavigate', () => {
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
  });

  function lastSent() {
    return postMessageMock.mock.calls[postMessageMock.mock.calls.length - 1][0] as {
      type: string;
      payload: { path: string; scope?: string; target: string };
    };
  }

  /**
   * 🔴 THE BACK-COMPAT PROPERTY, AND IT IS AN EXACT-PAYLOAD ASSERTION ON PURPOSE.
   * `toEqual` with no `scope` key fails if the hook starts sending `scope: 'app'`
   * or `scope: undefined` — either of which would make an unscoped call's wire
   * payload differ from what every pre-`scope` build sent. A `toMatchObject`
   * here would pass on both and assert nothing.
   *
   * ⚠️ `/models/12345` is deliberately NOT the example any more. Under the
   * `'app'` default it asks for THIS APP's `/models/12345`, so using it as the
   * canonical sample is the single easiest way to teach the wrong thing. The
   * site-scoped test below is where that path belongs.
   */
  // [invariant guard — green at base] Green before AND after: that is the point.
  // It pins the back-compat property rather than a new behaviour, so it can only
  // ever fail on a future change that starts stamping `scope` on an unscoped call.
  it('omits `scope` entirely when unscoped, and defaults target to "current"', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    act(() => {
      result.current.navigate('settings');
    });
    const sent = lastSent();
    expect(sent.type).toBe('NAVIGATE');
    expect(sent.payload).toEqual({ path: 'settings', target: 'current' });
    expect('scope' in sent.payload).toBe(false);
  });

  // [invariant guard — green at base] The two-argument call shape is unchanged by
  // construction; this pins that the widened parameter did not break it.
  //
  // 🔴 IT ALSO PINS THE VERBATIM-PATH CLAIM, which is why a separate
  // "passes the path through verbatim" test was deleted rather than kept. The
  // `toEqual` below is an EXACT payload assertion on a path with a LEADING
  // SLASH, so a hook that started normalising — `'/user/alice'` → `'user/alice'`
  // — fails right here. `scope` selects the space and the HOST strips the slash;
  // a second normaliser in this package would make the two layers disagree.
  it('forwards an explicit "new_tab" target passed the pre-`scope` way (still unscoped)', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    act(() => {
      result.current.navigate('/user/alice', 'new_tab');
    });
    expect(lastSent().payload).toEqual({ path: '/user/alice', target: 'new_tab' });
  });

  it('sends `scope: "site"` when the caller asks to leave the app', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    act(() => {
      result.current.navigate('models/12345', { scope: 'site' });
    });
    expect(lastSent().payload).toEqual({ path: 'models/12345', scope: 'site', target: 'current' });
  });

  it('carries `scope` and `target` together from the options object', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    act(() => {
      result.current.navigate('models/12345', { scope: 'site', target: 'new_tab' });
    });
    expect(lastSent().payload).toEqual({ path: 'models/12345', scope: 'site', target: 'new_tab' });
  });

  it('sends an EXPLICIT `scope: "app"` through rather than dropping it', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    act(() => {
      result.current.navigate('detail/7', { scope: 'app' });
    });
    expect(lastSent().payload).toEqual({ path: 'detail/7', scope: 'app', target: 'current' });
  });

  it('an options object with only a target is equivalent to the bare-string form', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    act(() => {
      result.current.navigate('detail/7', { target: 'new_tab' });
    });
    const viaObject = lastSent().payload;
    act(() => {
      result.current.navigate('detail/7', 'new_tab');
    });
    expect(lastSent().payload).toEqual(viaObject);
    expect('scope' in viaObject).toBe(false);
  });

  it('is fire-and-forget — the returned value is undefined (no host reply awaited)', () => {
    const { result } = renderHook(() => useCivitaiNavigate());
    let ret: unknown;
    act(() => {
      ret = result.current.navigate('/');
    });
    expect(ret).toBeUndefined();
    // Exactly one outbound message, and nothing waits on a reply.
    expect(postMessageMock).toHaveBeenCalledTimes(1);
  });

  it('keeps `navigate` referentially stable across renders (useCallback)', () => {
    const { result, rerender } = renderHook(() => useCivitaiNavigate());
    const first = result.current.navigate;
    rerender();
    expect(result.current.navigate).toBe(first);
  });
});
