import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, ConsentUnavailablePayload } from '@civitai/app-sdk/blocks';

import { useConsentUnavailable } from '../src/hooks/useConsentUnavailable.js';
import { useRequestConsent } from '../src/hooks/useRequestConsent.js';
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
   * So this instruments the transport itself and pins the RELATIONSHIP: the
   * hook's own subscription is released and its handler stops being invoked.
   *
   * 🔴 THE SEAM: a mount now takes TWO transport subscriptions, not one — the
   * refusal BUFFER's (`armConsentRefusalLatch`, deliberately never released, so
   * a refusal that lands while nothing is mounted is still recorded) and the
   * HOOK's (released on unmount). A test that only counted subscriptions, or
   * only counted handler invocations in aggregate, could not tell those apart:
   * it would go green either if the hook leaked its listener or if the buffer
   * released the one it must keep. So each subscription is tracked separately
   * and the assertion is on the SPLIT — exactly one released, exactly one still
   * receiving.
   */
  it('unsubscribes on unmount — the hook listener is released, the buffer listener is not', () => {
    const transport = getTransport();
    const original = transport.onMessage.bind(transport);
    const subs: Array<{ type: string; unsub: ReturnType<typeof vi.fn>; invocations: number }> = [];

    const spy = vi
      .spyOn(transport, 'onMessage')
      .mockImplementation((type: string, handler: (p: unknown) => void) => {
        const entry = { type, unsub: vi.fn(), invocations: 0 };
        const realUnsub = original(type as never, (p: unknown) => {
          entry.invocations += 1;
          handler(p);
        });
        entry.unsub.mockImplementation(() => realUnsub());
        subs.push(entry);
        return entry.unsub;
      });

    const { unmount } = renderHook(() => useConsentUnavailable());

    // Positive control: the instrumentation IS wired to something. Without this
    // a zero on the post-unmount count below would be indistinguishable from a
    // spy that never saw a message at all.
    expect(subs).toHaveLength(2);
    expect(subs.map((s) => s.type)).toEqual(['CONSENT_UNAVAILABLE', 'CONSENT_UNAVAILABLE']);
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });
    expect(subs.map((s) => s.invocations)).toEqual([1, 1]);

    unmount();
    expect(subs.filter((s) => s.unsub.mock.calls.length > 0)).toHaveLength(1);

    const before = subs.map((s) => s.invocations);
    dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['buzz:read:self'] });
    const after = subs.map((s) => s.invocations);
    // Exactly one handler advanced (the buffer's) and exactly one froze (the
    // hook's). `[2, 1]` or `[1, 2]` — order is an implementation detail, the
    // SPLIT is not.
    expect(after.filter((n, i) => n === before[i]!)).toHaveLength(1);
    expect(after.filter((n, i) => n === before[i]! + 1)).toHaveLength(1);
    // The released subscription is the one that froze.
    const frozen = subs.filter((s, i) => after[i] === before[i]!);
    expect(frozen[0]!.unsub).toHaveBeenCalledTimes(1);

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

  /**
   * 🔴 THE DROPPED REFUSAL. A `CONSENT_UNAVAILABLE` is an uncorrelated push, and
   * the transport hands an unsolicited push ONLY to handlers registered at the
   * instant it arrives — one with no listener falls through to
   * `handleMessage`'s no-op tail. So before the buffer, a refusal that landed
   * while no `useConsentUnavailable()` was mounted was gone forever, and the
   * block went back to rendering "confirm in the dialog, then click Generate
   * again" next to a host toast saying the permission is unavailable — the exact
   * two-message screen this whole message exists to remove.
   *
   * Reachable whenever the component that CALLS `requestConsent()` and the one
   * that RENDERS the refusal are different, or the consumer is conditionally
   * rendered. Both orderings are pinned; both returned `null` before the buffer.
   */
  describe('buffering — a refusal that arrives while nothing is mounted', () => {
    it('a refusal pushed AFTER requestConsent() but BEFORE the consumer mounts is delivered', () => {
      // The requester and the consumer are different components: this one only
      // asks. Rendering it is what arms the buffer.
      renderHook(() => useRequestConsent()).result.current.requestConsent({
        scopes: ['ai:write:budgeted'],
      });
      dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });

      const { result } = renderHook(() => useConsentUnavailable());
      expect(result.current.refusal).toEqual({
        reason: 'ungrantable',
        scopes: ['ai:write:budgeted'],
      });
    });

    it('a refusal pushed while the consumer is UNMOUNTED is delivered on remount', () => {
      const first = renderHook(() => useConsentUnavailable());
      expect(first.result.current.refusal).toBeNull();
      first.unmount();

      dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['buzz:read:self'] });

      const second = renderHook(() => useConsentUnavailable());
      expect(second.result.current.refusal).toEqual({
        reason: 'ungrantable',
        scopes: ['buzz:read:self'],
      });
    });

    it('an EMPTY-scopes refusal survives the buffer too — it is the message, not the names', () => {
      renderHook(() => useRequestConsent()).result.current.requestConsent({ scopes: ['nope'] });
      dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: [] });

      const { result } = renderHook(() => useConsentUnavailable());
      expect(result.current.refusal).toEqual({ reason: 'ungrantable', scopes: [] });
    });

    it('the buffer holds only the LATEST refusal', () => {
      renderHook(() => useRequestConsent()).result.current.requestConsent({ scopes: ['a'] });
      dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });
      dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['buzz:read:self'] });

      const { result } = renderHook(() => useConsentUnavailable());
      expect(result.current.refusal?.scopes).toEqual(['buzz:read:self']);
    });

    /**
     * INVARIANT GUARD (green before the buffer existed, because nothing was
     * retained at all). It pins the buffer's ESCAPE HATCH: `reset()` has to
     * clear the buffered copy, not just the calling hook's state, or the
     * documented "Try again" button is undone by the next remount.
     */
    it('reset() clears the BUFFER, so a later mount does not resurrect the refusal', () => {
      const first = renderHook(() => useConsentUnavailable());
      dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });
      expect(first.result.current.refusal).not.toBeNull();
      act(() => first.result.current.reset());
      first.unmount();

      const second = renderHook(() => useConsentUnavailable());
      expect(second.result.current.refusal).toBeNull();
    });

    /**
     * INVARIANT GUARD (green before the buffer existed). It pins the STALENESS
     * BOUND that buffering buys — a refusal replayed to an unrelated later mount
     * is a block claiming "unavailable" about something it never asked for. A
     * refusal means "the scopes THIS token was minted with can never be extended
     * here", so a re-minted token (the grant path pushes `TOKEN_REFRESH`, and
     * the host rotates roughly every 13 min) invalidates its premise. The bias
     * is deliberate: dropping a still-true refusal costs one more round-trip,
     * retaining a now-false one tells the user a granted permission is
     * unavailable.
     */
    it('a refusal recorded against a SUPERSEDED token is discarded, not replayed', () => {
      renderHook(() => useRequestConsent()).result.current.requestConsent({
        scopes: ['ai:write:budgeted'],
      });
      dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });

      // Positive control: with the token UNCHANGED the very same buffered
      // refusal IS delivered (asserted by the first test in this describe), so a
      // null below is the token check firing and not a buffer wired to nothing.
      dispatch('TOKEN_REFRESH', {
        token: {
          raw: 'jwt-after-grant',
          scopes: ['ai:write:budgeted'],
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      expect(getTransport().getSnapshot().token.raw).toBe('jwt-after-grant');

      const { result } = renderHook(() => useConsentUnavailable());
      expect(result.current.refusal).toBeNull();
    });

    /**
     * INVARIANT GUARD (green before the buffer existed). The documented
     * boundary: the buffer is armed by `requestConsent()` or by a mount, so a
     * block that posts `REQUEST_CONSENT` through the RAW transport gets the old
     * drop-if-nobody-is-listening behaviour. Pinned so the boundary is a
     * decision on record rather than an accident.
     */
    it('is NOT armed by a raw-transport REQUEST_CONSENT — nothing buffers that path', () => {
      getTransport().sendMessage({ type: 'REQUEST_CONSENT', payload: { scopes: ['x'] } });
      dispatch('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['ai:write:budgeted'] });

      const { result } = renderHook(() => useConsentUnavailable());
      expect(result.current.refusal).toBeNull();
    });
  });
});
