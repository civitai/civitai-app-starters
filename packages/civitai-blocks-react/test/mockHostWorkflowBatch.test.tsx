import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkflowBody } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { useWorkflowBatch } from '../src/hooks/useWorkflowBatch.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * `createMockHost`'s poll and cancel handlers, driven through the REAL
 * `useBuzzWorkflow().submit()` + `useWorkflowBatch()` and transport — the local
 * loop a grid app tests against.
 */

const ORIGIN = window.location.origin;
const FAST = { intervalMs: 1, waitSeconds: 0 } as const;

const body = (prompt: string): WorkflowBody => ({
  kind: 'textToImage',
  modelId: 7,
  modelVersionId: 99,
  params: { prompt },
});
const promptOf = (b: WorkflowBody | undefined) =>
  (b as { params?: { prompt?: string } } | undefined)?.params?.prompt;

describe('createMockHost — workflow batch watch / cancel', () => {
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

  async function setup(options: Parameters<typeof createMockHost>[0], initial: string[] = []) {
    const host = createMockHost(options);
    uninstall = host.install();
    const { result } = renderHook(() => {
      const [ids, setIds] = useState<string[]>(initial);
      return { ids, setIds, flow: useBuzzWorkflow(), batch: useWorkflowBatch(ids, FAST) };
    });
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const submitAll = async (prompts: string[]) => {
      for (const p of prompts) {
        let id = '';
        await act(async () => {
          id = (await result.current.flow.submit(body(p))).workflowId;
        });
        act(() => result.current.setIds((prev) => [...prev, id]));
      }
    };
    return { host, result, submitAll };
  }

  it('generation.workflowOutcome gives a grid a mix of outcomes', async () => {
    const { result, submitAll } = await setup({
      generation: {
        costPerGen: 8,
        workflowOutcome: (_id, b) => (promptOf(b) === 'bad' ? 'failed' : 'succeeded'),
      },
    });
    await submitAll(['a', 'bad', 'c']);
    await waitFor(() => expect(result.current.batch.summary.settled).toBe(true));
    expect(result.current.batch.summary).toMatchObject({
      total: 3,
      succeeded: 2,
      failed: 1,
      realisedCost: 16,
    });
  });

  it('generation.cancelRefused answers processing and the workflow keeps running; once cleared, a cancel sticks', async () => {
    const { host, result, submitAll } = await setup({
      pollsUntilDone: 1_000_000,
      generation: { cancelRefused: true },
    });
    await submitAll(['a', 'b']);
    await waitFor(() => expect(result.current.batch.cells.every((c) => c.snapshot)).toBe(true));

    let outcome!: Awaited<ReturnType<typeof result.current.batch.cancelAll>>;
    await act(async () => {
      outcome = await result.current.batch.cancelAll();
    });
    expect(outcome.refused.length + outcome.notAttempted.length).toBe(2);
    expect(outcome.complete).toBe(false);
    expect(result.current.batch.summary.running).toBe(2);

    host.setScenario({ generation: { cancelRefused: undefined } });
    await act(async () => {
      outcome = await result.current.batch.cancelAll();
    });
    expect(outcome).toMatchObject({ canceled: result.current.ids, complete: true });
    // Later polls report canceled, not a resumed countdown.
    const id = result.current.ids[0]!;
    let polled = '';
    await act(async () => {
      polled = (await result.current.flow.poll(id)).status;
    });
    expect(polled).toBe('canceled');
  });

  it('a workflow id the mock did not submit (restored after a reload) counts down to done', async () => {
    const { result } = await setup({ pollsUntilDone: 3 }, ['wf_restored_1', 'wf_restored_2']);
    await waitFor(() => expect(result.current.batch.summary.settled).toBe(true));
    expect(result.current.batch.summary).toMatchObject({ total: 2, succeeded: 2 });
  });

  it('cancelling a workflow that already finished reports its real status', async () => {
    const { result, submitAll } = await setup({ pollsUntilDone: 1 });
    await submitAll(['a']);
    await waitFor(() => expect(result.current.batch.summary.succeeded).toBe(1));
    const id = result.current.ids[0]!;
    let status = '';
    await act(async () => {
      status = (await result.current.flow.cancel(id)).status;
    });
    expect(status).toBe('succeeded');
  });
});
