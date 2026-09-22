import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGenerationResources } from '../src/hooks/useGenerationResources.js';
import { useTip } from '../src/hooks/useTip.js';
import { useTipAllowance } from '../src/hooks/useTipAllowance.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * #398 — THE HOST-ORIGIN-ABSENT FAMILY, IN ONE PLACE.
 *
 * Three hooks direct-fetch the App Blocks REST API and therefore need
 * `useHostOrigin()` before they can do anything. This file pins what each does
 * when that origin NEVER arrives (a direct/unembedded load, `InlineTransport`
 * before bootstrap), and asserts the one property that must hold across all of
 * them: NOTHING IS LEFT WAITING FOREVER.
 *
 * 🔴 ONE PROPERTY, TWO SHAPES — and the split is by API shape, not by accident:
 *
 *   IMPERATIVE (`useTip.tip()`, `useGenerationResources.fetch()`) — the caller
 *   holds a promise, so the terminal state is a REJECTION with a named error,
 *   delivered immediately. There is no `loading` flag to strand.
 *
 *   DECLARATIVE (`useTipAllowance`) — nobody holds a promise; the hook owns
 *   `loading`/`error` and auto-fetches. Throwing from an effect is not available
 *   to it, so its terminal state is `loading: false` plus a named `error`, after
 *   a BOUNDED WAIT (the origin is absent during every healthy boot too, so an
 *   immediate error would flash on every embedded block).
 *
 * `useWildcardPack` is NOT in this family, contrary to the issue's table: its
 * `:77-82` early `setLoading(false)` is a `modelVersionId` validity guard, and
 * the hook never reads the host origin at all.
 *
 * ⚠️ HONEST LABEL: the two imperative cases below are GREEN at `f913811`. They
 * are INVARIANT GUARDS pinning behaviour the fix must not flatten while making
 * the family agree — they are NOT regression coverage for #398. Only the
 * `useTipAllowance` cases (here and in `useTipAllowance.test.tsx`) were watched
 * to fail.
 */

const PARENT_ORIGIN = 'https://civitai.com';

describe('#398 host origin never arrives — the direct-fetch hook family', () => {
  const realFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
    // Transport exists; BLOCK_INIT is deliberately NEVER dispatched.
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    fetchMock = vi.fn(async () => {
      throw new Error('no request should ever be issued without a validated host origin');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    resetTransport();
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('INVARIANT GUARD (green at f913811) — useTip.tip() rejects immediately with a named error', async () => {
    const { result } = renderHook(() => useTip());
    await expect(result.current.tip({ toUserId: 1, amount: 10 })).rejects.toThrow(
      'useTip: host origin not established yet (wait for BLOCK_INIT).',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('INVARIANT GUARD (green at f913811) — useGenerationResources.fetch() rejects immediately with a named error', async () => {
    const { result } = renderHook(() => useGenerationResources());
    await expect(result.current.fetch([691639])).rejects.toThrow(
      'useGenerationResources: host origin not established yet (wait for BLOCK_INIT).',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('useTipAllowance reaches a TERMINAL state (not an eternal spinner) — watched to fail at f913811', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTipAllowance());

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/host origin not established/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The family property, stated once: after the bound, NO hook here is still
   * waiting. For the imperative pair "settled" means the promise rejected; for
   * the declarative one it means `loading === false`.
   */
  it('every member of the family is SETTLED once the bound elapses', async () => {
    // 🔴 Fake timers BEFORE the first render. `useTipAllowance` arms its
    // host-origin backstop in a mount effect, so a `useFakeTimers()` call made
    // afterwards leaves that timer on the REAL clock — `advanceTimersByTimeAsync`
    // then moves a clock the timer is not on and the hook never settles. (That
    // ordering is exactly how this test first failed against a correct fix.)
    vi.useFakeTimers();

    const tipHook = renderHook(() => useTip());
    const resourcesHook = renderHook(() => useGenerationResources());
    const allowanceHook = renderHook(() => useTipAllowance());

    const settled: string[] = [];
    const rejections = Promise.all([
      tipHook.result.current.tip({ toUserId: 1, amount: 1 }).catch(() => settled.push('useTip')),
      resourcesHook.result.current
        .fetch([1])
        .catch(() => settled.push('useGenerationResources')),
    ]);
    await act(async () => {
      await rejections;
    });
    expect(settled.sort()).toEqual(['useGenerationResources', 'useTip']);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(allowanceHook.result.current.loading).toBe(false);
    expect(allowanceHook.result.current.error).toBeInstanceOf(Error);

    tipHook.unmount();
    resourcesHook.unmount();
    allowanceHook.unmount();
  });
});
