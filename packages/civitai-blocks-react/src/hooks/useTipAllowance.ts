import { useCallback, useEffect, useRef, useState } from 'react';

import { useHostOrigin } from './useHostOrigin.js';
import { useBlockToken } from './useBlockToken.js';
import { useRequestSequencer } from './useRequestSequencer.js';

/**
 * Backstop timeout for the direct REST allowance GET (see {@link useTip} /
 * {@link useGenerationResources} for why direct-fetch hooks need their own bound).
 */
const TIP_ALLOWANCE_TIMEOUT_MS = 30_000;

/**
 * How long the hook waits for `useHostOrigin()` before declaring the block
 * un-embedded (#398).
 *
 * 🔴 A BOUND, NOT AN IMMEDIATE ERROR, AND THE DIFFERENCE MATTERS. The host
 * origin is absent on EVERY boot — it lands a tick or two after mount, with
 * `BLOCK_INIT` — so erroring on the first `!host` would flash a spurious error
 * on every healthy embedded block. Only its CONTINUED absence is the fault, and
 * that is what this measures.
 *
 * Equal to {@link TIP_ALLOWANCE_TIMEOUT_MS} by coincidence, not by derivation:
 * this bounds a wait for the HOST to introduce itself, that one bounds a request
 * already in flight. Two independent questions, so two constants — tuning either
 * must not silently retune the other.
 */
const HOST_ORIGIN_WAIT_MS = 30_000;

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
  /**
   * The last fetch's failure, or `null`. Cleared at the start of the next fetch.
   *
   * Also carries the NO-HOST-ORIGIN terminal state (#398): if `BLOCK_INIT` never
   * lands — a direct/unembedded load, or `InlineTransport` before bootstrap —
   * `loading` drops to `false` and this becomes a named `Error` after
   * {@link HOST_ORIGIN_WAIT_MS}, instead of the hook spinning forever.
   */
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
 * Only the LATEST request may write state: a reply superseded by a newer
 * `refetch` — or one that lands after unmount — is dropped (#392). If the host
 * origin never arrives the hook reaches a TERMINAL state rather than spinning:
 * see `error` above (#398).
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

  // 🔴 `inFlight` IS NOT A SEQUENCING GUARD, and #392's triage note read it as
  // one. It is drained only by the unmount cleanup below, so two overlapping
  // `refetch()`es neither abort each other nor correlate their replies — the
  // slower one simply wrote last. `useRequestSequencer` is what supplies the
  // latest-wins predicate; this set exists to abort on unmount and to let a
  // superseded request's socket be closed rather than left running.
  const inFlight = useRef<Set<AbortController>>(new Set());
  const seq = useRequestSequencer();
  useEffect(() => {
    const controllers = inFlight.current;
    return () => {
      for (const c of controllers) c.abort();
      controllers.clear();
    };
  }, []);

  // #398 — bounded wait for the host origin. Re-armed whenever `host` changes,
  // and cleared the moment one arrives, so the terminal error is reachable ONLY
  // when the origin is still absent a full HOST_ORIGIN_WAIT_MS after mount.
  useEffect(() => {
    if (host) return;
    const id = setTimeout(() => {
      setLoading(false);
      setError(
        new Error(
          `useTipAllowance: host origin not established after ${HOST_ORIGIN_WAIT_MS}ms (no BLOCK_INIT — the block is probably not embedded).`,
        ),
      );
    }, HOST_ORIGIN_WAIT_MS);
    return () => clearTimeout(id);
  }, [host, seq]);

  const refetch = useCallback(() => {
    // Wait for the host origin (established at BLOCK_INIT) before the first
    // fetch. The effect above is what stops this from being an eternal spinner.
    if (!host) return;
    const token = seq.begin();
    setLoading(true);
    setError(null);
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
        if (!seq.isCurrent(token)) return;
        if (!res.ok || body == null || typeof body.remaining !== 'number') {
          setError(new Error(body?.error ?? `tip-allowance request failed (${res.status})`));
          setLoading(false);
          return;
        }
        setAllowance({ cap: body.cap ?? 0, spent: body.spent ?? 0, remaining: body.remaining });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!seq.isCurrent(token)) return;
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
  }, [host, raw, seq]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { allowance, loading, error, refetch };
}
