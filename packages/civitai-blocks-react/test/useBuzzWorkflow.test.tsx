import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const PARENT_ORIGIN = 'https://civitai.com';

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

describe('useBuzzWorkflow', () => {
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

  it('starts idle with no result', () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('estimate() sends ESTIMATE_WORKFLOW and transitions idle→estimating→confirming', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    let estimatePromise!: Promise<unknown>;
    act(() => {
      estimatePromise = result.current.estimate({ kind: 'textToImage', modelId: 7, modelVersionId: 99, params: { prompt: 'cat' } });
    });
    expect(result.current.status).toBe('estimating');

    const sent = postMessageMock.mock.calls[0][0] as { type: string; payload: { requestId: string; body: unknown } };
    expect(sent.type).toBe('ESTIMATE_WORKFLOW');
    expect(sent.payload.body).toEqual({ kind: 'textToImage', modelId: 7, modelVersionId: 99, params: { prompt: 'cat' } });

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'ESTIMATE_RESULT',
            payload: {
              requestId: sent.payload.requestId,
              snapshot: { workflowId: 'est-1', status: 'pending', cost: { total: 5 } },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await estimatePromise;
    await waitFor(() => expect(result.current.status).toBe('confirming'));
    expect(result.current.result?.cost?.total).toBe(5);
  });

  it('submit() sends SUBMIT_WORKFLOW and transitions to polling for in-flight workflows', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    let submitPromise!: Promise<unknown>;
    act(() => {
      submitPromise = result.current.submit({ kind: 'textToImage', modelId: 7, modelVersionId: 99, params: { prompt: 'cat' } });
    });
    expect(result.current.status).toBe('submitting');

    const sent = postMessageMock.mock.calls[0][0] as { type: string; payload: { requestId: string } };
    expect(sent.type).toBe('SUBMIT_WORKFLOW');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'WORKFLOW_SUBMITTED',
            payload: {
              requestId: sent.payload.requestId,
              snapshot: { workflowId: 'wf-1', status: 'processing' },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await submitPromise;
    await waitFor(() => expect(result.current.status).toBe('polling'));
    expect(result.current.result?.workflowId).toBe('wf-1');
  });

  it('submit() forwards an optional accountType preference on the body unchanged', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    let submitPromise!: Promise<unknown>;
    act(() => {
      submitPromise = result.current.submit({
        kind: 'textToImage',
        modelId: 7,
        modelVersionId: 99,
        accountType: 'yellow',
        params: { prompt: 'cat' },
      });
    });

    const sent = postMessageMock.mock.calls[0][0] as {
      type: string;
      payload: { requestId: string; body: { accountType?: string } };
    };
    expect(sent.type).toBe('SUBMIT_WORKFLOW');
    // The whole body — accountType included — rides through SUBMIT_WORKFLOW unchanged.
    expect(sent.payload.body).toEqual({
      kind: 'textToImage',
      modelId: 7,
      modelVersionId: 99,
      accountType: 'yellow',
      params: { prompt: 'cat' },
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'WORKFLOW_SUBMITTED',
            payload: {
              requestId: sent.payload.requestId,
              // Host echoes the primary-funder pool back on the snapshot.
              snapshot: { workflowId: 'wf-1', status: 'processing', spentAccountType: 'yellow' },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await submitPromise;
    await waitFor(() => expect(result.current.result?.spentAccountType).toBe('yellow'));
  });

  it('submit() tolerates a slow host past the 30s default request timeout', async () => {
    // Regression: submitWorkflow does two orchestrator round-trips +
    // prompt audit server-side, so it can take >30s on a busy queue. The
    // hook must give SUBMIT_WORKFLOW a raised timeout (120s) rather than
    // the transport's 30s default, or a healthy-but-slow submit surfaces
    // as a spurious `request "SUBMIT_WORKFLOW" timed out` rejection.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useBuzzWorkflow());

      let rejected = false;
      act(() => {
        result.current
          .submit({ kind: 'textToImage', modelId: 7, modelVersionId: 99, params: { prompt: 'cat' } })
          .catch(() => {
            rejected = true;
          });
      });
      expect(result.current.status).toBe('submitting');

      // Advance 60s — well past the old 30s default, well under 120s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(rejected).toBe(false);
      expect(result.current.status).toBe('submitting');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Idempotency (item 2, gen half) ──────────────────────────────────────────

  function replySubmitted(requestId: string) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'WORKFLOW_SUBMITTED',
            payload: { requestId, snapshot: { workflowId: 'wf-1', status: 'processing' } },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });
  }

  it('submit() attaches a non-empty auto-generated idempotencyKey to the payload', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    let submitPromise!: Promise<unknown>;
    act(() => {
      submitPromise = result.current.submit({
        kind: 'textToImage',
        modelId: 7,
        modelVersionId: 99,
        params: { prompt: 'cat' },
      });
    });
    const sent = postMessageMock.mock.calls[0][0] as {
      type: string;
      payload: { requestId: string; body: unknown; idempotencyKey?: unknown };
    };
    expect(sent.type).toBe('SUBMIT_WORKFLOW');
    expect(typeof sent.payload.idempotencyKey).toBe('string');
    expect((sent.payload.idempotencyKey as string).length).toBeGreaterThan(0);
    // The body is unchanged — the key rides ALONGSIDE it, not inside it.
    expect(sent.payload.body).toEqual({
      kind: 'textToImage',
      modelId: 7,
      modelVersionId: 99,
      params: { prompt: 'cat' },
    });
    replySubmitted(sent.payload.requestId);
    await submitPromise;
  });

  it('submit() reuses a caller-supplied stable idempotencyKey (retry-safe)', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const body = { kind: 'textToImage' as const, modelId: 7, modelVersionId: 99, params: { prompt: 'cat' } };

    // First attempt with an explicit key.
    let p1!: Promise<unknown>;
    act(() => {
      p1 = result.current.submit(body, { idempotencyKey: 'stable-key-abc' });
    });
    const s1 = postMessageMock.mock.calls[0][0] as { payload: { requestId: string; idempotencyKey?: unknown } };
    expect(s1.payload.idempotencyKey).toBe('stable-key-abc');
    replySubmitted(s1.payload.requestId);
    await p1;

    // A RETRY of the same logical submit reuses the SAME key → the host+server
    // collapse it to one Buzz charge.
    postMessageMock.mockClear();
    let p2!: Promise<unknown>;
    act(() => {
      p2 = result.current.submit(body, { idempotencyKey: 'stable-key-abc' });
    });
    const s2 = postMessageMock.mock.calls[0][0] as { payload: { requestId: string; idempotencyKey?: unknown } };
    expect(s2.payload.idempotencyKey).toBe('stable-key-abc');
    replySubmitted(s2.payload.requestId);
    await p2;
  });

  it('two auto-keyed submits get DIFFERENT keys (each call is a new logical submit)', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const body = { kind: 'textToImage' as const, modelId: 7, modelVersionId: 99, params: { prompt: 'cat' } };

    let p1!: Promise<unknown>;
    act(() => {
      p1 = result.current.submit(body);
    });
    const s1 = postMessageMock.mock.calls[0][0] as { payload: { requestId: string; idempotencyKey: string } };
    replySubmitted(s1.payload.requestId);
    await p1;

    postMessageMock.mockClear();
    let p2!: Promise<unknown>;
    act(() => {
      p2 = result.current.submit(body);
    });
    const s2 = postMessageMock.mock.calls[0][0] as { payload: { requestId: string; idempotencyKey: string } };
    replySubmitted(s2.payload.requestId);
    await p2;

    expect(s1.payload.idempotencyKey).not.toBe(s2.payload.idempotencyKey);
  });

  it('poll() to a terminal status transitions to done', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    let pollPromise!: Promise<unknown>;
    act(() => {
      pollPromise = result.current.poll('wf-1');
    });
    const sent = postMessageMock.mock.calls[0][0] as { type: string; payload: { requestId: string; workflowId: string } };
    expect(sent.type).toBe('POLL_WORKFLOW');
    expect(sent.payload.workflowId).toBe('wf-1');

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'WORKFLOW_STATUS',
            payload: {
              requestId: sent.payload.requestId,
              snapshot: { workflowId: 'wf-1', status: 'succeeded', imageUrls: ['https://cdn/x.png'] },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    await pollPromise;
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.result?.imageUrls).toEqual(['https://cdn/x.png']);
  });
});
