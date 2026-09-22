import { useCallback, useEffect, useState } from 'react';

import type { BlockWildcardPack, BlockWildcardPackErrorCode } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';
import { useRequestSequencer } from './useRequestSequencer.js';

export type { BlockWildcardPack, BlockWildcardPackErrorCode };

/**
 * A wildcard-pack import failure. Unlike the buzz bridges' free-text errors, the
 * host returns a DISCRIMINATED code — this error carries it on `.code` so a block
 * can branch on the exact reason (`busy` is retryable; `too-large`/`forbidden`/
 * `not-found`/`parse-failed` are terminal). `.message` equals the code.
 */
export class WildcardPackError extends Error {
  readonly code: BlockWildcardPackErrorCode;
  constructor(code: BlockWildcardPackErrorCode) {
    super(code);
    this.name = 'WildcardPackError';
    this.code = code;
  }
}

/**
 * What {@link useWildcardPack} returns.
 */
export interface UseWildcardPack {
  /** The parsed pack, or `null` until the first successful fetch. */
  pack: BlockWildcardPack | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure as a {@link WildcardPackError} (`.code` is the
   * discriminated reason), or a plain `Error` on a transport timeout. Cleared at
   * the start of the next fetch.
   */
  error: Error | null;
  /** Re-request the pack. */
  refetch: () => void;
}

/**
 * Import a wildcard pack's parsed prompt lists by model-version id, through the
 * host-mediated `GET_WILDCARD_PACK` → `WILDCARD_PACK_RESULT` bridge.
 * TOKEN-INDEPENDENT (no block scope): the host resolves + fetches + unzips +
 * parses the pack in the viewer's authenticated page session — enforcing every
 * real download gate — and returns only the parsed JSON. The untrusted iframe
 * never sees the session, the signed URL, or the raw bytes.
 *
 * Fetches on mount and whenever `modelVersionId` changes; exposes `refetch` (e.g.
 * to retry a `busy` result). On failure `error` is a {@link WildcardPackError}
 * whose `.code` is the discriminated reason. A non-positive `modelVersionId` is a
 * no-op (nothing to fetch). A host that never answers surfaces as an `error`
 * after the transport timeout. Only the LATEST request may write state: a reply
 * superseded by a newer `refetch` / `modelVersionId` change — or one that lands
 * after unmount — is dropped (#392).
 *
 * @example
 * const { pack, loading, error } = useWildcardPack(modelVersionId);
 * if (error instanceof WildcardPackError && error.code === 'busy') return <RetryLater />;
 */
export function useWildcardPack(modelVersionId: number): UseWildcardPack {
  const [pack, setPack] = useState<BlockWildcardPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Latest-wins + unmount guard in one predicate (#392): a reply may write state
  // only if it answers the request this hook is CURRENTLY waiting for. A bare
  // mount check would let a superseded request's slow reply overwrite newer
  // state — nothing unmounted, so it passes.
  const seq = useRequestSequencer();

  const valid = Number.isInteger(modelVersionId) && modelVersionId > 0;

  const refetch = useCallback(() => {
    // `begin()` runs BEFORE the validity gate on purpose: moving to a
    // non-positive id must also SUPERSEDE an in-flight request for the previous
    // id, or that reply would land and paint a pack the hook no longer wants.
    const token = seq.begin();
    if (!valid) {
      // Nothing to fetch — don't summon a host round-trip that would only time
      // out (the host drops a non-positive modelVersionId).
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    sendTypedRequest(
      getTransport(),
      { type: 'GET_WILDCARD_PACK', payload: { modelVersionId } },
      'WILDCARD_PACK_RESULT',
    )
      .then((result) => {
        if (!seq.isCurrent(token)) return;
        if (result.error || !result.pack) {
          // 🔴 KEEP `??` HERE — do NOT "fix" this to `||` like the sibling hooks.
          // Unlike every other reply guard, `isValidWildcardPackResult` constrains
          // `error` to the CLOSED `WILDCARD_PACK_ERROR_CODES` set, so `error: ''` is
          // rejected upstream and can never reach this line. The only value `??`
          // replaces here is a genuinely absent `error` (the `!result.pack` arm),
          // which is exactly what the `'parse-failed'` code is for.
          setError(new WildcardPackError(result.error ?? 'parse-failed'));
          setLoading(false);
          return;
        }
        setPack(result.pack);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!seq.isCurrent(token)) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [valid, modelVersionId, seq]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { pack, loading, error, refetch };
}
