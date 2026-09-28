import { useCallback, useEffect, useRef, useState } from 'react';

import { useBlockToken } from './useBlockToken.js';
import { useHostOrigin } from './useHostOrigin.js';
import { useRequestSequencer } from './useRequestSequencer.js';

/**
 * Backstop timeout for the direct REST entitlements GET (see {@link useTip} /
 * {@link useGenerationResources} for why direct-fetch hooks need their own bound).
 */
const ENTITLEMENTS_TIMEOUT_MS = 30_000;

/**
 * How long the hook waits for `useHostOrigin()` before declaring the block
 * un-embedded. A BOUND, not an immediate error: the host origin is absent on
 * EVERY boot and lands a tick or two after mount with `BLOCK_INIT`, so erroring
 * on the first `!host` would flash a spurious error on every healthy block.
 * Only its CONTINUED absence is the fault.
 *
 * Equal to {@link ENTITLEMENTS_TIMEOUT_MS} by coincidence, not derivation: this
 * bounds a wait for the HOST to introduce itself, that one bounds a request
 * already in flight. Two constants so tuning either cannot retune the other.
 */
const HOST_ORIGIN_WAIT_MS = 30_000;

/** One thing the viewer owns, as the platform recorded it. */
export interface Entitlement {
  /** The `id` of the good from this app's manifest. */
  goodId: string;
  /** `good` for an ordinary purchase, `app_unlock` for a paid-app unlock. */
  kind: string;
  /** The opaque payload the manifest declared. The platform never interprets it. */
  payload: Record<string, unknown>;
  grantedAt: string;
}

export interface UseEntitlements {
  /** What the viewer owns, or `null` until the first successful fetch. */
  entitlements: Entitlement[] | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure, or `null`. Cleared at the start of the next fetch.
   * Also carries the NO-HOST-ORIGIN terminal state: if `BLOCK_INIT` never lands,
   * `loading` drops to `false` and this becomes a named `Error` after
   * {@link HOST_ORIGIN_WAIT_MS} rather than the hook spinning forever.
   */
  error: Error | null;
  /** Re-read entitlements (e.g. immediately after a successful purchase). */
  refetch: () => void;
  /**
   * `true` if the viewer owns `goodId`. 🔴 Returns `false` while
   * `entitlements` is still `null`, which is ALSO what a failed read looks
   * like — so never gate paid content on this alone without checking
   * `loading` and `error`. A refused read renders as "you own nothing", and
   * treating that as authoritative takes away something the viewer paid for.
   */
  owns: (goodId: string) => boolean;
}

/**
 * Read what the viewer owns FROM THIS APP through the block-token-gated
 * `GET /api/v1/blocks/entitlements` REST endpoint (scope `goods:read:self`).
 *
 * The reply is scoped server-side to the calling app's own `appBlockId`, so an
 * app can only ever see what it itself sold — which is why this scope is
 * consent-EXEMPT: there is no third-party data to consent to. A read-only app
 * that just wants to render "you own this" therefore needs no purchase power
 * and triggers no re-consent prompt; only `goods:purchase:self` does.
 *
 * Revoked entitlements are excluded by the server — "what do I own" must not
 * include what was taken back.
 *
 * Only the LATEST request may write state: a reply superseded by a newer
 * `refetch`, or one landing after unmount, is dropped.
 *
 * @example
 * const { owns, loading, error, refetch } = useEntitlements();
 * if (loading) return <Spinner />;
 * if (error) return <RetryNotice onRetry={refetch} />;   // NOT "you own nothing"
 * return owns('extra-slots') ? <Unlocked /> : <BuyButton onDone={refetch} />;
 */
export function useEntitlements(): UseEntitlements {
  const host = useHostOrigin();
  const { raw } = useBlockToken();
  const [entitlements, setEntitlements] = useState<Entitlement[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Not a sequencing guard: drained only by the unmount cleanup, so it exists
  // to abort on unmount and let a superseded request's socket close.
  // `useRequestSequencer` supplies the latest-wins predicate.
  const inFlight = useRef<Set<AbortController>>(new Set());
  const seq = useRequestSequencer();
  useEffect(() => {
    const controllers = inFlight.current;
    return () => {
      for (const c of controllers) c.abort();
      controllers.clear();
    };
  }, []);

  // Bounded wait for the host origin. Re-armed whenever `host` changes and
  // cleared the moment one arrives, so the terminal error is reachable ONLY
  // when the origin is still absent a full HOST_ORIGIN_WAIT_MS after mount.
  useEffect(() => {
    if (host) return;
    const id = setTimeout(() => {
      setLoading(false);
      setError(
        new Error(
          `useEntitlements: host origin not established after ${HOST_ORIGIN_WAIT_MS}ms (no BLOCK_INIT — the block is probably not embedded).`,
        ),
      );
    }, HOST_ORIGIN_WAIT_MS);
    return () => clearTimeout(id);
  }, [host, seq]);

  const refetch = useCallback(() => {
    if (!host) return;
    const token = seq.begin();
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    inFlight.current.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), ENTITLEMENTS_TIMEOUT_MS);
    fetch(`${host}/api/v1/blocks/entitlements`, {
      headers: { Authorization: `Bearer ${raw}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { entitlements?: Entitlement[]; error?: string }
          | null;
        if (!seq.isCurrent(token)) return;
        if (!res.ok || body == null || !Array.isArray(body.entitlements)) {
          throw new Error(body?.error ?? `entitlements request failed (${res.status})`);
        }
        setEntitlements(body.entitlements);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!seq.isCurrent(token)) return;
        setError(
          controller.signal.aborted
            ? new Error(
                `useEntitlements: request aborted (timed out after ${ENTITLEMENTS_TIMEOUT_MS}ms or the hook unmounted).`,
              )
            : err instanceof Error
              ? err
              : new Error(String(err)),
        );
        setLoading(false);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        inFlight.current.delete(controller);
      });
  }, [host, raw, seq]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const owns = useCallback(
    (goodId: string) => (entitlements ?? []).some((e) => e.goodId === goodId),
    [entitlements],
  );

  return { entitlements, loading, error, refetch, owns };
}
