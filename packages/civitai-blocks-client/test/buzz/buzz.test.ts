import { describe, expect, it } from 'vitest';

import { BridgeError, buzz } from '../../src/index.js';
import { createFakeTransport } from '../../src/testing.js';

const ACCOUNTS = [
  { type: 'blue' as const, balance: 10 },
  { type: 'yellow' as const, balance: 1500 },
];

const row = (id: string, amount: number) => ({
  id,
  date: '2026-09-18T00:00:00.000Z',
  type: 'Tip',
  amount,
  from: { accountId: 1, type: 'yellow' as const },
  to: { accountId: 2 },
});

describe('buzz.getAccounts', () => {
  it('returns the pools, not the envelope', async () => {
    const t = createFakeTransport();
    t.reply('BUZZ_GET_ACCOUNTS', { accounts: ACCOUNTS });

    await expect(buzz.getAccounts({ transport: t })).resolves.toEqual(ACCOUNTS);
    expect(t.sent.at(-1)?.type).toBe('BUZZ_GET_ACCOUNTS');
  });

  it('raises the code the host classified the failure with', async () => {
    const t = createFakeTransport();
    t.fail('BUZZ_GET_ACCOUNTS', { code: 'forbidden', message: 'block lacks buzz:read:self' });

    await expect(buzz.getAccounts({ transport: t })).rejects.toMatchObject({
      code: 'forbidden',
      message: 'block lacks buzz:read:self',
      operation: 'BUZZ_GET_ACCOUNTS',
    });
  });

  it('leaves a caller’s own deadline as the platform reports it', async () => {
    const t = createFakeTransport();
    t.stall('BUZZ_GET_ACCOUNTS');

    const failure = await buzz
      .getAccounts({ transport: t, signal: AbortSignal.timeout(5) })
      .catch((err: unknown) => err);

    expect(failure).toMatchObject({ name: 'TimeoutError' });
    expect(failure).not.toBeInstanceOf(BridgeError);
  });

  it('re-throws a caller’s abort rather than wrapping it', async () => {
    const t = createFakeTransport();
    const ac = new AbortController();
    t.stall('BUZZ_GET_ACCOUNTS');

    const pending = buzz.getAccounts({ transport: t, signal: ac.signal });
    ac.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('buzz.listTransactions', () => {
  const drain = async (rows: AsyncIterable<unknown>) => {
    const out: unknown[] = [];
    for await (const r of rows) out.push(r);
    return out;
  };

  it('follows the cursor, asking only for what is still wanted', async () => {
    const t = createFakeTransport();
    t.reply('BUZZ_LIST_TRANSACTIONS', { transactions: [row('a', 1)], cursor: 'c1' });
    t.reply('BUZZ_LIST_TRANSACTIONS', { transactions: [row('b', 2)] });

    const all = await drain(buzz.listTransactions({}, { transport: t }));

    expect(all.map((r) => (r as { id: string }).id)).toEqual(['a', 'b']);
    expect(t.sent.map((m) => m.payload)).toEqual([
      { limit: 100, cursor: undefined },
      { limit: 99, cursor: 'c1' },
    ]);
  });

  it('stops at 100 rows rather than reading a whole history', async () => {
    const t = createFakeTransport();
    t.handle('BUZZ_LIST_TRANSACTIONS', () => ({
      transactions: Array.from({ length: 100 }, (_, i) => row(`r${i}`, 1)),
      cursor: 'more',
    }));

    const all = await drain(buzz.listTransactions({}, { transport: t }));

    expect(all).toHaveLength(100);
    expect(t.sent).toHaveLength(1);
  });

  it('holds the limit even when the host serves more than it was asked for', async () => {
    const t = createFakeTransport();
    t.reply('BUZZ_LIST_TRANSACTIONS', {
      transactions: Array.from({ length: 40 }, (_, i) => row(`r${i}`, 1)),
      cursor: 'more',
    });

    const all = await drain(buzz.listTransactions({ limit: 5 }, { transport: t }));

    expect(all).toHaveLength(5);
  });

  it('reads past the default when the caller lifts it', async () => {
    const t = createFakeTransport();
    t.reply('BUZZ_LIST_TRANSACTIONS', {
      transactions: Array.from({ length: 100 }, (_, i) => row(`r${i}`, 1)),
      cursor: 'more',
    });
    t.reply('BUZZ_LIST_TRANSACTIONS', { transactions: [row('last', 1)] });

    const all = await drain(buzz.listTransactions({ limit: Infinity }, { transport: t }));

    expect(all).toHaveLength(101);
    expect(t.sent.map((m) => (m.payload as { limit: number }).limit)).toEqual([200, 200]);
  });

  it('asks for nothing more once the reader stops', async () => {
    const t = createFakeTransport();
    t.reply('BUZZ_LIST_TRANSACTIONS', { transactions: [row('a', 1), row('b', 2)], cursor: 'c1' });

    for await (const _ of buzz.listTransactions({}, { transport: t })) break;

    expect(t.sent).toHaveLength(1);
  });
});

describe('buzz.requestPurchase', () => {
  it('reports an abandoned purchase as an outcome, not a failure', async () => {
    const t = createFakeTransport();
    t.reply('BUZZ_REQUEST_PURCHASE', { purchased: false });

    await expect(buzz.requestPurchase({ amount: 500 }, { transport: t })).resolves.toEqual({
      purchased: false,
    });
    expect(t.sent.at(-1)?.payload).toEqual({ amount: 500 });
  });

  it('reports a completed purchase with the pools after it', async () => {
    const t = createFakeTransport();
    t.reply('BUZZ_REQUEST_PURCHASE', { purchased: true, accounts: ACCOUNTS });

    await expect(buzz.requestPurchase({}, { transport: t })).resolves.toEqual({
      purchased: true,
      accounts: ACCOUNTS,
    });
  });
});

describe('buzz.watchAccounts', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('serves every consumer from one read', async () => {
    const t = createFakeTransport();
    const live = buzz.watchAccounts({ transport: t });
    expect(buzz.watchAccounts({ transport: t })).toBe(live);

    t.reply('BUZZ_GET_ACCOUNTS', { accounts: ACCOUNTS });
    await flush();

    expect(live.value).toEqual(ACCOUNTS);
    expect(t.sent.filter((m) => m.type === 'BUZZ_GET_ACCOUNTS')).toHaveLength(1);
  });

  it('follows the host push without asking again', async () => {
    const t = createFakeTransport();
    const live = buzz.watchAccounts({ transport: t });
    t.reply('BUZZ_GET_ACCOUNTS', { accounts: ACCOUNTS });
    await flush();

    let changes = 0;
    live.addEventListener('change', () => (changes += 1));

    const richer = [{ type: 'yellow' as const, balance: 9000 }];
    t.push('BUZZ_ACCOUNTS_CHANGED', { accounts: richer });

    expect(live.value).toEqual(richer);
    expect(changes).toBe(1);
    expect(t.sent.filter((m) => m.type === 'BUZZ_GET_ACCOUNTS')).toHaveLength(1);
  });
});

