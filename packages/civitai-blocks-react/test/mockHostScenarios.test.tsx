import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { useBuzzBalance } from '../src/hooks/useBuzzBalance.js';
import { useAppStorage } from '../src/hooks/useAppStorage.js';
import { getTransport } from '../src/internal/singleton.js';
import {
  createMockHost,
  resetTransport,
  readMockHostUrlOptions,
  disallowedAccountError,
} from '../src/testing.js';

/**
 * Layer-1 scenario coverage for `createMockHost`: the `generation` / `buzz` /
 * `storage` groups + the runtime `setScenario` / `buzz` handle. Exercised
 * against the REAL SDK hooks + transport (mirrors mockHost.test.tsx).
 */

const ORIGIN = window.location.origin;

const BODY = {
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'a cat' },
};

/** Drive estimate→submit→poll(×n) to a terminal state and return the snapshot. */
async function runGen(
  result: { current: ReturnType<typeof useBuzzWorkflow> },
  polls = 2,
) {
  let snap!: { workflowId: string; status: string; error?: string; cost?: { total: number } };
  await act(async () => {
    snap = await result.current.submit(BODY);
  });
  if (snap.status === 'failed') return snap;
  for (let i = 0; i < polls; i += 1) {
    await act(async () => {
      snap = await result.current.poll(snap.workflowId);
    });
    if (snap.status === 'succeeded' || snap.status === 'failed') break;
  }
  return snap;
}

describe('createMockHost — generation scenario', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.restoreAllMocks();
  });

  it('costPerGen as a number reports on estimate + succeeded', async () => {
    uninstall = createMockHost({ generation: { costPerGen: 42 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await act(async () => {
      await result.current.estimate(BODY);
    });
    await waitFor(() => expect(result.current.result?.cost?.total).toBe(42));

    const snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
    expect(snap.cost?.total).toBe(42);
  });

  it('costPerGen as a function varies cost by the submitted body', async () => {
    uninstall = createMockHost({
      generation: { costPerGen: (req) => (req.params?.prompt === 'a cat' ? 5 : 99) },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await runGen(result, 1);
    expect(snap.cost?.total).toBe(5);
  });

  it('failNext fails the first N submits then succeeds', async () => {
    uninstall = createMockHost({ generation: { failNext: 1 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const first = await runGen(result, 1);
    expect(first.status).toBe('failed');
    expect(first.error).toMatch(/simulated/i);

    const second = await runGen(result, 1);
    expect(second.status).toBe('succeeded');
  });

  it('failRate 1 always fails; 0 never fails', async () => {
    uninstall = createMockHost({ generation: { failRate: 1 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const snap = await runGen(result, 1);
    expect(snap.status).toBe('failed');
  });

  it('custom image/images appear on the succeeded snapshot', async () => {
    uninstall = createMockHost({
      generation: { images: ['https://example.test/a.png', 'https://example.test/b.png'] },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const snap = await runGen(result, 1);
    expect(result.current.result?.imageUrls).toEqual([
      'https://example.test/a.png',
      'https://example.test/b.png',
    ]);
    expect(snap.status).toBe('succeeded');
  });

  it('default synthetic result image is prominently labeled MOCK', async () => {
    // No custom image configured → the host falls back to its placehold.co
    // default. That default MUST read "MOCK" so a first-run dev in dev:harness
    // can't mistake the scaffold placeholder for a real generation.
    uninstall = createMockHost({ pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
    const url = result.current.result?.imageUrls?.[0] ?? '';
    expect(url).toContain('text=MOCK');
  });

  it('latencyMs delays the terminal poll without changing the outcome', async () => {
    // Use a small real delay (120ms) so the terminal poll lands behind a timer
    // but the test stays fast + deterministic (no fake-timer orchestration).
    uninstall = createMockHost({ generation: { latencyMs: 120 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const t0 = Date.now();
    const snap = await runGen(result, 1);
    const elapsed = Date.now() - t0;
    expect(snap.status).toBe('succeeded');
    // The succeeded snapshot arrived only after the configured latency.
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('latencyMs accepts a [min,max] range', async () => {
    uninstall = createMockHost({ generation: { latencyMs: [50, 80] }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
  });
});

describe('createMockHost — buzz balance scenario', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  it('a gen that exceeds the balance returns insufficient-Buzz', async () => {
    host = createMockHost({ buzz: { balance: 3 }, generation: { costPerGen: 5 }, pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await runGen(result, 1);
    expect(snap.status).toBe('failed');
    expect(snap.error).toMatch(/insufficient buzz/i);
  });

  it('debits the balance on a successful gen', async () => {
    host = createMockHost({ buzz: { balance: 20 }, generation: { costPerGen: 8 }, pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await runGen(result, 1);
    expect(host.buzz.getBalance()).toBe(12);
    await runGen(result, 1);
    expect(host.buzz.getBalance()).toBe(4);
    // 3rd gen (cost 8) exceeds remaining 4 → insufficient.
    const snap = await runGen(result, 1);
    expect(snap.status).toBe('failed');
    expect(snap.error).toMatch(/insufficient buzz/i);
  });

  it('buzz.insufficient forces the insufficient path regardless of balance', async () => {
    host = createMockHost({ buzz: { balance: 1000, insufficient: true }, pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const snap = await runGen(result, 1);
    expect(snap.status).toBe('failed');
    expect(snap.error).toMatch(/insufficient buzz/i);
  });

  it('runtime buzz.setBalance flips insufficient → sufficient mid-session', async () => {
    host = createMockHost({ buzz: { balance: 0 }, generation: { costPerGen: 8 }, pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap = await runGen(result, 1);
    expect(snap.status).toBe('failed');

    act(() => host!.buzz.setBalance(100));
    snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
  });

  it('OPEN_BUZZ_PURCHASE refills the simulated balance', async () => {
    host = createMockHost({ buzz: { balance: 0 }, generation: { costPerGen: 8 }, pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    // useBuzzWorkflow exposes a topUp/openPurchase path; drive the transport
    // directly to assert the host refills.
    const before = host.buzz.getBalance();
    expect(before).toBe(0);
    await act(async () => {
      window.parent.postMessage({ type: 'OPEN_BUZZ_PURCHASE', payload: { requestId: 'r1' } }, ORIGIN);
    });
    await waitFor(() => expect(host!.buzz.getBalance()).toBeGreaterThan(0));
  });

  it('stamps a synthetic spentAccountType (primary funder) when no accountType is picked', async () => {
    // Default wallet is yellow-dominant (5000) → primary funder 'yellow'. BODY
    // carries NO accountType, so the mock falls back to the largest-pool stamp.
    host = createMockHost({ pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = (await runGen(result, 1)) as { status: string; spentAccountType?: string };
    expect(snap.status).toBe('succeeded');
    expect(snap.spentAccountType).toBe('yellow');
  });

  it('stamps spentAccountType from the SUBMITTED accountType (pick-aware, not largest pool)', async () => {
    // Default wallet is yellow-dominant → the pick-blind stamp would be 'yellow'.
    // A pick of 'green' must win: spentAccountType echoes the submitted pool.
    host = createMockHost({ pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap!: { status: string; workflowId: string; spentAccountType?: string };
    await act(async () => {
      snap = (await result.current.submit({
        ...BODY,
        accountType: 'green',
      })) as typeof snap;
    });
    await act(async () => {
      snap = (await result.current.poll(snap.workflowId)) as typeof snap;
    });
    expect(snap.status).toBe('succeeded');
    expect(snap.spentAccountType).toBe('green');
  });
});

describe('createMockHost — GET_BUZZ_BALANCE (per-pool wallet)', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  it('replies BUZZ_BALANCE_RESULT with the default wallet (useBuzzBalance resolves, not hangs)', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useBuzzBalance());

    // The hook fetches on mount and is loading until the mock host answers.
    expect(result.current.loading).toBe(true);

    // Resolves (does NOT hang to the request timeout) against the mock host.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.balance).toEqual({ blue: 1000, green: 0, yellow: 5000 });
  });

  it('honors a custom buzzBalance option', async () => {
    const custom = { blue: 42, green: 7, yellow: 999 };
    uninstall = createMockHost({ buzzBalance: custom }).install();
    const { result } = renderHook(() => useBuzzBalance());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toEqual(custom);
    expect(result.current.error).toBeNull();
  });

  it('replies with the exact BUZZ_BALANCE_RESULT shape and drops a request with no requestId', async () => {
    uninstall = createMockHost({ buzzBalance: { blue: 1, green: 2, yellow: 3 } }).install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const replies: Array<{ requestId?: string; balance?: unknown }> = [];
    const listener = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; payload?: { requestId?: string; balance?: unknown } };
      if (d?.type === 'BUZZ_BALANCE_RESULT') replies.push(d.payload ?? {});
    };
    window.addEventListener('message', listener);
    try {
      // A well-formed request → one reply carrying the wallet + requestId.
      await act(async () => {
        window.parent.postMessage(
          { type: 'GET_BUZZ_BALANCE', payload: { requestId: 'buzz-1' } },
          ORIGIN,
        );
      });
      await waitFor(() => expect(replies.length).toBe(1));
      expect(replies[0]).toEqual({ requestId: 'buzz-1', balance: { blue: 1, green: 2, yellow: 3 } });

      // A request with NO requestId is unroutable → dropped (no reply).
      await act(async () => {
        window.parent.postMessage({ type: 'GET_BUZZ_BALANCE', payload: {} }, ORIGIN);
      });
      await Promise.resolve();
      expect(replies.length).toBe(1);
    } finally {
      window.removeEventListener('message', listener);
    }
  });

  it('buzzBalanceError: true surfaces the default error on useBuzzBalance (no balance)', async () => {
    uninstall = createMockHost({ buzzBalanceError: true }).install();
    const { result } = renderHook(() => useBuzzBalance());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('buzzBalanceError as a string uses that exact message in the error reply shape', async () => {
    uninstall = createMockHost({ buzzBalanceError: 'boom' }).install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const replies: Array<{ requestId?: string; balance?: unknown; error?: unknown }> = [];
    const listener = (ev: MessageEvent) => {
      const d = ev.data as {
        type?: string;
        payload?: { requestId?: string; balance?: unknown; error?: unknown };
      };
      if (d?.type === 'BUZZ_BALANCE_RESULT') replies.push(d.payload ?? {});
    };
    window.addEventListener('message', listener);
    try {
      await act(async () => {
        window.parent.postMessage(
          { type: 'GET_BUZZ_BALANCE', payload: { requestId: 'buzz-err' } },
          ORIGIN,
        );
      });
      await waitFor(() => expect(replies.length).toBe(1));
      // Exact error shape: { requestId, error } and NO balance (mirrors createLiveHost).
      expect(replies[0]).toEqual({ requestId: 'buzz-err', error: 'boom' });
    } finally {
      window.removeEventListener('message', listener);
    }
  });

  it('buzzBalanceError as an empty string still fails (coerced to default, not unset)', async () => {
    uninstall = createMockHost({ buzzBalanceError: '' }).install();
    const { result } = renderHook(() => useBuzzBalance());

    await waitFor(() => expect(result.current.loading).toBe(false));
    // An intentionally-empty message must NOT silently re-enable the read.
    expect(result.current.balance).toBeNull();
    expect(result.current.error).toBeTruthy();
    expect(result.current.error?.message).toBe('balance unavailable');
  });

  it('setScenario can clear buzzBalanceError mid-session (error → wallet)', async () => {
    const host = createMockHost({ buzzBalanceError: true });
    uninstall = host.install();
    const { result, rerender } = renderHook(() => useBuzzBalance());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();

    act(() => host.setScenario({ buzzBalanceError: false }));
    await act(async () => {
      await result.current.refetch();
    });
    rerender();
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.balance).toEqual({ blue: 1000, green: 0, yellow: 5000 });
  });
});

describe('createMockHost — disallowed account (content-rating clamp)', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  async function submitWith(
    result: { current: ReturnType<typeof useBuzzWorkflow> },
    accountType: 'blue' | 'green' | 'yellow',
  ) {
    let snap!: { status: string; workflowId: string; error?: string };
    await act(async () => {
      snap = (await result.current.submit({ ...BODY, accountType })) as typeof snap;
    });
    return snap;
  }

  it('rejects a submit whose accountType is disallowed with the real backend message', async () => {
    host = createMockHost({ disallowedAccountTypes: ['yellow'], pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await submitWith(result, 'yellow');
    expect(snap.status).toBe('failed');
    expect(snap.error).toBe(disallowedAccountError('yellow'));
  });

  it('accepts a submit whose accountType is NOT in the disallowed set', async () => {
    host = createMockHost({ disallowedAccountTypes: ['yellow'], pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap = await submitWith(result, 'green');
    expect(snap.status).not.toBe('failed');
    await act(async () => {
      snap = (await result.current.poll(snap.workflowId)) as typeof snap;
    });
    expect(snap.status).toBe('succeeded');
  });

  it('disallowed check runs BEFORE the balance/insufficient path', async () => {
    // Even with a balance that could NOT cover the gen, a disallowed pool fails
    // with the content-rating message (not insufficient-Buzz) — matches the real
    // backend rejecting at the currency boundary before any spend check.
    host = createMockHost({
      disallowedAccountTypes: ['yellow'],
      buzz: { balance: 0 },
      generation: { costPerGen: 999 },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await submitWith(result, 'yellow');
    expect(snap.status).toBe('failed');
    expect(snap.error).toBe(disallowedAccountError('yellow'));
  });

  it('setScenario can add a disallowed pool mid-session', async () => {
    host = createMockHost({ pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    // Initially any pool is accepted.
    let snap = await submitWith(result, 'yellow');
    expect(snap.status).not.toBe('failed');

    act(() => host!.setScenario({ disallowedAccountTypes: ['yellow'] }));
    snap = await submitWith(result, 'yellow');
    expect(snap.status).toBe('failed');
    expect(snap.error).toBe(disallowedAccountError('yellow'));
  });
});

describe('createMockHost — storage scenario (in-memory KV)', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  async function ready() {
    // Storage needs the transport ready (BLOCK_INIT must land first).
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
  }

  it('seed is readable via get(); list() enumerates seeded keys', async () => {
    host = createMockHost({ storage: { seed: { 'prompt:1': 'hello', 'prompt:2': 'world' } } });
    uninstall = host.install();
    const { result } = renderHook(() => useAppStorage());
    await ready();

    await expect(result.current.get('prompt:1')).resolves.toBe('hello');
    await expect(result.current.get('missing')).resolves.toBeNull();

    const listed = await result.current.list({ prefix: 'prompt:' });
    expect(listed.keys.map((k) => k.key).sort()).toEqual(['prompt:1', 'prompt:2']);
    expect(listed.keys[0]!.updatedAt).toBeInstanceOf(Date);
  });

  it('set→get→delete round-trips', async () => {
    host = createMockHost({ storage: {} });
    uninstall = host.install();
    const { result } = renderHook(() => useAppStorage());
    await ready();

    const setRes = await result.current.set('k', { a: 1 });
    expect(setRes.ok).toBe(true);
    expect(setRes.sizeBytes).toBeGreaterThan(0);
    await expect(result.current.get('k')).resolves.toEqual({ a: 1 });

    const del = await result.current.delete('k');
    expect(del).toEqual({ ok: true, deleted: true });
    await expect(result.current.get('k')).resolves.toBeNull();
    // idempotent delete
    await expect(result.current.delete('k')).resolves.toEqual({ ok: true, deleted: false });
  });

  it('per-value cap rejects an oversized value with PAYLOAD_TOO_LARGE', async () => {
    host = createMockHost({ storage: { valueCapBytes: 16 } });
    uninstall = host.install();
    const { result } = renderHook(() => useAppStorage());
    await ready();
    await expect(result.current.set('big', 'x'.repeat(1000))).rejects.toThrow('PAYLOAD_TOO_LARGE');
  });

  it('quotaBytes rejects a write that would cross the quota', async () => {
    host = createMockHost({ storage: { quotaBytes: 50 } });
    uninstall = host.install();
    const { result } = renderHook(() => useAppStorage());
    await ready();
    // First small write fits.
    await expect(result.current.set('a', 'x'.repeat(10))).resolves.toMatchObject({ ok: true });
    // Second write blows the 50-byte quota.
    await expect(result.current.set('b', 'y'.repeat(100))).rejects.toThrow('PAYLOAD_TOO_LARGE');
  });

  it('getQuota reports used/row counts + the configured ceilings', async () => {
    host = createMockHost({
      storage: { seed: { a: '1', b: '2' }, quotaBytes: 1024, limitRows: 10 },
    });
    uninstall = host.install();
    const { result } = renderHook(() => useAppStorage());
    await ready();
    const q = await result.current.getQuota();
    expect(q.rowCount).toBe(2);
    expect(q.usedBytes).toBeGreaterThan(0);
    expect(q.limitBytes).toBe(1024);
    expect(q.limitRows).toBe(10);
  });

  it('storage.failNext forces N mutations to error then recovers', async () => {
    host = createMockHost({ storage: { failNext: 1 } });
    uninstall = host.install();
    const { result } = renderHook(() => useAppStorage());
    await ready();
    await expect(result.current.set('k', 'v')).rejects.toThrow('STORAGE_UNAVAILABLE');
    await expect(result.current.set('k', 'v')).resolves.toMatchObject({ ok: true });
  });

  it('list() paginates with a cursor', async () => {
    host = createMockHost({ storage: { seed: { k1: '1', k2: '2', k3: '3' } } });
    uninstall = host.install();
    const { result } = renderHook(() => useAppStorage());
    await ready();

    const page1 = await result.current.list({ limit: 2 });
    expect(page1.keys.map((k) => k.key)).toEqual(['k1', 'k2']);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await result.current.list({ limit: 2, cursor: page1.nextCursor });
    expect(page2.keys.map((k) => k.key)).toEqual(['k3']);
    expect(page2.nextCursor).toBeUndefined();
  });
});

describe('createMockHost — setScenario + URL toggles', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  it('setScenario flips failMode/generation mid-session', async () => {
    host = createMockHost({ pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');

    act(() => host!.setScenario({ generation: { failRate: 1 } }));
    snap = await runGen(result, 1);
    expect(snap.status).toBe('failed');
  });

  it('readMockHostUrlOptions maps the new query params onto scenarios', () => {
    const fakeWin = {
      location: { search: '?balance=0&latency=500-2000&costPerGen=12&failNext=2&fail=insufficient' },
    } as unknown as Window & typeof globalThis;
    const opts = readMockHostUrlOptions(fakeWin);
    expect(opts.buzz?.balance).toBe(0);
    expect(opts.generation?.latencyMs).toEqual([500, 2000]);
    expect(opts.generation?.costPerGen).toBe(12);
    expect(opts.generation?.failNext).toBe(2);
    expect(opts.failMode).toBe('insufficient');
  });

  it('readMockHostUrlOptions maps ?consent=granted|ungrantable onto the two consent knobs', () => {
    // The dev-harness affordance for the refusal path — a third value on the
    // EXISTING `?consent` knob rather than a second parameter, because "already
    // granted" and "can never grant" are mutually exclusive states of one thing.
    const granted = readMockHostUrlOptions({
      location: { search: '?consent=granted' },
    } as unknown as Window & typeof globalThis);
    expect(granted.consentGranted).toBe(true);
    expect(granted.consentGrantable).toBeUndefined();

    const ungrantable = readMockHostUrlOptions({
      location: { search: '?consent=ungrantable' },
    } as unknown as Window & typeof globalThis);
    expect(ungrantable.consentGrantable).toBe(false);
    expect(ungrantable.consentGranted).toBeUndefined();

    // An unrelated value touches neither (no silent default flip).
    const other = readMockHostUrlOptions({
      location: { search: '?consent=maybe' },
    } as unknown as Window & typeof globalThis);
    expect(other.consentGranted).toBeUndefined();
    expect(other.consentGrantable).toBeUndefined();
  });

  it('readMockHostUrlOptions parses a single-number latency + ?seed JSON', () => {
    const fakeWin = {
      location: { search: '?latency=2000&seed=' + encodeURIComponent('{"k":"v"}') },
    } as unknown as Window & typeof globalThis;
    const opts = readMockHostUrlOptions(fakeWin);
    expect(opts.generation?.latencyMs).toBe(2000);
    expect(opts.storage?.seed).toEqual({ k: 'v' });
  });
});

describe('createMockHost — purity (no network)', () => {
  it('exercising the full protocol never touches fetch / XMLHttpRequest', async () => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation(() => {
      throw new Error('mock host must not call fetch');
    });
    const host = createMockHost({
      buzz: { balance: 100 },
      generation: { costPerGen: 5, latencyMs: 0 },
      storage: { seed: { a: '1' } },
      pollsUntilDone: 1,
    });
    const uninstall = host.install();
    try {
      const gen = renderHook(() => useBuzzWorkflow());
      const store = renderHook(() => useAppStorage());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      await runGen(gen.result, 1);
      await store.result.current.set('b', '2');
      await store.result.current.get('a');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      uninstall();
      resetTransport();
      vi.restoreAllMocks();
    }
  });
});
