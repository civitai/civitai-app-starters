import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppWorkflow, BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useAppWorkflows } from '../src/hooks/useAppWorkflows.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: ['ai:write:budgeted'], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  };
}

const DONE: AppWorkflow = {
  workflowId: 'wf_2',
  status: 'succeeded',
  images: [
    { url: 'https://image.civitai.com/x/a.jpeg', width: 1024, height: 1024, nsfwLevel: 1 },
    { url: 'https://image.civitai.com/x/b.jpeg', width: null, height: null, nsfwLevel: null },
  ],
  cost: 12,
  createdAt: '2026-07-14T12:00:00.000Z',
};
const PENDING: AppWorkflow = {
  workflowId: 'wf_1',
  status: 'processing',
  images: [],
  cost: null,
  createdAt: '2026-07-14T11:58:00.000Z',
};

function calls(mock: ReturnType<typeof vi.fn>, type: string) {
  return mock.mock.calls.filter((c) => c[0]?.type === type);
}
function lastQuery(mock: ReturnType<typeof vi.fn>): { payload: { requestId: string; params?: unknown } } {
  const c = calls(mock, 'QUERY_APP_WORKFLOWS');
  return c[c.length - 1]![0] as { payload: { requestId: string; params?: unknown } };
}
function lastCancel(mock: ReturnType<typeof vi.fn>): { payload: { requestId: string; workflowId: string } } {
  const c = calls(mock, 'CANCEL_APP_WORKFLOW');
  return c[c.length - 1]![0] as { payload: { requestId: string; workflowId: string } };
}
function dispatch(type: string, payload: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type, payload }, origin: PARENT_ORIGIN }));
  });
}

describe('useAppWorkflows', () => {
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
    vi.restoreAllMocks();
  });

  it('fetches on mount: posts QUERY_APP_WORKFLOWS (params) → resolves workflows + cursor', async () => {
    const { result } = renderHook(() => useAppWorkflows({ limit: 20 }));

    expect(result.current.loading).toBe(true);
    expect(result.current.workflows).toEqual([]);
    const sent = lastQuery(postMessageMock);
    expect(typeof sent.payload.requestId).toBe('string');
    expect(sent.payload.params).toEqual({ limit: 20 });
    const raw = calls(postMessageMock, 'QUERY_APP_WORKFLOWS')[0];
    expect(raw![1]).toBe(PARENT_ORIGIN);

    dispatch('APP_WORKFLOWS_RESULT', {
      requestId: sent.payload.requestId,
      result: { workflows: [DONE, PENDING], cursor: 'next-abc' },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.workflows).toEqual([DONE, PENDING]);
    expect(result.current.cursor).toBe('next-abc');
  });

  it('omits params from the outbound payload when called with none', async () => {
    renderHook(() => useAppWorkflows());
    const sent = lastQuery(postMessageMock);
    expect(sent.payload).not.toHaveProperty('params');
  });

  it('RESOLVES a null cursor (last/only page) — does not hang', async () => {
    const { result } = renderHook(() => useAppWorkflows());
    dispatch('APP_WORKFLOWS_RESULT', {
      requestId: lastQuery(postMessageMock).payload.requestId,
      result: { workflows: [DONE], cursor: null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cursor).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.workflows).toEqual([DONE]);
  });

  it('surfaces the FREE-TEXT error variant (error string, no result)', async () => {
    const { result } = renderHook(() => useAppWorkflows());
    dispatch('APP_WORKFLOWS_RESULT', {
      requestId: lastQuery(postMessageMock).payload.requestId,
      error: 'block lacks ai:write:budgeted scope',
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('block lacks ai:write:budgeted scope');
    expect(result.current.workflows).toEqual([]);
  });

  it('ignores a response whose requestId does not match', async () => {
    const { result } = renderHook(() => useAppWorkflows());
    const realId = lastQuery(postMessageMock).payload.requestId;

    dispatch('APP_WORKFLOWS_RESULT', { requestId: 'other', result: { workflows: [DONE], cursor: null } });
    await Promise.resolve();
    expect(result.current.loading).toBe(true);

    dispatch('APP_WORKFLOWS_RESULT', { requestId: realId, result: { workflows: [DONE], cursor: null } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workflows).toEqual([DONE]);
  });

  it('refetch() re-requests the page', async () => {
    const { result } = renderHook(() => useAppWorkflows());
    dispatch('APP_WORKFLOWS_RESULT', {
      requestId: lastQuery(postMessageMock).payload.requestId,
      result: { workflows: [PENDING], cursor: null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const before = calls(postMessageMock, 'QUERY_APP_WORKFLOWS').length;
    act(() => result.current.refetch());
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(calls(postMessageMock, 'QUERY_APP_WORKFLOWS').length).toBe(before + 1);

    dispatch('APP_WORKFLOWS_RESULT', {
      requestId: lastQuery(postMessageMock).payload.requestId,
      result: { workflows: [DONE, PENDING], cursor: null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workflows).toEqual([DONE, PENDING]);
  });

  it('cancel(id) posts CANCEL_APP_WORKFLOW and optimistically flips the row to canceled', async () => {
    const { result } = renderHook(() => useAppWorkflows());
    dispatch('APP_WORKFLOWS_RESULT', {
      requestId: lastQuery(postMessageMock).payload.requestId,
      result: { workflows: [DONE, PENDING], cursor: null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let settled: 'resolved' | 'rejected' | null = null;
    act(() => {
      void result.current
        .cancel('wf_1')
        .then(() => (settled = 'resolved'))
        .catch(() => (settled = 'rejected'));
    });
    const sent = lastCancel(postMessageMock);
    expect(sent.payload.workflowId).toBe('wf_1');
    expect(typeof sent.payload.requestId).toBe('string');

    const canceled: AppWorkflow = { ...PENDING, status: 'canceled' };
    dispatch('CANCEL_APP_WORKFLOW_RESULT', { requestId: sent.payload.requestId, result: { workflow: canceled } });

    await waitFor(() => expect(settled).toBe('resolved'));
    // The matching row is replaced in place; the other row is untouched.
    expect(result.current.workflows).toEqual([DONE, canceled]);
  });

  it('cancel(id) rejects on the host error variant (FORBIDDEN) and leaves the list unchanged', async () => {
    const { result } = renderHook(() => useAppWorkflows());
    dispatch('APP_WORKFLOWS_RESULT', {
      requestId: lastQuery(postMessageMock).payload.requestId,
      result: { workflows: [DONE, PENDING], cursor: null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let caught: Error | null = null;
    act(() => {
      void result.current.cancel('wf_1').catch((e: Error) => (caught = e));
    });
    dispatch('CANCEL_APP_WORKFLOW_RESULT', {
      requestId: lastCancel(postMessageMock).payload.requestId,
      error: 'workflow is not in this app subqueue',
    });

    await waitFor(() => expect(caught).not.toBeNull());
    expect((caught as unknown as Error).message).toBe('workflow is not in this app subqueue');
    expect(result.current.workflows).toEqual([DONE, PENDING]);
  });

  it('drops a MALFORMED reply (dropped by the validator) → surfaces an error after the timeout, never hangs', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useAppWorkflows());
      const sent = lastQuery(postMessageMock);
      // A workflow with an empty workflowId is malformed → the transport validator
      // drops it (with a console.warn) → the request must TIME OUT, not hang forever.
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'APP_WORKFLOWS_RESULT',
              payload: { requestId: sent.payload.requestId, result: { workflows: [{ ...DONE, workflowId: '' }], cursor: null } },
            },
            origin: PARENT_ORIGIN,
          }),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.loading).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('APP_WORKFLOWS_RESULT'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.workflows).toEqual([]);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('is unmount-safe: a late reply after unmount does not throw / setState', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result, unmount } = renderHook(() => useAppWorkflows());
      const sent = lastQuery(postMessageMock);
      unmount();
      dispatch('APP_WORKFLOWS_RESULT', {
        requestId: sent.payload.requestId,
        result: { workflows: [DONE], cursor: null },
      });
      await Promise.resolve();
      // No "setState on an unmounted component" warning was logged.
      expect(
        errorSpy.mock.calls.some((c) => String(c[0]).includes('unmounted')),
      ).toBe(false);
      // The last committed value is the pre-unmount empty state.
      expect(result.current.workflows).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
