import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppWorkflow, AppWorkflowsParams } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

export type { AppWorkflow, AppWorkflowsParams };

/**
 * What {@link useAppWorkflows} returns.
 */
export interface UseAppWorkflows {
  /** The current page's workflows (newest-first). `[]` until the first successful fetch. */
  workflows: AppWorkflow[];
  /**
   * The next-page cursor, or `null` when there's no further page. Pass it back as
   * `params.cursor` on a subsequent call to page forward.
   */
  cursor: string | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure — a host-reported error (anon viewer / missing
   * `ai:write:budgeted` scope / rate-limit / host failure) or the transport
   * timeout. Free-text. Cleared at the start of the next fetch. A failed
   * {@link cancel} does NOT set this (it rejects its own promise instead).
   */
  error: Error | null;
  /** Re-request the current page. */
  refetch: () => void;
  /**
   * Cancel ONE workflow in this app's subqueue (host `CANCEL_APP_WORKFLOW`). The
   * host is FAIL-CLOSED — it verifies the viewer/app own the workflow before the
   * orchestrator cancel — so a block can only cancel a gen it submitted. Resolves
   * once the host confirms the terminal state, which is OPTIMISTICALLY spliced
   * into `workflows` in place (no refetch round-trip); rejects with the host's
   * free-text error on failure (FORBIDDEN / transport). Unmount-safe.
   */
  cancel: (workflowId: string) => Promise<void>;
}

/**
 * Read (and cancel within) the calling app's OWN generator SUBQUEUE — the
 * tag-scoped list of generations THIS app produced for the viewer, newest-first —
 * through the host-mediated `QUERY_APP_WORKFLOWS` → `APP_WORKFLOWS_RESULT` and
 * `CANCEL_APP_WORKFLOW` → `CANCEL_APP_WORKFLOW_RESULT` bridges. Token-bound: the
 * host self-binds the account off the block token and FORCES the per-app tag
 * filter (scope `ai:write:budgeted`, same trust boundary as submit) — the block
 * can never widen the filter or reach another user's / their personal queue.
 *
 * Fetches on mount and whenever `params` change (by value), and exposes `refetch`.
 * A host that never answers surfaces as an `error` after the transport's request
 * timeout — the hook never hangs. Late responses that arrive after unmount are
 * ignored.
 *
 * @example
 * const { workflows, cursor, loading, error, cancel } = useAppWorkflows({ limit: 20 });
 * // …render each workflow's images; await cancel(w.workflowId) on a Cancel click.
 */
export function useAppWorkflows(params?: AppWorkflowsParams): UseAppWorkflows {
  const [workflows, setWorkflows] = useState<AppWorkflow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Serialize the params to a stable key so `refetch`'s identity only changes
  // when the params VALUE changes (not on every render's fresh object). The
  // callback re-parses the key so it closes over NOTHING but the key.
  const paramsKey = params ? JSON.stringify(params) : '';

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    const parsed = paramsKey ? (JSON.parse(paramsKey) as AppWorkflowsParams) : undefined;
    const payload = parsed ? { params: parsed } : {};
    sendTypedRequest(
      getTransport(),
      { type: 'QUERY_APP_WORKFLOWS', payload },
      'APP_WORKFLOWS_RESULT',
    )
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.error || !result.result) {
          // `||`, not `??`: the reply validator gates `error` on SHAPE only, so a
          // host `error: ''` is a VALID reply that reaches here. `??` replaces only
          // null/undefined, so it would surface an Error with an EMPTY message.
          setError(new Error(result.error || 'failed to fetch app workflows'));
          setLoading(false);
          return;
        }
        setWorkflows(result.result.workflows);
        setCursor(result.result.cursor ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [paramsKey]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const cancel = useCallback(async (workflowId: string): Promise<void> => {
    const reply = await sendTypedRequest(
      getTransport(),
      { type: 'CANCEL_APP_WORKFLOW', payload: { workflowId } },
      'CANCEL_APP_WORKFLOW_RESULT',
    );
    if (reply.error || !reply.result) {
      // `||`, not `??`: the reply validator gates `error` on SHAPE only, so a host
      // `error: ''` is a VALID reply that reaches here. `??` replaces only
      // null/undefined, so it would throw an Error with an EMPTY message.
      throw new Error(reply.error || 'failed to cancel workflow');
    }
    const canceled = reply.result.workflow;
    // Optimistically splice the terminal (canceled) projection into the current
    // page in place — no refetch round-trip. Functional update so it never races
    // a concurrent refetch's stale closure. Only touches the row if it's present
    // (the host returns the canceled workflow regardless).
    if (mountedRef.current) {
      setWorkflows((prev) =>
        prev.map((w) => (w.workflowId === canceled.workflowId ? canceled : w)),
      );
    }
  }, []);

  return { workflows, cursor, loading, error, refetch, cancel };
}
