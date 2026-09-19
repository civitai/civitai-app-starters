/** The spendable pools. `red`, `creatorProgram` and `cash` are internal to the platform. */
export type BuzzAccountType = 'blue' | 'green' | 'yellow';

export interface BuzzAccount {
  type: BuzzAccountType;
  balance: number;
}

/** `type` is absent when the counterparty is an account a block may not see. */
export interface BuzzCounterparty {
  accountId: number;
  type?: BuzzAccountType;
}

export interface BuzzTransaction {
  id: string;
  /** ISO-8601. */
  date: string;
  type: string;
  amount: number;
  from: BuzzCounterparty;
  to: BuzzCounterparty;
  description?: string;
}

export interface BuzzLedgerQuery {
  accountType?: BuzzAccountType;
  type?: string;
  /** ISO-8601. */
  start?: string;
  end?: string;
  /** Stop after this many rows. Defaults to 100; `Infinity` reads to the end. */
  limit?: number;
  /** Opaque; from a prior reply. */
  cursor?: string;
}

export type BuzzRequests = {
  BUZZ_GET_ACCOUNTS: { params: Record<string, never>; result: { accounts: BuzzAccount[] } };
  BUZZ_LIST_TRANSACTIONS: {
    params: BuzzLedgerQuery;
    result: { transactions: BuzzTransaction[]; cursor?: string };
  };
  BUZZ_REQUEST_PURCHASE: {
    params: { amount?: number };
    result: { purchased: boolean; accounts?: BuzzAccount[] };
  };
};

export type BuzzPushes = {
  BUZZ_ACCOUNTS_CHANGED: { accounts: BuzzAccount[] };
};
