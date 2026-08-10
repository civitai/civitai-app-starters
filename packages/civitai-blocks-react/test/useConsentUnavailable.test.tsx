import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, ConsentUnavailablePayload } from '@civitai/app-sdk/blocks';

import { useConsentUnavailable } from '../src/hooks/useConsentUnavailable.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useConsentUnavailable` — the typed consumption path for the host's
 * `CONSENT_UNAVAILABLE` push.
 *
 * Before this hook the only public path was
 * `getTransport().onMessage('CONSENT_UNAVAILABLE', (p: unknown) => …)` plus a
 * hand-written `as ConsentUnavailablePayload` cast, i.e. the message was
 * *nameable* but not *consumable* — the cast is unchecked, so a payload shape
 * change would compile straight through it.
 */

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt',
      scopes: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

function dispatch(type: string, payload: unknown, origin = PARENT_ORIGIN): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type, payload }, origin }));
  });
}

describe('useConsentUnavailable', () => {
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
    vi.restoreAllMocks();
  });

  it('starts null — a block that never gets refused renders its normal path', () => {
    const { result } = renderHook(() => useConsentUnavailable());
    expect(result.current.refusal).toBeNull();
  });

  it('captures the refusal payload from the host push', () => {
    const { result } = renderHook(() => useConsentUnavailable());
    dispatch('CONSENT_UNAVAILABLE', {
      reason: 'ungrantable',
      scopes: ['ai:write:budgeted'],
    });
    expect(result.current.refusal).toEqual({
      reason: 'ungrantable',
      scopes: ['ai:write:budgeted'],
    });
  });

  /**
   * 🔴 THE REGRESSION THIS HOOK EXISTS TO MAKE UNWRITABLE. The host refuses on
   * its UNFILTERED un-grantable set but only names scopes in the public
   * vocabulary, so `scopes: []` is a legitimate refusal. A hook that gated on
   * `scopes.length` would silently drop exactly the message it subscribed for —
   * the failure mode the README warns about in prose and nothing enforced.
   */
  it('captures a refusal carrying an EMPTY scopes array', () => {
    const { result } = renderHook(() => useConsentUnavailable());
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: [] });
    expect(result.current.refusal).not.toBeNull();
    expect(result.current.refusal).toEqual({ reason: 'ungrantable', scopes: [] });
  });

  it('reset() clears the refusal so a later request can be tried again', () => {
    const { result } = renderHook(() => useConsentUnavailable());
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });
    expect(result.current.refusal).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.refusal).toBeNull();
  });

  it('a LATER refusal replaces an earlier one', () => {
    const { result } = renderHook(() => useConsentUnavailable());
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['buzz:read:self'] });
    expect(result.current.refusal?.scopes).toEqual(['buzz:read:self']);
  });

  /**
   * The hook subscribes through the transport, so it inherits the SAME trust
   * gate every inbound message passes — origin allowlist + payload validator —
   * rather than adding its own `window` listener behind the boundary. Both
   * halves are pinned here because "it renders the payload" is exactly the
   * position where a bypass would be invisible.
   */
  it('ignores a push from a NON-allowlisted origin', () => {
    const { result } = renderHook(() => useConsentUnavailable());
    dispatch(
      'CONSENT_UNAVAILABLE',
      { reason: 'ungrantable', scopes: ['ai:write:budgeted'] },
      'https://evil.example',
    );
    expect(result.current.refusal).toBeNull();
  });

  it('ignores a MALFORMED payload (validator drops it before the hook sees it)', () => {
    const { result } = renderHook(() => useConsentUnavailable());
    dispatch('CONSENT_UNAVAILABLE', { reason: 'nope', scopes: ['ai:write:budgeted'] });
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: [1, 2] });
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable' });
    expect(result.current.refusal).toBeNull();
  });

  /**
   * 🔴 ASSERT THE LISTENER IS GONE, NOT THAT THE RESULT LOOKS UNCHANGED. The
   * obvious version of this test — unmount, dispatch, `expect(result.current
   * .refusal).toBeNull()` — is VACUOUS: React 18+ makes a `setState` on an
   * unmounted component a silent no-op and RTL's `result.current` is frozen at
   * the last render, so it reads null whether or not the subscription was ever
   * torn down. A mutant that simply drops the effect's cleanup (`return
   * subscribeTyped(…)` → `subscribeTyped(…)`) SURVIVED that assertion, leaking
   * one transport listener per mount for the life of the page.
   *
   * So this instruments the transport itself and pins the RELATIONSHIP: every
   * subscription taken is released, and the handler stops being invoked.
   */
  it('unsubscribes on unmount — the transport listener is released, not just ignored', () => {
    const transport = getTransport();
    const original = transport.onMessage.bind(transport);
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    let handlerInvocations = 0;

    const spy = vi
      .spyOn(transport, 'onMessage')
      .mockImplementation((type: string, handler: (p: unknown) => void) => {
        const realUnsub = original(type as never, (p: unknown) => {
          handlerInvocations += 1;
          handler(p);
        });
        const wrapped = vi.fn(() => realUnsub());
        unsubscribes.push(wrapped);
        return wrapped;
      });

    const { unmount } = renderHook(() => useConsentUnavailable());

    // Positive control: the instrumentation IS wired to something. Without this
    // a zero on the post-unmount count below would be indistinguishable from a
    // spy that never saw a message at all.
    expect(unsubscribes).toHaveLength(1);
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });
    expect(handlerInvocations).toBe(1);

    unmount();
    expect(unsubscribes[0]!).toHaveBeenCalledTimes(1);

    const before = handlerInvocations;
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['buzz:read:self'] });
    expect(handlerInvocations).toBe(before);

    spy.mockRestore();
  });

  it('two concurrent hook instances both observe the same refusal', () => {
    const a = renderHook(() => useConsentUnavailable());
    const b = renderHook(() => useConsentUnavailable());
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });
    expect(a.result.current.refusal).not.toBeNull();
    expect(b.result.current.refusal).not.toBeNull();
  });

  it('the handler payload is typed — no cast needed at the call site', () => {
    const { result } = renderHook(() => useConsentUnavailable());
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });
    // No `as` here: `refusal` is already `ConsentUnavailablePayload | null`, and
    // this assignment is the compile-time half of the claim.
    const typed: ConsentUnavailablePayload | null = result.current.refusal;
    expect(typed?.reason).toBe('ungrantable');
  });
});
