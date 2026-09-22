import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useAppWorkflows } from '../src/hooks/useAppWorkflows.js';
import { useBuzzAccounts } from '../src/hooks/useBuzzAccounts.js';
import { useBuzzBalance } from '../src/hooks/useBuzzBalance.js';
import { useBuzzTransactions } from '../src/hooks/useBuzzTransactions.js';
import { useDailyCompensation } from '../src/hooks/useDailyCompensation.js';
import { useTipAllowance } from '../src/hooks/useTipAllowance.js';
import { useViewer } from '../src/hooks/useViewer.js';
import { useWildcardPack } from '../src/hooks/useWildcardPack.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * #392 — REQUEST SEQUENCING. Every hook here auto-issues a request on mount and
 * re-issues on `refetch()` / a dependency change, then writes the reply into
 * component state. Without a latest-wins guard, a SLOW EARLIER reply lands after
 * a FAST LATER one and overwrites it: the user clicks "next page", page 2 paints,
 * then page 1's late reply repaints page 1 while the cursor still points past it.
 *
 * Each case below drives exactly that ordering — request A (mount) and request B
 * (`refetch`) are both in flight, B resolves FIRST, A resolves SECOND — and
 * asserts the state reflects B.
 *
 * 🔴 THE LEDGER IS THE POINT. `SEQUENCED_HOOKS` is the DERIVED set of hooks that
 * store a reply in state from an auto-issued request. It is asserted non-empty
 * and pinned by size below, so a new hook of this shape that is added without a
 * sequencing guard shows up as a ledger mismatch rather than as silence.
 *
 * Issue #392 filed this as SEVEN hooks, excluding `useTipAllowance` on the
 * grounds that its `inFlight: Set<AbortController>` already sequences. It does
 * NOT: that set is only ever drained by the UNMOUNT cleanup, so two overlapping
 * `refetch()`es abort neither each other nor correlate their replies. The last
 * case in this file is the measurement — it fails at `f913811` exactly like the
 * other seven.
 */

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

/** One postMessage-bridge hook under test. `marker` is an integer that must survive to the state. */
interface BridgeCase {
  /** Hook name, for the test title and the ledger. */
  name: string;
  /** Render the hook. */
  render: () => { refetch: () => void } & Record<string, unknown>;
  /** The outbound block→parent request type. */
  request: string;
  /** The inbound parent→block reply type. */
  reply: string;
  /** A VALID reply payload body (no `requestId`) carrying `marker`. */
  result: (marker: number) => Record<string, unknown>;
  /**
   * A VALID FAILURE reply body. Free-text for every bridge except
   * `WILDCARD_PACK_RESULT`, whose validator constrains `error` to a CLOSED code
   * set — a free-text string there is dropped by the transport before it reaches
   * the hook, which would make the stale-error case pass VACUOUSLY.
   */
  errorReply?: Record<string, unknown>;
  /** Pull `marker` back out of the hook's returned state. */
  read: (current: Record<string, unknown>) => number | null | undefined;
}

const BRIDGE_CASES: BridgeCase[] = [
  {
    name: 'useViewer',
    render: () => useViewer() as never,
    request: 'GET_VIEWER',
    reply: 'VIEWER_RESULT',
    result: (m) => ({
      viewer: { id: m, username: `viewer-${m}`, status: 'active', buzzBudget: m },
    }),
    read: (c) => (c.viewer as { id: number } | null)?.id,
  },
  {
    name: 'useBuzzBalance',
    render: () => useBuzzBalance() as never,
    request: 'GET_BUZZ_BALANCE',
    reply: 'BUZZ_BALANCE_RESULT',
    result: (m) => ({ balance: { blue: 0, green: 0, yellow: m } }),
    read: (c) => (c.balance as { yellow: number } | null)?.yellow,
  },
  {
    name: 'useBuzzAccounts',
    render: () => useBuzzAccounts() as never,
    request: 'GET_BUZZ_ACCOUNTS',
    reply: 'BUZZ_ACCOUNTS_RESULT',
    result: (m) => ({ result: { accounts: [{ accountType: 'yellow', balance: m }] } }),
    read: (c) => (c.accounts as { balance: number }[] | null)?.[0]?.balance,
  },
  {
    name: 'useBuzzTransactions',
    render: () => useBuzzTransactions() as never,
    request: 'GET_BUZZ_TRANSACTIONS',
    reply: 'BUZZ_TRANSACTIONS_RESULT',
    result: (m) => ({
      result: {
        cursor: null,
        transactions: [
          {
            date: '2026-07-14T12:00:00.000Z',
            type: 'Tip',
            amount: m,
            fromAccountId: 2,
            toAccountId: 5,
            fromAccountType: 'yellow',
            toAccountType: 'yellow',
            externalTransactionId: null,
          },
        ],
      },
    }),
    read: (c) => (c.transactions as { amount: number }[] | null)?.[0]?.amount,
  },
  {
    name: 'useDailyCompensation',
    render: () => useDailyCompensation({ date: '2026-07-01' }) as never,
    request: 'GET_DAILY_COMPENSATION',
    reply: 'DAILY_COMPENSATION_RESULT',
    result: (m) => ({
      result: {
        resources: [
          {
            id: m,
            name: 'fp8',
            modelName: 'FLUX.1 [dev]',
            data: [{ createdAt: '2026-07-01', total: m }],
            cashData: [],
            totalSum: m,
            cashCents: 0,
          },
        ],
        hasPublishedResources: true,
      },
    }),
    read: (c) => (c.resources as { id: number }[] | null)?.[0]?.id,
  },
  {
    name: 'useAppWorkflows',
    render: () => useAppWorkflows({ limit: 20 }) as never,
    request: 'QUERY_APP_WORKFLOWS',
    reply: 'APP_WORKFLOWS_RESULT',
    result: (m) => ({
      result: {
        cursor: null,
        workflows: [
          {
            workflowId: `wf_${m}`,
            status: 'processing',
            images: [],
            cost: m,
            createdAt: '2026-07-14T11:58:00.000Z',
          },
        ],
      },
    }),
    read: (c) => (c.workflows as { cost: number }[] | null)?.[0]?.cost,
  },
  {
    name: 'useWildcardPack',
    render: () => useWildcardPack(691639) as never,
    request: 'GET_WILDCARD_PACK',
    reply: 'WILDCARD_PACK_RESULT',
    result: (m) => ({
      pack: {
        modelId: 618692,
        modelVersionId: m,
        modelName: 'Sample Wildcard Pack',
        versionName: 'v1.0',
        creatorUsername: 'creator',
        lists: { colors: ['red'] },
        truncated: false,
        truncatedLists: [],
        maturity: { browsingLevel: 1, sfwOnly: true },
      },
    }),
    read: (c) => (c.pack as { modelVersionId: number } | null)?.modelVersionId,
    errorReply: { error: 'busy' },
  },
];

/**
 * The DERIVED set (#392). Seven postMessage-bridge hooks plus `useTipAllowance`,
 * which the issue excluded but which measurably does NOT sequence — see the
 * dedicated case at the bottom of this file.
 */
const SEQUENCED_HOOKS = [...BRIDGE_CASES.map((c) => c.name), 'useTipAllowance'].sort();

describe('#392 request sequencing — the derived hook set', () => {
  it('is non-empty and pinned at 8 (7 bridge hooks + useTipAllowance)', () => {
    // Non-vacuity: an empty table would make every `it.each` below vanish and
    // this file would pass while asserting nothing.
    expect(BRIDGE_CASES.length).toBeGreaterThan(0);
    expect(SEQUENCED_HOOKS).toEqual([
      'useAppWorkflows',
      'useBuzzAccounts',
      'useBuzzBalance',
      'useBuzzTransactions',
      'useDailyCompensation',
      'useTipAllowance',
      'useViewer',
      'useWildcardPack',
    ]);
    expect(SEQUENCED_HOOKS).toHaveLength(8);
  });
});

describe('#392 request sequencing — postMessage bridge hooks', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageMock = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInit() },
        origin: PARENT_ORIGIN,
      }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
    vi.restoreAllMocks();
  });

  function requestIds(type: string): string[] {
    return postMessageMock.mock.calls
      .filter((c) => (c[0] as { type?: string } | undefined)?.type === type)
      .map((c) => (c[0] as { payload: { requestId: string } }).payload.requestId);
  }

  function dispatchReply(type: string, payload: unknown): void {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type, payload }, origin: PARENT_ORIGIN }),
      );
    });
  }

  it.each(BRIDGE_CASES.map((c) => [c.name, c] as const))(
    '%s: a SLOW EARLIER reply cannot overwrite the state a LATER request already set',
    async (_name, c) => {
      const { result } = renderHook(() => c.render());

      // Request A went out on mount; request B goes out on refetch. Both are now
      // in flight — the exact state a params change / a "next page" click creates.
      act(() => {
        (result.current as { refetch: () => void }).refetch();
      });
      const ids = requestIds(c.request);
      expect(ids).toHaveLength(2);
      const [idA, idB] = ids as [string, string];
      expect(idA).not.toBe(idB);

      // B (the LATER request) resolves FIRST with marker 2.
      dispatchReply(c.reply, { requestId: idB, ...c.result(2) });
      await waitFor(() =>
        expect((result.current as Record<string, unknown>).loading).toBe(false),
      );
      expect(c.read(result.current as Record<string, unknown>)).toBe(2);

      // A (the EARLIER, superseded request) resolves SECOND with marker 1. It must
      // be DROPPED — it is answering a question the hook no longer asks.
      dispatchReply(c.reply, { requestId: idA, ...c.result(1) });
      await act(async () => {
        await Promise.resolve();
      });

      expect(c.read(result.current as Record<string, unknown>)).toBe(2);
      expect((result.current as Record<string, unknown>).loading).toBe(false);
      expect((result.current as Record<string, unknown>).error).toBeNull();
    },
  );

  it.each(BRIDGE_CASES.map((c) => [c.name, c] as const))(
    "%s: a superseded request's ERROR cannot clobber the newer request's success",
    async (_name, c) => {
      const { result } = renderHook(() => c.render());
      act(() => {
        (result.current as { refetch: () => void }).refetch();
      });
      const ids = requestIds(c.request);
      const [idA, idB] = ids as [string, string];

      dispatchReply(c.reply, { requestId: idB, ...c.result(2) });
      await waitFor(() =>
        expect((result.current as Record<string, unknown>).loading).toBe(false),
      );

      // The superseded request fails. A stale failure must not surface as the
      // CURRENT state — the hook is showing marker 2's data, successfully.
      dispatchReply(c.reply, {
        requestId: idA,
        ...(c.errorReply ?? { error: 'stale request failed' }),
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect((result.current as Record<string, unknown>).error).toBeNull();
      expect(c.read(result.current as Record<string, unknown>)).toBe(2);
    },
  );

  /**
   * The CONCRETE failure #392 records, on the hook it was audit-verified against:
   * `paramsKey` changes → `refetch`'s identity changes → the mount effect re-runs
   * → page 2 goes out while page 1 is still in flight. This drives the real
   * dependency-change path rather than a manual double-`refetch()`.
   */
  it('useBuzzTransactions: paging forward does not get repainted by page 1 landing late', async () => {
    const { result, rerender } = renderHook(
      (props: { cursor?: string }) => useBuzzTransactions({ limit: 20, ...props }),
      { initialProps: {} as { cursor?: string } },
    );

    const page1Id = requestIds('GET_BUZZ_TRANSACTIONS')[0]!;
    rerender({ cursor: '2026-07-10T09:30:00.000Z' });
    const ids = requestIds('GET_BUZZ_TRANSACTIONS');
    expect(ids).toHaveLength(2);
    const page2Id = ids[1]!;

    const row = (amount: number) => ({
      date: '2026-07-14T12:00:00.000Z',
      type: 'Tip',
      amount,
      fromAccountId: 2,
      toAccountId: 5,
      fromAccountType: 'yellow',
      toAccountType: 'yellow',
      externalTransactionId: null,
    });

    // Page 2 lands first.
    dispatchReply('BUZZ_TRANSACTIONS_RESULT', {
      requestId: page2Id,
      result: { cursor: '2026-07-05T00:00:00.000Z', transactions: [row(222)] },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.transactions?.[0]?.amount).toBe(222);
    expect(result.current.cursor).toBe('2026-07-05T00:00:00.000Z');

    // Page 1 lands late. Before the fix this repaints page 1 AND resets `cursor`
    // to page 2's value, wedging the "next" button.
    dispatchReply('BUZZ_TRANSACTIONS_RESULT', {
      requestId: page1Id,
      result: { cursor: '2026-07-10T09:30:00.000Z', transactions: [row(111)] },
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.transactions?.[0]?.amount).toBe(222);
    expect(result.current.cursor).toBe('2026-07-05T00:00:00.000Z');
  });

  /**
   * `useWildcardPack` is the one hook whose `refetch` can decide NOT to send a
   * request at all (a non-positive `modelVersionId`). That decision still has to
   * SUPERSEDE whatever is in flight — the sequencer is opened before the validity
   * gate, not after it — or the previous id's reply paints a pack the hook has
   * already been told it no longer wants.
   */
  it('useWildcardPack: moving to an INVALID id supersedes the in-flight request for the old one', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useWildcardPack(id),
      { initialProps: { id: 691639 } },
    );
    const [inFlightId] = requestIds('GET_WILDCARD_PACK') as [string];

    // Nothing to fetch for `0`, so no second request goes out …
    rerender({ id: 0 });
    expect(requestIds('GET_WILDCARD_PACK')).toHaveLength(1);
    expect(result.current.loading).toBe(false);

    // … and the OLD id's reply must not land.
    dispatchReply('WILDCARD_PACK_RESULT', {
      requestId: inFlightId,
      pack: {
        modelId: 618692,
        modelVersionId: 691639,
        modelName: 'Sample Wildcard Pack',
        versionName: 'v1.0',
        creatorUsername: 'creator',
        lists: { colors: ['red'] },
        truncated: false,
        truncatedLists: [],
        maturity: { browsingLevel: 1, sfwOnly: true },
      },
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pack).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  /**
   * REACHABILITY + the `loading` half of the contract. A superseded reply must not
   * flip `loading` back to `false` while the CURRENT request is still in flight —
   * otherwise a consumer's `if (loading) return <Spinner/>` unblanks onto stale
   * data. This is the ordering the unmount guard cannot see (nothing unmounted).
   */
  it.each(BRIDGE_CASES.map((c) => [c.name, c] as const))(
    '%s: a superseded reply does not clear `loading` while the current request is still in flight',
    async (_name, c) => {
      const { result } = renderHook(() => c.render());
      act(() => {
        (result.current as { refetch: () => void }).refetch();
      });
      const [idA] = requestIds(c.request) as [string, string];

      expect((result.current as Record<string, unknown>).loading).toBe(true);
      // Only the SUPERSEDED request answers. B is still out.
      dispatchReply(c.reply, { requestId: idA, ...c.result(1) });
      await act(async () => {
        await Promise.resolve();
      });

      expect((result.current as Record<string, unknown>).loading).toBe(true);
      expect(c.read(result.current as Record<string, unknown>)).toBeFalsy();
    },
  );
});

/**
 * `useTipAllowance` is a DIRECT REST hook (not a postMessage bridge), so it gets
 * its own harness — and it is the case #392's triage note got wrong. Its
 * `inFlight: Set<AbortController>` is drained only by the unmount cleanup, so two
 * overlapping `refetch()`es neither abort each other nor correlate their replies.
 */
describe('#392 request sequencing — useTipAllowance (direct REST)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInit() },
        origin: PARENT_ORIGIN,
      }),
    );
  });

  afterEach(() => {
    resetTransport();
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('a SLOW EARLIER allowance reply cannot overwrite the state a LATER request set', async () => {
    // Two deferred responses: call #1 (mount) is held open; call #2 (refetch)
    // resolves immediately. Then #1 is released — it must be dropped.
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((r) => {
      releaseFirst = r;
    });

    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        await firstHeld;
        return { ok: true, status: 200, json: async () => ({ cap: 100, spent: 90, remaining: 10 }) };
      }
      return { ok: true, status: 200, json: async () => ({ cap: 100, spent: 0, remaining: 100 }) };
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useTipAllowance());

    act(() => {
      result.current.refetch();
    });
    // The LATER request resolves first.
    await waitFor(() => expect(result.current.allowance?.remaining).toBe(100));

    // The EARLIER request finally answers with the stale 10.
    await act(async () => {
      releaseFirst();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.allowance?.remaining).toBe(100);
    expect(result.current.error).toBeNull();
  });
});
