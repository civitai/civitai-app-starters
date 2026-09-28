import { act, renderHook } from '@testing-library/react';
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
  });

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
