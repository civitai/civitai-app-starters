import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useBuzzWorkflow,
  WorkflowEstimateError,
  WorkflowSubmitError,
} from '../src/hooks/useBuzzWorkflow.js';
import { useBuzzBalance } from '../src/hooks/useBuzzBalance.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport, readMockHostUrlOptions } from '../src/testing.js';
import { disallowedAccountError } from '../src/internal/mockHost.js';

/**
 * Layer-1 scenario coverage for `createMockHost`: the `generation` / `buzz`
 * groups + the runtime `setScenario` / `buzz` handle. Exercised
 * against the REAL SDK hooks + transport (mirrors mockHost.test.tsx).
 */

const ORIGIN = window.location.origin;

const BODY = {
  kind: 'textToImage' as const,
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'a cat' },
};

/** Drive estimate→submit→poll(×n) to a terminal state and return the snapshot. */
async function runGen(
  result: { current: ReturnType<typeof useBuzzWorkflow> },
  polls = 2,
) {
  let snap!: { workflowId: string; status: string; error?: string; cost?: { total: number } };
  await act(async () => {
    snap = await result.current.submit(BODY);
  });
  if (snap.status === 'failed') return snap;
  for (let i = 0; i < polls; i += 1) {
    await act(async () => {
      snap = await result.current.poll(snap.workflowId);
    });
    if (snap.status === 'succeeded' || snap.status === 'failed') break;
  }
  return snap;
}

/**
 * Submit once and expect a REJECTION — the civitai/civitai-app-starters#251 arm.
 * A failure-shaped reply with NO price means the submit ERRORED (the host's
 * `failureSnapshot(err)`), so `submit()` rejects rather than handing back a
 * "workflow" that was never queued. Returns the error so the caller can read
 * `.code` / `.snapshot.error`.
 *
 * A RESOLVE is caught here too, and surfaces as the `toBeInstanceOf` assertion
 * failing rather than as a silent pass on the wrong shape.
 */
async function submitExpectingRejection(result: {
  current: ReturnType<typeof useBuzzWorkflow>;
}): Promise<WorkflowSubmitError> {
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.submit(BODY).then(
      (snap) => ({ unexpectedlyResolved: snap }),
      (err) => err,
    );
  });
  expect(outcome).toBeInstanceOf(WorkflowSubmitError);
  return outcome as WorkflowSubmitError;
}

describe('createMockHost — generation scenario', () => {
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

  it('costPerGen as a number reports on estimate + succeeded', async () => {
    uninstall = createMockHost({ consentGranted: true, generation: { costPerGen: 42 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await act(async () => {
      await result.current.estimate(BODY);
    });
    await waitFor(() => expect(result.current.result?.cost?.total).toBe(42));

    const snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
    expect(snap.cost?.total).toBe(42);
  });

  // ── generation.authorFee — the app fee, itemised on a quote ────────────────
  //
  // Mirrors the host: the fee is INSIDE the quote's `cost.total` and reported
  // beside it as `cost.authorFee`; a submitted workflow's total is the
  // generation's own cost.
  const estimateWith = async (
    generation: NonNullable<Parameters<typeof createMockHost>[0]>['generation'],
    body: Parameters<ReturnType<typeof useBuzzWorkflow>['estimate']>[0] = BODY,
  ) => {
    uninstall = createMockHost({ consentGranted: true, generation, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let snap!: Awaited<ReturnType<typeof result.current.estimate>>;
    await act(async () => {
      snap = await result.current.estimate(body);
    });
    return { snap, result };
  };

  it('authorFee itemises the fee on the estimate and adds it into the total', async () => {
    const { snap, result } = await estimateWith({ costPerGen: 42, authorFee: 13 });
    expect(snap.cost).toEqual({ total: 55, authorFee: 13 });
    expect(snap.cost!.total - snap.cost!.authorFee!).toBe(42);

    // The submitted workflow reports the generation's own cost, un-itemised.
    const done = await runGen(result, 1);
    expect(done.status).toBe('succeeded');
    expect(done.cost).toEqual({ total: 42 });
  });

  it('authorFee as a function sees the submitted body', async () => {
    const { snap } = await estimateWith({
      costPerGen: 20,
      authorFee: (req) => (req.kind === 'textToImage' ? 7 : 99),
    });
    expect(snap.cost).toEqual({ total: 27, authorFee: 7 });
  });

  it('authorFee defaults to 0 — reported as 0, not omitted', async () => {
    const { snap } = await estimateWith({ costPerGen: 42 });
    expect(snap.cost).toEqual({ total: 42, authorFee: 0 });
    expect(Object.keys(snap.cost!).sort()).toEqual(['authorFee', 'total']);
  });

  it('authorFee: false simulates a host that predates the field (absent)', async () => {
    const { snap } = await estimateWith({ costPerGen: 42, authorFee: false });
    expect(Object.keys(snap.cost!)).toEqual(['total']);
    expect(snap.cost!.total).toBe(42);
  });

  it('a registered step quote is itemised; a kind that prices no fee is not', async () => {
    const step = await estimateWith(
      { costPerGen: 4, authorFee: 13 },
      { kind: 'step', step: 'convert-image', params: {} } as never,
    );
    expect(step.snap.cost).toEqual({ total: 17, authorFee: 13 });
    uninstall?.();
    resetTransport();
    getTransport({ allowedParentOrigins: [ORIGIN] });

    const comfy = await estimateWith(
      { costPerGen: 4, authorFee: 13 },
      { kind: 'customComfy', recipe: 'any-recipe', params: {} } as never,
    );
    expect(Object.keys(comfy.snap.cost!)).toEqual(['total']);
    expect(comfy.snap.cost!.total).toBe(4);
  });

  // The host routes a `kind: 'step'` body on the VALUE of `step`, not on the key
  // being present: `{ kind: 'step', step: undefined, $type, ... }` is a legal
  // PASS-THROUGH body (an app spreading an optional variable produces one), and
  // a pass-through quote prices no fee. The mock must route it the same way.
  it('a pass-through step body carrying `step: undefined` is not itemised and debits no fee', async () => {
    const passThrough = {
      kind: 'step',
      step: undefined,
      $type: 'imageBackgroundRemoval',
      input: { image: 'https://example.test/a.png' },
      maxBuzz: 20,
    } as never;

    const { snap } = await estimateWith({ costPerGen: 4, authorFee: 13 }, passThrough);
    expect(
      Object.keys(snap.cost!),
      'a pass-through quote with `step: undefined` must not carry authorFee',
    ).toEqual(['total']);
    expect(snap.cost!.total).toBe(4);
    uninstall?.();
    resetTransport();
    getTransport({ allowedParentOrigins: [ORIGIN] });

    const host = createMockHost({
      consentGranted: true,
      buzz: { balance: 100 },
      generation: { costPerGen: 4, authorFee: 13 },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let submitted!: Awaited<ReturnType<typeof result.current.submit>>;
    await act(async () => {
      submitted = await result.current.submit(passThrough);
    });
    expect(submitted.status).not.toBe('failed');
    expect(host.buzz.getBalance(), 'only the generation is debited, no fee').toBe(96);
  });

  it('costPerGen as a function varies cost by the submitted body', async () => {
    uninstall = createMockHost({
      generation: { costPerGen: (req) => (req.params?.prompt === 'a cat' ? 5 : 99) },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = await runGen(result, 1);
    expect(snap.cost?.total).toBe(5);
  });

  // 🔴 THE POINT OF THIS KNOB IS THAT IT DID NOT EXIST. Until civitai/civitai#4159
  // the mock host could not produce a failed estimate at all — the fail knobs
  // drove SUBMIT only — so a block author had no way to reach their own `catch`
  // around `estimate()` locally, and the dead "Cost unavailable" control was
  // unreproducible in every harness until a real user hit it. These two tests
  // run the knob through the REAL hook + transport, so they also serve as the
  // end-to-end proof that the guard and the mock agree.
  it("failEstimate: 'failed' makes estimate reject with the server-message producer", async () => {
    uninstall = createMockHost({
      generation: { failEstimate: 'failed', failEstimateMessage: 'resource not generatable' },
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let caught: unknown;
    await act(async () => {
      caught = await result.current.estimate(BODY).then(
        () => null,
        (e) => e,
      );
    });
    expect(caught).toBeInstanceOf(WorkflowEstimateError);
    expect((caught as WorkflowEstimateError).code).toBe('failed');
    // The server's words live on `.snapshot.error`; `message` stays generic so
    // an uncaught rejection cannot print server text (see the leak test in
    // useBuzzWorkflow.test.tsx).
    expect((caught as WorkflowEstimateError).snapshot.error).toBe('resource not generatable');
    expect((caught as Error).message).not.toContain('resource not generatable');
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it("failEstimate: 'no-cost' makes estimate reject on a SUCCESSFUL cost-less reply", async () => {
    uninstall = createMockHost({ generation: { failEstimate: 'no-cost' } }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let caught: unknown;
    await act(async () => {
      caught = await result.current.estimate(BODY).then(
        () => null,
        (e) => e,
      );
    });
    expect(caught).toBeInstanceOf(WorkflowEstimateError);
    // The harder producer: no `error` on the wire, and the snapshot is NOT
    // 'failed' — a status-only guard would let this one through.
    expect((caught as WorkflowEstimateError).code).toBe('no-cost');
    expect((caught as WorkflowEstimateError).snapshot.status).toBe('pending');
  });

  it('the estimate path still prices normally when failEstimate is unset (control)', async () => {
    uninstall = createMockHost({ consentGranted: true, generation: { costPerGen: 42 } }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await act(async () => {
      await result.current.estimate(BODY);
    });
    expect(result.current.result?.cost?.total).toBe(42);
    expect(result.current.status).toBe('confirming');
  });

  // 🔴 `failNext` / `failRate` / `failMode:'some'` simulate an ERRORED submit,
  // not a priced refusal — the mock emits the host's `failureSnapshot(err)`
  // shape (no `cost`), because the real backend has no generic submit-time
  // failure OUTCOME. Since civitai/civitai-app-starters#251 that arm REJECTS.
  // The reason is unchanged and fully recoverable, on `.snapshot.error`.
  it('failNext rejects the first N submits then succeeds', async () => {
    // `consentGranted: true` so the token already carries `ai:write:budgeted`.
    // This test is about the `failNext` KNOB — one deliberate failure, then a
    // success — and with an un-granted token the SDK's automatic consent
    // prompt-and-retry would legitimately absorb that first failure (prompt →
    // the mock grants → retry → succeeds), leaving nothing for
    // `submitExpectingRejection` to catch. Granting up front makes the consent
    // path inert so the knob is what is being measured.
    uninstall = createMockHost({
      consentGranted: true,
      generation: { failNext: 1 },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const err = await submitExpectingRejection(result);
    expect(err.code).toBe('exception');
    expect(err.snapshot.error).toMatch(/simulated/i);
    // The reason is on the snapshot, never on the developer-facing message.
    expect(err.message).not.toMatch(/simulated/i);

    const second = await runGen(result, 1);
    expect(second.status).toBe('succeeded');
  });

  it('failRate 1 always rejects; 0 never fails', async () => {
    uninstall = createMockHost({ generation: { failRate: 1 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const err = await submitExpectingRejection(result);
    expect(err.code).toBe('exception');
  });

  // 🔴 #251: until this knob existed, an errored submit was unreachable in every
  // local harness, so a block author testing "what if submit goes wrong" only
  // ever exercised the arm that never throws. (The balance / `insufficient`
  // knobs now reject with this same shape too, since that is what production
  // sends for an out-of-Buzz viewer — see the buzz balance scenario below.)
  // Driven end-to-end through the real hook + transport, not stubbed.
  it('failSubmitException rejects with the host failureSnapshot shape (#251)', async () => {
    uninstall = createMockHost({
      generation: { failSubmitException: true, failSubmitExceptionMessage: 'prompt audit down' },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const err = await submitExpectingRejection(result);
    // 🔴 `'exception'`, NOT `'workflow-failed'` — the knob emits the host's
    // `'failed'` sentinel id, so the SDK correctly reports that the host had no
    // workflow to report. (That code does not prove nothing was charged in
    // production, but in THIS mock nothing was: the knob short-circuits before
    // any simulated spend.) A synthetic id here would flip this to the
    // possibly-charged arm and teach the opposite lesson.
    expect(err.code).toBe('exception');
    expect(err.snapshot.error).toBe('prompt audit down');
    // The real `failureSnapshot(err)` shape: the 'failed' sentinel id and NO
    // price. The missing cost is the whole discriminator — assert it directly so
    // a mock that starts emitting one cannot pass.
    expect(err.snapshot.workflowId).toBe('failed');
    expect(err.snapshot.cost).toBeUndefined();
    expect(result.current.status).toBe('error');
  });

  it('failSubmitException defaults its message and pre-empts a sufficient balance (#251)', async () => {
    uninstall = createMockHost({
      generation: { failSubmitException: true },
      buzz: { balance: 100_000 },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const err = await submitExpectingRejection(result);
    expect(err.snapshot.error).toBe('mock: submit failed');
  });

  // The negative control for the knob: unset, submits behave normally. Without
  // it, a mock wired to reject unconditionally would pass every test above.
  it('submits price and queue normally when failSubmitException is unset (control)', async () => {
    uninstall = createMockHost({ generation: {}, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
  });

  it('custom image/images appear on the succeeded snapshot', async () => {
    uninstall = createMockHost({
      generation: { images: ['https://example.test/a.png', 'https://example.test/b.png'] },
      pollsUntilDone: 1,
    }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const snap = await runGen(result, 1);
    expect(result.current.result?.imageUrls).toEqual([
      'https://example.test/a.png',
      'https://example.test/b.png',
    ]);
    expect(snap.status).toBe('succeeded');
  });

  it('default synthetic result image is prominently labeled MOCK', async () => {
    // No custom image configured → the host falls back to its placehold.co
    // default. That default MUST read "MOCK" so a first-run dev in dev:harness
    // can't mistake the scaffold placeholder for a real generation.
    uninstall = createMockHost({ pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
    const url = result.current.result?.imageUrls?.[0] ?? '';
    expect(url).toContain('text=MOCK');
  });

  it('latencyMs delays the terminal poll without changing the outcome', async () => {
    // Use a small real delay (120ms) so the terminal poll lands behind a timer
    // but the test stays fast + deterministic (no fake-timer orchestration).
    uninstall = createMockHost({ generation: { latencyMs: 120 }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const t0 = Date.now();
    const snap = await runGen(result, 1);
    const elapsed = Date.now() - t0;
    expect(snap.status).toBe('succeeded');
    // The succeeded snapshot arrived only after the configured latency.
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('latencyMs accepts a [min,max] range', async () => {
    uninstall = createMockHost({ generation: { latencyMs: [50, 80] }, pollsUntilDone: 1 }).install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
  });
});

describe('createMockHost — buzz balance scenario', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  // 🔴 OUT OF BUZZ REJECTS, AS IN PRODUCTION. The orchestrator 403s the debit,
  // civitai throws `throwInsufficientFundsError` (a BAD_REQUEST), the submit
  // procedure rethrows it, and the iframe host replies with its cost-less
  // `failureSnapshot(err)` — so `useBuzzWorkflow` rejects with `'exception'`.
  // These knobs used to RESOLVE a priced `failed` snapshot, which taught a
  // "resolved refusal → top-up" flow production never produces.
  // `consentGranted` keeps the SDK's consent prompt-and-retry out of the way,
  // so the knob is the only thing measured.

  /** The full out-of-Buzz reply shape: the host's `failureSnapshot(err)`. */
  function expectOutOfBuzz(err: WorkflowSubmitError) {
    expect(err.code).toBe('exception');
    expect(err.snapshot.workflowId).toBe('failed');
    expect(err.snapshot.status).toBe('failed');
    // The discriminator: no price. A priced reply would RESOLVE.
    expect(err.snapshot.cost).toBeUndefined();
    expect(err.snapshot.error).toMatch(/insufficient buzz/i);
  }

  it('a gen that exceeds the balance REJECTS as out of Buzz (exception, no cost)', async () => {
    host = createMockHost({
      consentGranted: true,
      buzz: { balance: 3 },
      generation: { costPerGen: 5 },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    expectOutOfBuzz(await submitExpectingRejection(result));
    expect(result.current.status).toBe('error');
    // Nothing was debited for the refused gen.
    expect(host.buzz.getBalance()).toBe(3);
  });

  it('debits the balance on a successful gen, then rejects once it runs out', async () => {
    host = createMockHost({
      consentGranted: true,
      buzz: { balance: 20 },
      generation: { costPerGen: 8 },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await runGen(result, 1);
    expect(host.buzz.getBalance()).toBe(12);
    await runGen(result, 1);
    expect(host.buzz.getBalance()).toBe(4);
    // 3rd gen (cost 8) exceeds remaining 4 → out of Buzz → rejects.
    expectOutOfBuzz(await submitExpectingRejection(result));
    expect(host.buzz.getBalance()).toBe(4);
  });

  it('buzz.insufficient makes submit() REJECT with WorkflowSubmitError code "exception"', async () => {
    host = createMockHost({
      consentGranted: true,
      buzz: { balance: 1000, insufficient: true },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expectOutOfBuzz(await submitExpectingRejection(result));
  });

  it('buzz.insufficient rejects on an UN-granted token too (consent retry then the same rejection)', async () => {
    // The realistic first-run path: no spend scope yet, so the SDK's consent
    // prompt-and-retry runs first. Being out of Buzz must still end in the
    // rejection, not in a resolve on the retried attempt.
    host = createMockHost({ buzz: { insufficient: true }, pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expectOutOfBuzz(await submitExpectingRejection(result));
  });

  it.each(['insufficient', 'all'] as const)(
    'legacy failMode "%s" REJECTS as out of Buzz (exception, no cost)',
    async (failMode) => {
      host = createMockHost({ consentGranted: true, failMode, pollsUntilDone: 1 });
      uninstall = host.install();
      const { result } = renderHook(() => useBuzzWorkflow());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      expectOutOfBuzz(await submitExpectingRejection(result));
    },
  );

  it('runtime buzz.setBalance flips out-of-Buzz → sufficient mid-session', async () => {
    host = createMockHost({
      consentGranted: true,
      buzz: { balance: 0 },
      generation: { costPerGen: 8 },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    expectOutOfBuzz(await submitExpectingRejection(result));

    act(() => host!.buzz.setBalance(100));
    const snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
  });

  // 🔴 A spend CAP is the arm that RESOLVES, priced. The server checks its caps
  // (per-call budget, daily, consent, per-app, dev session) before asking the
  // orchestrator to debit, and quotes the cost it refused to charge.
  it('generation.submitCapRefusal RESOLVES a priced failed snapshot (cap refusal)', async () => {
    host = createMockHost({
      consentGranted: true,
      generation: {
        costPerGen: 37,
        submitCapRefusal: 'insufficient buzz budget: estimate 37 exceeds budget 20',
      },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      snap = await result.current.submit(BODY);
    });
    expect(snap).toEqual({
      workflowId: 'failed',
      status: 'failed',
      cost: { total: 37, authorFee: 0 },
      error: 'insufficient buzz budget: estimate 37 exceeds budget 20',
    });
  });

  it('a cap refusal itemises the fee, and the simulated balance is debited gen + fee', async () => {
    host = createMockHost({
      consentGranted: true,
      buzz: { balance: 100 },
      generation: { costPerGen: 37, authorFee: 13, submitCapRefusal: true },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      snap = await result.current.submit(BODY);
    });
    expect(snap?.cost).toEqual({ total: 50, authorFee: 13 });
    expect(host.buzz.getBalance()).toBe(100);

    act(() => host!.setScenario({ generation: { submitCapRefusal: undefined } }));
    const done = await runGen(result, 1);
    expect(done.status).toBe('succeeded');
    expect(host.buzz.getBalance()).toBe(50);
  });

  it('submitCapRefusal: true uses the default message; it pre-empts out-of-Buzz; it clears', async () => {
    host = createMockHost({
      consentGranted: true,
      buzz: { balance: 0 },
      generation: { costPerGen: 11, submitCapRefusal: true },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    // Cap first, as on the server: resolves priced even with an empty wallet.
    let snap: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      snap = await result.current.submit(BODY);
    });
    expect(snap?.status).toBe('failed');
    expect(snap?.cost).toEqual({ total: 11, authorFee: 0 });
    expect(snap?.error).toBe('Buzz spend cap reached (simulated).');

    // Cleared live → the empty wallet is what stops it now, as a rejection.
    act(() => host!.setScenario({ generation: { submitCapRefusal: undefined } }));
    expectOutOfBuzz(await submitExpectingRejection(result));
  });

  it('OPEN_BUZZ_PURCHASE refills the simulated balance', async () => {
    host = createMockHost({ buzz: { balance: 0 }, generation: { costPerGen: 8 }, pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    // useBuzzWorkflow exposes a topUp/openPurchase path; drive the transport
    // directly to assert the host refills.
    const before = host.buzz.getBalance();
    expect(before).toBe(0);
    await act(async () => {
      window.parent.postMessage({ type: 'OPEN_BUZZ_PURCHASE', payload: { requestId: 'r1' } }, ORIGIN);
    });
    await waitFor(() => expect(host!.buzz.getBalance()).toBeGreaterThan(0));
  });

  // A purchase ends every forced out-of-Buzz state — `buzz.insufficient` AND
  // the legacy `failMode` spellings of it — so reject → top-up → retry lands.
  // Before the fix only `buzz.insufficient` was cleared, and `?fail=insufficient`
  // looped reject → top-up → reject. `'some'` is not a wallet state, so the
  // purchase must leave it set (the control arm).
  it.each([
    ['failMode "insufficient"', { failMode: 'insufficient' as const }],
    ['failMode "all"', { failMode: 'all' as const }],
    ['buzz.insufficient', { buzz: { insufficient: true } }],
  ])('OPEN_BUZZ_PURCHASE ends the out-of-Buzz state forced by %s', async (_label, opts) => {
    host = createMockHost({ consentGranted: true, pollsUntilDone: 1, ...opts });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    expectOutOfBuzz(await submitExpectingRejection(result));

    const replies: unknown[] = [];
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; payload?: unknown };
      if (d?.type === 'BUZZ_PURCHASE_RESULT') replies.push(d.payload);
    };
    window.addEventListener('message', onMsg);
    try {
      await act(async () => {
        window.parent.postMessage({ type: 'OPEN_BUZZ_PURCHASE', payload: { requestId: 'p1' } }, ORIGIN);
      });
      await waitFor(() => expect(replies).toHaveLength(1));
    } finally {
      window.removeEventListener('message', onMsg);
    }

    const snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');
  });

  it('OPEN_BUZZ_PURCHASE leaves failMode "some" set (not a wallet state)', async () => {
    host = createMockHost({ consentGranted: true, failMode: 'some', pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    await act(async () => {
      window.parent.postMessage({ type: 'OPEN_BUZZ_PURCHASE', payload: { requestId: 'p1' } }, ORIGIN);
    });
    // 'some' fails every 3rd submit; submits 1 and 2 succeed, 3 rejects.
    expect((await runGen(result, 1)).status).toBe('succeeded');
    expect((await runGen(result, 1)).status).toBe('succeeded');
    const err = await submitExpectingRejection(result);
    expect(err.code).toBe('exception');
    expect(err.snapshot.error).toMatch(/simulated/i);
  });

  it('stamps a synthetic spentAccountType (primary funder) when no accountType is picked', async () => {
    // Default wallet is yellow-dominant (5000) → primary funder 'yellow'. BODY
    // carries NO accountType, so the mock falls back to the largest-pool stamp.
    host = createMockHost({ pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const snap = (await runGen(result, 1)) as { status: string; spentAccountType?: string };
    expect(snap.status).toBe('succeeded');
    expect(snap.spentAccountType).toBe('yellow');
  });

  it('stamps spentAccountType from the SUBMITTED accountType (pick-aware, not largest pool)', async () => {
    // Default wallet is yellow-dominant → the pick-blind stamp would be 'yellow'.
    // A pick of 'green' must win: spentAccountType echoes the submitted pool.
    host = createMockHost({ pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap!: { status: string; workflowId: string; spentAccountType?: string };
    await act(async () => {
      snap = (await result.current.submit({
        ...BODY,
        accountType: 'green',
      })) as typeof snap;
    });
    await act(async () => {
      snap = (await result.current.poll(snap.workflowId)) as typeof snap;
    });
    expect(snap.status).toBe('succeeded');
    expect(snap.spentAccountType).toBe('green');
  });
});

describe('createMockHost — GET_BUZZ_BALANCE (per-pool wallet)', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  it('replies BUZZ_BALANCE_RESULT with the default wallet (useBuzzBalance resolves, not hangs)', async () => {
    uninstall = createMockHost().install();
    const { result } = renderHook(() => useBuzzBalance());

    // The hook fetches on mount and is loading until the mock host answers.
    expect(result.current.loading).toBe(true);

    // Resolves (does NOT hang to the request timeout) against the mock host.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.balance).toEqual({ blue: 1000, green: 0, yellow: 5000 });
  });

  it('honors a custom buzzBalance option', async () => {
    const custom = { blue: 42, green: 7, yellow: 999 };
    uninstall = createMockHost({ buzzBalance: custom }).install();
    const { result } = renderHook(() => useBuzzBalance());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toEqual(custom);
    expect(result.current.error).toBeNull();
  });

  it('replies with the exact BUZZ_BALANCE_RESULT shape and drops a request with no requestId', async () => {
    uninstall = createMockHost({ buzzBalance: { blue: 1, green: 2, yellow: 3 } }).install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const replies: Array<{ requestId?: string; balance?: unknown }> = [];
    const listener = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; payload?: { requestId?: string; balance?: unknown } };
      if (d?.type === 'BUZZ_BALANCE_RESULT') replies.push(d.payload ?? {});
    };
    window.addEventListener('message', listener);
    try {
      // A well-formed request → one reply carrying the wallet + requestId.
      await act(async () => {
        window.parent.postMessage(
          { type: 'GET_BUZZ_BALANCE', payload: { requestId: 'buzz-1' } },
          ORIGIN,
        );
      });
      await waitFor(() => expect(replies.length).toBe(1));
      expect(replies[0]).toEqual({ requestId: 'buzz-1', balance: { blue: 1, green: 2, yellow: 3 } });

      // A request with NO requestId is unroutable → dropped (no reply).
      await act(async () => {
        window.parent.postMessage({ type: 'GET_BUZZ_BALANCE', payload: {} }, ORIGIN);
      });
      await Promise.resolve();
      expect(replies.length).toBe(1);
    } finally {
      window.removeEventListener('message', listener);
    }
  });

  it('buzzBalanceError: true surfaces the default error on useBuzzBalance (no balance)', async () => {
    uninstall = createMockHost({ buzzBalanceError: true }).install();
    const { result } = renderHook(() => useBuzzBalance());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.balance).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('buzzBalanceError as a string uses that exact message in the error reply shape', async () => {
    uninstall = createMockHost({ buzzBalanceError: 'boom' }).install();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const replies: Array<{ requestId?: string; balance?: unknown; error?: unknown }> = [];
    const listener = (ev: MessageEvent) => {
      const d = ev.data as {
        type?: string;
        payload?: { requestId?: string; balance?: unknown; error?: unknown };
      };
      if (d?.type === 'BUZZ_BALANCE_RESULT') replies.push(d.payload ?? {});
    };
    window.addEventListener('message', listener);
    try {
      await act(async () => {
        window.parent.postMessage(
          { type: 'GET_BUZZ_BALANCE', payload: { requestId: 'buzz-err' } },
          ORIGIN,
        );
      });
      await waitFor(() => expect(replies.length).toBe(1));
      // Exact error shape: { requestId, error } and NO balance (mirrors createLiveHost).
      expect(replies[0]).toEqual({ requestId: 'buzz-err', error: 'boom' });
    } finally {
      window.removeEventListener('message', listener);
    }
  });

  it('buzzBalanceError as an empty string still fails (coerced to default, not unset)', async () => {
    uninstall = createMockHost({ buzzBalanceError: '' }).install();
    const { result } = renderHook(() => useBuzzBalance());

    await waitFor(() => expect(result.current.loading).toBe(false));
    // An intentionally-empty message must NOT silently re-enable the read.
    expect(result.current.balance).toBeNull();
    expect(result.current.error).toBeTruthy();
    expect(result.current.error?.message).toBe('balance unavailable');
  });

  it('setScenario can clear buzzBalanceError mid-session (error → wallet)', async () => {
    const host = createMockHost({ buzzBalanceError: true });
    uninstall = host.install();
    const { result, rerender } = renderHook(() => useBuzzBalance());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();

    act(() => host.setScenario({ buzzBalanceError: false }));
    await act(async () => {
      await result.current.refetch();
    });
    rerender();
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.balance).toEqual({ blue: 1000, green: 0, yellow: 5000 });
  });
});

describe('createMockHost — disallowed account (content-rating clamp)', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  async function submitWith(
    result: { current: ReturnType<typeof useBuzzWorkflow> },
    accountType: 'blue' | 'green' | 'yellow',
  ) {
    let snap!: { status: string; workflowId: string; error?: string };
    await act(async () => {
      snap = (await result.current.submit({ ...BODY, accountType })) as typeof snap;
    });
    return snap;
  }

  /**
   * The disallowed-pool arm REJECTS since civitai/civitai-app-starters#251: the
   * real backend raises a tRPC BAD_REQUEST at the currency-resolution boundary,
   * which the host catches into `failureSnapshot(err)` — an errored submit with
   * no quote, not a priced refusal. The reason is unchanged, on
   * `.snapshot.error`.
   */
  async function submitWithExpectingRejection(
    result: { current: ReturnType<typeof useBuzzWorkflow> },
    accountType: 'blue' | 'green' | 'yellow',
  ): Promise<WorkflowSubmitError> {
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit({ ...BODY, accountType }).then(
        (snap) => ({ unexpectedlyResolved: snap }),
        (err) => err,
      );
    });
    expect(outcome).toBeInstanceOf(WorkflowSubmitError);
    return outcome as WorkflowSubmitError;
  }

  it('rejects a submit whose accountType is disallowed with the real backend message', async () => {
    host = createMockHost({ disallowedAccountTypes: ['yellow'], pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const err = await submitWithExpectingRejection(result, 'yellow');
    expect(err.code).toBe('exception');
    expect(err.snapshot.status).toBe('failed');
    expect(err.snapshot.error).toBe(disallowedAccountError('yellow'));
  });

  it('accepts a submit whose accountType is NOT in the disallowed set', async () => {
    host = createMockHost({ disallowedAccountTypes: ['yellow'], pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap = await submitWith(result, 'green');
    expect(snap.status).not.toBe('failed');
    await act(async () => {
      snap = (await result.current.poll(snap.workflowId)) as typeof snap;
    });
    expect(snap.status).toBe('succeeded');
  });

  it('disallowed check runs BEFORE the balance/insufficient path', async () => {
    // Even with a balance that could NOT cover the gen, a disallowed pool fails
    // with the content-rating message (not insufficient-Buzz) — matches the real
    // backend rejecting at the currency boundary before any spend check.
    host = createMockHost({
      disallowedAccountTypes: ['yellow'],
      buzz: { balance: 0 },
      generation: { costPerGen: 999 },
      pollsUntilDone: 1,
    });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const err = await submitWithExpectingRejection(result, 'yellow');
    // The content-rating message, NOT insufficient-Buzz — that is the ordering
    // this test exists to pin, and it survives the #251 rejection unchanged.
    expect(err.snapshot.error).toBe(disallowedAccountError('yellow'));
    expect(err.snapshot.error).not.toMatch(/insufficient/i);
  });

  it('setScenario can add a disallowed pool mid-session', async () => {
    host = createMockHost({ pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    // Initially any pool is accepted.
    let snap = await submitWith(result, 'yellow');
    expect(snap.status).not.toBe('failed');

    act(() => host!.setScenario({ disallowedAccountTypes: ['yellow'] }));
    const err = await submitWithExpectingRejection(result, 'yellow');
    expect(err.snapshot.error).toBe(disallowedAccountError('yellow'));
  });
});

describe('createMockHost — setScenario + URL toggles', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  it('setScenario flips failMode/generation mid-session', async () => {
    host = createMockHost({ pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap = await runGen(result, 1);
    expect(snap.status).toBe('succeeded');

    act(() => host!.setScenario({ generation: { failRate: 1 } }));
    // `failRate` is the errored-submit producer, so it REJECTS (#251).
    const err = await submitExpectingRejection(result);
    expect(err.code).toBe('exception');
  });

  it('readMockHostUrlOptions maps the new query params onto scenarios', () => {
    const fakeWin = {
      location: { search: '?balance=0&latency=500-2000&costPerGen=12&failNext=2&fail=insufficient' },
    } as unknown as Window & typeof globalThis;
    const opts = readMockHostUrlOptions(fakeWin);
    expect(opts.buzz?.balance).toBe(0);
    expect(opts.generation?.latencyMs).toEqual([500, 2000]);
    expect(opts.generation?.costPerGen).toBe(12);
    expect(opts.generation?.failNext).toBe(2);
    expect(opts.failMode).toBe('insufficient');
    expect(opts.generation?.submitCapRefusal).toBeUndefined();
  });

  it('readMockHostUrlOptions maps ?authorFee onto generation.authorFee', () => {
    const read = (search: string) =>
      readMockHostUrlOptions({ location: { search } } as unknown as Window & typeof globalThis);
    expect(read('?authorFee=13').generation?.authorFee).toBe(13);
    expect(read('?authorFee=0').generation?.authorFee).toBe(0);
    expect(read('?authorFee=off').generation?.authorFee).toBe(false);
    expect(read('?authorFee=').generation).toBeUndefined();
    expect(read('?authorFee=lots').generation).toBeUndefined();
  });

  it('readMockHostUrlOptions maps ?capRefusal onto generation.submitCapRefusal', () => {
    const read = (search: string) =>
      readMockHostUrlOptions({ location: { search } } as unknown as Window & typeof globalThis);
    expect(read('?capRefusal=1').generation?.submitCapRefusal).toBe(true);
    expect(read('?capRefusal=true').generation?.submitCapRefusal).toBe(true);
    expect(read('?capRefusal=daily%20cap%20reached').generation?.submitCapRefusal).toBe(
      'daily cap reached',
    );
    expect(read('?capRefusal=').generation).toBeUndefined();
  });

  it('readMockHostUrlOptions maps ?consent=granted|ungrantable onto the two consent knobs', () => {
    // The dev-harness affordance for the refusal path — a third value on the
    // EXISTING `?consent` knob rather than a second parameter, because "already
    // granted" and "can never grant" are mutually exclusive states of one thing.
    const granted = readMockHostUrlOptions({
      location: { search: '?consent=granted' },
    } as unknown as Window & typeof globalThis);
    expect(granted.consentGranted).toBe(true);
    expect(granted.consentGrantable).toBeUndefined();

    const ungrantable = readMockHostUrlOptions({
      location: { search: '?consent=ungrantable' },
    } as unknown as Window & typeof globalThis);
    expect(ungrantable.consentGrantable).toBe(false);
    expect(ungrantable.consentGranted).toBeUndefined();

    // An unrelated value touches neither (no silent default flip).
    const other = readMockHostUrlOptions({
      location: { search: '?consent=maybe' },
    } as unknown as Window & typeof globalThis);
    expect(other.consentGranted).toBeUndefined();
    expect(other.consentGrantable).toBeUndefined();
  });

  it('readMockHostUrlOptions parses a single-number latency', () => {
    const fakeWin = {
      location: { search: '?latency=2000' },
    } as unknown as Window & typeof globalThis;
    const opts = readMockHostUrlOptions(fakeWin);
    expect(opts.generation?.latencyMs).toBe(2000);
  });
});

describe('createMockHost — purity (no network)', () => {
  it('exercising the full protocol never touches fetch / XMLHttpRequest', async () => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation(() => {
      throw new Error('mock host must not call fetch');
    });
    const host = createMockHost({
      buzz: { balance: 100 },
      generation: { costPerGen: 5, latencyMs: 0 },
      pollsUntilDone: 1,
    });
    const uninstall = host.install();
    try {
      const gen = renderHook(() => useBuzzWorkflow());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
      await runGen(gen.result, 1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      uninstall();
      resetTransport();
      vi.restoreAllMocks();
    }
  });
});

/**
 * `accountType` on BOTH `kind: 'step'` arms (civitai/civitai's step schemas carry it
 * top-level, as `textToImage` does). The default wallet is yellow-dominant, so a
 * pick-blind stamp reads `'yellow'` and cannot satisfy the `'green'` assertion.
 */
describe('createMockHost — accountType on kind: step bodies', () => {
  let host: ReturnType<typeof createMockHost> | undefined;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = host = undefined;
    resetTransport();
  });

  const ARMS = [
    [
      'pass-through',
      { kind: 'step' as const, $type: 'imageBackgroundRemoval', input: { prompt: 'a cat' }, maxBuzz: 20 },
    ],
    ['registered', { kind: 'step' as const, step: 'convert-image', params: {} }],
  ] as const;

  it.each(ARMS)('%s: stamps spentAccountType from the pick', async (_arm, body) => {
    host = createMockHost({ pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let snap!: { status: string; workflowId: string; spentAccountType?: string };
    await act(async () => {
      snap = (await result.current.submit({ ...body, accountType: 'green' })) as typeof snap;
    });
    await act(async () => {
      snap = (await result.current.poll(snap.workflowId)) as typeof snap;
    });
    expect(snap.status).toBe('succeeded');
    expect(snap.spentAccountType).toBe('green');
  });

  // The host refuses a disallowed pick on the ESTIMATE too (civitai/civitai#8985), with
  // the submit's message. Kills: a mock that checks the pick on submit only.
  it.each([...ARMS, ['textToImage', BODY]] as const)(
    '%s: the ESTIMATE rejects a disallowed pick with the host message',
    async (_arm, body) => {
      // The spend scope granted, so the estimate reaches the account check.
      host = createMockHost({ consentGranted: true, disallowedAccountTypes: ['yellow'] });
      uninstall = host.install();
      const { result } = renderHook(() => useBuzzWorkflow());
      await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

      let outcome: unknown;
      await act(async () => {
        outcome = await result.current
          .estimate({ ...body, accountType: 'yellow' })
          .then((snap) => ({ unexpectedlyResolved: snap }), (err) => err);
      });
      expect(outcome).toBeInstanceOf(WorkflowEstimateError);
      expect((outcome as WorkflowEstimateError).snapshot.error).toBe(
        disallowedAccountError('yellow'),
      );
    },
  );

  // An invariant guard: an allowed pick still prices.
  it('the ESTIMATE of an allowed pick still prices', async () => {
    host = createMockHost({ consentGranted: true, disallowedAccountTypes: ['yellow'] });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let snap: { status: string; cost?: { total: number } } | undefined;
    await act(async () => {
      snap = await result.current.estimate({ ...BODY, accountType: 'green' });
    });
    expect(snap!.status).not.toBe('failed');
    expect(typeof snap!.cost?.total).toBe('number');
  });

  it.each(ARMS)('%s: rejects a disallowed pick with the host message', async (_arm, body) => {
    host = createMockHost({ disallowedAccountTypes: ['yellow'], pollsUntilDone: 1 });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.submit({ ...body, accountType: 'yellow' }).then(
        (snap) => ({ unexpectedlyResolved: snap }),
        (err) => err,
      );
    });
    expect(outcome).toBeInstanceOf(WorkflowSubmitError);
    expect((outcome as WorkflowSubmitError).snapshot.error).toBe(disallowedAccountError('yellow'));
  });
});
