import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BlockDailyCompensationParams,
  BlockDailyCompensationResource,
} from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * What {@link useDailyCompensation} returns.
 */
export interface UseDailyCompensation {
  /**
   * Per-modelVersion generation-compensation rows for the month of the requested
   * `date`, or `null` until the first successful fetch. `data`/`cashData`
   * `createdAt` are `YYYY-MM-DD` day-strings (NOT rehydrated to `Date`).
   */
  resources: BlockDailyCompensationResource[] | null;
  /**
   * Whether the viewer has ANY published resource — `false` distinguishes "no
   * published models" from "published models that earned nothing this month"
   * (both give `resources: []`). `null` until the first successful fetch.
   */
  hasPublishedResources: boolean | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure — a host-reported error (anon viewer / missing
   * `buzz:read:self` scope / a ClickHouse blip surfaced as a retryable error) or
   * the transport timeout. Free-text. Cleared at the start of the next fetch.
   */
  error: Error | null;
  /** Re-request the compensation for the current `params`. */
  refetch: () => void;
}

/**
 * Read the signed-in viewer's per-modelVersion generation compensation for the
 * MONTH containing `params.date`, through the host-mediated
 * `GET_DAILY_COMPENSATION` → `DAILY_COMPENSATION_RESULT` bridge. Token-bound: the
 * host self-binds off the block token and reads via its
 * `blocks.getMyDailyCompensation` mutation (scope `buzz:read:self`).
 *
 * Fetches on mount and whenever `params` change (by value), and exposes `refetch`.
 * A host that never answers surfaces as an `error` after the transport timeout;
 * late post-unmount responses are ignored.
 *
 * @example
 * const { resources, hasPublishedResources } = useDailyCompensation({ date: '2026-07-01' });
 */
export function useDailyCompensation(params: BlockDailyCompensationParams): UseDailyCompensation {
  const [resources, setResources] = useState<BlockDailyCompensationResource[] | null>(null);
  const [hasPublishedResources, setHasPublishedResources] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stable params key so `refetch`'s identity only changes when the params VALUE
  // changes; the callback re-parses it so it closes over nothing but the key.
  const paramsKey = JSON.stringify(params);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    const parsed = JSON.parse(paramsKey) as BlockDailyCompensationParams;
    sendTypedRequest(
      getTransport(),
      { type: 'GET_DAILY_COMPENSATION', payload: { params: parsed } },
      'DAILY_COMPENSATION_RESULT',
    )
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.error || !result.result) {
          // `||`, not `??`: the reply validator gates `error` on SHAPE only, so a
          // host `error: ''` is a VALID reply that reaches here. `??` replaces only
          // null/undefined, so it would surface an Error with an EMPTY message.
          setError(new Error(result.error || 'failed to fetch daily compensation'));
          setLoading(false);
          return;
        }
        setResources(result.result.resources);
        setHasPublishedResources(result.result.hasPublishedResources);
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

  return { resources, hasPublishedResources, loading, error, refetch };
}
