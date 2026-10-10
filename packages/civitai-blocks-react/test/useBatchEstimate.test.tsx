import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, WorkflowBody } from '@civitai/app-sdk/blocks';

import {
  BATCH_ESTIMATE_MAX_CELLS,
  BatchEstimateError,
  useBatchEstimate,
} from '../src/hooks/useBatchEstimate.js';
import { WorkflowEstimateError } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useBatchEstimate` against a hand-driven host: every reply below is dispatched
 * by the test, so each assertion is about what the HOOK does with a given wire
 * reply, not about any host.
 *
 * Cell prices are pairwise distinct (12, 31, 7) and the aggregate is a literal,
 * so a hook that reordered, dropped or recomputed anything is visible.
 */

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt',
      scopes: ['ai:write:budgeted'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

const body = (prompt: string): WorkflowBody => ({
  kind: 'textToImage',
  modelId: 7,
  modelVersionId: 99,
  params: { prompt },
});
const priced = (total: number) => ({
  workflowId: 'wf_estimate',
  status: 'pending' as const,
  cost: { total },
});

type Sent = { type: string; payload: { requestId: string; bodies?: unknown } };

describe('useBatchEstimate', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  const sentBatches = (): Sent[] =>
    postMessageMock.mock.calls
      .map((c) => c[0] as Sent)
      .filter((m) => m?.type === 'ESTIMATE_WORKFLOW_BATCH');

  function reply(payload: unknown): void {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ESTIMATE_BATCH_RESULT', payload },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  /** Start a call and return a handle on its outcome. */
  function start(
    estimateBatch: ReturnType<typeof useBatchEstimate>['estimateBatch'],
    bodies: WorkflowBody[],
    options?: { timeoutMs?: number },
  ) {
    const outcome: { value?: unknown; error?: unknown } = {};
    let done!: Promise<void>;
    act(() => {
      done = estimateBatch(bodies, options).then(
        (value) => {
          outcome.value = value;
        },
        (error: unknown) => {
          outcome.error = error;
        },
      );
    });
    return { outcome, done };
  }

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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends the bodies in ONE message and resolves with the cells IN ORDER plus the aggregate', async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const bodies = [body('a'), body('b'), body('c')];
    const { outcome, done } = start(result.current.estimateBatch, bodies);

    expect(sentBatches()).toHaveLength(1);
    expect(sentBatches()[0].payload.bodies).toEqual(bodies);
    reply({
      requestId: sentBatches()[0].payload.requestId,
      snapshots: [priced(12), priced(31), priced(7)],
      aggregate: { total: 50, pricedCells: 3, cellCount: 3 },
    });
    await act(async () => {
      await done;
    });

    expect(outcome.error).toBeUndefined();
    expect(outcome.value).toEqual({
      cells: [
        { ok: true, cost: { total: 12 }, snapshot: priced(12) },
        { ok: true, cost: { total: 31 }, snapshot: priced(31) },
        { ok: true, cost: { total: 7 }, snapshot: priced(7) },
      ],
      aggregate: { total: 50, pricedCells: 3, cellCount: 3 },
    });
    expect(result.current.result).toEqual(outcome.value);
    expect(result.current.pending).toBe(false);
  });

  it('a failed cell is a per-cell WorkflowEstimateError — the same error one estimate() rejects with — and the call resolves', async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const { outcome, done } = start(result.current.estimateBatch, [body('a'), body('b'), body('c')]);
    const failed = { workflowId: 'failed', status: 'failed', error: 'modelId mismatch with token' };
    const noCost = { workflowId: 'wf_estimate', status: 'pending' };
    reply({
      requestId: sentBatches()[0].payload.requestId,
      snapshots: [failed, priced(31), noCost],
      aggregate: { total: 31, pricedCells: 1, cellCount: 3 },
    });
    await act(async () => {
      await done;
    });

    const { cells, aggregate } = outcome.value as {
      cells: Array<{ ok: boolean; error?: WorkflowEstimateError; cost?: unknown }>;
      aggregate: unknown;
    };
    expect(cells.map((c) => c.ok)).toEqual([false, true, false]);
    expect(cells[0].error).toBeInstanceOf(WorkflowEstimateError);
    expect(cells[0].error?.code).toBe('failed');
    expect(cells[0].error?.snapshot.error).toBe('modelId mismatch with token');
    expect(cells[1].cost).toEqual({ total: 31 });
    expect(cells[2].error?.code).toBe('no-cost');
    expect(aggregate).toEqual({ total: 31, pricedCells: 1, cellCount: 3 });
  });

  it('passes a cell cost object through untouched, including fields it does not know', async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const { outcome, done } = start(result.current.estimateBatch, [body('a')]);
    const future = { total: 14, somethingAddedLater: { amount: 2 } };
    reply({
      requestId: sentBatches()[0].payload.requestId,
      snapshots: [{ workflowId: 'wf_estimate', status: 'pending', cost: future }],
      aggregate: { total: 14, pricedCells: 1, cellCount: 1 },
    });
    await act(async () => {
      await done;
    });
    expect((outcome.value as { cells: Array<{ cost: unknown }> }).cells[0].cost).toEqual(future);
  });

  it("an OLD host's generic `unsupported on this host` reply rejects with code 'unsupported'", async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const { outcome, done } = start(result.current.estimateBatch, [body('a')]);
    reply({ requestId: sentBatches()[0].payload.requestId, error: 'unsupported on this host' });
    await act(async () => {
      await done;
    });
    expect(outcome.error).toBeInstanceOf(BatchEstimateError);
    expect((outcome.error as BatchEstimateError).code).toBe('unsupported');
    expect((outcome.error as BatchEstimateError).hostError).toBe('unsupported on this host');
    expect(result.current.error).toBe(outcome.error);
    expect(result.current.result).toBeNull();
  });

  it("a host that never replies rejects with code 'timeout' after the caller's wait", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBatchEstimate());
    const { outcome, done } = start(result.current.estimateBatch, [body('a')], {
      timeoutMs: 5_000,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(outcome.error).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
      await done;
    });
    expect(outcome.error).toBeInstanceOf(BatchEstimateError);
    expect((outcome.error as BatchEstimateError).code).toBe('timeout');
  });

  it("a whole-call server refusal rejects with code 'failed' and the server's text on hostError", async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const { outcome, done } = start(result.current.estimateBatch, [body('a')]);
    reply({
      requestId: sentBatches()[0].payload.requestId,
      error: 'Rate limit exceeded, please retry shortly.',
    });
    await act(async () => {
      await done;
    });
    expect((outcome.error as BatchEstimateError).code).toBe('failed');
    expect((outcome.error as BatchEstimateError).hostError).toBe(
      'Rate limit exceeded, please retry shortly.',
    );
  });

  it("the host's list refusals reject with code 'invalid-request'", async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const { outcome, done } = start(result.current.estimateBatch, [body('a')]);
    reply({ requestId: sentBatches()[0].payload.requestId, error: 'estimate batch too large' });
    await act(async () => {
      await done;
    });
    expect((outcome.error as BatchEstimateError).code).toBe('invalid-request');
  });

  it('refuses an empty list and a list over 16 WITHOUT sending anything', async () => {
    expect(BATCH_ESTIMATE_MAX_CELLS).toBe(16);
    const { result } = renderHook(() => useBatchEstimate());
    for (const bodies of [[], Array.from({ length: 17 }, (_, i) => body(`c${i}`))]) {
      const { outcome, done } = start(result.current.estimateBatch, bodies);
      await act(async () => {
        await done;
      });
      expect((outcome.error as BatchEstimateError).code).toBe('invalid-request');
    }
    expect(sentBatches()).toHaveLength(0);

    // …and exactly 16 is sent.
    start(result.current.estimateBatch, Array.from({ length: 16 }, (_, i) => body(`c${i}`)));
    expect(sentBatches()).toHaveLength(1);
  });

  it('a reply that does not answer every body is refused, not shown shifted by a cell', async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const { outcome, done } = start(result.current.estimateBatch, [body('a'), body('b')]);
    reply({
      requestId: sentBatches()[0].payload.requestId,
      snapshots: [priced(12)],
      aggregate: { total: 12, pricedCells: 1, cellCount: 1 },
    });
    await act(async () => {
      await done;
    });
    expect((outcome.error as BatchEstimateError).code).toBe('failed');
  });

  it('a failed call clears the previous result, so no stale total stays on display', async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const first = start(result.current.estimateBatch, [body('a')]);
    reply({
      requestId: sentBatches()[0].payload.requestId,
      snapshots: [priced(12)],
      aggregate: { total: 12, pricedCells: 1, cellCount: 1 },
    });
    await act(async () => {
      await first.done;
    });
    expect(result.current.result?.aggregate.total).toBe(12);

    const second = start(result.current.estimateBatch, [body('b')]);
    reply({ requestId: sentBatches()[1].payload.requestId, error: 'unsupported on this host' });
    await act(async () => {
      await second.done;
    });
    expect(result.current.result).toBeNull();
    expect(result.current.error?.code).toBe('unsupported');
  });

  it('the LATEST call wins: an older reply landing late does not overwrite a newer result', async () => {
    const { result } = renderHook(() => useBatchEstimate());
    const older = start(result.current.estimateBatch, [body('a')]);
    const newer = start(result.current.estimateBatch, [body('b')]);
    const [olderReq, newerReq] = sentBatches().map((m) => m.payload.requestId);
    reply({
      requestId: newerReq,
      snapshots: [priced(31)],
      aggregate: { total: 31, pricedCells: 1, cellCount: 1 },
    });
    reply({
      requestId: olderReq,
      snapshots: [priced(12)],
      aggregate: { total: 12, pricedCells: 1, cellCount: 1 },
    });
    await act(async () => {
      await Promise.all([older.done, newer.done]);
    });
    // Each caller still gets its own answer…
    expect((older.outcome.value as { aggregate: { total: number } }).aggregate.total).toBe(12);
    // …but the hook's state shows the newer one.
    expect(result.current.result?.aggregate.total).toBe(31);
  });
});
