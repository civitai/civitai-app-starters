import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * The host can answer a FINAL status while an output is still being rated: it holds
 * that output as `{ pending: true }` and sets `ratingPending: true` (civitai/civitai#8994).
 * `watch` must keep polling at its usual pacing for up to two minutes after the final
 * status, resolve as soon as the rating lands, and otherwise resolve with the last
 * snapshot, outputs still pending. Driven through the mock host's `pendingOutputs`, the
 * real transport and the real hook; the clock is faked (`Date` only) for the window.
 */
const ORIGIN = window.location.origin;
const IMAGES = ['https://img.test/p-0.png', 'https://img.test/p-1.png'];
const TEXT_BODY = {
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'cat' },
};

describe('watch — a final snapshot with a rating pending', () => {
  let uninstall: (() => void) | undefined;
  let outbound: string[];

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
    outbound = [];
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.useRealTimers();
  });

  async function setup(pendingOutputs: Record<number, number>) {
    uninstall = createMockHost({
      consentGranted: true,
      pollsUntilDone: 1,
      onOutbound: (msg) => outbound.push(msg.type),
      generation: { images: IMAGES, pendingOutputs },
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let submitted!: BlockWorkflowSnapshot;
    await act(async () => {
      submitted = await result.current.submit(TEXT_BODY);
    });
    return { result, workflowId: submitted.workflowId };
  }
  const polls = () => outbound.filter((t) => t === 'POLL_WORKFLOW').length;

  it('keeps polling after the final status and resolves once the rating lands', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Output 0 is held for the first two reads after success, rated on the third.
    const { result, workflowId } = await setup({ 0: 2 });
    const updates: BlockWorkflowSnapshot[] = [];
    let final!: BlockWorkflowSnapshot;
    await act(async () => {
      final = await result.current.watch(workflowId, {
        intervalMs: 1,
        waitSeconds: 0,
        onUpdate: (s) => updates.push(s),
      });
    });
    expect(polls()).toBe(3);
    expect(updates.map((s) => [s.status, s.ratingPending ?? false])).toEqual([
      ['succeeded', true],
      ['succeeded', true],
      ['succeeded', false],
    ]);
    expect(updates[0]!.outputs).toEqual([{ pending: true }, { url: IMAGES[1] }]);
    expect(final.outputs).toEqual([{ url: IMAGES[0] }, { url: IMAGES[1] }]);
    expect(final.imageUrls).toEqual(IMAGES);
    expect(final).not.toHaveProperty('ratingPending');
  });

  it('the window runs out: resolves with the last snapshot, outputs still pending', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { result, workflowId } = await setup({ 0: 1_000 });
    const start = Date.now();
    let reads = 0;
    let final!: BlockWorkflowSnapshot;
    await act(async () => {
      final = await result.current.watch(workflowId, {
        intervalMs: 1,
        waitSeconds: 0,
        // Each read lands 50 s after the last, so the two-minute window closes.
        onUpdate: () => {
          reads += 1;
          vi.setSystemTime(start + reads * 50_000);
        },
      });
    });
    // Read 1 opens the window at +50 s; reads at +100 s and +150 s are inside it; the
    // read at +200 s is past it, and the watch resolves with it.
    expect(polls()).toBe(4);
    expect(final.status).toBe('succeeded');
    expect(final.ratingPending).toBe(true);
    expect(final.outputs).toEqual([{ pending: true }, { url: IMAGES[1] }]);
  });

  it('nothing pending: resolves at the first final snapshot, as before', async () => {
    const { result, workflowId } = await setup({});
    await act(async () => {
      await result.current.watch(workflowId, { intervalMs: 1, waitSeconds: 0 });
    });
    expect(polls()).toBe(1);
  });
});
