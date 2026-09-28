import { useCallback, useEffect, useRef, useState } from 'react';

import { generateIdempotencyKey } from '../transport/transport.js';
import { useBlockToken } from './useBlockToken.js';
import { useBuzzPurchase } from './useBuzzPurchase.js';
import { useHostOrigin } from './useHostOrigin.js';

/**
 * Backstop timeout for the direct REST purchase POST. Like {@link useTip} (and
 * unlike the postMessage hooks), this talks to the HTTP API directly, so it
 * needs its OWN bound — otherwise a hung request never rejects.
 */
const GOOD_PURCHASE_TIMEOUT_MS = 30_000;

/** Which good to buy, and optionally the price the app showed the viewer. */
export interface GoodPurchaseParams {
  /** The `id` of a good declared in this app's approved manifest. */
  goodId: string;
  /**
   * The price the app DISPLAYED. Optional, and worth passing: the server
   * charges its OWN price and refuses when this disagrees, so sending it turns
   * "the app showed a stale price" into a clean refusal instead of a viewer
   * being charged an amount they never saw.
   */
  expectedPriceBuzz?: number;
}

/** Optional per-purchase controls. */
export interface GoodPurchaseOptions {
  /**
   * A STABLE idempotency key for this logical purchase. Reuse the SAME value
   * when RETRYING a purchase whose response was lost (timeout / network drop)
   * so the server replays the first terminal result instead of charging twice.
   * Omit → a fresh key per `purchase()` call.
   */
  idempotencyKey?: string;
  /**
   * When the viewer cannot afford the good, open the host's Buzz top-up modal
   * and — only if they actually bought Buzz — retry the purchase ONCE.
   * Default `false`, so the refusal surfaces and the app decides.
   *
   * 🔴 THE RETRY REUSES THE SAME IDEMPOTENCY KEY, DELIBERATELY. The server's
   * own comment on this path is that an `insufficient_funds` refusal leaves the
   * key FREE precisely because "an identical retry CAN reach a different
   * verdict — a top-up"; it caches terminal results, not this one. Minting a
   * fresh key here would work too, but it would make a lost response on the
   * retry unrecoverable, which is the thing idempotency keys exist to prevent.
   */
  topUpOnInsufficientFunds?: boolean;
}

/** One entitlement, as the platform records it. */
export interface GoodEntitlement {
  goodId: string;
  kind: string;
  payload: Record<string, unknown>;
  grantedAt: string;
}

/** The successful purchase echo the endpoint returns. */
export interface GoodPurchaseResult {
  ok: true;
  purchase: { id: string; goodId: string; priceBuzz: number };
  entitlement: GoodEntitlement;
}

/**
 * A refusal the server produced deliberately, as opposed to a transport
 * failure. `reason` is the machine-readable discriminator — branch on it rather
 * than on `message`, which is viewer-facing copy and will be reworded.
 */
export class GoodPurchaseRefusal extends Error {
  readonly status: number;
  readonly reason: string | undefined;
  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = 'GoodPurchaseRefusal';
    this.status = status;
    this.reason = reason;
  }
}

export interface UseGoodPurchase {
  /**
   * Buy a manifest-declared good for the viewer. Resolves with the server's
   * echo, including the entitlement it granted. REJECTS with a
   * {@link GoodPurchaseRefusal} on any 4xx/5xx — read `reason` to tell
   * `insufficient_funds` from a stale price or a rate limit.
   */
  purchase: (
    params: GoodPurchaseParams,
    options?: GoodPurchaseOptions,
  ) => Promise<GoodPurchaseResult>;
  /** `true` while a purchase POST is in flight. */
  loading: boolean;
  /** The last purchase's failure, or `null`. Cleared at the start of the next call. */
  error: Error | null;
}

/**
 * Buy a DIGITAL GOOD for the viewer through the block-token-gated
 * `POST /api/v1/blocks/goods/purchase` REST endpoint (scope
 * `goods:purchase:self`).
 *
 * Direct-fetch against the VALIDATED host origin (`useHostOrigin()`) with the
 * block bearer token, the same security-reviewed pattern as {@link useTip}. The
 * BUYER is always the token subject — the server self-binds it and the block
 * never supplies a user id, so there is no client-supplied value on the money
 * path.
 *
 * 🔴 BUYING A GOOD AND BUYING BUZZ ARE OPPOSITE DIRECTIONS, AND THIS HOOK
 * TOUCHES BOTH. A good is Buzz flowing FROM the viewer TO the app owner. The
 * top-up modal this hook can open ({@link useBuzzPurchase}) is fiat flowing INTO
 * the viewer's balance. They are different rails with different ledgers; the
 * only thing they share is that one can unblock the other.
 *
 * ⚠️ THE PLATFORM RENDERS NO CONFIRMATION FOR THE PURCHASE ITSELF. This is a
 * plain authed POST, so whatever confirm UI the viewer sees is the APP's. Spend
 * is bounded by the good's manifest-reviewed price and the viewer's daily cap,
 * but a good can be priced near that cap where a tip cannot — so show the price
 * and get an explicit action before calling this.
 *
 * @example
 * const { purchase, loading, error } = useGoodPurchase();
 * const { entitlement } = await purchase(
 *   { goodId: 'extra-slots', expectedPriceBuzz: 250 },
 *   { topUpOnInsufficientFunds: true },
 * );
 */
export function useGoodPurchase(): UseGoodPurchase {
  const host = useHostOrigin();
  const { raw } = useBlockToken();
  const { openPurchaseModal } = useBuzzPurchase();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  const inFlight = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    mountedRef.current = true;
    const controllers = inFlight.current;
    return () => {
      mountedRef.current = false;
      for (const c of controllers) c.abort();
      controllers.clear();
    };
  }, []);

  const postOnce = useCallback(
    async (
      params: GoodPurchaseParams,
      idempotencyKey: string,
    ): Promise<GoodPurchaseResult> => {
      const controller = new AbortController();
      inFlight.current.add(controller);
      const timeoutId = setTimeout(() => controller.abort(), GOOD_PURCHASE_TIMEOUT_MS);
      try {
        const res = await fetch(`${host}/api/v1/blocks/goods/purchase`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goodId: params.goodId,
            ...(params.expectedPriceBuzz != null
              ? { expectedPriceBuzz: params.expectedPriceBuzz }
              : {}),
            idempotencyKey,
          }),
          signal: controller.signal,
        });
        const bodyJson = (await res.json().catch(() => null)) as
          | (Partial<GoodPurchaseResult> & { error?: string; reason?: string })
          | null;
        if (!res.ok) {
          throw new GoodPurchaseRefusal(
            bodyJson?.error ?? `purchase request failed (${res.status})`,
            res.status,
            bodyJson?.reason,
          );
        }
        return bodyJson as GoodPurchaseResult;
      } finally {
        clearTimeout(timeoutId);
        inFlight.current.delete(controller);
      }
    },
    [host, raw],
  );

  const purchase = useCallback(
    async (
      params: GoodPurchaseParams,
      options?: GoodPurchaseOptions,
    ): Promise<GoodPurchaseResult> => {
      if (!host) {
        throw new Error(
          'useGoodPurchase: host origin not established yet (wait for BLOCK_INIT).',
        );
      }
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }
      const idempotencyKey = options?.idempotencyKey ?? generateIdempotencyKey();
      try {
        try {
          return await postOnce(params, idempotencyKey);
        } catch (first) {
          const canTopUp =
            options?.topUpOnInsufficientFunds === true &&
            first instanceof GoodPurchaseRefusal &&
            first.reason === 'insufficient_funds';
          if (!canTopUp) throw first;

          // Only retry if the viewer ACTUALLY bought Buzz. `purchased: false`
          // is the ordinary "they closed the modal" case, and retrying it would
          // just reproduce the same refusal — so the original refusal is what
          // the app should see.
          const { purchased } = await openPurchaseModal(params.expectedPriceBuzz);
          if (!purchased) throw first;
          return await postOnce(params, idempotencyKey);
        }
      } catch (err) {
        const e =
          err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(e);
        throw e;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [host, openPurchaseModal, postOnce],
  );

  return { purchase, loading, error };
}
