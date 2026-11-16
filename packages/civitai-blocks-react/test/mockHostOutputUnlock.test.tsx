import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockOutputUnlockResult, WorkflowBody } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { useOutputUnlock } from '../src/hooks/useOutputUnlock.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * `useOutputUnlock` against `createMockHost`: REQUEST_OUTPUT_UNLOCK on a restricted
 * output. A `'pool'` position unlocks in place (paid in the host's dialog), and stays
 * unlocked on later polls; a `'ceiling'` / `'unrated'` one is never charged and links
 * out; the viewer can dismiss. Driven through the real hook and transport, so every
 * reply asserted here passed the SDK's inbound validator.
 */

const ORIGIN = window.location.origin;

const TEXT: WorkflowBody = {
  kind: 'textToImage',
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'a clip' },
};

const IMAGES = ['https://img.test/u-0.png', 'https://img.test/u-1.png', 'https://img.test/u-2.png'];

describe('useOutputUnlock — mock host', () => {
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

  async function ran(
    generation: NonNullable<Parameters<typeof createMockHost>[0]>['generation'],
  ) {
    const host = createMockHost({ consentGranted: true, pollsUntilDone: 1, generation });
    uninstall = host.install();
    const { result } = renderHook(() => ({ flow: useBuzzWorkflow(), unlock: useOutputUnlock() }));
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let workflowId = '';
    await act(async () => {
      workflowId = (await result.current.flow.submit(TEXT)).workflowId;
      const done = await result.current.flow.poll(workflowId);
      expect(done.status).toBe('succeeded');
    });
    const unlock = async (position: number, id = workflowId) => {
      let out!: BlockOutputUnlockResult;
      await act(async () => {
        out = await result.current.unlock.unlockOutput(id, position);
      });
      return out;
    };
    const poll = async () => {
      let snap!: Awaited<ReturnType<typeof result.current.flow.poll>>;
      await act(async () => {
        snap = await result.current.flow.poll(workflowId);
      });
      return snap;
    };
    return { workflowId, unlock, poll };
  }

  it("a 'pool' position unlocks in place and stays unlocked", async () => {
    const { unlock, poll } = await ran({ images: IMAGES, restrictedOutputs: { 1: 'pool' } });
    const result = await unlock(1);
    expect(result.outcome).toBe('unlocked');
    expect(result.snapshot?.outputs).toStrictEqual([
      { url: IMAGES[0] },
      { url: IMAGES[1] },
      { url: IMAGES[2] },
    ]);
    expect(result.snapshot?.imageUrls).toStrictEqual(IMAGES);
    expect((await poll()).outputs?.[1]).toStrictEqual({ url: IMAGES[1] });
    // A retry after the unlock: nothing left to unlock.
    expect(await unlock(1)).toStrictEqual({ outcome: 'not-restricted' });
  });

  it("'ceiling' and 'unrated' are never charged: the viewer is linked out", async () => {
    const { unlock, poll } = await ran({
      images: IMAGES,
      restrictedOutputs: { 0: 'ceiling' },
      neverRatedOutputs: [2],
    });
    expect(await unlock(0)).toStrictEqual({ outcome: 'linked-out' });
    expect(await unlock(2)).toStrictEqual({ outcome: 'linked-out' });
    const after = await poll();
    expect(after.outputs?.[0]).toStrictEqual({ restricted: true, reason: 'ceiling' });
    expect(after.outputs?.[2]).toStrictEqual({ restricted: true, reason: 'unrated' });
  });

  it("'dismiss': the viewer closes the dialog and the output stays restricted", async () => {
    const { unlock, poll } = await ran({
      images: IMAGES,
      restrictedOutputs: { 1: 'pool' },
      outputUnlock: 'dismiss',
    });
    expect(await unlock(1)).toStrictEqual({ outcome: 'dismissed' });
    expect((await poll()).outputs?.[1]).toStrictEqual({ restricted: true, reason: 'pool' });
  });

  it("'insufficient': refused with the host's message, the output stays restricted", async () => {
    const { unlock, poll } = await ran({
      images: IMAGES,
      restrictedOutputs: { 1: 'pool' },
      outputUnlock: 'insufficient',
    });
    const result = await unlock(1);
    expect(result.outcome).toBe('refused');
    expect(result.message).toBe('You do not have enough yellow Buzz to unlock this output.');
    expect(result.snapshot?.outputs?.[1]).toStrictEqual({ restricted: true, reason: 'pool' });
    expect((await poll()).outputs?.[1]).toStrictEqual({ restricted: true, reason: 'pool' });
  });

  it('an unrestricted position and a workflow the mock did not run', async () => {
    const { unlock } = await ran({ images: IMAGES, restrictedOutputs: { 1: 'pool' } });
    expect(await unlock(0)).toStrictEqual({ outcome: 'not-restricted' });
    expect(await unlock(1, 'wf_not_mine')).toStrictEqual({
      outcome: 'unavailable',
      message: 'workflow does not belong to this viewer',
    });
  });
});
