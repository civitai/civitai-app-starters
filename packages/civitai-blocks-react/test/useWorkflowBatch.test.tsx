import { StrictMode, createElement } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload, BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import { WORKFLOW_BATCH_MAX_CELLS, useWorkflowBatch } from '../src/hooks/useWorkflowBatch.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useWorkflowBatch` against a scripted host: every reply is produced by the
 * responder below from a per-workflow script, so each assertion is about what
 * the HOOK does with a given sequence of wire replies.
 *
 * Costs are pairwise distinct (12, 31, 7) and the totals are literals, so a
 * summary that dropped, double-counted or mis-bucketed a cell is visible.
 */

const PARENT_ORIGIN = 'https://civitai.com';
const FAST = { intervalMs: 1, waitSeconds: 0 } as const;

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

type Snap = BlockWorkflowSnapshot;
const processing = (workflowId: string): Snap => ({ workflowId, status: 'processing' });
const terminal = (workflowId: string, status: Snap['status'], total?: number): Snap => ({
  workflowId,
  status,
  ...(total === undefined ? {} : { cost: { total } }),
});
/** The host's `failureSnapshot(err)`: what a host-side throw reaches the block as. */
const placeholder = (error = 'orchestrator read timed out'): Snap => ({
  workflowId: 'failed',
  status: 'failed',
  error,
});

type Sent = { type: string; payload: { requestId: string; workflowId: string } };

describe('useWorkflowBatch', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;
  /** Per workflow: the replies to successive polls. The last one repeats. */
  let pollScript: Record<string, Snap[]>;
  /** Per workflow: the reply to a cancel. Absent → `canceled`. */
  let cancelScript: Record<string, Snap>;
  /** Per workflow: ms before the cancel reply is sent. Absent → 0. */
  let cancelDelay: Record<string, number>;
  /** When set, POLL replies are held here instead of being sent. */
  let heldPolls: Array<() => void> | null;

  const sent = (type: string): Sent[] =>
    postMessageMock.mock.calls.map((c) => c[0] as Sent).filter((m) => m?.type === type);
  const polls = (id?: string) =>
    sent('POLL_WORKFLOW').filter((m) => id === undefined || m.payload.workflowId === id);

  function dispatch(type: string, payload: unknown): void {
    window.dispatchEvent(new MessageEvent('message', { data: { type, payload }, origin: PARENT_ORIGIN }));
  }

  beforeEach(() => {
    pollScript = {};
    cancelScript = {};
    cancelDelay = {};
    heldPolls = null;
    postMessageMock = vi.fn((msg: Sent) => {
      const { requestId, workflowId } = msg.payload ?? ({} as Sent['payload']);
      if (msg.type === 'POLL_WORKFLOW') {
        const script = pollScript[workflowId] ?? [processing(workflowId)];
        const snapshot = script.length > 1 ? script.shift()! : script[0]!;
        const send = () => dispatch('WORKFLOW_STATUS', { requestId, snapshot });
        if (heldPolls) heldPolls.push(send);
        else setTimeout(send, 0);
      } else if (msg.type === 'CANCEL_WORKFLOW') {
        const snapshot = cancelScript[workflowId] ?? terminal(workflowId, 'canceled');
        setTimeout(
          () => dispatch('WORKFLOW_CANCELED', { requestId, snapshot }),
          cancelDelay[workflowId] ?? 0,
        );
      }
    });
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    dispatch('BLOCK_INIT', buildInit());
    postMessageMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    resetTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('summarises every cell from its latest snapshot: counts by status, realised cost, running', async () => {
    pollScript = {
      a: [processing('a'), terminal('a', 'succeeded', 12)],
      b: [terminal('b', 'failed', 31)],
      c: [processing('c'), processing('c'), terminal('c', 'canceled', 7)],
      d: [processing('d')],
      e: [terminal('e', 'expired')],
    };
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const { result, unmount } = renderHook(() => useWorkflowBatch(ids, FAST));

    await waitFor(() => expect(result.current.summary.running).toBe(1));
    expect(result.current.summary).toEqual({
      total: 5,
      running: 1,
      succeeded: 1,
      failed: 1,
      canceled: 1,
      expired: 1,
      stopped: 0,
      realisedCost: 50,
      costedCells: 3,
      settled: false,
    });
    expect(result.current.cells.map((c) => [c.workflowId, c.phase, c.snapshot?.status])).toEqual([
      ['a', 'settled', 'succeeded'],
      ['b', 'settled', 'failed'],
      ['c', 'settled', 'canceled'],
      ['d', 'watching', 'processing'],
      ['e', 'settled', 'expired'],
    ]);
    unmount();
  });

  it('PARTIAL FAILURE: a host failure placeholder on a poll stops that cell; it is NOT counted as a failed workflow', async () => {
    pollScript = {
      a: [terminal('a', 'succeeded', 12)],
      b: [processing('b'), placeholder()],
      c: [terminal('c', 'succeeded', 31)],
    };
    const { result } = renderHook(() => useWorkflowBatch(['a', 'b', 'c'], FAST));

    await waitFor(() => expect(result.current.cells[1]?.phase).toBe('stopped'));
    const b = result.current.cells[1]!;
    // The last snapshot that was actually about `b` is kept; the placeholder is not.
    expect(b.snapshot).toEqual(processing('b'));
    expect(b.error).toBeInstanceOf(Error);
    await waitFor(() => expect(result.current.summary.succeeded).toBe(2));
    expect(result.current.summary).toMatchObject({
      failed: 0,
      running: 1,
      stopped: 1,
      realisedCost: 43,
      settled: false,
    });
  });

  it('rewatch() restarts a stopped cell and it settles', async () => {
    pollScript = { b: [placeholder(), terminal('b', 'succeeded', 31)] };
    const { result } = renderHook(() => useWorkflowBatch(['b'], FAST));
    await waitFor(() => expect(result.current.cells[0]?.phase).toBe('stopped'));
    act(() => result.current.rewatch());
    await waitFor(() => expect(result.current.summary.settled).toBe(true));
    expect(result.current.cells[0]).toMatchObject({ phase: 'settled', error: null });
    expect(result.current.summary.realisedCost).toBe(31);
  });

  it('cancelAll with ONE REFUSED cancel: reports it, sends nothing more, and leaves that cell running', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    cancelScript = { b: processing('b') };
    // The refusal is the first answer back, so every worker sees it before it
    // picks up another cell.
    cancelDelay = { a: 15, c: 15, d: 15 };
    const { result } = renderHook(() => useWorkflowBatch(ids, FAST));
    await waitFor(() => expect(result.current.cells.every((c) => c.snapshot !== null)).toBe(true));

    let outcome!: Awaited<ReturnType<typeof result.current.cancelAll>>;
    await act(async () => {
      outcome = await result.current.cancelAll();
    });

    expect(outcome).toEqual({
      canceled: ['a', 'c', 'd'],
      alreadySettled: [],
      refused: ['b'],
      notAttempted: ['e', 'f'],
      failed: [],
      complete: false,
    });
    // Four in flight at once; after the refusal nothing else is sent.
    expect(sent('CANCEL_WORKFLOW').map((m) => m.payload.workflowId)).toEqual(['a', 'b', 'c', 'd']);
    const b = result.current.cells[1]!;
    expect(b).toMatchObject({ cancel: 'refused', phase: 'watching' });
    expect(b.snapshot?.status).toBe('processing');
    expect(result.current.summary).toMatchObject({ canceled: 3, running: 3, settled: false });

    // Retrying targets only the cells that are still not finished.
    cancelScript = {};
    postMessageMock.mockClear();
    await act(async () => {
      outcome = await result.current.cancelAll();
    });
    expect(sent('CANCEL_WORKFLOW').map((m) => m.payload.workflowId)).toEqual(['b', 'e', 'f']);
    expect(outcome).toMatchObject({
      canceled: ['b', 'e', 'f'],
      alreadySettled: ['a', 'c', 'd'],
      complete: true,
    });
    expect(result.current.summary).toMatchObject({ canceled: 6, settled: true });
  });

  it('cancelAll: a host failure placeholder is a FAILED cancel, not a failed workflow; a raced finish is alreadySettled', async () => {
    pollScript = { z: [terminal('z', 'succeeded', 7)] };
    cancelScript = { x: placeholder('ownership check failed'), y: terminal('y', 'succeeded', 12) };
    const { result } = renderHook(() => useWorkflowBatch(['x', 'y', 'z'], FAST));
    await waitFor(() => expect(result.current.cells[2]?.phase).toBe('settled'));

    let outcome!: Awaited<ReturnType<typeof result.current.cancelAll>>;
    await act(async () => {
      outcome = await result.current.cancelAll();
    });
    expect(outcome).toEqual({
      canceled: [],
      alreadySettled: ['y', 'z'],
      refused: [],
      notAttempted: [],
      failed: ['x'],
      complete: false,
    });
    // `z` was already terminal, so no request was sent for it.
    expect(sent('CANCEL_WORKFLOW').map((m) => m.payload.workflowId)).toEqual(['x', 'y']);
    expect(result.current.cells[0]).toMatchObject({ cancel: 'failed' });
    expect(result.current.cells[0]?.snapshot?.workflowId).toBe('x');
    expect(result.current.summary).toMatchObject({ failed: 0, succeeded: 2, realisedCost: 19 });
  });

  it('cancelAll called twice while running returns the same promise', async () => {
    const { result } = renderHook(() => useWorkflowBatch(['a'], FAST));
    await waitFor(() => expect(result.current.cells[0]?.snapshot).not.toBeNull());
    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    await act(async () => {
      p1 = result.current.cancelAll();
      p2 = result.current.cancelAll();
      await p1;
    });
    expect(p1).toBe(p2);
    expect(sent('CANCEL_WORKFLOW')).toHaveLength(1);
  });

  it('RE-ATTACH: a fresh hook given saved ids watches exactly those workflows to completion', async () => {
    const saved = JSON.parse(JSON.stringify(['wf_saved_1', 'wf_saved_2'])) as string[];
    pollScript = {
      wf_saved_1: [processing('wf_saved_1'), terminal('wf_saved_1', 'succeeded', 12)],
      wf_saved_2: [terminal('wf_saved_2', 'succeeded', 31)],
    };
    const { result } = renderHook(() => useWorkflowBatch(saved, FAST));
    await waitFor(() => expect(result.current.summary.settled).toBe(true));
    expect(result.current.summary).toMatchObject({ total: 2, succeeded: 2, realisedCost: 43 });
    expect(new Set(polls().map((m) => m.payload.workflowId))).toEqual(new Set(saved));
  });

  it('appending an id starts only that cell; a new array with the same ids restarts nothing', async () => {
    pollScript = { a: [terminal('a', 'succeeded', 12)], b: [terminal('b', 'succeeded', 31)] };
    const { result, rerender } = renderHook(({ ids }) => useWorkflowBatch(ids, FAST), {
      initialProps: { ids: ['a'] },
    });
    await waitFor(() => expect(result.current.summary.settled).toBe(true));
    expect(polls('a')).toHaveLength(1);

    rerender({ ids: ['a'] });
    rerender({ ids: ['a', 'b'] });
    await waitFor(() => expect(result.current.summary.succeeded).toBe(2));
    expect(polls('a')).toHaveLength(1);
    expect(polls('b')).toHaveLength(1);
  });

  it('UNMOUNT stops polling', async () => {
    const { result, unmount } = renderHook(() => useWorkflowBatch(['a', 'b'], FAST));
    await waitFor(() => expect(polls().length).toBeGreaterThanOrEqual(4));
    expect(result.current.summary.running).toBe(2);
    unmount();
    // Let any poll already in flight land, then measure.
    await new Promise((r) => setTimeout(r, 20));
    const after = polls().length;
    await new Promise((r) => setTimeout(r, 50));
    expect(polls().length).toBe(after);
  });

  it('keeps ONE poll in flight per workflow when an id is removed and re-added mid-poll', async () => {
    heldPolls = [];
    const { result, rerender } = renderHook(({ ids }) => useWorkflowBatch(ids, FAST), {
      initialProps: { ids: ['a'] },
    });
    await waitFor(() => expect(polls('a')).toHaveLength(1));
    // Remove `a` while its poll is held, then add it back. The old loop is
    // aborted but its poll is still in flight, so the new loop must wait.
    rerender({ ids: [] });
    rerender({ ids: ['a'] });
    await new Promise((r) => setTimeout(r, 20));
    expect(polls('a')).toHaveLength(1);

    pollScript = { a: [terminal('a', 'succeeded', 12)] };
    const release = heldPolls;
    heldPolls = null;
    act(() => release.splice(0).forEach((send) => send()));
    await waitFor(() => expect(result.current.summary.settled).toBe(true));
    expect(polls('a')).toHaveLength(2);
  });

  it('survives a StrictMode remount: one poll in flight, and the cell still settles', async () => {
    heldPolls = [];
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const { result } = renderHook(() => useWorkflowBatch(['a'], FAST), { wrapper });
    await waitFor(() => expect(polls('a')).toHaveLength(1));
    // The remount aborted the first loop and started a second one, but the
    // first loop's poll is still in flight, so the second must wait for it.
    await new Promise((r) => setTimeout(r, 20));
    expect(polls('a')).toHaveLength(1);

    pollScript = { a: [terminal('a', 'succeeded', 12)] };
    const release = heldPolls;
    heldPolls = null;
    act(() => release.splice(0).forEach((send) => send()));
    await waitFor(() => expect(result.current.summary.settled).toBe(true));
  });

  it('refuses a list it cannot watch correctly', () => {
    const tooMany = Array.from({ length: WORKFLOW_BATCH_MAX_CELLS + 1 }, (_, i) => `wf_${i}`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useWorkflowBatch(tooMany))).toThrow(RangeError);
    expect(() => renderHook(() => useWorkflowBatch(['a', 'a']))).toThrow(/more than once/);
    expect(() => renderHook(() => useWorkflowBatch(['failed']))).toThrow(/not a workflow id/);
    expect(() => renderHook(() => useWorkflowBatch(['']))).toThrow(TypeError);
    expect(WORKFLOW_BATCH_MAX_CELLS).toBe(30);
  });
});
