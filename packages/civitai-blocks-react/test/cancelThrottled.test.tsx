import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow, WorkflowCancelNotIssuedError } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * `cancel()` against a THROTTLED reply — `{ workflowId, status: 'processing',
 * throttled: true }`, the host's answer to a request it could not serve
 * (civitai/civitai#8980). The cancel was NOT issued, so it must not be read as
 * an outcome: the hook's `result`, `status` and `error` stay as they were, and
 * the call rejects with `WorkflowCancelNotIssuedError` so the caller retries.
 * Driven through the real transport: `postMessage` → validation → projection →
 * the hook.
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
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

const RUNNING = {
  workflowId: 'wf_1',
  status: 'processing',
  eta: { stepName: 'gen', queuedAhead: null, startsAt: null, completesAt: null, progress: 0.42, support: null },
};

describe('useBuzzWorkflow().cancel — throttled reply', () => {
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
      new MessageEvent('message', { data: { type: 'BLOCK_INIT', payload: buildInit() }, origin: PARENT_ORIGIN }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
  });

  /** Answer the most recent outbound request of `type` with `replyType` + `snapshot`. */
  function answer(type: string, replyType: string, snapshot: Record<string, unknown>) {
    const sent = postMessageMock.mock.calls
      .map((c) => c[0] as { type: string; payload: { requestId: string } })
      .filter((m) => m.type === type)
      .at(-1)!;
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: replyType, payload: { requestId: sent.payload.requestId, snapshot } },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  async function polled() {
    const hook = renderHook(() => useBuzzWorkflow());
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.poll('wf_1');
    });
    answer('POLL_WORKFLOW', 'WORKFLOW_STATUS', RUNNING);
    await act(async () => {
      await pending;
    });
    await waitFor(() => expect(hook.result.current.result?.eta?.progress).toBe(0.42));
    expect(hook.result.current.status).toBe('polling');
    return hook;
  }

  it('rejects with WorkflowCancelNotIssuedError and leaves result, status and error untouched', async () => {
    const { result } = await polled();
    const before = result.current.result;

    let outcome!: Promise<unknown>;
    act(() => {
      outcome = result.current.cancel('wf_1').then(
        (s) => ({ resolved: s }),
        (e: unknown) => e,
      );
    });
    answer('CANCEL_WORKFLOW', 'WORKFLOW_CANCELED', { workflowId: 'wf_1', status: 'processing', throttled: true });
    let err!: unknown;
    await act(async () => {
      err = await outcome;
    });

    expect(err).toBeInstanceOf(WorkflowCancelNotIssuedError);
    const e = err as WorkflowCancelNotIssuedError;
    expect(e.code).toBe('cancel-not-issued');
    expect(e.workflowId).toBe('wf_1');
    expect(e.snapshot).toEqual({ workflowId: 'wf_1', status: 'processing', throttled: true });
    expect(e.message).toMatch(/not issued/i);

    expect(result.current.result).toBe(before);
    expect(result.current.result?.eta?.progress).toBe(0.42);
    expect(result.current.status).toBe('polling');
    expect(result.current.error).toBeNull();
  });

  it('a normal cancel is unchanged: resolves the canceled snapshot and settles the hook', async () => {
    const { result } = await polled();

    let outcome!: Promise<unknown>;
    act(() => {
      outcome = result.current.cancel('wf_1');
    });
    answer('CANCEL_WORKFLOW', 'WORKFLOW_CANCELED', { workflowId: 'wf_1', status: 'canceled' });
    let resolved!: unknown;
    await act(async () => {
      resolved = await outcome;
    });

    expect(resolved).toEqual({ workflowId: 'wf_1', status: 'canceled' });
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.result).toEqual({ workflowId: 'wf_1', status: 'canceled' });
    expect(result.current.error).toBeNull();
  });
});
