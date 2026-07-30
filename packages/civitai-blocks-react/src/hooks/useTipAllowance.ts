import { useCallback, useEffect, useRef, useState } from 'react';

import { useHostOrigin } from './useHostOrigin.js';
import { useBlockToken } from './useBlockToken.js';

/**
 * Backstop timeout for the direct REST allowance GET (see {@link useTip} /
 * {@link useGenerationResources} for why direct-fetch hooks need their own bound).
 */
const TIP_ALLOWANCE_TIMEOUT_MS = 30_000;

/** The viewer's daily tip allowance, in Buzz. */
export interface TipAllowance {
  /** The per-user daily tip ceiling. */
  cap: number;
  /**
   * Net Buzz reserved toward tips today (reservation-based, so it can briefly
   * over-count between a reserve and its refund — the safe direction).
   */
  spent: number;
  /** `cap - spent`, clamped at 0 — the amount the viewer may still tip today. */
  remaining: number;
}

export interface UseTipAllowance {
  /** The current allowance, or `null` until the first successful fetch. */
  allowance: TipAllowance | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /** The last fetch's failure, or `null`. Cleared at the start of the next fetch. */
  error: Error | null;
  /** Re-read the allowance (e.g. after the viewer tips). */
  refetch: () => void;
}

/**
 * Read the viewer's REAL remaining daily tip allowance `{ cap, spent, remaining }`
 * through the block-token-gated `GET /api/v1/blocks/tip-allowance` REST endpoint
 * (scope `social:tip:self` — the SAME scope the app already holds to tip, so no
 * manifest change). Direct-fetch against the validated host origin with the block
 * bearer token, the same pattern as {@link useGenerationResources}.
 *
 * Lets a block show a genuinely-tracked remaining allowance and disable the tip
 * button at the true ceiling — instead of a dead client-side full-cap guess
 * (`localStorage` is inert in the opaque-origin sandbox). Fetches once on mount
 * and exposes `refetch` (call it after a successful `useTip().tip(...)`).
 *
 * @example
 * const { allowance, refetch } = useTipAllowance();
 * // allowance?.remaining — Buzz the viewer may still tip today
 */
export function useTipAllowance(): UseTipAllowance {
  const host = useHostOrigin();
  const { raw } = useBlockToken();
  const [allowance, setAllowance] = useState<TipAllowance | null>(null);
  const [loading, setLoading] = useState(true);
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

  const refetch = useCallback(() => {
    // Wait for the host origin (established at BLOCK_INIT) before the first fetch.
    if (!host) return;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    const controller = new AbortController();
    inFlight.current.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), TIP_ALLOWANCE_TIMEOUT_MS);
    fetch(`${host}/api/v1/blocks/tip-allowance`, {
      headers: { Authorization: `Bearer ${raw}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | (Partial<TipAllowance> & { error?: string })
          | null;
        if (!mountedRef.current) return;
        if (!res.ok || body == null || typeof body.remaining !== 'number') {
          setError(new Error(body?.error ?? `tip-allowance request failed (${res.status})`));
          setLoading(false);
          return;
        }
        setAllowance({ cap: body.cap ?? 0, spent: body.spent ?? 0, remaining: body.remaining });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(
          controller.signal.aborted
            ? new Error(
                `useTipAllowance: request aborted (timed out after ${TIP_ALLOWANCE_TIMEOUT_MS}ms or the hook unmounted).`,
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
  }, [host, raw]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { allowance, loading, error, refetch };
}
