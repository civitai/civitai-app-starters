import { useCallback, useEffect, useState } from 'react';

import type { BlockBuzzAccount } from '@civitai/app-sdk/blocks';

import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';
import { useRequestSequencer } from './useRequestSequencer.js';

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
 * as an `error` after the transport timeout. Only the LATEST request may write
 * state: a reply superseded by a newer `refetch` — or one that lands after
 * unmount — is dropped (#392).
 *
 * @example
 * const { accounts, loading, error } = useBuzzAccounts();
 */
export function useBuzzAccounts(): UseBuzzAccounts {
  const [accounts, setAccounts] = useState<BlockBuzzAccount[] | null>(null);
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
    sendTypedRequest(
      getTransport(),
      { type: 'GET_BUZZ_ACCOUNTS', payload: {} },
      'BUZZ_ACCOUNTS_RESULT',
    )
      .then((result) => {
        if (!seq.isCurrent(token)) return;
        if (result.error || !result.result) {
          // `||`, not `??`: the reply validator gates `error` on SHAPE only, so a
          // host `error: ''` is a VALID reply that reaches here. `??` replaces only
          // null/undefined, so it would surface an Error with an EMPTY message.
          setError(new Error(result.error || 'failed to fetch buzz accounts'));
          setLoading(false);
          return;
        }
        setAccounts(result.result.accounts);
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

  return { accounts, loading, error, refetch };
}
