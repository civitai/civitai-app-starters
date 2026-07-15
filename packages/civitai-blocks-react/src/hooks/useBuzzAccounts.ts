import { useCallback, useEffect, useRef, useState } from 'react';

import type { BlockBuzzAccount } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * What {@link useBuzzAccounts} returns.
 */
export interface UseBuzzAccounts {
  /**
   * The viewer's all-pool balances — the three spendable pools PLUS the creator
   * payout pools (`creatorProgramBank`, `cashSettled`, …) the spendable-only
   * {@link useBuzzBalance} omits. `null` until the first successful fetch.
   */
  accounts: BlockBuzzAccount[] | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure — a host-reported error (anon viewer / missing
   * `buzz:read:self` scope / host failure) or the transport timeout. Free-text.
   * Cleared at the start of the next fetch.
   */
  error: Error | null;
  /** Re-request the balances. */
  refetch: () => void;
}

/**
 * Read the signed-in viewer's ALL-pool Buzz balances through the host-mediated
 * `GET_BUZZ_ACCOUNTS` → `BUZZ_ACCOUNTS_RESULT` bridge. Token-bound: the host
 * self-binds off the block token and reads via its `blocks.getMyBuzzAccounts`
 * mutation (scope `buzz:read:self`). Unlike {@link useBuzzBalance} (the three
 * spendable pools), this returns every pool in the block API's set — including
 * the creator payout pools — as `{ accountType, balance }` rows.
 *
 * Fetches once on mount and exposes `refetch`. A host that never answers surfaces
 * as an `error` after the transport timeout; late post-unmount responses are
 * ignored.
 *
 * @example
 * const { accounts, loading, error } = useBuzzAccounts();
 */
export function useBuzzAccounts(): UseBuzzAccounts {
  const [accounts, setAccounts] = useState<BlockBuzzAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
      { type: 'GET_BUZZ_ACCOUNTS', payload: {} },
      'BUZZ_ACCOUNTS_RESULT',
    )
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.error || !result.result) {
          setError(new Error(result.error ?? 'failed to fetch buzz accounts'));
          setLoading(false);
          return;
        }
        setAccounts(result.result.accounts);
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

  return { accounts, loading, error, refetch };
}
