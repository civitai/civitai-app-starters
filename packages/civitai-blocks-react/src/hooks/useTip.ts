import { useCallback, useEffect, useRef, useState } from 'react';

import { useHostOrigin } from './useHostOrigin.js';
import { useBlockToken } from './useBlockToken.js';
import { generateIdempotencyKey } from '../internal/transport.js';

/**
 * Backstop timeout for the direct REST tip POST. Like {@link useGenerationResources}
 * (and unlike the postMessage hooks), this talks to the HTTP API directly, so it
 * needs its OWN bound — otherwise a hung request never rejects.
 */
const TIP_REQUEST_TIMEOUT_MS = 30_000;

/** The tip target + amount. `entityType`/`entityId` are optional context. */
export interface TipParams {
  toUserId: number;
  amount: number;
  entityType?: 'Image' | 'Collection' | 'User';
  entityId?: number;
}

/** Optional per-tip controls. */
export interface TipOptions {
  /**
   * A STABLE idempotency key for this logical tip. Reuse the SAME value when
   * RETRYING a tip whose response was lost (timeout / network drop) so the host
   * collapses it to ONE transfer instead of DOUBLE-TIPPING. Omit → the hook mints
   * a fresh key per `tip()` call (each call is a new logical tip).
   */
  idempotencyKey?: string;
}

/** The successful tip echo the endpoint returns. */
export interface TipResult {
  ok: true;
  tip: {
    toUserId: number;
    amount: number;
    entityType: string | null;
    entityId: number | null;
  };
}

export interface UseTip {
  /**
   * Send a Buzz tip from the viewer to `toUserId`. Resolves with the server's
   * echo on success; REJECTS with an `Error` (carrying the server message) on any
   * 4xx/5xx — including a `409` if a tip with the same idempotency key is still in
   * flight. A lost-response retry with the SAME `options.idempotencyKey` is
   * collapsed server-side to the first result (no double-tip).
   */
  tip: (params: TipParams, options?: TipOptions) => Promise<TipResult>;
  /** `true` while a tip POST is in flight. */
  loading: boolean;
  /** The last tip's failure, or `null`. Cleared at the start of the next `tip()`. */
  error: Error | null;
}

/**
 * Send a Buzz TIP from the viewer through the block-token-gated
 * `POST /api/v1/blocks/tip` REST endpoint (scope `social:tip:self`).
 *
 * Direct-fetch (bypasses the postMessage bridge) against the VALIDATED host
 * origin (`useHostOrigin()`) with the block bearer token (`useBlockToken().raw`)
 * — the same security-reviewed pattern as {@link useGenerationResources}. The
 * SENDER is always the token subject (server self-binds it); the block never
 * supplies a `fromUserId`.
 *
 * IDEMPOTENCY: pass a stable `options.idempotencyKey` to make a retry-after-
 * timeout safe (the server replays the first terminal result). Omitting it mints
 * a fresh key per call, so each call is a distinct logical tip.
 *
 * @example
 * const { tip, loading, error } = useTip();
 * const key = React.useId(); // stable across this component's retries
 * await tip({ toUserId: 123, amount: 50, entityType: 'Image', entityId: 99 }, { idempotencyKey: key });
 */
export function useTip(): UseTip {
  const host = useHostOrigin();
  const { raw } = useBlockToken();
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

  const tip = useCallback(
    async (params: TipParams, options?: TipOptions): Promise<TipResult> => {
      if (!host) {
        throw new Error('useTip: host origin not established yet (wait for BLOCK_INIT).');
      }
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }
      const idempotencyKey = options?.idempotencyKey ?? generateIdempotencyKey();
      const controller = new AbortController();
      inFlight.current.add(controller);
      const timeoutId = setTimeout(() => controller.abort(), TIP_REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${host}/api/v1/blocks/tip`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toUserId: params.toUserId,
            amount: params.amount,
            ...(params.entityType ? { entityType: params.entityType } : {}),
            ...(params.entityId != null ? { entityId: params.entityId } : {}),
            idempotencyKey,
          }),
          signal: controller.signal,
        });
        const bodyJson = (await res.json().catch(() => null)) as
          | (Partial<TipResult> & { error?: string })
          | null;
        if (!res.ok) {
          throw new Error(bodyJson?.error ?? `tip request failed (${res.status})`);
        }
        return bodyJson as TipResult;
      } catch (err) {
        const e =
          controller.signal.aborted && !(err instanceof Error && err.message.startsWith('tip'))
            ? new Error(
                `useTip: request aborted (timed out after ${TIP_REQUEST_TIMEOUT_MS}ms or the hook unmounted).`,
              )
            : err instanceof Error
              ? err
              : new Error(String(err));
        if (mountedRef.current) setError(e);
        throw e;
      } finally {
        clearTimeout(timeoutId);
        inFlight.current.delete(controller);
        if (mountedRef.current) setLoading(false);
      }
    },
    [host, raw],
  );

  return { tip, loading, error };
}
