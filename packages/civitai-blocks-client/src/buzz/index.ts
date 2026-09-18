import { sharedLive, type Live } from '../core/live.js';
import { createCaller, createListener, type CallOptions } from '../core/messaging.js';
import type { BlockTransport } from '../core/transport.js';

import type {
  BuzzAccount,
  BuzzLedgerQuery,
  BuzzPushes,
  BuzzRequests,
  BuzzTransaction,
} from './protocol.js';

const call = createCaller<BuzzRequests>();
const on = createListener<BuzzPushes>();

export type {
  BuzzAccount,
  BuzzAccountType,
  BuzzCounterparty,
  BuzzLedgerQuery,
  BuzzTransaction,
} from './protocol.js';

export interface PurchaseOutcome {
  purchased: boolean;
  /** The pools after the purchase; absent when the viewer bought nothing. */
  accounts?: BuzzAccount[];
}

/** The viewer's spendable pools, read once. */
export async function getAccounts(opts: CallOptions = {}): Promise<BuzzAccount[]> {
  return (await call('BUZZ_GET_ACCOUNTS', {}, opts)).accounts;
}

const accountsCache = new WeakMap<BlockTransport, Live<BuzzAccount[]>>();

/**
 * The pools as a shared live value: one round-trip however many components read
 * it, kept current by the host's `BUZZ_ACCOUNTS_CHANGED` push, so a tip arriving
 * or another app spending updates every consumer.
 */
export function watchAccounts(opts: CallOptions = {}): Live<BuzzAccount[]> {
  return sharedLive(accountsCache, opts, getAccounts, (transport, accept) =>
    on(transport, 'BUZZ_ACCOUNTS_CHANGED', ({ accounts }) => accept(accounts)),
  );
}

/**
 * The viewer's ledger, newest first, fetching the next page only as you read
 * into it. `break` stops fetching; the cursor stays inside.
 */
export async function* listTransactions(
  query: BuzzLedgerQuery = {},
  opts: CallOptions = {},
): AsyncGenerator<BuzzTransaction> {
  let cursor = query.cursor;
  do {
    const page = await call('BUZZ_LIST_TRANSACTIONS', { ...query, cursor }, opts);
    for (const transaction of page.transactions) yield transaction;
    cursor = page.cursor;
  } while (cursor);
}

/**
 * Asks for a Buzz purchase and resolves with what the viewer decided. `amount`
 * is a suggestion they can change and the host caps at 50,000; an abandoned
 * flow answers `purchased: false`, because a refusal is an outcome.
 */
export async function requestPurchase(
  args: { amount?: number } = {},
  opts: CallOptions = {},
): Promise<PurchaseOutcome> {
  return call('BUZZ_REQUEST_PURCHASE', args, opts);
}
