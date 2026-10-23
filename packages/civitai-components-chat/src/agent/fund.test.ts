import { ApiError } from '@civitai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { humanize } from '../ux/humanize.js';
import { FreeTier, freeTierFetch } from './free-tier.js';
import { ChatFund, type FundStatus } from './fund.js';

const QWEN = 'civitai/qwen3.8';
const RESET = '2026-10-23T09:00:00Z';

async function usedUpFreeTier(): Promise<FreeTier> {
  const tier = new FreeTier(async () => ({ enabled: true, models: [{ key: 'qwen3.8-chat', airs: [QWEN], remaining: 0, windows: [{ limit: 200, remaining: 0, resetAt: RESET }] }] }));
  await tier.refresh();
  return tier;
}

/** The orchestrator's funds, with the viewer's own Buzz. */
function funds(start: { balance?: number; wallet?: number } = {}) {
  const stored = new Map<string, string>();
  let fund: FundStatus | null = start.balance === undefined ? null : { id: 'f1', balance: start.balance, expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() };
  if (fund) stored.set('cvt:fund:7', fund.id);
  let wallet = start.wallet ?? 1000;
  const deposits: number[] = [];
  const api = {
    createFund: vi.fn(async () => (fund = { id: 'f2', balance: 0, expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() })),
    getFund: vi.fn(async (id: string) => {
      if (fund?.id !== id) throw new ApiError(404, 'Not Found', undefined);
      return fund;
    }),
    depositIntoFund: vi.fn(async (_id: string, amount: number) => {
      if (wallet < amount) throw new ApiError(402, 'Insufficient Buzz', undefined);
      wallet -= amount;
      deposits.push(amount);
      return (fund = { ...fund!, balance: fund!.balance + amount });
    }),
    extendFund: vi.fn(async () => fund!),
    refundFund: vi.fn(async () => {
      wallet += fund!.balance;
      return (fund = { ...fund!, balance: 0 });
    }),
  };
  const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) };
  const make = (autoTopUp: boolean) => new ChatFund({ api, viewer: async () => 7, autoTopUp: () => autoTopUp, storage });
  /** Charges 1 per request billed to the fund; a 402 when it is empty. */
  const sent: string[] = [];
  const inner = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const billed = headers.get('X-Civitai-Fund');
    sent.push(billed ? `fund:${billed}` : headers.get('X-Civitai-Tier') === 'free' ? 'free' : 'wallet');
    if (headers.get('X-Civitai-Tier') === 'free') return new Response('', { status: 429 });
    if (billed) {
      if (fund?.id !== billed || fund.balance < 1) return Response.json({ error: { message: 'Insufficient Buzz in the fund', type: 'insufficient_buzz' } }, { status: 402 });
      fund = { ...fund, balance: fund.balance - 1 };
    }
    return new Response('data: {"ok":true}\n\n', { status: 200 });
  }) as typeof fetch;
  return { make, inner, sent, deposits, balance: () => fund?.balance, wallet: () => wallet, stored };
}

const request = (doFetch: typeof fetch) => doFetch('https://orch/v1/chat/completions', { method: 'POST', body: '{"model":"x"}' });
const messageOf = async (response: Response) => ((await response.json()) as { error: { message: string } }).error.message;

describe('chat balance', () => {
  it('pays what is left back to the viewer on Withdraw, and tops up again from an empty fund', async () => {
    const { make, inner, balance, wallet, deposits } = funds({ balance: 60, wallet: 500 });
    const fund = make(true);
    await fund.refresh();

    await fund.withdraw();
    expect([balance(), fund.balance, wallet()]).toEqual([0, 0, 560]);

    expect((await request(freeTierFetch(inner, QWEN, await usedUpFreeTier(), () => ({ useFree: true, payWhenOut: true }), fund))).status).toBe(200);
    expect(deposits).toEqual([100]);
  });

  it('bills the fund once the free replies are used up, never the wallet', async () => {
    const { make, inner, sent, balance } = funds({ balance: 5 });
    const response = await request(freeTierFetch(inner, QWEN, await usedUpFreeTier(), () => ({ useFree: true, payWhenOut: true }), make(false)));

    expect(response.status).toBe(200);
    expect(sent).toEqual(['fund:f1']);
    expect(balance()).toBe(4);
  });

  it('with no balance and no auto top-up, sends nothing and says when the free replies come back', async () => {
    const { make, inner, sent, deposits } = funds();
    const response = await request(freeTierFetch(inner, QWEN, await usedUpFreeTier(), () => ({ useFree: true, payWhenOut: true }), make(false)));

    expect(sent).toEqual([]);
    expect(deposits).toEqual([]);
    expect(humanize(new Error(await messageOf(response)))).toMatchObject({ kind: 'free_tier_exhausted', message: expect.stringMatching(/^Your free allowance is used up until .+\.$/) });
  });

  it('with auto top-up, opens and fills a fund and keeps going, and tops up again when a reply empties it', async () => {
    const { make, inner, sent, deposits, balance, stored } = funds();
    const fund = make(true);
    const doFetch = freeTierFetch(inner, QWEN, await usedUpFreeTier(), () => ({ useFree: true, payWhenOut: true }), fund);

    expect((await request(doFetch)).status).toBe(200);
    expect(deposits).toEqual([100]);
    expect(stored.get('cvt:fund:7')).toBe('f2');
    expect(balance()).toBe(99);

    // Someone else's reply on the same fund (another tab) used the rest.
    for (let i = 0; i < 99; i++) await request(doFetch);
    fund.status = { ...fund.status!, balance: 3 };
    expect((await request(doFetch)).status).toBe(200);
    expect(deposits).toEqual([100, 100]);
    expect(sent.filter((s) => s === 'wallet')).toEqual([]);
  });

  it('says the viewer has too little Buzz when an automatic top-up cannot be paid', async () => {
    const { make, inner, sent } = funds({ wallet: 40 });
    const response = await request(freeTierFetch(inner, QWEN, await usedUpFreeTier(), () => ({ useFree: true, payWhenOut: true }), make(true)));

    expect(sent).toEqual([]);
    expect(humanize(Object.assign(new Error(await messageOf(response)), { statusCode: response.status })).kind).toBe('insufficient_buzz');
  });
});
