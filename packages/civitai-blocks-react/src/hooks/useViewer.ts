import { useCallback, useEffect, useRef, useState } from 'react';

import type { BlockViewer } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

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
 * authoritative self-read (non-null `username`, `active`/`muted` status, current
 * `buzzBudget`).
 *
 * Fetches once on mount and exposes `refetch` for on-demand refreshes. A host
 * that never answers surfaces as an `error` after the transport's request
 * timeout — the hook never hangs. Late responses that arrive after unmount are
 * ignored (no state update).
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

  // Guards against a late response resolving after the component unmounted
  // (React would warn about a state update on an unmounted component, and the
  // work is wasted anyway).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    sendTypedRequest(getTransport(), { type: 'GET_VIEWER', payload: {} }, 'VIEWER_RESULT')
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.error || !result.viewer) {
          setError(new Error(result.error ?? 'failed to fetch viewer'));
          setLoading(false);
          return;
        }
        setViewer(result.viewer);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { viewer, loading, error, refetch };
}
