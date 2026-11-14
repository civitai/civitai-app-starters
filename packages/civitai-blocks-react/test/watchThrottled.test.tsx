import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * A poll the host could not serve (rate-limited) answers
 * `{ workflowId, status: 'processing', throttled: true }` — not a real update
 * (civitai/civitai#8980). `watch` must not hand it to `onUpdate`, must keep the
 * previous real snapshot (eta, steps, cost) as its result, and must keep
 * polling. Driven through the mock host's `throttledPolls` option, the real
 * transport and the real hook.
 */
const ORIGIN = window.location.origin;

const TEXT_BODY = {
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'cat' },
};

describe('watch — throttled poll replies', () => {
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
  });

  async function setup(options: Parameters<typeof createMockHost>[0]) {
    uninstall = createMockHost({
      consentGranted: true,
      onOutbound: (msg) => outbound.push(msg.type),
      ...options,
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

  it('real → throttled → real: onUpdate sees the two real snapshots only, eta intact', async () => {
    // pollsUntilDone 2: poll 1 running, poll 2 THROTTLED (not served), poll 3 terminal.
    const { result, workflowId } = await setup({ pollsUntilDone: 2, throttledPolls: [2] });
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
    expect(updates.map((s) => s.status)).toEqual(['processing', 'succeeded']);
    expect(updates.some((s) => 'throttled' in s)).toBe(false);
    expect(updates[0]!.eta).toEqual({
      stepName: '$0',
      queuedAhead: null,
      startsAt: null,
      completesAt: null,
      progress: 0.5,
      support: null,
    });
    expect(final.status).toBe('succeeded');
  });

  it('a throttled FIRST reply: no onUpdate for it, and polling continues', async () => {
    const { result, workflowId } = await setup({ pollsUntilDone: 2, throttledPolls: [1] });
    const updates: BlockWorkflowSnapshot[] = [];
    await act(async () => {
      await result.current.watch(workflowId, {
        intervalMs: 1,
        waitSeconds: 0,
        onUpdate: (s) => updates.push(s),
      });
    });

    expect(polls()).toBe(3);
    expect(updates.map((s) => [s.status, s.eta?.progress ?? null])).toEqual([
      ['processing', 0.5],
      ['succeeded', null],
    ]);
  });

  it('the latest snapshot stays the previous REAL one, for the hook result and the resolved value', async () => {
    // Every poll after the first is throttled, so the watch runs out its budget
    // holding the one real (running) snapshot.
    const { result, workflowId } = await setup({
      pollsUntilDone: 2,
      throttledPolls: Array.from({ length: 500 }, (_, i) => i + 2),
    });
    let resolved!: BlockWorkflowSnapshot;
    const updates: BlockWorkflowSnapshot[] = [];
    await act(async () => {
      resolved = await result.current.watch(workflowId, {
        intervalMs: 5,
        waitSeconds: 0,
        timeoutMs: 150,
        onUpdate: (s) => updates.push(s),
      });
    });

    expect(polls()).toBeGreaterThan(2);
    expect(updates).toHaveLength(1);
    expect(resolved).toBe(updates[0]);
    expect(resolved.throttled).toBeUndefined();
    expect(resolved.eta?.progress).toBe(0.5);
    await waitFor(() => expect(result.current.result?.eta?.progress).toBe(0.5));
    expect(result.current.result?.throttled).toBeUndefined();
  });

  it('poll(): a throttled reply is returned as such but does not replace the hook result', async () => {
    const { result, workflowId } = await setup({ pollsUntilDone: 2, throttledPolls: [2] });
    let first!: BlockWorkflowSnapshot;
    let second!: BlockWorkflowSnapshot;
    await act(async () => {
      first = await result.current.poll(workflowId);
    });
    await act(async () => {
      second = await result.current.poll(workflowId);
    });

    expect(first.eta?.progress).toBe(0.5);
    expect(second).toEqual({ workflowId, status: 'processing', throttled: true });
    expect(result.current.result).toEqual(first);
  });
});
