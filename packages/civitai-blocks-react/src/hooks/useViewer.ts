import { useCallback, useEffect, useState } from 'react';

import type { BlockViewer } from '@civitai/app-sdk/blocks';

import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';
import { useRequestSequencer } from './useRequestSequencer.js';

/**
 * What {@link useViewer} returns.
 */
export interface UseViewer {
  /** The signed-in viewer, or `null` until the first successful fetch. */
  viewer: BlockViewer | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure — a host-reported error (anon / banned viewer /
   * missing scope / host failure) or the transport timeout when the host never
   * answers. Cleared at the start of the next fetch.
   */
  error: Error | null;
  /** Re-request the viewer. */
  refetch: () => void;
}

/**
 * Read the signed-in viewer (id / username / status + optional buzzBudget)
 * through the host-mediated `GET_VIEWER` → `VIEWER_RESULT` bridge. Token-bound:
 * the host resolves the viewer from the block token and reads via its
 * `blocks.getMyViewer` tRPC mutation — the block never touches the viewer API or
 * credentials directly (same trust model as {@link useBuzzBalance}).
 *
 * Distinct from `useBlockContext().viewer`, which is the coarse BLOCK_INIT-time
 * snapshot ({@link ViewerInfo}, `status` optional): `useViewer` is the on-demand
 * authoritative self-read (`active`/`muted` status + the viewer's current
 * `buzzBudget`). `username` and `buzzBudget` are surfaced as-is and may be `null`
 * (a viewer with no handle / a token lacking the budget claim) — the block
 * handles the null case.
 *
 * Fetches once on mount and exposes `refetch` for on-demand refreshes. A host
 * that never answers surfaces as an `error` after the transport's request
 * timeout — the hook never hangs. Only the LATEST request may write state: a
 * reply superseded by a newer `refetch` — or one that lands after unmount — is
 * dropped (#392).
 *
 * @example
 * const { viewer, loading, error, refetch } = useViewer();
 * if (loading) return <Spinner />;
 * if (error) return <RetryButton onClick={refetch} />;
 * return <span>{viewer?.username}</span>;
 */
export function useViewer(): UseViewer {
  const [viewer, setViewer] = useState<BlockViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Latest-wins + unmount guard in one predicate (#392): a reply may write state
  // only if it answers the request this hook is CURRENTLY waiting for. A bare
  // mount check would let a superseded `refetch`'s slow reply overwrite newer
  // state — nothing unmounted, so it passes.
  const seq = useRequestSequencer();

  const refetch = useCallback(() => {
    const token = seq.begin();
    setLoading(true);
    setError(null);
    sendTypedRequest(getTransport(), { type: 'GET_VIEWER', payload: {} }, 'VIEWER_RESULT')
      .then((result) => {
        if (!seq.isCurrent(token)) return;
        if (result.error || !result.viewer) {
          // `||`, not `??`: `isValidViewerResult` gates `error` on SHAPE only, so a
          // host `error: ''` is a VALID reply that reaches here. `??` replaces only
          // null/undefined, so it would surface an Error with an EMPTY message.
          setError(new Error(result.error || 'failed to fetch viewer'));
          setLoading(false);
          return;
        }
        setViewer(result.viewer);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!seq.isCurrent(token)) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [seq]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { viewer, loading, error, refetch };
}
