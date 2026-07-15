import { describe, expect, it } from 'vitest';

import {
  isValidBuzzAccountsResult,
  isValidBuzzTransactionsResult,
  isValidDailyCompensationResult,
  isValidWildcardPackResult,
} from '../src/internal/validate.js';

describe('isValidBuzzTransactionsResult', () => {
  const row = {
    date: '2026-07-14T12:00:00.000Z',
    type: 'Tip',
    amount: 250,
    fromAccountId: 2,
    toAccountId: 5,
    fromAccountType: 'yellow',
    toAccountType: 'yellow',
    externalTransactionId: null,
  };

  it('accepts a result page (ISO string date/cursor)', () => {
    expect(
      isValidBuzzTransactionsResult({
        requestId: 'r',
        result: { cursor: '2026-07-10T00:00:00.000Z', transactions: [row] },
      }),
    ).toBe(true);
  });

  it('accepts a Date instance for date/cursor (raw structured-clone wire)', () => {
    expect(
      isValidBuzzTransactionsResult({
        result: { cursor: new Date(), transactions: [{ ...row, date: new Date() }] },
      }),
    ).toBe(true);
  });

  it('accepts a null cursor (last/only page — `z.coerce.date().nullish()`)', () => {
    expect(
      isValidBuzzTransactionsResult({ requestId: 'r', result: { cursor: null, transactions: [row] } }),
    ).toBe(true);
  });

  it('accepts the error variant', () => {
    expect(isValidBuzzTransactionsResult({ requestId: 'r', error: 'nope' })).toBe(true);
  });

  it('rejects neither-result-nor-error', () => {
    expect(isValidBuzzTransactionsResult({ requestId: 'r' })).toBe(false);
  });

  it('rejects a row with an unparseable date', () => {
    expect(
      isValidBuzzTransactionsResult({ result: { transactions: [{ ...row, date: 'not-a-date' }] } }),
    ).toBe(false);
  });

  it('rejects a row missing a numeric amount', () => {
    expect(
      isValidBuzzTransactionsResult({ result: { transactions: [{ ...row, amount: 'x' }] } }),
    ).toBe(false);
  });
});

describe('isValidBuzzAccountsResult', () => {
  it('accepts an accounts page', () => {
    expect(
      isValidBuzzAccountsResult({
        requestId: 'r',
        result: { accounts: [{ accountType: 'yellow', balance: 5 }] },
      }),
    ).toBe(true);
  });

  it('accepts the error variant', () => {
    expect(isValidBuzzAccountsResult({ error: 'x' })).toBe(true);
  });

  it('rejects a non-finite balance', () => {
    expect(
      isValidBuzzAccountsResult({ result: { accounts: [{ accountType: 'yellow', balance: 'x' }] } }),
    ).toBe(false);
  });

  it('rejects neither-result-nor-error', () => {
    expect(isValidBuzzAccountsResult({})).toBe(false);
  });
});

describe('isValidDailyCompensationResult', () => {
  it('accepts a result', () => {
    expect(
      isValidDailyCompensationResult({ result: { resources: [], hasPublishedResources: false } }),
    ).toBe(true);
  });

  it('accepts the error variant', () => {
    expect(isValidDailyCompensationResult({ error: 'x' })).toBe(true);
  });

  it('rejects a non-boolean hasPublishedResources', () => {
    expect(
      isValidDailyCompensationResult({ result: { resources: [], hasPublishedResources: 'yes' } }),
    ).toBe(false);
  });

  it('rejects neither-result-nor-error', () => {
    expect(isValidDailyCompensationResult({})).toBe(false);
  });
});

describe('isValidWildcardPackResult', () => {
  const pack = {
    modelId: 1,
    modelVersionId: 2,
    modelName: 'm',
    versionName: 'v',
    creatorUsername: null,
    lists: { a: ['x'] },
    truncated: false,
    truncatedLists: [],
    maturity: { browsingLevel: 1, sfwOnly: true },
  };

  it('accepts a pack', () => {
    expect(isValidWildcardPackResult({ requestId: 'r', pack })).toBe(true);
  });

  it('accepts each discriminated error code', () => {
    for (const code of ['not-found', 'forbidden', 'too-large', 'parse-failed', 'busy']) {
      expect(isValidWildcardPackResult({ requestId: 'r', error: code })).toBe(true);
    }
  });

  it('REJECTS a free-text (non-enum) error — the wildcard error is a closed enum', () => {
    expect(isValidWildcardPackResult({ requestId: 'r', error: 'kaboom' })).toBe(false);
  });

  it('rejects a pack with a non-integer modelVersionId', () => {
    expect(isValidWildcardPackResult({ pack: { ...pack, modelVersionId: 1.5 } })).toBe(false);
  });

  it('rejects a pack missing maturity', () => {
    const noMaturity = {
      modelId: 1,
      modelVersionId: 2,
      modelName: 'm',
      versionName: 'v',
      creatorUsername: null,
      lists: { a: ['x'] },
      truncated: false,
      truncatedLists: [],
    };
    expect(isValidWildcardPackResult({ pack: noMaturity })).toBe(false);
  });

  it('rejects neither-pack-nor-error', () => {
    expect(isValidWildcardPackResult({ requestId: 'r' })).toBe(false);
  });
});
