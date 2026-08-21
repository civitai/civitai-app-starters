import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import {
  DEFAULT_WATCH_WAIT_SECONDS,
  useBuzzWorkflow,
  WorkflowEstimateError,
} from '../src/hooks/useBuzzWorkflow.js';
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

  // ──────────────────────────────────────────────────────────────────────────
  // civitai/civitai#4159 — an estimate with no usable price must not RESOLVE
  //
  // 🔴 THE FIXTURES ARE REAL HOST REPLY *SHAPES*, NOT HAND-ROLLED SENTINELS, and
  // that is the load-bearing property. Each is a VALID snapshot —
  // `isValidWorkflowSnapshot` accepts every one — which is precisely why they
  // used to sail through as resolved estimates. A hand-rolled `{ status:
  // 'failed' }` would go red on the guard while missing that.
  //
  // Precisely, since "real" is a claim worth being exact about: the `workflowId`
  // values below are the server's actual sentinels — `'failed'` from the host's
  // `failureSnapshot`, and `'whatif'` from `snapshotFromWorkflow`'s
  // `workflow.id ?? 'whatif'` on the textToImage estimate path. (`'wf_estimate'`,
  // used by the mock host, is the third real one — emitted by the router's
  // `customComfy` / `step` estimate handlers.) The guard never READS the id, so
  // no assertion here depends on which sentinel is used; they are chosen to match
  // production so the fixtures cannot drift into a shape the server never sends.
  //
  // 🔴 THERE ARE TWO PRODUCERS of the identical observable, and a guard keyed on
  // `status` alone is INERT for the second:
  //   (a) `failureSnapshot(err)` — `{ workflowId:'failed', status:'failed', error }`
  //       (civitai `src/components/AppBlocks/failureSnapshot.ts`, posted from the
  //       catch arms of `PageBlockHost.tsx` / `IframeHost.tsx`).
  //   (b) a SUCCESSFUL snapshot with `cost` omitted — civitai
  //       `src/server/services/blocks/workflow.service.ts:175` drops the key
  //       entirely when the whatIf reply has no numeric total, so the block sees
  //       `{ status:'pending' }` with no `error` at all.
  // Which of the two caused the reported incident is NOT known — the fields that
  // would distinguish them are exactly what the bug discarded.
  // ──────────────────────────────────────────────────────────────────────────

  /** Fire an estimate and hand back a settle-observer + the reply function. */
  function driveEstimate(estimate: (body: never) => Promise<unknown>) {
    let promise!: Promise<unknown>;
    act(() => {
      promise = estimate({
        kind: 'textToImage',
        modelId: 4384,
        modelVersionId: 128713,
        additionalResources: [{ modelVersionId: 87153, strength: 1 }],
        params: { prompt: 'cat' },
      } as never);
    });
    // Own the outcome immediately so a regression is reported by the assertion
    // below rather than as an unhandled rejection.
    const settled = promise.then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    );
    const sent = postMessageMock.mock.calls.at(-1)![0] as {
      type: string;
      payload: { requestId: string };
    };
    expect(sent.type).toBe('ESTIMATE_WORKFLOW');
    const reply = (snapshot: unknown) => {
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'ESTIMATE_RESULT',
              payload: { requestId: sent.payload.requestId, snapshot },
            },
            origin: PARENT_ORIGIN,
          }),
        );
      });
    };
    return { settled, reply };
  }

  it('estimate() REJECTS on producer (a), the host failure snapshot (#4159)', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const { settled, reply } = driveEstimate(result.current.estimate as never);

    reply({
      workflowId: 'failed',
      status: 'failed',
      error: 'a selected LoRA is not compatible with the checkpoint base model',
    });

    const outcome = await settled;
    // 1. It rejects. Before the fix this RESOLVED, and the whole defect follows
    //    from that one fact.
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const err = outcome.e as WorkflowEstimateError;
    expect(err).toBeInstanceOf(WorkflowEstimateError);
    // `name` is asserted separately from `instanceof`: it is what survives a
    // dual-module load (two copies of the package ⇒ `instanceof` is false while
    // the error is the right one), so a caller may legitimately branch on it.
    expect(err.name).toBe('WorkflowEstimateError');
    // 2. Structural discriminator, so callers never pattern-match the prose.
    expect(err.code).toBe('failed');
    // 3. The server's own explanation reaches the caller — on `.snapshot.error`.
    //    It was already on the wire and was being discarded, and that is what
    //    made the dead control undiagnosable rather than merely unusable. THIS
    //    is the documented #4159 reproduction read.
    expect(err.snapshot.error).toBe(
      'a selected LoRA is not compatible with the checkpoint base model',
    );
    // 4. `message` is GENERIC and carries the code — see the leak test below.
    expect(err.message).toBe(
      'estimate did not return a usable price (failed) — reason on .snapshot.error',
    );
    // 5. Nothing reachable before is lost: the raw reply rides on the error.
    expect(err.snapshot.status).toBe('failed');
    // 6. The hook does NOT advertise a confirmable estimate. `'confirming'` is
    //    what a block gates its Confirm button on, and reaching it with no cost
    //    is the "Cost unavailable" dead control in the issue.
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status).not.toBe('confirming');
    expect(result.current.error).toBeInstanceOf(WorkflowEstimateError);
  });

  // 🔴 THE ONLY INPUT THAT MAKES THE `'failed'` ARM NON-REDUNDANT — without it,
  // every other fixture in this file has NO cost, so `!usableCost` would reject
  // them all on its own and the `status==='failed'` arm is never the clause that
  // actually fires. That is the "prove the guard is REACHABLE, not merely
  // breakable" trap: a mutation that deletes the arm still dies, to the other
  // guard, and the arm's own necessity goes untested.
  //
  // The shape is real: a whatIf the ORCHESTRATOR reports as failed maps to
  // `status:'failed'` through the server's `ORCH_STATUS_MAP` and can carry a
  // numeric cost — unlike `failureSnapshot(err)`, which never does. Rejecting is
  // correct: a failed estimate is not a quote you may spend against, and a block
  // must not confirm a charge on the strength of a number attached to it.
  it("estimate() REJECTS a 'failed' snapshot even when it DOES carry a cost (#4159)", async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const { settled, reply } = driveEstimate(result.current.estimate as never);

    reply({ workflowId: 'whatif', status: 'failed', cost: { total: 7 }, error: 'orchestrator whatIf failed' });

    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const err = outcome.e as WorkflowEstimateError;
    expect(err.code).toBe('failed');
    // The number IS present and IS preserved — it is simply not a quote.
    expect(err.snapshot.cost?.total).toBe(7);
    // And the hook must not advertise it as confirmable.
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status).not.toBe('confirming');
  });

  // 🔴 PRODUCER (b). A `status`-only guard passes every assertion in the test
  // above and is still INERT here — same dead control, and harder to diagnose
  // because there is no `error` string to show.
  it('estimate() REJECTS a SUCCESSFUL snapshot that carries no cost — producer (b) (#4159)', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const { settled, reply } = driveEstimate(result.current.estimate as never);

    reply({ workflowId: 'whatif', status: 'pending' });

    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const err = outcome.e as WorkflowEstimateError;
    expect(err).toBeInstanceOf(WorkflowEstimateError);
    expect(err.code).toBe('no-cost');
    // The generic message names the CODE, so an uncaught rejection is still
    // self-describing without carrying server text (there is none here anyway).
    expect(err.message).toBe(
      'estimate did not return a usable price (no-cost) — reason on .snapshot.error',
    );
    expect(err.snapshot.status).toBe('pending');
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  // 🔴 `message` MUST NOT CARRY THE SERVER STRING. `Error.message` is what an
  // uncaught rejection prints and what a third-party block's error reporter ships
  // upstream by default; civitai's `errorHandling.ts` documents that raw
  // Prisma/`pg` text — constraint names, `Key (email)=(…) already exists.` —
  // can reach `snapshot.error`. Blocks are third-party code, so database
  // internals must not land on their default-printed surface.
  //
  // 🔴 THE FIXTURE IS A REALISTIC LEAK, NOT A TOKEN. A scanner-style test using
  // `'secret'` proves only that the literal `'secret'` is absent; this asserts
  // against the actual shape `errorHandling.ts` warns about, and checks each
  // distinctive fragment separately so a partial interpolation cannot pass.
  it('estimate() keeps the raw server text OFF `message` and ON `.snapshot.error` (#4159)', async () => {
    const RAW = 'Unique constraint failed: Key (email)=(a@b.example) already exists.';
    const { result } = renderHook(() => useBuzzWorkflow());
    const { settled, reply } = driveEstimate(result.current.estimate as never);

    reply({ workflowId: 'failed', status: 'failed', error: RAW });

    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const err = outcome.e as WorkflowEstimateError;
    // Still fully recoverable — this is the documented diagnostic read.
    expect(err.snapshot.error).toBe(RAW);
    // …and absent from the default-printed field, fragment by fragment.
    expect(err.message).not.toContain(RAW);
    for (const fragment of ['email', 'a@b.example', 'Unique constraint', 'Key (']) {
      expect(err.message).not.toContain(fragment);
    }
    expect(err.message).toBe(
      'estimate did not return a usable price (failed) — reason on .snapshot.error',
    );
  });

  // `error: ''` is reachable — the host builds its string as
  // `err instanceof Error ? err.message : …` and `new Error().message` is `''`.
  // It used to be the case that separated `||` from `??` in the message
  // fallback; now that `message` never reads `snapshot.error` at all, what
  // matters is that the empty value is preserved VERBATIM rather than
  // normalised away, and that `message` is non-empty regardless.
  it('estimate() preserves error: "" verbatim and still yields a non-empty message', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const { settled, reply } = driveEstimate(result.current.estimate as never);

    reply({ workflowId: 'failed', status: 'failed', error: '' });

    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const err = outcome.e as WorkflowEstimateError;
    expect(err.code).toBe('failed');
    expect(err.snapshot.error).toBe('');
    expect(err.message).not.toBe('');
    expect(err.message).toContain('(failed)');
  });

  // The other two cost-less terminal statuses. They are in this file's own
  // TERMINAL_STATUSES and are reachable replies; the widened clause covers them
  // without needing an arm each, and this pins that it actually does.
  for (const status of ['canceled', 'expired'] as const) {
    it(`estimate() REJECTS a cost-less '${status}' snapshot (#4159)`, async () => {
      const { result } = renderHook(() => useBuzzWorkflow());
      const { settled, reply } = driveEstimate(result.current.estimate as never);
      reply({ workflowId: 'whatif', status });
      const outcome = await settled;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect((outcome.e as WorkflowEstimateError).code).toBe('no-cost');
    });
  }

  // 🔴 THE NEGATIVE CONTROL, and it is not decorative: `0` is FALSY. An
  // implementation written as `if (!snapshot.cost?.total)` passes every rejection
  // test above and then rejects a legitimately FREE estimate — a cache-hit prices
  // at 0 on the real host, and the buzz-workflow starter harness returns exactly
  // that for a repeated seed. Only a fixture whose cost is 0 can catch it, so the
  // value here must stay 0 and must not be "tidied" to a round non-zero number.
  it('estimate() RESOLVES a cost of 0 — free is priced, not unpriceable (#4159)', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());
    const { settled, reply } = driveEstimate(result.current.estimate as never);

    reply({ workflowId: 'whatif', status: 'pending', cost: { total: 0 } });

    const outcome = await settled;
    expect(outcome.ok).toBe(true);
    await waitFor(() => expect(result.current.status).toBe('confirming'));
    expect(result.current.result?.cost?.total).toBe(0);
  });

  // 🔴 THE FIX MUST NOT FAIL OPEN ON `result`. Rejecting BEFORE publishing the
  // snapshot would leave the PREVIOUS estimate's priced snapshot in place, so a
  // block gating Confirm on `typeof result.cost?.total === 'number'` — which this
  // package's own README documents as where the cost lives — would read the OLD
  // config's price for a config that could not be estimated. That is a live
  // control quoting a wrong number on a money path: strictly WORSE than the dead
  // control this PR fixes, and it is what the first draft of this change shipped.
  // Two estimates in one test is the only shape that can see it.
  it('estimate() does not leave a STALE price in `result` after a failed estimate (#4159)', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    // A — prices normally at 5.
    const a = driveEstimate(result.current.estimate as never);
    a.reply({ workflowId: 'wf-a', status: 'pending', cost: { total: 5 } });
    await a.settled;
    await waitFor(() => expect(result.current.result?.cost?.total).toBe(5));

    // B — a DIFFERENT config whose estimate fails.
    const b = driveEstimate(result.current.estimate as never);
    b.reply({ workflowId: 'failed', status: 'failed', error: 'nope' });
    expect((await b.settled).ok).toBe(false);

    await waitFor(() => expect(result.current.status).toBe('error'));
    // The stale-price read, stated the way a block's Confirm gate would make it.
    expect(typeof result.current.result?.cost?.total).not.toBe('number');
    expect(result.current.result?.cost?.total).not.toBe(5);
    // And `result` is B's snapshot, not A's — the positive half, so this cannot
    // pass merely because `result` was cleared to null by some other path.
    expect(result.current.result?.workflowId).toBe('failed');
  });

  // 🔴 SCOPE PIN, NOT A CORRECTNESS CLAIM ABOUT `submit`. Read the assertion
  // narrowly: it says a BUDGET REJECTION — which carries a `cost` and is a
  // documented outcome the block recovers from by opening a top-up flow — still
  // resolves. It does NOT say submit is free of the #4159 defect. It is not:
  // `WORKFLOW_SUBMITTED` has the same two producers, indistinguishable by
  // `status`, since caught server exceptions are posted through the very same
  // `failureSnapshot(err)`. The discriminator there is `cost` presence, and
  // fixing it is a separate change with its own blast radius on the recovery
  // path. This test exists so that change cannot be mistaken for a tidy-up of
  // the estimate guard — it must keep the budget-rejection arm resolving.
  // Tracked at civitai/civitai-app-starters#251.
  it('submit() still RESOLVES a budget rejection (a documented outcome, cost present)', async () => {
    const { result } = renderHook(() => useBuzzWorkflow());

    let submitPromise!: Promise<{ status: string; error?: string; cost?: { total: number } }>;
    act(() => {
      submitPromise = result.current.submit({
        kind: 'textToImage',
        modelId: 7,
        modelVersionId: 99,
        params: { prompt: 'cat' },
      }) as Promise<{ status: string; error?: string; cost?: { total: number } }>;
    });

    const sent = postMessageMock.mock.calls[0][0] as { type: string; payload: { requestId: string } };
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'WORKFLOW_SUBMITTED',
            payload: {
              requestId: sent.payload.requestId,
              // The budget-rejection producer carries a cost — that is what
              // separates it from the `failureSnapshot(err)` producer.
              snapshot: {
                workflowId: 'failed',
                status: 'failed',
                error: 'insufficient buzz budget',
                cost: { total: 120 },
              },
            },
          },
          origin: PARENT_ORIGIN,
        }),
      );
    });

    const snap = await submitPromise;
    expect(snap.status).toBe('failed');
    expect(snap.error).toBe('insufficient buzz budget');
    expect(snap.cost?.total).toBe(120);
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
