import { useCallback, useEffect, useState } from 'react';

import type { BlockBuzzTransaction, BlockBuzzTransactionsParams } from '@civitai/app-sdk/blocks';

import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';
import { useRequestSequencer } from './useRequestSequencer.js';

/**
 * One Buzz-transaction row, REHYDRATED for block consumption: identical to the
 * wire {@link BlockBuzzTransaction} except `date` is a `Date` (rehydrated from
 * the ISO string / `Date` the host sends — see the DATE WIRE CAVEAT on
 * `BlockBuzzTransaction`).
 */
export interface BuzzTransaction extends Omit<BlockBuzzTransaction, 'date'> {
  date: Date;
}

/**
 * What {@link useBuzzTransactions} returns.
 */
export interface UseBuzzTransactions {
  /** The current page's rows (newest-first), or `null` until the first successful fetch. */
  transactions: BuzzTransaction[] | null;
  /**
   * The next-page cursor (ISO-8601), or `null` when there's no further page.
   * Pass it back as `params.cursor` on a subsequent call to page forward.
   */
  cursor: string | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure — a host-reported error (anon viewer / missing
   * `buzz:read:self` scope / host failure) or the transport timeout. Free-text
   * (the buzz bridge does not use a discriminated error enum). Cleared at the
   * start of the next fetch.
   */
  error: Error | null;
  /** Re-request the current page. */
  refetch: () => void;
}

/** Rehydrate the host's `date`/`cursor` (a `Date` instance OR an ISO string). */
function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string);
}
function toIso(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Read the signed-in viewer's Buzz-transaction ledger through the host-mediated
 * `GET_BUZZ_TRANSACTIONS` → `BUZZ_TRANSACTIONS_RESULT` bridge. Token-bound: the
 * host self-binds the account off the block token and reads via its
 * `blocks.getMyBuzzTransactions` mutation (scope `buzz:read:self`) — the block
 * never touches the ledger API or credentials directly (same trust model as
 * {@link useBuzzBalance}).
 *
 * Fetches on mount and whenever `params` change (by value), and exposes `refetch`.
 * A host that never answers surfaces as an `error` after the transport's request
 * timeout — the hook never hangs. Only the LATEST request may write state: page
 * 1's slow reply cannot repaint (or rewind `cursor` behind) the page 2 a newer
 * request already painted, and a reply that lands after unmount is dropped
 * (#392). Transaction `date`s are rehydrated to `Date`; `cursor` is normalized
 * to an ISO string for round-tripping.
 *
 * @example
 * const { transactions, cursor, loading, error } = useBuzzTransactions({ type: 'Tip', limit: 20 });
 */
export function useBuzzTransactions(params?: BlockBuzzTransactionsParams): UseBuzzTransactions {
  const [transactions, setTransactions] = useState<BuzzTransaction[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Latest-wins + unmount guard in one predicate (#392). This hook is the one
  // the issue was audit-verified against: `paramsKey` moving is exactly what
  // puts two requests in flight, and a bare mount check passes for BOTH of them.
  const seq = useRequestSequencer();

  // Serialize the params to a stable key so `refetch`'s identity only changes
  // when the params VALUE changes (not on every render's fresh object). The
  // callback re-parses the key so it closes over NOTHING but the key.
  const paramsKey = params ? JSON.stringify(params) : '';

  const refetch = useCallback(() => {
    const token = seq.begin();
    setLoading(true);
    setError(null);
    const parsed = paramsKey ? (JSON.parse(paramsKey) as BlockBuzzTransactionsParams) : undefined;
    const payload = parsed ? { params: parsed } : {};
    sendTypedRequest(
      getTransport(),
      { type: 'GET_BUZZ_TRANSACTIONS', payload },
      'BUZZ_TRANSACTIONS_RESULT',
    )
      .then((result) => {
        if (!seq.isCurrent(token)) return;
        if (result.error || !result.result) {
          // `||`, not `??`: the reply validator gates `error` on SHAPE only, so a
          // host `error: ''` is a VALID reply that reaches here. `??` replaces only
          // null/undefined, so it would surface an Error with an EMPTY message.
          setError(new Error(result.error || 'failed to fetch buzz transactions'));
          setLoading(false);
          return;
        }
        const wire = result.result;
        setTransactions(wire.transactions.map((t) => ({ ...t, date: toDate(t.date) })));
        setCursor(toIso(wire.cursor));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!seq.isCurrent(token)) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [paramsKey, seq]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { transactions, cursor, loading, error, refetch };
}
