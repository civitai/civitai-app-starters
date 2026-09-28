import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { GoodPurchaseRefusal, useGoodPurchase } from '../src/hooks/useGoodPurchase.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt-goods',
      scopes: ['goods:purchase:self', 'goods:read:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 'app.page' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'alice', status: 'active' },
    theme: 'dark',
    renderMode: 'iframe',
  };
}

const OK_BODY = {
  ok: true,
  purchase: { id: 'bgp_01', goodId: 'extra-slots', priceBuzz: 250 },
  entitlement: { goodId: 'extra-slots', kind: 'good', payload: {}, grantedAt: 'now' },
};

function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => OK_BODY }));
}

/** A server refusal, with the machine-readable `reason` the hook branches on. */
function refusingFetch(status: number, reason: string, error = 'nope') {
  return vi.fn(async () => ({ ok: false, status, json: async () => ({ ok: false, error, reason }) }));
}

/**
 * 🔴 The top-up modal is a BRIDGE message, so it cannot be stubbed with `fetch`.
 * Spying on the hook module that owns it keeps the seam honest: the test drives
 * the real `useGoodPurchase`, and only the host round-trip is replaced.
 */
const openPurchaseModal = vi.fn();
vi.mock('../src/hooks/useBuzzPurchase.js', () => ({
  useBuzzPurchase: () => ({ openPurchaseModal }),
}));

describe('useGoodPurchase', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    openPurchaseModal.mockReset();
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

  /**
   * A `fetch` that never settles on its own — it rejects the way the platform
   * does, ONLY when its `AbortSignal` fires. Anything less (a promise that
   * simply hangs) cannot exercise the abort branch at all: the hook would sit
   * on the `await` forever and the test would time out rather than assert.
   */
  function abortOnlyFetch() {
    return vi.fn(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => {
            const e = new Error('The operation was aborted.');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    );
  }

  it('POSTs to the goods endpoint with the bearer token, the goodId and an auto idempotencyKey', async () => {
    const fetchMock = okFetch();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useGoodPurchase());
    await act(async () => {
      await result.current.purchase({ goodId: 'extra-slots', expectedPriceBuzz: 250 });
    });

    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${PARENT_ORIGIN}/api/v1/blocks/goods/purchase`);
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer jwt-goods');
    const sent = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(sent.goodId).toBe('extra-slots');
    expect(sent.expectedPriceBuzz).toBe(250);
    expect(typeof sent.idempotencyKey).toBe('string');
    // 🔴 The BUYER is never sent. The server binds it to the token subject, and
    // a client-supplied user id on a money path is the FIN-1 class.
    expect(sent).not.toHaveProperty('buyerUserId');
    expect(sent).not.toHaveProperty('userId');
  });

  it('rejects with a GoodPurchaseRefusal carrying the machine-readable reason', async () => {
    globalThis.fetch = refusingFetch(400, 'insufficient_funds', 'not enough Buzz') as never;
    const { result } = renderHook(() => useGoodPurchase());

    await act(async () => {
      await expect(result.current.purchase({ goodId: 'extra-slots' })).rejects.toBeInstanceOf(
        GoodPurchaseRefusal,
      );
    });
    // The app must be able to branch WITHOUT string-matching viewer-facing copy.
    expect((result.current.error as GoodPurchaseRefusal).reason).toBe('insufficient_funds');
    expect((result.current.error as GoodPurchaseRefusal).status).toBe(400);
  });

  it('🔴 a 2xx that is not a purchase result REJECTS rather than resolving undefined', async () => {
    // The declared return type promises an entitlement, and the documented usage
    // destructures it. An unparseable 200 resolved as `null` and a wrong-shaped
    // one resolved with `entitlement === undefined`, so both surfaced as a
    // TypeError in the app instead of a failed purchase. On this hook the body
    // IS the granted entitlement, so a silent absence is unrecoverable.
    //
    // 🔴 THE FIXTURE SET IS CHOSEN SO EACH CLAUSE OF THE GUARD IS THE KILLING
    // CONDITION FOR AT LEAST ONE ROW — otherwise a clause can be deleted with
    // the suite still green. The first three rows are all killed by the
    // `bodyJson == null` / `entitlement == null` clauses, so an earlier
    // revision's `ok !== true` clause SURVIVED deletion: every row that had a
    // body also set `ok: true`. The last two rows fix that:
    //   - `ok` OMITTED but otherwise complete → only `ok !== true` can reject it.
    //   - `purchase` OMITTED but otherwise complete → only `purchase == null`
    //     can, and `GoodPurchaseResult` declares that field REQUIRED, so
    //     resolving here hands the caller a value whose `.purchase.id` throws.
    const GOOD_ENTITLEMENT = {
      goodId: 'extra-slots',
      kind: 'good',
      payload: {},
      grantedAt: 'now',
    };
    const GOOD_PURCHASE = { id: 'bgp_01', goodId: 'extra-slots', priceBuzz: 250 };
    for (const body of [
      null,
      { ok: true },
      { ok: true, purchase: { id: 'x' } },
      { purchase: GOOD_PURCHASE, entitlement: GOOD_ENTITLEMENT },
      { ok: true, entitlement: GOOD_ENTITLEMENT },
    ]) {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          if (body === null) throw new Error('invalid json');
          return body;
        },
      })) as unknown as typeof fetch;
      const { result } = renderHook(() => useGoodPurchase());
      await act(async () => {
        await expect(
          result.current.purchase({ goodId: 'extra-slots' }),
          `body ${JSON.stringify(body)}`,
        ).rejects.toBeInstanceOf(GoodPurchaseRefusal);
      });
      // The message must say the charge MAY have landed — the caller's next
      // move is a same-key retry, not a fresh attempt.
      expect(result.current.error?.message).toContain('may have landed');
    }
  });

  it('CONTROL — a well-formed 2xx still resolves, so the check above is not rejecting everything', async () => {
    globalThis.fetch = okFetch() as unknown as typeof fetch;
    const { result } = renderHook(() => useGoodPurchase());
    let out: unknown;
    await act(async () => {
      out = await result.current.purchase({ goodId: 'extra-slots' });
    });
    expect((out as { ok: boolean }).ok).toBe(true);
  });

  it('does NOT open the top-up modal unless asked — the default leaves the refusal to the app', async () => {
    globalThis.fetch = refusingFetch(400, 'insufficient_funds') as never;
    const { result } = renderHook(() => useGoodPurchase());

    await act(async () => {
      await expect(result.current.purchase({ goodId: 'extra-slots' })).rejects.toThrow();
    });
    expect(openPurchaseModal).not.toHaveBeenCalled();
  });

  it('🔴 tops up then RETRIES WITH THE SAME IDEMPOTENCY KEY, and only after a real purchase', async () => {
    // First POST refuses for funds, second succeeds — the shape of a top-up that
    // worked. Same key on both, because the server leaves the key free on a 400
    // precisely so an identical retry can reach a different verdict.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, error: 'nope', reason: 'insufficient_funds' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => OK_BODY });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    openPurchaseModal.mockResolvedValue({ purchased: true, newBalance: 9_000 });

    const { result } = renderHook(() => useGoodPurchase());
    let out: Awaited<ReturnType<typeof result.current.purchase>> | undefined;
    await act(async () => {
      out = await result.current.purchase(
        { goodId: 'extra-slots', expectedPriceBuzz: 250 },
        { topUpOnInsufficientFunds: true },
      );
    });

    expect(out?.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The modal is offered the price, so the host can pre-fill a sensible amount.
    expect(openPurchaseModal).toHaveBeenCalledWith(250);
    const k1 = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).idempotencyKey;
    const k2 = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).idempotencyKey;
    expect(k1).toBe(k2);
  });

  it('CONTROL — a CLOSED top-up modal does not retry, and rethrows the ORIGINAL refusal', async () => {
    // Without this, the test above passes for a hook that retries unconditionally
    // — which would re-charge-attempt on every dismissed modal and report the
    // second refusal instead of the one the viewer caused.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: 'nope', reason: 'insufficient_funds' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    openPurchaseModal.mockResolvedValue({ purchased: false });

    const { result } = renderHook(() => useGoodPurchase());
    await act(async () => {
      await expect(
        result.current.purchase({ goodId: 'extra-slots' }, { topUpOnInsufficientFunds: true }),
      ).rejects.toBeInstanceOf(GoodPurchaseRefusal);
    });
    expect(openPurchaseModal).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * THE ABORT/TIMEOUT BRANCH. Until now it had NO coverage at all — no
   * `useFakeTimers`, no `abort`, no `timeout` anywhere in this file — while
   * being the branch that decides what an app is told when a money request
   * does not come back.
   */
  describe('the abort branch', () => {
    it('🔴 the 30s bound produces a NAMED timeout error, not a bare AbortError', async () => {
      // 🔴 Fake timers BEFORE the render, per `hostOriginAbsent.test.tsx`: a
      // `useFakeTimers()` installed afterwards leaves an already-armed timer on
      // the real clock, and `advanceTimersByTimeAsync` then moves a clock the
      // timer is not on.
      vi.useFakeTimers();
      const fetchMock = abortOnlyFetch();
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const { result } = renderHook(() => useGoodPurchase());
      let caught: unknown;
      await act(async () => {
        const settled = result.current
          .purchase({ goodId: 'extra-slots' })
          .catch((e: unknown) => {
            caught = e;
          });
        await vi.advanceTimersByTimeAsync(30_001);
        await settled;
      });

      const err = caught as Error;
      expect(err).toBeInstanceOf(Error);
      // The bound, by value — a caller reading this knows the request was
      // cut off by US and not refused by the server.
      expect(err.message).toContain('timed out after 30000ms');
      // The same-key retry advice is the whole point of naming it: the charge
      // may have landed on the far side of the abort.
      expect(err.message).toContain('SAME idempotencyKey');
      // 🔴 NOT an `AbortError`. Apps routinely ignore that name as "we
      // navigated away"; a silently-ignored money-path timeout is the worst
      // outcome this branch can produce.
      expect(err.name).toBe('Error');
      expect(err).not.toBeInstanceOf(GoodPurchaseRefusal);
    });

    it('🔴 an UNMOUNT keeps `name === "AbortError"` — the discriminator callers ignore on', async () => {
      // Distinct from the timeout above and deliberately so. A component that
      // navigated away has no failure to report, and the established way to say
      // that is the `AbortError` name — `useBuzzWorkflow`'s `watch()` sets it
      // the same way. Flattening it to a plain `Error` (as this branch once did)
      // turns every navigate-away into a reported purchase failure.
      const fetchMock = abortOnlyFetch();
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const hook = renderHook(() => useGoodPurchase());
      let caught: unknown;
      const settled = hook.result.current
        .purchase({ goodId: 'extra-slots' })
        .catch((e: unknown) => {
          caught = e;
        });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      await act(async () => {
        hook.unmount();
        await settled;
      });

      const err = caught as Error;
      expect(err.name).toBe('AbortError');
      // Informative wording AND a usable `name` — not a trade-off.
      expect(err.message).toContain('unmounted');
      expect(err.message).toContain('SAME idempotencyKey');
      // And it is NOT the timeout wording: the bound never elapsed.
      expect(err.message).not.toContain('timed out');
    });

    it('🔴 a refusal racing the abort STAYS a GoodPurchaseRefusal, so the top-up branch still sees it', async () => {
      // This is the `!(err instanceof GoodPurchaseRefusal)` escape hatch, and it
      // is not defensive padding: the server's `insufficient_funds` 400 can be
      // mid-parse when the unmount cleanup aborts the controller. Rewriting it
      // into the abort `Error` strips `reason`, `canTopUp` goes false, and the
      // viewer is shown a raw failure where the Buzz modal was the whole point.
      let releaseBody: () => void = () => {};
      const bodyGate = new Promise<void>((r) => {
        releaseBody = r;
      });
      let reachedBody = false;
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => {
          reachedBody = true;
          await bodyGate;
          return { ok: false, error: 'not enough Buzz', reason: 'insufficient_funds' };
        },
      }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      // The modal declines, so the ORIGINAL refusal is what surfaces — the
      // assertion below is about which error object reached the branch, not
      // about the retry.
      openPurchaseModal.mockResolvedValue({ purchased: false });

      const hook = renderHook(() => useGoodPurchase());
      let caught: unknown;
      const settled = hook.result.current
        .purchase({ goodId: 'extra-slots', expectedPriceBuzz: 250 }, { topUpOnInsufficientFunds: true })
        .catch((e: unknown) => {
          caught = e;
        });
      // Park the hook inside `res.json()`, then abort underneath it.
      await waitFor(() => expect(reachedBody).toBe(true));

      await act(async () => {
        hook.unmount();
        releaseBody();
        await settled;
      });

      expect(caught).toBeInstanceOf(GoodPurchaseRefusal);
      expect((caught as GoodPurchaseRefusal).reason).toBe('insufficient_funds');
      // The discriminator survived far enough to REACH the top-up branch —
      // a structural check on `instanceof` alone would pass for a refusal the
      // branch never saw.
      expect(openPurchaseModal).toHaveBeenCalledTimes(1);
      expect(openPurchaseModal).toHaveBeenCalledWith(250);
    });
  });

  it('CONTROL — a NON-funds refusal is never topped up, however the flag is set', async () => {
    // `topUpOnInsufficientFunds` must key on the REASON, not on "the call failed".
    // A stale price or a rate limit is not fixed by buying Buzz, and opening a
    // payment modal for one would be a spend prompt the viewer cannot act on.
    // 🔴 The REAL shape: the endpoint's own 429 carries `{ error }` and NO
    // `reason` — only service-level refusals populate it. An earlier draft of
    // this test invented `reason: 'rate_limited'`, a value the server never
    // sends, which made the case look covered while testing a fiction.
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too many purchases — please retry shortly.' }),
    })) as unknown as typeof fetch;
    const { result } = renderHook(() => useGoodPurchase());

    await act(async () => {
      await expect(
        result.current.purchase({ goodId: 'extra-slots' }, { topUpOnInsufficientFunds: true }),
      ).rejects.toThrow();
    });
    expect(openPurchaseModal).not.toHaveBeenCalled();
  });
});
