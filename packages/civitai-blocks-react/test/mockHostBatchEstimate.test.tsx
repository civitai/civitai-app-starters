import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowBody } from '@civitai/app-sdk/blocks';

import { BatchEstimateError, useBatchEstimate } from '../src/hooks/useBatchEstimate.js';
import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * `createMockHost`'s ESTIMATE_WORKFLOW_BATCH handler, driven through the REAL
 * hooks and transport. The claim under test is that the mock prices each cell
 * EXACTLY as it prices a single estimate of that body, so every case compares a
 * batch against single `estimate()` calls on the same host.
 */

const ORIGIN = window.location.origin;

const body = (prompt: string): WorkflowBody => ({
  kind: 'textToImage',
  modelId: 7,
  modelVersionId: 99,
  params: { prompt },
});

/** A per-body price that differs per cell, so order and sum mistakes show. */
const PRICE: Record<string, number> = { a: 12, b: 31, c: 7 };
const costPerGen = (b: WorkflowBody) =>
  PRICE[(b as { params?: { prompt?: string } }).params?.prompt ?? ''] ?? 99;

describe('createMockHost — batch estimate', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function hooks(options: Parameters<typeof createMockHost>[0]) {
    uninstall = createMockHost(options).install();
    const { result } = renderHook(() => ({ batch: useBatchEstimate(), single: useBuzzWorkflow() }));
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    return result;
  }

  it('prices each cell exactly as a single estimate of that body, in order, with the aggregate', async () => {
    const result = await hooks({ generation: { costPerGen } });
    const bodies = [body('a'), body('b'), body('c')];

    let batch: Awaited<ReturnType<typeof result.current.batch.estimateBatch>> | undefined;
    await act(async () => {
      batch = await result.current.batch.estimateBatch(bodies);
    });
    const singles: unknown[] = [];
    for (const b of bodies) {
      await act(async () => {
        singles.push((await result.current.single.estimate(b)).cost);
      });
    }

    expect(batch!.cells.map((c) => (c.ok ? c.cost : null))).toEqual(singles);
    expect(batch!.cells.map((c) => (c.ok ? c.cost.total : null))).toEqual([12, 31, 7]);
    expect(batch!.aggregate).toEqual({ total: 50, pricedCells: 3, cellCount: 3 });
  });

  it('`failEstimate` applies per cell, exactly as it applies to a single estimate', async () => {
    const result = await hooks({
      generation: { costPerGen, failEstimate: 'failed', failEstimateMessage: 'not generatable' },
    });
    let batch: Awaited<ReturnType<typeof result.current.batch.estimateBatch>> | undefined;
    await act(async () => {
      batch = await result.current.batch.estimateBatch([body('a'), body('b')]);
    });
    expect(batch!.cells.map((c) => c.ok)).toEqual([false, false]);
    const first = batch!.cells[0];
    expect(first.ok === false && first.error.code).toBe('failed');
    expect(first.ok === false && first.error.snapshot.error).toBe('not generatable');
    expect(batch!.aggregate).toEqual({ total: 0, pricedCells: 0, cellCount: 2 });
  });

  it('refuses a `training` cell per cell, as the server does, and prices the rest', async () => {
    const result = await hooks({ generation: { costPerGen } });
    const training = {
      kind: 'training',
      datasetId: `tds_${'a'.repeat(32)}`,
      engine: 'ai-toolkit',
      model: 'sdxl',
      triggerWord: 'x',
      samplePrompts: [],
      params: {},
    } as unknown as WorkflowBody;
    let batch: Awaited<ReturnType<typeof result.current.batch.estimateBatch>> | undefined;
    await act(async () => {
      batch = await result.current.batch.estimateBatch([training, body('b')]);
    });
    const first = batch!.cells[0];
    expect(first.ok).toBe(false);
    expect(first.ok === false && first.error.snapshot.error).toBe(
      'a training estimate cannot be part of a batch — estimate it on its own',
    );
    expect(batch!.aggregate).toEqual({ total: 31, pricedCells: 1, cellCount: 2 });
  });

  it("`batchEstimate: 'unsupported'` answers as a host with no handler does", async () => {
    const result = await hooks({ generation: { batchEstimate: 'unsupported' } });
    let caught: unknown;
    await act(async () => {
      await result.current.batch.estimateBatch([body('a')]).catch((e: unknown) => {
        caught = e;
      });
    });
    expect(caught).toBeInstanceOf(BatchEstimateError);
    expect((caught as BatchEstimateError).code).toBe('unsupported');
  });

  it("`batchEstimate: 'silent'` never answers, as a host that predates the message", async () => {
    const result = await hooks({ generation: { batchEstimate: 'silent' } });
    let caught: unknown;
    await act(async () => {
      await result.current.batch
        .estimateBatch([body('a')], { timeoutMs: 50 })
        .catch((e: unknown) => {
          caught = e;
        });
    });
    expect((caught as BatchEstimateError).code).toBe('timeout');
  });

  it('refuses an over-long list sent around the hook, with the host error', async () => {
    // Drive the transport directly: the hook would refuse 17 before sending.
    await hooks({ generation: { costPerGen } });
    let reply: unknown;
    await act(async () => {
      reply = await getTransport().sendRequest(
        {
          type: 'ESTIMATE_WORKFLOW_BATCH',
          payload: { bodies: Array.from({ length: 17 }, () => body('a')) },
        },
        'ESTIMATE_BATCH_RESULT',
      );
    });
    expect(reply).toMatchObject({ error: 'estimate batch too large' });
  });
});
