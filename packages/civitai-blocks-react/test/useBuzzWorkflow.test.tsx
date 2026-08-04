import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { DEFAULT_WATCH_WAIT_SECONDS, useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
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

  // -------------------------------------------------------------------------
  // watch() — the PUSH-shaped API that replaces the caller's own timer loop.
  //
  // Snapshot fields are pairwise DISTINCT (workflowId, status, cost, imageUrls)
  // so an implementation that returns the wrong attempt's snapshot, or replays
  // a stale one, fails instead of coincidentally passing.
  // -------------------------------------------------------------------------
  type PollSeen = { requestId: string; workflowId: string; waitSeconds?: number };

  /**
   * Auto-answer every POLL_WORKFLOW with the next entry of `script`, and record
   * what the hook actually sent. `null` means "reply with no snapshot" — the
   * malformed-reply path, which is how a transport failure surfaces here.
   * The last entry repeats if the loop polls more times than scripted.
   */
  function scriptPolls(script: Array<Record<string, unknown> | null>) {
    const seen: PollSeen[] = [];
    let i = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    postMessageMock.mockImplementation((msg: { type: string; payload: PollSeen }) => {
      if (msg?.type !== 'POLL_WORKFLOW') return;
      seen.push(msg.payload);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const next = script[Math.min(i, script.length - 1)];
      i += 1;
      setTimeout(() => {
        inFlight -= 1;
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'WORKFLOW_STATUS',
              payload: { requestId: msg.payload.requestId, ...(next ? { snapshot: next } : {}) },
            },
            origin: PARENT_ORIGIN,
          }),
        );
      }, 1);
    });
    return { seen, peakInFlight: () => maxInFlight };
  }

  it('watch() resolves on a workflow that completes inside the first wait window', async () => {
    const { seen } = scriptPolls([
      { workflowId: 'wf-fast', status: 'succeeded', cost: { total: 11 }, imageUrls: ['a.png'] },
    ]);
    const { result } = renderHook(() => useBuzzWorkflow());
    const updates: Array<Record<string, unknown>> = [];

    let p!: Promise<{ status: string; cost?: { total: number } }>;
    act(() => {
      p = result.current.watch('wf-fast', {
        onUpdate: (s) => updates.push(s as unknown as Record<string, unknown>),
      }) as never;
    });
    const done = await p;

    expect(seen).toHaveLength(1);
    expect(done.status).toBe('succeeded');
    expect(done.cost?.total).toBe(11);
    expect(updates).toHaveLength(1);
    await waitFor(() => expect(result.current.status).toBe('done'));
  });

  it('watch() RE-ARMS when the hold elapses non-terminal (202) and pushes every snapshot in order', async () => {
    const { seen } = scriptPolls([
      { workflowId: 'wf-rearm', status: 'processing', cost: { total: 22 } },
      { workflowId: 'wf-rearm', status: 'processing', cost: { total: 33 } },
      { workflowId: 'wf-rearm', status: 'succeeded', cost: { total: 44 }, imageUrls: ['z.png'] },
    ]);
    const { result } = renderHook(() => useBuzzWorkflow());
    const costs: number[] = [];

    let p!: Promise<{ status: string; cost?: { total: number } }>;
    act(() => {
      p = result.current.watch('wf-rearm', {
        intervalMs: 1,
        onUpdate: (s) => costs.push((s as unknown as { cost: { total: number } }).cost.total),
      }) as never;
    });
    const done = await p;

    expect(seen).toHaveLength(3);
    // Distinct costs: a loop that replayed the first snapshot would read [22,22,22].
    expect(costs).toEqual([22, 33, 44]);
    expect(done.cost?.total).toBe(44);
    expect(done.status).toBe('succeeded');
  });

  it('watch() RESOLVES (not rejects) on a terminal failure', async () => {
    scriptPolls([{ workflowId: 'wf-dead', status: 'failed', cost: { total: 55 } }]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let p!: Promise<{ status: string }>;
    act(() => {
      p = result.current.watch('wf-dead', { intervalMs: 1 }) as never;
    });
    const done = await p;

    expect(done.status).toBe('failed');
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.error).toBeNull();
  });

  it('watch() CANCELLATION resolves with the last snapshot and stops polling', async () => {
    const { seen } = scriptPolls([{ workflowId: 'wf-cancel', status: 'processing', cost: { total: 66 } }]);
    const ctl = new AbortController();
    const { result } = renderHook(() => useBuzzWorkflow());

    let p!: Promise<{ status: string; cost?: { total: number } }>;
    act(() => {
      p = result.current.watch('wf-cancel', { intervalMs: 30, signal: ctl.signal }) as never;
    });
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(1));
    ctl.abort();
    const done = await p;
    const atAbort = seen.length;

    expect(done.status).toBe('processing');
    expect(done.cost?.total).toBe(66);
    // No further polls after the abort — the loop really stopped.
    await new Promise((r) => setTimeout(r, 120));
    expect(seen.length).toBe(atAbort);
  });

  it('watch() rejects with AbortError when the signal is already aborted (no poll issued)', async () => {
    const { seen } = scriptPolls([{ workflowId: 'wf-pre', status: 'processing' }]);
    const ctl = new AbortController();
    ctl.abort();
    const { result } = renderHook(() => useBuzzWorkflow());

    let p!: Promise<unknown>;
    act(() => {
      p = result.current.watch('wf-pre', { signal: ctl.signal });
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toHaveLength(0);
  });

  it('watch() requests a long-poll hold by default and omits it when waitSeconds is 0', async () => {
    const a = scriptPolls([{ workflowId: 'wf-w1', status: 'succeeded' }]);
    const { result } = renderHook(() => useBuzzWorkflow());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.watch('wf-w1');
    });
    await p;
    expect(a.seen[0].waitSeconds).toBe(DEFAULT_WATCH_WAIT_SECONDS);

    const b = scriptPolls([{ workflowId: 'wf-w2', status: 'succeeded' }]);
    act(() => {
      p = result.current.watch('wf-w2', { waitSeconds: 0 });
    });
    await p;
    // Absent, not 0 — the message stays byte-identical to a pre-watch block's.
    expect('waitSeconds' in b.seen[0]).toBe(false);
  });

  it('watch() keeps exactly ONE poll in flight at a time (safe to long-poll)', async () => {
    const { seen, peakInFlight } = scriptPolls([
      { workflowId: 'wf-seq', status: 'processing' },
      { workflowId: 'wf-seq', status: 'processing' },
      { workflowId: 'wf-seq', status: 'processing' },
      { workflowId: 'wf-seq', status: 'succeeded' },
    ]);
    const { result } = renderHook(() => useBuzzWorkflow());
    let p!: Promise<unknown>;
    act(() => {
      p = result.current.watch('wf-seq', { intervalMs: 1 });
    });
    await p;

    expect(seen.length).toBeGreaterThanOrEqual(4);
    // The whole safety argument for long polling. A setInterval-driven caller
    // would show a peak well above 1 here.
    expect(peakInFlight()).toBe(1);
  });

  // The reachable transport failure is a REQUEST TIMEOUT (120s) — far too slow
  // to drive through the real iframe path, and a snapshot-less reply is dropped
  // by IframeTransport's own payload validator before it ever resolves. So the
  // retry loop is exercised at the transport seam, which is the unit under test
  // here: `watch`'s failure accounting, not the transport's validation.
  function stubSendRequest(script: Array<Record<string, unknown> | Error>) {
    let i = 0;
    const attempts: Array<Record<string, unknown>> = [];
    return vi
      .spyOn(getTransport(), 'sendRequest')
      .mockImplementation(async (request: { payload?: Record<string, unknown> }) => {
        attempts.push(request.payload ?? {});
        const next = script[Math.min(i, script.length - 1)];
        i += 1;
        if (next instanceof Error) throw next;
        return { snapshot: next };
      }) && { attempts };
  }

  it('watch() absorbs a transient poll failure and keeps going', async () => {
    const { attempts } = stubSendRequest([
      { workflowId: 'wf-blip', status: 'processing', cost: { total: 77 } },
      new Error('transport blip'),
      { workflowId: 'wf-blip', status: 'succeeded', cost: { total: 88 } },
    ]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let p!: Promise<{ status: string; cost?: { total: number } }>;
    act(() => {
      p = result.current.watch('wf-blip', { intervalMs: 1 }) as never;
    });
    const done = await p;

    expect(attempts).toHaveLength(3);
    // Distinct costs: a run that stopped at the blip would read 77.
    expect(done.cost?.total).toBe(88);
    expect(done.status).toBe('succeeded');
  });

  it('watch() rejects and flips status to error once maxRetries is exceeded', async () => {
    const { attempts } = stubSendRequest([new Error('host is down')]);
    const { result } = renderHook(() => useBuzzWorkflow());

    let p!: Promise<unknown>;
    act(() => {
      p = result.current.watch('wf-broken', { intervalMs: 1, maxRetries: 2 });
    });
    await expect(p).rejects.toThrow('host is down');
    // 1 initial attempt + 2 retries, then give up — not an unbounded loop.
    expect(attempts).toHaveLength(3);
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
