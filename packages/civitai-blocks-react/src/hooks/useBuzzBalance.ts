import { useCallback, useEffect, useRef, useState } from 'react';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * The viewer's per-pool Buzz balance, in the domain-clamped set a Civitai App
 * can read (mirrors `@civitai/app-sdk/blocks`' `BuzzAccountType`). Never
 * includes the platform-internal pools (`red`/`purple`).
 */
export interface BuzzBalance {
  blue: number;
  green: number;
  yellow: number;
}

/**
 * What {@link useBuzzBalance} returns.
 */
export interface UseBuzzBalance {
  /** The viewer's per-pool balance, or `null` until the first successful fetch. */
  balance: BuzzBalance | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure — a host-reported error (anon viewer / missing
   * scope / host failure) or the transport timeout when the host never answers.
   * Cleared at the start of the next fetch.
   */
  error: Error | null;
  /** Re-request the balance (e.g. after a generation debits it). */
  refetch: () => void;
}

/**
 * Read the signed-in viewer's per-pool Buzz balance ({ blue, green, yellow })
 * through the host-mediated `GET_BUZZ_BALANCE` → `BUZZ_BALANCE_RESULT` bridge.
 * Token-bound: the host resolves the viewer from the block token and reads the
 * balance via its `blocks.getMyBuzzBalance` tRPC mutation — the block never
 * touches the balance API or credentials directly (same trust model as
 * `useBuzzWorkflow` / `useBuzzPurchase`).
 *
 * Fetches once on mount and exposes `refetch` for on-demand refreshes (e.g.
 * after a generation debits the balance). A host that never answers surfaces as
 * an `error` after the transport's request timeout — the hook never hangs. Late
 * responses that arrive after unmount are ignored (no state update).
 *
 * @example
 * const { balance, loading, error, refetch } = useBuzzBalance();
 * if (loading) return <Spinner />;
 * if (error) return <RetryButton onClick={refetch} />;
 * return <span>Yellow: {balance?.yellow ?? 0}</span>;
 */
export function useBuzzBalance(): UseBuzzBalance {
  const [balance, setBalance] = useState<BuzzBalance | null>(null);
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
    sendTypedRequest(
      getTransport(),
      { type: 'GET_BUZZ_BALANCE', payload: {} },
      'BUZZ_BALANCE_RESULT',
    )
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.error || !result.balance) {
          setError(new Error(result.error ?? 'failed to fetch buzz balance'));
          setLoading(false);
          return;
        }
        setBalance(result.balance);
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

  return { balance, loading, error, refetch };
}
