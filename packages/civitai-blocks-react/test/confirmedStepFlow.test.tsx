import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BLOCK_CONFIRMED_STEP_MAX_BUZZ_PER_JOB,
  BLOCK_STEP_QUOTE_ID_REGEX,
  type AppWorkflow,
  type BlockInitPayload,
  type BlockModel3dOutput,
  type BlockWorkflowSnapshot,
  type WorkflowBody,
  type WorkflowBodyPassThroughStep,
} from '@civitai/app-sdk/blocks';

import { useAppWorkflows } from '../src/hooks/useAppWorkflows.js';
import { useBatchEstimate } from '../src/hooks/useBatchEstimate.js';
import {
  CONFIRMED_STEP_BODY_SUBMIT_REFUSAL,
  useBuzzWorkflow,
  WorkflowEstimateError,
  WorkflowSubmitError,
} from '../src/hooks/useBuzzWorkflow.js';
import {
  CONFIRMED_STEP_QUOTE_ID_REFUSAL,
  RUN_CONFIRMED_STEP_ERROR_CODES,
  RunConfirmedStepError,
  STEP_QUOTE_ID_PATTERN,
  isRunConfirmedStepErrorCode,
  isStepQuoteId,
  useRunConfirmedStep,
  type QuotedStepBody,
} from '../src/hooks/useRunConfirmedStep.js';
import {
  MOCK_CONFIRMED_STEP_MAX_BUZZ_PER_JOB,
  MOCK_SPEND_SCOPE_ERROR,
  MOCK_STEP_BODY_MISMATCH_ERROR,
  MOCK_STEP_NON_JSON_INPUT_ERROR_PREFIX,
  MOCK_STEP_NOT_CONFIRMED_ERROR,
  MOCK_STEP_TRAINING_TYPE_ERROR,
  MOCK_STEP_QUOTE_GONE_ERROR,
  type MockHostOptions,
} from '../src/internal/mockHost.js';
import { HUMAN_INTERACTION_TIMEOUT_MS } from '../src/transport/requestTimeouts.js';
import { getTransport } from '../src/transport/singleton.js';
import { sendTypedRequest } from '../src/transport/transport.js';
import { createMockHost, readMockHostUrlOptions, resetTransport } from '../src/testing.js';

/**
 * The confirmed-step flow — estimate → run → watch — driven through the REAL
 * hooks and the REAL iframe transport (so every reply asserted here also passed
 * the inbound validators) against `createMockHost`. Mirrors
 * `trainingKindFlow.test.tsx`.
 *
 * 🔴 WHAT THIS CANNOT PROVE: the confirm is HOST chrome and the mock has none —
 * it settles `RUN_CONFIRMED_STEP` immediately where the real host waits on a
 * click and shows server-read numbers. `declined` and `daily-limit-exceeded` are
 * outcomes here, never a wait. The feature flag, the page-only / dev-token
 * refusals, the fixed-vs-variable price rule and the submit-time re-price are
 * server-side and not modelled. Nothing here ran against a real host.
 *
 * FIXTURE NUMBERS ARE PAIRWISE DISTINCT, and distinct from every default the
 * mock would fall back to (`cost` 8, `buzzBudget` 200), so a value that came
 * from the wrong place cannot read as the right one: price 800, budget 300,
 * `maxBuzz` 250, a later re-price 900.
 */

const ORIGIN = window.location.origin;

const PRICE = 800;
const BUDGET = 300;
const REPRICE = 900;

const BODY: WorkflowBodyPassThroughStep = {
  kind: 'step',
  $type: 'polyGen',
  input: { prompt: 'a low-poly chair', quality: 'high' },
  maxBuzz: 250,
};

const SQ_SHAPE = /^sq_[0-9a-f]{32}$/;

type Outbound = { type: string; payload?: unknown };

function install(opts: MockHostOptions = {}) {
  const outbound: Outbound[] = [];
  const host = createMockHost({
    consentGranted: true,
    buzzBudget: BUDGET,
    generation: { costPerGen: PRICE },
    ...opts,
    onOutbound: (m) => outbound.push(m),
  });
  const uninstall = host.install();
  return { host, uninstall, outbound };
}

function hooks() {
  return renderHook(() => ({ wf: useBuzzWorkflow(), run: useRunConfirmedStep() }));
}

type Hooks = ReturnType<typeof hooks>['result'];

async function settle<T>(p: () => Promise<T>): Promise<{ value?: T; error?: unknown }> {
  let out: { value?: T; error?: unknown } = {};
  await act(async () => {
    try {
      out = { value: await p() };
    } catch (error) {
      out = { error };
    }
  });
  return out;
}

const sent = (outbound: Outbound[], type: string) => outbound.filter((o) => o.type === type);

/** estimate `body`, assert it was quoted, and return the body to run. */
async function quote(result: Hooks, body: WorkflowBodyPassThroughStep = BODY) {
  const estimated = await settle(() => result.current.wf.estimate(body));
  expect(estimated.error).toBeUndefined();
  const stepQuote = estimated.value!.stepQuote;
  expect(stepQuote, 'the estimate carried no stepQuote').toBeDefined();
  const quoted: QuotedStepBody = { ...body, quoteId: stepQuote!.quoteId };
  return { estimate: estimated.value!, stepQuote: stepQuote!, quoted };
}

async function ready() {
  await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
}

describe('confirmed-step copies of the SDK constants', () => {
  it('the mock ceiling and the hook pattern ARE the SDK values (copied to keep the peer floor down)', () => {
    expect(MOCK_CONFIRMED_STEP_MAX_BUZZ_PER_JOB).toBe(BLOCK_CONFIRMED_STEP_MAX_BUZZ_PER_JOB);
    expect(STEP_QUOTE_ID_PATTERN.source).toBe(BLOCK_STEP_QUOTE_ID_REGEX.source);
    expect(STEP_QUOTE_ID_PATTERN.flags).toBe(BLOCK_STEP_QUOTE_ID_REGEX.flags);
  });

  it('the runtime code list is the eight host codes, exactly', () => {
    expect([...RUN_CONFIRMED_STEP_ERROR_CODES].sort()).toEqual(
      [
        'block is not ready',
        'daily-limit-exceeded',
        'declined',
        'invalid confirmed step request',
        'no block token',
        'review-mode',
        'sign in to run',
        'submission-unconfirmed',
      ].sort(),
    );
    expect(isRunConfirmedStepErrorCode('declined')).toBe(true);
    // A training-only code and a server message are NOT codes of this bridge.
    expect(isRunConfirmedStepErrorCode('sign in to train')).toBe(false);
    expect(isRunConfirmedStepErrorCode(MOCK_STEP_QUOTE_GONE_ERROR)).toBe(false);
  });

  it('isStepQuoteId accepts only an sq_-shaped string', () => {
    expect(isStepQuoteId(`sq_${'0'.repeat(31)}f`)).toBe(true);
    for (const bad of [
      undefined,
      null,
      7,
      '',
      'sq_',
      `tq_${'0'.repeat(32)}`,
      `sq_${'0'.repeat(31)}`,
      `sq_${'0'.repeat(33)}`,
      `sq_${'A'.repeat(32)}`,
      { quoteId: `sq_${'0'.repeat(32)}` },
    ]) {
      expect(isStepQuoteId(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('confirmed step — estimate → run → watch', () => {
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

  it('round-trips: a stored quote, the body verbatim on RUN_CONFIRMED_STEP, a run charged the CONFIRMED price', async () => {
    const m = install({ pollsUntilDone: 1 });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();

    const { estimate, stepQuote, quoted } = await quote(result);
    expect(stepQuote.quoteId).toMatch(SQ_SHAPE);
    expect(stepQuote.total).toBe(PRICE);
    expect(stepQuote.stepType).toBe('polyGen');
    // 15 minutes out, to within the test's own runtime.
    const ttl = Date.parse(stepQuote.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    expect(estimate.status).toBe('pending');

    // The price moves AFTER the quote: the job must still cost what was confirmed.
    m.host.setScenario({ generation: { costPerGen: REPRICE } });

    const started = await settle(() => result.current.run.runConfirmedStep(quoted));
    expect(started.error).toBeUndefined();
    expect(started.value!.status).toBe('pending');
    expect(started.value!.workflowId).not.toBe('failed');
    expect(result.current.run.error).toBeNull();
    expect(result.current.run.pending).toBe(false);

    // The wire: exactly one RUN_CONFIRMED_STEP, the body verbatim, quoteId included.
    const runs = sent(m.outbound, 'RUN_CONFIRMED_STEP');
    expect(runs).toHaveLength(1);
    expect((runs[0]!.payload as { body: unknown }).body).toEqual({
      kind: 'step',
      $type: 'polyGen',
      input: { prompt: 'a low-poly chair', quality: 'high' },
      maxBuzz: 250,
      quoteId: stepQuote.quoteId,
    });
    // Never the plain submit.
    expect(sent(m.outbound, 'SUBMIT_WORKFLOW')).toHaveLength(0);

    const done = await settle(() => result.current.wf.watch(started.value!.workflowId));
    const snap = done.value as BlockWorkflowSnapshot;
    expect(snap.status).toBe('succeeded');
    expect(snap.cost?.total).toBe(PRICE);
  });

  it('a quote is offered ONLY above the per-call budget and at most 5,000 — both boundaries, both sides', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();

    const quoteAt = async (costPerGen: number) => {
      m.host.setScenario({ generation: { costPerGen } });
      const r = await settle(() => result.current.wf.estimate(BODY));
      expect(r.error, String(costPerGen)).toBeUndefined();
      // The ordinary estimate is intact either way.
      expect(r.value!.cost?.total, String(costPerGen)).toBe(costPerGen);
      return r.value!.stepQuote;
    };

    expect(await quoteAt(BUDGET - 1)).toBeUndefined();
    expect(await quoteAt(BUDGET)).toBeUndefined(); // AT the budget: the ordinary submit runs it
    expect((await quoteAt(BUDGET + 1))?.total).toBe(BUDGET + 1);
    expect((await quoteAt(5000))?.total).toBe(5000); // AT the ceiling: allowed
    expect(await quoteAt(5001)).toBeUndefined();
  });

  it('only a PASS-THROUGH step is quoted: a registered step and a textToImage body never are', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await ready();

    const registered = await settle(() =>
      result.current.wf.estimate({ kind: 'step', step: 'chat-completion', input: {} } as WorkflowBody),
    );
    expect(registered.error).toBeUndefined();
    expect(registered.value!.cost?.total).toBe(PRICE);
    expect('stepQuote' in registered.value!).toBe(false);

    const t2i = await settle(() =>
      result.current.wf.estimate({
        kind: 'textToImage',
        modelId: 1,
        modelVersionId: 2,
        params: { prompt: 'a cat' },
      }),
    );
    expect(t2i.error).toBeUndefined();
    expect('stepQuote' in t2i.value!).toBe(false);

    // The arm is keyed on the VALUE of `step`, as the host keys it: a body that
    // names a registered step is that arm even if it also carries a `$type`.
    const both = await settle(() =>
      result.current.wf.estimate({ ...BODY, step: 'chat-completion' } as unknown as WorkflowBody),
    );
    expect(both.error).toBeUndefined();
    expect('stepQuote' in both.value!).toBe(false);

    // Positive control on the same host: the pass-through body IS quoted.
    expect((await quote(result)).stepQuote.total).toBe(PRICE);
  });

  it('a signed-out viewer gets no quote, and `sign in to run` → .signInRequired', async () => {
    const m = install({ viewer: null });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();

    const estimated = await settle(() => result.current.wf.estimate(BODY));
    expect(estimated.error).toBeUndefined();
    expect('stepQuote' in estimated.value!).toBe(false);

    const r = await settle(() =>
      result.current.run.runConfirmedStep({ ...BODY, quoteId: `sq_${'0'.repeat(32)}` }),
    );
    const e = r.error as RunConfirmedStepError;
    expect(e).toBeInstanceOf(RunConfirmedStepError);
    expect(e.code).toBe('sign in to run');
    expect(e.signInRequired).toBe(true);
    expect([e.declined, e.dailyLimitExceeded, e.unconfirmed, e.refused, e.timedOut]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('`declined` → .declined only; the quote survives and runs once the viewer confirms', async () => {
    const m = install({ runConfirmedStepError: 'declined' });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);

    const r = await settle(() => result.current.run.runConfirmedStep(quoted));
    expect(r.value).toBeUndefined();
    const e = r.error as RunConfirmedStepError;
    expect(e).toBeInstanceOf(RunConfirmedStepError);
    expect(e.name).toBe('RunConfirmedStepError');
    expect(e.code).toBe('declined');
    expect(e.declined).toBe(true);
    expect([e.dailyLimitExceeded, e.unconfirmed, e.refused, e.signInRequired, e.timedOut]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    await waitFor(() => expect(result.current.run.error).toBe(e));
    expect(sent(m.outbound, 'RUN_CONFIRMED_STEP')).toHaveLength(1);

    m.host.setScenario({ runConfirmedStepError: undefined });
    const ran = await settle(() => result.current.run.runConfirmedStep(quoted));
    expect(ran.error).toBeUndefined();
    expect(ran.value!.status).toBe('pending');
    // The next call cleared the previous failure.
    expect(result.current.run.error).toBeNull();
  });

  it('`daily-limit-exceeded` → .dailyLimitExceeded: no job, not declined, not unconfirmed; the quote survives', async () => {
    const m = install({ runConfirmedStepError: 'daily-limit-exceeded' });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);

    const r = await settle(() => result.current.run.runConfirmedStep(quoted));
    expect(r.value).toBeUndefined();
    const e = r.error as RunConfirmedStepError;
    expect(e).toBeInstanceOf(RunConfirmedStepError);
    expect(e.code).toBe('daily-limit-exceeded');
    expect(e.dailyLimitExceeded).toBe(true);
    expect([e.declined, e.unconfirmed, e.refused, e.signInRequired, e.timedOut]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(sent(m.outbound, 'RUN_CONFIRMED_STEP')).toHaveLength(1);

    // The viewer raised their limit: the SAME quote still runs.
    m.host.setScenario({ runConfirmedStepError: undefined });
    expect((await settle(() => result.current.run.runConfirmedStep(quoted))).error).toBeUndefined();
  });

  it('a submit-time daily-limit refusal SNAPSHOT (errorCode) → .refused AND .dailyLimitExceeded', async () => {
    // What a host that forwards the server's refusal snapshot (rather than
    // converting it to the code) hands the block. Sent straight onto the wire,
    // because the mock's cap-refusal knob carries no errorCode.
    const outbound: Outbound[] = [];
    const host = createMockHost({ consentGranted: true, onOutbound: (m) => outbound.push(m) });
    uninstall = host.install();
    const { result } = hooks();
    await ready();

    const refusal: BlockWorkflowSnapshot = {
      workflowId: 'failed',
      status: 'failed',
      cost: { total: PRICE },
      error: 'daily budget for this app reached',
      errorCode: 'daily-limit-exceeded',
    };
    const real = window.parent.postMessage.bind(window.parent);
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: Outbound) => {
      if (msg?.type !== 'RUN_CONFIRMED_STEP') return real(msg as never, '*' as never);
      const requestId = (msg.payload as { requestId: string }).requestId;
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'CONFIRMED_STEP_RESULT', payload: { requestId, snapshot: refusal } },
          origin: ORIGIN,
        }),
      );
    }) as never);

    const r = await settle(() =>
      result.current.run.runConfirmedStep({ ...BODY, quoteId: `sq_${'1'.repeat(32)}` }),
    );
    const e = r.error as RunConfirmedStepError;
    expect(e).toBeInstanceOf(RunConfirmedStepError);
    expect(e.code).toBe('refused');
    expect(e.refused).toBe(true);
    expect(e.dailyLimitExceeded).toBe(true);
    expect(e.unconfirmed).toBe(false);
    expect(e.message).toBe('daily budget for this app reached');
    expect(e.snapshot).toEqual(refusal);
  });

  it('`submission-unconfirmed` → .unconfirmed, is NEVER retried, and uses the quote up', async () => {
    const m = install({ runConfirmedStepError: 'submission-unconfirmed' });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);
    const before = m.outbound.length;

    const r = await settle(() => result.current.run.runConfirmedStep(quoted));
    expect(r.value).toBeUndefined();
    const e = r.error as RunConfirmedStepError;
    expect(e).toBeInstanceOf(RunConfirmedStepError);
    expect(e.code).toBe('submission-unconfirmed');
    expect(e.unconfirmed).toBe(true);
    expect([e.declined, e.dailyLimitExceeded, e.refused, e.signInRequired, e.timedOut]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);

    // 🔴 NO AUTO-RETRY: the hook put exactly ONE message on the wire for this
    // call — no second run, no fresh estimate, no consent prompt, no plain submit.
    // Let any deferred retry fire before counting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(m.outbound.slice(before).map((o) => o.type)).toEqual(['RUN_CONFIRMED_STEP']);

    // The job may exist, so the quote is spent: an explicit re-run is refused by
    // the server and is NOT reported as unconfirmed a second time.
    m.host.setScenario({ runConfirmedStepError: undefined });
    const again = await settle(() => result.current.run.runConfirmedStep(quoted));
    const ae = again.error as RunConfirmedStepError;
    expect(ae.message).toBe(MOCK_STEP_QUOTE_GONE_ERROR);
    expect(ae.code).toBeUndefined();
    expect(ae.unconfirmed).toBe(false);
  });

  it('a reply with neither a snapshot nor a reason is treated as UNCONFIRMED (the cautious reading)', async () => {
    const m = install({ runConfirmedStepError: '' });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);
    const r = await settle(() => result.current.run.runConfirmedStep(quoted));
    const e = r.error as RunConfirmedStepError;
    expect(e.code).toBe('submission-unconfirmed');
    expect(e.unconfirmed).toBe(true);
    expect(e.declined).toBe(false);
  });

  it('a quote runs at most once — the second run is the server message, not a code', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);

    expect((await settle(() => result.current.run.runConfirmedStep(quoted))).error).toBeUndefined();
    const again = await settle(() => result.current.run.runConfirmedStep(quoted));
    const e = again.error as RunConfirmedStepError;
    expect(e).toBeInstanceOf(RunConfirmedStepError);
    expect(e.message).toBe(MOCK_STEP_QUOTE_GONE_ERROR);
    expect(e.code).toBeUndefined();
    expect([e.declined, e.dailyLimitExceeded, e.unconfirmed, e.refused]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    // Two explicit calls, two messages — the hook added none of its own.
    expect(sent(m.outbound, 'RUN_CONFIRMED_STEP')).toHaveLength(2);
  });

  it('a quote expires after 15 minutes: runnable one millisecond before, gone at the instant', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await ready();
    const a = await quote(result);
    const b = await quote(result);
    expect(a.stepQuote.quoteId).not.toBe(b.stepQuote.quoteId);

    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(Date.parse(a.stepQuote.expiresAt) - 1);
    const early = await settle(() => result.current.run.runConfirmedStep(a.quoted));
    expect(early.error).toBeUndefined();

    now.mockReturnValue(Date.parse(b.stepQuote.expiresAt));
    const late = await settle(() => result.current.run.runConfirmedStep(b.quoted));
    expect(late.value, 'a quote ran at its own expiry instant').toBeUndefined();
    expect((late.error as RunConfirmedStepError).message).toBe(MOCK_STEP_QUOTE_GONE_ERROR);
  });

  it('a body that differs from the quoted one is refused AND consumes the quote', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);

    const changed = await settle(() =>
      result.current.run.runConfirmedStep({
        ...quoted,
        input: { prompt: 'a low-poly TABLE', quality: 'high' },
      }),
    );
    expect((changed.error as RunConfirmedStepError).message).toBe(MOCK_STEP_BODY_MISMATCH_ERROR);
    expect((changed.error as RunConfirmedStepError).code).toBeUndefined();

    const again = await settle(() => result.current.run.runConfirmedStep(quoted));
    expect((again.error as RunConfirmedStepError).message).toBe(MOCK_STEP_QUOTE_GONE_ERROR);
  });

  it('each of $type / input / maxBuzz is bound to the quote; quoteId itself is not part of the binding', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await ready();

    for (const patch of [{ $type: 'polyGenV2' }, { input: { prompt: 'x' } }, { maxBuzz: 249 }]) {
      const { quoted } = await quote(result);
      const r = await settle(() => result.current.run.runConfirmedStep({ ...quoted, ...patch }));
      expect((r.error as RunConfirmedStepError | undefined)?.message, JSON.stringify(patch)).toBe(
        MOCK_STEP_BODY_MISMATCH_ERROR,
      );
    }
    // Control: the unchanged body, key order shuffled AT EVERY DEPTH, runs — the
    // binding is over the values, as the server's canonical form is.
    const { quoted } = await quote(result);
    const shuffled = {
      quoteId: quoted.quoteId,
      maxBuzz: quoted.maxBuzz,
      input: { quality: 'high', prompt: 'a low-poly chair' },
      $type: quoted.$type,
      kind: quoted.kind,
    } as QuotedStepBody;
    expect(Object.keys(shuffled.input)).not.toEqual(Object.keys(quoted.input));
    expect((await settle(() => result.current.run.runConfirmedStep(shuffled))).error).toBeUndefined();
  });

  it("another kind's quote id never runs: an unknown sq_ id is the quote-gone message", async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await ready();
    const r = await settle(() =>
      result.current.run.runConfirmedStep({ ...BODY, quoteId: `sq_${'f'.repeat(32)}` }),
    );
    expect((r.error as RunConfirmedStepError).message).toBe(MOCK_STEP_QUOTE_GONE_ERROR);
  });

  it('a resolved spend-cap refusal REJECTS with .refused and the server reason, not a fake run', async () => {
    const reason =
      'daily Buzz cap reached: 4500 already spent today across your installed apps, ' +
      'this job costs 800, daily cap is 5000';
    const m = install({ runConfirmedStepCapRefusal: reason });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);

    const r = await settle(() => result.current.run.runConfirmedStep(quoted));
    expect(r.value).toBeUndefined();
    const e = r.error as RunConfirmedStepError;
    expect(e).toBeInstanceOf(RunConfirmedStepError);
    expect(e.refused).toBe(true);
    expect(e.code).toBe('refused');
    expect(e.message).toBe(reason);
    expect([e.declined, e.dailyLimitExceeded, e.unconfirmed]).toEqual([false, false, false]);
    expect(e.snapshot).toEqual({
      workflowId: 'failed',
      status: 'failed',
      cost: { total: PRICE },
      error: reason,
    });

    // The refusal consumed the quote; a fresh one runs once the knob clears.
    m.host.setScenario({ runConfirmedStepCapRefusal: undefined });
    const again = await settle(() => result.current.run.runConfirmedStep(quoted));
    expect((again.error as RunConfirmedStepError).message).toBe(MOCK_STEP_QUOTE_GONE_ERROR);
    const fresh = await quote(result);
    expect((await settle(() => result.current.run.runConfirmedStep(fresh.quoted))).error).toBeUndefined();
  });

  it('a forced SERVER outcome consumes the quote; a forced host gate/dialog code keeps it', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();

    const runFresh = async (forced: string) => {
      const { quoted } = await quote(result);
      m.host.setScenario({ runConfirmedStepError: forced });
      const first = await settle(() => result.current.run.runConfirmedStep(quoted));
      expect((first.error as RunConfirmedStepError).message, forced).toBe(forced);
      m.host.setScenario({ runConfirmedStepError: undefined });
      return settle(() => result.current.run.runConfirmedStep(quoted));
    };

    for (const forced of ['Not enough Buzz for this job.', 'submission-unconfirmed']) {
      const again = await runFresh(forced);
      expect((again.error as RunConfirmedStepError | undefined)?.message, forced).toBe(
        MOCK_STEP_QUOTE_GONE_ERROR,
      );
    }
    for (const forced of ['declined', 'daily-limit-exceeded', 'no block token', 'review-mode']) {
      const again = await runFresh(forced);
      expect(again.error, forced).toBeUndefined();
      expect(again.value?.status, forced).toBe('pending');
    }
  });

  it('a free-text server message has no code and no money flag', async () => {
    const message = 'the step price changed from 800 to 950 Buzz since it was confirmed — estimate again';
    uninstall = install({ runConfirmedStepError: message }).uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);
    const e = (await settle(() => result.current.run.runConfirmedStep(quoted)))
      .error as RunConfirmedStepError;
    expect(e.message).toBe(message);
    expect(e.code).toBeUndefined();
    expect([
      e.declined,
      e.dailyLimitExceeded,
      e.unconfirmed,
      e.signInRequired,
      e.timedOut,
      e.refused,
    ]).toEqual([false, false, false, false, false, false]);
  });

  it('runConfirmedStep NEVER prompts for consent or re-sends, even on a token without the scope', async () => {
    const m = install({ consentGranted: false });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();

    const r = await settle(() =>
      result.current.run.runConfirmedStep({ ...BODY, quoteId: `sq_${'0'.repeat(32)}` }),
    );
    expect((r.error as RunConfirmedStepError).message).toBe(MOCK_SPEND_SCOPE_ERROR);
    expect(sent(m.outbound, 'RUN_CONFIRMED_STEP')).toHaveLength(1);
    expect(sent(m.outbound, 'REQUEST_CONSENT')).toHaveLength(0);
  });
});

/**
 * The server's own strings, as LITERALS — the mock's constants are compared to
 * these, never the other way round, so a mock that drifted from the host's text
 * fails here. Copied from civitai/civitai#5786 (`blocks.router.ts`).
 */
const SERVER_TRAINING_TYPE_ERROR =
  "a training step type cannot run as a confirmed step — use kind:'training'";
const SERVER_NON_JSON_PREFIX =
  'a confirmed step needs plain JSON input (objects, arrays, strings, finite numbers, booleans, null) — ';

describe('confirmed step — what the server refuses to quote', () => {
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

  it('the mock refusal strings ARE the server strings', () => {
    expect(MOCK_STEP_TRAINING_TYPE_ERROR).toBe(SERVER_TRAINING_TYPE_ERROR);
    expect(MOCK_STEP_NON_JSON_INPUT_ERROR_PREFIX).toBe(SERVER_NON_JSON_PREFIX);
  });

  it('a BATCH estimate never carries stepQuote; the same body estimated on its own does', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = renderHook(() => ({ wf: useBuzzWorkflow(), batch: useBatchEstimate() }));
    await ready();

    const other: WorkflowBodyPassThroughStep = { ...BODY, input: { prompt: 'a cup' } };
    const batch = await settle(() => result.current.batch.estimateBatch([BODY, other]));
    expect(batch.error).toBeUndefined();
    expect(batch.value!.cells).toHaveLength(2);
    for (const cell of batch.value!.cells) {
      // Priced exactly as a single estimate prices it…
      expect(cell.ok).toBe(true);
      if (!cell.ok) continue;
      expect(cell.cost.total).toBe(PRICE);
      // …with no confirmable quote.
      expect('stepQuote' in cell.snapshot).toBe(false);
    }

    // Positive control, same host, same body: the single estimate IS quoted.
    const single = await settle(() => result.current.wf.estimate(BODY));
    expect(single.value!.stepQuote?.total).toBe(PRICE);
  });

  for (const $type of ['training', 'imageResourceTraining']) {
    it(`an over-budget estimate of a "${$type}" step REJECTS with the server's message instead of a price`, async () => {
      const m = install();
      uninstall = m.uninstall;
      const { result } = hooks();
      await ready();
      const trainingStep: WorkflowBodyPassThroughStep = { ...BODY, $type };

      const over = await settle(() => result.current.wf.estimate(trainingStep));
      expect(over.value).toBeUndefined();
      const e = over.error as WorkflowEstimateError;
      expect(e).toBeInstanceOf(WorkflowEstimateError);
      expect(e.code).toBe('failed');
      expect(e.snapshot.error).toBe(SERVER_TRAINING_TYPE_ERROR);
      expect('cost' in e.snapshot).toBe(false);

      // Control: WITHIN the budget no quote would be granted, so nothing is
      // refused — the ordinary estimate, exactly as before.
      m.host.setScenario({ generation: { costPerGen: BUDGET } });
      const within = await settle(() => result.current.wf.estimate(trainingStep));
      expect(within.error).toBeUndefined();
      expect(within.value!.cost?.total).toBe(BUDGET);
      expect('stepQuote' in within.value!).toBe(false);
    });
  }

  it('a training step is refused only where a quote would be granted: not in a batch', async () => {
    uninstall = install().uninstall;
    const { result } = renderHook(() => ({ batch: useBatchEstimate() }));
    await ready();
    const batch = await settle(() =>
      result.current.batch.estimateBatch([{ ...BODY, $type: 'training' }]),
    );
    const cell = batch.value!.cells[0]!;
    expect(cell.ok).toBe(true);
    if (cell.ok) expect(cell.cost.total).toBe(PRICE);
  });

  const NON_JSON: Array<[string, () => Record<string, unknown>, string]> = [
    ['a Date', () => ({ prompt: 'x', when: new Date(7) }), 'body.input.when is a Date'],
    ['a Map', () => ({ opts: new Map([[1, 2]]) }), 'body.input.opts is a Map'],
    ['a Set', () => ({ tags: new Set([3]) }), 'body.input.tags is a Set'],
    ['a BigInt', () => ({ seed: BigInt(5) }), 'body.input.seed is a bigint'],
    ['NaN', () => ({ scale: Number.NaN }), 'body.input.scale is the non-finite number NaN'],
    [
      'Infinity',
      () => ({ scale: Number.POSITIVE_INFINITY }),
      'body.input.scale is the non-finite number Infinity',
    ],
    [
      'an undefined array element',
      () => ({ list: [9, undefined] }),
      'body.input.list[1] is undefined',
    ],
    [
      'a nested class instance',
      () => ({ a: [{ b: new URL('https://example.com/10') }] }),
      'body.input.a[0].b is a URL',
    ],
  ];

  for (const [label, input, where] of NON_JSON) {
    it(`an over-budget estimate whose input holds ${label} REJECTS, naming the path`, async () => {
      const m = install();
      uninstall = m.uninstall;
      const { result } = hooks();
      await ready();
      const body: WorkflowBodyPassThroughStep = { ...BODY, input: input() };

      const over = await settle(() => result.current.wf.estimate(body));
      expect(over.value).toBeUndefined();
      const e = over.error as WorkflowEstimateError;
      expect(e).toBeInstanceOf(WorkflowEstimateError);
      expect(e.snapshot.error).toBe(`${SERVER_NON_JSON_PREFIX}${where}`);
      // The documented way to recognise it: the fixed prefix.
      expect(e.snapshot.error!.startsWith(SERVER_NON_JSON_PREFIX)).toBe(true);

      // Control: within the budget the same body is an ordinary estimate.
      m.host.setScenario({ generation: { costPerGen: BUDGET } });
      const within = await settle(() => result.current.wf.estimate(body));
      expect(within.error).toBeUndefined();
      expect(within.value!.cost?.total).toBe(BUDGET);
    });
  }

  it('plain JSON of every kind IS quoted, and an undefined object key is ignored', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await ready();
    const { stepQuote } = await quote(result, {
      ...BODY,
      input: { s: 'x', n: 1.5, t: true, z: null, list: [1, 'a', false, null, { k: [] }], gone: undefined },
    });
    expect(stepQuote.total).toBe(PRICE);
  });

  it('RUN: a training $type is refused with the server message and the quote is KEPT', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);

    const r = await settle(() =>
      result.current.run.runConfirmedStep({ ...quoted, $type: 'imageResourceTraining' }),
    );
    const e = r.error as RunConfirmedStepError;
    expect(e).toBeInstanceOf(RunConfirmedStepError);
    expect(e.message).toBe(SERVER_TRAINING_TYPE_ERROR);
    // A server refusal string: no code, no money flag — like useRunTraining's.
    expect(e.code).toBeUndefined();
    expect([e.declined, e.dailyLimitExceeded, e.unconfirmed, e.refused, e.signInRequired]).toEqual(
      [false, false, false, false, false],
    );
    // Refused before the quote was touched: the quoted body still runs.
    expect((await settle(() => result.current.run.runConfirmedStep(quoted))).error).toBeUndefined();
  });

  it('RUN: non-plain-JSON input is refused naming the path, and the quote is CONSUMED', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);

    const r = await settle(() =>
      result.current.run.runConfirmedStep({
        ...quoted,
        input: { prompt: 'a low-poly chair', quality: 'high', when: new Date(7) },
      }),
    );
    const e = r.error as RunConfirmedStepError;
    expect(e.message).toBe(`${SERVER_NON_JSON_PREFIX}body.input.when is a Date`);
    expect(e.code).toBeUndefined();
    expect([e.declined, e.dailyLimitExceeded, e.unconfirmed, e.refused]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const again = await settle(() => result.current.run.runConfirmedStep(quoted));
    expect(again.value, 'the quote survived a refused non-JSON run').toBeUndefined();
    expect((again.error as RunConfirmedStepError).message).toBe(MOCK_STEP_QUOTE_GONE_ERROR);
  });
});

describe('confirmed step — the client-side quoteId refusal', () => {
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

  const BAD_QUOTE_IDS: Array<[string, unknown]> = [
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['a training quote', `tq_${'0'.repeat(32)}`],
    ['31 hex', `sq_${'0'.repeat(31)}`],
    ['33 hex', `sq_${'0'.repeat(33)}`],
    ['uppercase hex', `sq_${'ABCDEF0123456789'.repeat(2)}`],
    ['not a string', 12345],
  ];

  for (const [label, quoteId] of BAD_QUOTE_IDS) {
    it(`refuses a ${label} quoteId BEFORE sending anything`, async () => {
      const m = install();
      uninstall = m.uninstall;
      const { result } = hooks();
      await ready();
      const before = m.outbound.length;

      const body = { ...BODY, ...(quoteId === undefined ? {} : { quoteId }) } as QuotedStepBody;
      const r = await settle(() => result.current.run.runConfirmedStep(body));

      expect(r.value).toBeUndefined();
      const e = r.error as RunConfirmedStepError;
      expect(e).toBeInstanceOf(RunConfirmedStepError);
      // The SDK's own message — the host's refusal of the same body reads
      // `invalid confirmed step request`, so this pins WHO refused.
      expect(e.message).toBe(CONFIRMED_STEP_QUOTE_ID_REFUSAL);
      expect(e.code).toBe('invalid confirmed step request');
      expect([e.declined, e.dailyLimitExceeded, e.unconfirmed, e.refused, e.timedOut]).toEqual([
        false,
        false,
        false,
        false,
        false,
      ]);
      // Nothing reached the wire.
      expect(m.outbound.slice(before)).toEqual([]);
      await waitFor(() => expect(result.current.run.error).toBe(e));
      expect(result.current.run.pending).toBe(false);
    });
  }

  it('control: a well-formed sq_ id IS sent (the refusal is keyed on shape, not on the call)', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const r = await settle(() =>
      result.current.run.runConfirmedStep({ ...BODY, quoteId: `sq_${'0'.repeat(32)}` }),
    );
    expect(sent(m.outbound, 'RUN_CONFIRMED_STEP')).toHaveLength(1);
    // It reached the mock, which does not hold that quote.
    expect((r.error as RunConfirmedStepError).message).toBe(MOCK_STEP_QUOTE_GONE_ERROR);
  });

  it('the MOCK HOST refuses the same malformed bodies with the host code when the hook is bypassed', async () => {
    const m = install();
    uninstall = m.uninstall;
    hooks();
    await ready();

    const raw = async (body: unknown) =>
      sendTypedRequest(
        getTransport(),
        { type: 'RUN_CONFIRMED_STEP', payload: { body: body as WorkflowBodyPassThroughStep } },
        'CONFIRMED_STEP_RESULT',
      );
    const good = `sq_${'0'.repeat(32)}`;
    for (const body of [
      { ...BODY },
      { ...BODY, quoteId: `tq_${'0'.repeat(32)}` },
      { ...BODY, quoteId: `sq_${'0'.repeat(31)}` },
      { ...BODY, kind: 'training', quoteId: good },
      { kind: 'step', input: {}, maxBuzz: 1, quoteId: good },
      [BODY],
      null,
    ]) {
      const reply = await raw(body);
      expect(reply.error, JSON.stringify(body)).toBe('invalid confirmed step request');
      expect(reply.snapshot, JSON.stringify(body)).toBeUndefined();
    }
    // Control: a shape-valid body gets PAST the gate (to the quote lookup).
    expect((await raw({ ...BODY, quoteId: good })).error).toBe(MOCK_STEP_QUOTE_GONE_ERROR);
  });
});

describe('confirmed step — the plain submit never carries a quoteId body', () => {
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

  it('useBuzzWorkflow().submit() refuses a step body with a quoteId without sending anything', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);
    const before = m.outbound.length;

    const r = await settle(() => result.current.wf.submit(quoted));
    expect(r.value).toBeUndefined();
    expect(r.error).toBeInstanceOf(Error);
    expect(r.error).not.toBeInstanceOf(WorkflowSubmitError);
    expect((r.error as Error).message).toBe(CONFIRMED_STEP_BODY_SUBMIT_REFUSAL);
    expect(m.outbound.slice(before)).toEqual([]);
    await waitFor(() => expect(result.current.wf.status).toBe('error'));
  });

  it('…whatever the quoteId looks like (a malformed one is no more submittable)', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const before = m.outbound.length;
    const r = await settle(() => result.current.wf.submit({ ...BODY, quoteId: 'not-a-quote' }));
    expect((r.error as Error).message).toBe(CONFIRMED_STEP_BODY_SUBMIT_REFUSAL);
    expect(m.outbound.slice(before)).toEqual([]);
  });

  it('control: the SAME body without a quoteId still submits', async () => {
    // Under the budget so the mock's ordinary path runs it.
    const m = install({ generation: { costPerGen: 40 } });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const r = await settle(() => result.current.wf.submit(BODY));
    expect(r.error).toBeUndefined();
    expect(r.value!.status).toBe('pending');
    expect(sent(m.outbound, 'SUBMIT_WORKFLOW')).toHaveLength(1);
  });

  it('the MOCK HOST refuses a raw SUBMIT_WORKFLOW carrying a quoteId as unconfirmed, and starts nothing', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);

    const reply = await sendTypedRequest(
      getTransport(),
      { type: 'SUBMIT_WORKFLOW', payload: { body: quoted, idempotencyKey: 'confirmed-step-raw-1' } },
      'WORKFLOW_SUBMITTED',
    );
    expect(reply.snapshot).toEqual({
      workflowId: 'failed',
      status: 'failed',
      error: MOCK_STEP_NOT_CONFIRMED_ERROR,
    });
    // The refused submit did not consume the quote — the confirmed path still runs it.
    expect((await settle(() => result.current.run.runConfirmedStep(quoted))).error).toBeUndefined();
  });
});

describe('confirmed step — the ten-minute consent bound', () => {
  const PARENT_ORIGIN = 'https://civitai.com';
  let postMessageMock: ReturnType<typeof vi.fn>;

  const buildInit = (): BlockInitPayload => ({
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt',
      scopes: ['ai:write:budgeted'],
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'viewer', status: 'active' },
    theme: 'light',
    renderMode: 'iframe',
  });

  beforeEach(() => {
    // A host that NEVER answers: the viewer left the confirm open.
    postMessageMock = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInit() },
        origin: PARENT_ORIGIN,
      }),
    );
    postMessageMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    resetTransport();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('still pending 1ms before 10 minutes; at 10 minutes rejects .timedOut + .unconfirmed, having sent ONCE', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRunConfirmedStep());

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.runConfirmedStep({ ...BODY, quoteId: `sq_${'0'.repeat(32)}` });
    });
    let outcome: { value?: unknown; error?: unknown } | null = null;
    void pending.then(
      (value) => {
        outcome = { value };
      },
      (error: unknown) => {
        outcome = { error };
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HUMAN_INTERACTION_TIMEOUT_MS - 1);
    });
    expect(outcome, 'settled before the 10-minute bound').toBeNull();
    expect(result.current.pending).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(outcome).not.toBeNull();
    const e = outcome!.error as RunConfirmedStepError;
    expect(e).toBeInstanceOf(RunConfirmedStepError);
    expect(e.timedOut).toBe(true);
    // A viewer may confirm a dialog the block stopped waiting for.
    expect(e.unconfirmed).toBe(true);
    expect(e.declined).toBe(false);
    expect(e.code).toBeUndefined();
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe(e);

    // 🔴 A timeout is NOT retried either — and nothing fires later.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HUMAN_INTERACTION_TIMEOUT_MS);
    });
    const runs = postMessageMock.mock.calls
      .map((c) => c[0] as { type: string })
      .filter((msg) => msg.type === 'RUN_CONFIRMED_STEP');
    expect(runs).toHaveLength(1);
  });
});

describe('model3dOutputs — typed and passed through', () => {
  let uninstall: (() => void) | undefined;

  const MODELS: BlockModel3dOutput[] = [
    { url: 'https://orchestration.civitai.com/blobs/chair.glb', format: 'glb', variant: 'model' },
    {
      url: 'https://orchestration.civitai.com/blobs/chair-rigged.fbx',
      format: 'fbx',
      variant: 'riggedFbxModel',
    },
    {
      url: 'https://orchestration.civitai.com/blobs/chair-walk.glb',
      format: 'glb',
      variant: 'basicAnimations.walkingModel',
    },
  ];

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

  it('a confirmed polyGen run reports every model, each also in imageUrls, readable by format/variant', async () => {
    const m = install({ pollsUntilDone: 1, generation: { costPerGen: PRICE, model3dOutputs: MODELS } });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();
    const { quoted } = await quote(result);
    const started = await settle(() => result.current.run.runConfirmedStep(quoted));
    const done = await settle(() => result.current.wf.watch(started.value!.workflowId));
    const snap = done.value as BlockWorkflowSnapshot;

    expect(snap.status).toBe('succeeded');
    expect(snap.model3dOutputs).toEqual(MODELS);
    expect(snap.imageUrls).toEqual(MODELS.map((x) => x.url));

    // The documented lookups, with no cast.
    const glb = snap.model3dOutputs?.find((x) => x.format === 'glb' && x.variant === 'model');
    expect(glb?.url).toBe('https://orchestration.civitai.com/blobs/chair.glb');
    const walking = snap.model3dOutputs?.find((x) => x.variant === 'basicAnimations.walkingModel');
    expect(walking?.format).toBe('glb');
    expect(snap.model3dOutputs?.filter((x) => x.format === 'fbx').map((x) => x.variant)).toEqual([
      'riggedFbxModel',
    ]);
  });

  it('is OMITTED for a workflow with no 3D model, and for a non-pass-through body', async () => {
    const m = install({ pollsUntilDone: 1, generation: { costPerGen: 40 } });
    uninstall = m.uninstall;
    const { result } = hooks();
    await ready();

    const plain = await settle(() => result.current.wf.submit(BODY));
    const plainDone = await settle(() => result.current.wf.watch(plain.value!.workflowId));
    expect('model3dOutputs' in (plainDone.value as BlockWorkflowSnapshot)).toBe(false);

    m.host.setScenario({ generation: { model3dOutputs: MODELS } });
    const t2i = await settle(() =>
      result.current.wf.submit({
        kind: 'textToImage',
        modelId: 1,
        modelVersionId: 2,
        params: { prompt: 'a cat' },
      }),
    );
    const t2iDone = await settle(() => result.current.wf.watch(t2i.value!.workflowId));
    expect((t2iDone.value as BlockWorkflowSnapshot).status).toBe('succeeded');
    expect('model3dOutputs' in (t2iDone.value as BlockWorkflowSnapshot)).toBe(false);

    // Control on the same host: the pass-through body now does carry them.
    const step = await settle(() => result.current.wf.submit(BODY));
    const stepDone = await settle(() => result.current.wf.watch(step.value!.workflowId));
    expect((stepDone.value as BlockWorkflowSnapshot).model3dOutputs).toEqual(MODELS);
  });

  it('passes through on app-queue rows (QUERY_APP_WORKFLOWS)', async () => {
    const row: AppWorkflow = {
      workflowId: 'wf_app_3d',
      status: 'succeeded',
      images: MODELS.map((x) => ({ url: x.url, width: null, height: null, nsfwLevel: null })),
      cost: PRICE,
      createdAt: '2026-10-12T10:00:00.000Z',
      model3dOutputs: MODELS,
    };
    const m = install({ appWorkflows: { workflows: [row] } });
    uninstall = m.uninstall;
    const { result } = renderHook(() => useAppWorkflows());
    await ready();
    await waitFor(() => expect(result.current.workflows).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(result.current.workflows[0]!.model3dOutputs).toEqual(MODELS);
  });
});

describe('readMockHostUrlOptions — ?confirmedStep', () => {
  const read = (search: string) =>
    readMockHostUrlOptions({ location: { search } } as unknown as Window & typeof globalThis);

  it('maps each value onto runConfirmedStepError', () => {
    expect(read('?confirmedStep=declined').runConfirmedStepError).toBe('declined');
    expect(read('?confirmedStep=daily-limit').runConfirmedStepError).toBe('daily-limit-exceeded');
    expect(read('?confirmedStep=unconfirmed').runConfirmedStepError).toBe('submission-unconfirmed');
  });

  it('leaves the knob unset for `confirm`, an unknown value and no parameter', () => {
    for (const search of ['?confirmedStep=confirm', '?confirmedStep=nope', '?confirmedStep=', '?x=1']) {
      expect('runConfirmedStepError' in read(search), search).toBe(false);
    }
  });

  it('end to end: ?costPerGen over the budget + ?confirmedStep=declined declines a quoted run', async () => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
    const host = createMockHost({
      consentGranted: true,
      buzzBudget: BUDGET,
      ...read(`?costPerGen=${PRICE}&confirmedStep=declined`),
    });
    const uninstall = host.install();
    try {
      const { result } = hooks();
      await ready();
      const { quoted } = await quote(result);
      const r = await settle(() => result.current.run.runConfirmedStep(quoted));
      expect((r.error as RunConfirmedStepError).declined).toBe(true);
    } finally {
      cleanup();
      uninstall();
      resetTransport();
    }
  });
});
