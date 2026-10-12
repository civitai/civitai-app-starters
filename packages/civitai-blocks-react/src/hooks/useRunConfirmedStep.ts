import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BlockRunConfirmedStepHostError,
  BlockStepQuote,
  BlockWorkflowSnapshot,
  WorkflowBodyPassThroughStep,
} from '@civitai/app-sdk/blocks';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { RequestTimeoutError, sendTypedRequest } from '../transport/transport.js';

export type { BlockRunConfirmedStepHostError, BlockStepQuote, WorkflowBodyPassThroughStep };

/**
 * A pass-through step body ready to RUN as a confirmed job:
 * {@link WorkflowBodyPassThroughStep} with the `quoteId` its estimate returned
 * (`snapshot.stepQuote.quoteId`). Required here so a body without one is a
 * compile error rather than a refusal.
 */
export type QuotedStepBody = WorkflowBodyPassThroughStep & { quoteId: string };

/**
 * The host's CLOSED refusal codes for `RUN_CONFIRMED_STEP`, as a runtime list.
 * Mirrors civitai/civitai's `RUN_CONFIRMED_STEP_HOST_ERRORS`.
 *
 * 🔴 THE ERROR CHANNEL IS NOT AN ENUM: server messages (an expired or used quote,
 * a body or price that differs from the quoted one) arrive in the same field —
 * see {@link isRunConfirmedStepErrorCode}.
 */
export const RUN_CONFIRMED_STEP_ERROR_CODES = [
  'review-mode',
  'block is not ready',
  'sign in to run',
  'invalid confirmed step request',
  'no block token',
  'declined',
  'daily-limit-exceeded',
  'submission-unconfirmed',
] as const satisfies readonly BlockRunConfirmedStepHostError[];

const CODE_SET: ReadonlySet<string> = new Set(RUN_CONFIRMED_STEP_ERROR_CODES);

/**
 * The shape of a confirmed-step quote id: `sq_` + 32 lowercase hex characters.
 *
 * A COPY of `@civitai/app-sdk/blocks`'s `BLOCK_STEP_QUOTE_ID_REGEX`, deliberately
 * not value-imported: a value import would raise this package's
 * `@civitai/app-sdk` peer floor for one regular expression (see
 * `PEER_FLOOR.md`). Pinned to the SDK's by `test/confirmedStepFlow.test.tsx`,
 * which imports both.
 */
export const STEP_QUOTE_ID_PATTERN = /^sq_[a-f0-9]{32}$/;

/** `true` when `value` is a string shaped like a confirmed-step quote id. */
export function isStepQuoteId(value: unknown): value is string {
  return typeof value === 'string' && STEP_QUOTE_ID_PATTERN.test(value);
}

/**
 * The message of the {@link RunConfirmedStepError} `runConfirmedStep` rejects
 * with when the body carries no `sq_`-shaped `quoteId`.
 *
 * 🔴 REFUSED BEFORE THE SEND. The host refuses the same body with `invalid
 * confirmed step request`, so nothing is lost by refusing here — and one thing is
 * gained: a `tq_` training quote, an `undefined` from an estimate that returned
 * no `stepQuote`, or a stale id from storage is named at the call site instead of
 * surfacing as a host refusal. Nothing was sent, so nothing was charged.
 */
export const CONFIRMED_STEP_QUOTE_ID_REFUSAL =
  'runConfirmedStep() needs the quoteId its estimate returned (snapshot.stepQuote.quoteId, "sq_" + 32 hex characters) — estimate the body with useBuzzWorkflow().estimate() first. Nothing was sent.';

/**
 * The `code` a {@link RunConfirmedStepError} can carry: one of the host's closed
 * refusal codes, or `'refused'` — assigned by THIS SDK, never sent by the host,
 * for a submit the server refused at a spend cap or as temporarily unavailable
 * (see {@link RunConfirmedStepError.refused}).
 */
export type RunConfirmedStepErrorCode = BlockRunConfirmedStepHostError | 'refused';

/**
 * The `workflowId` the host's confirmed submit stamps on a snapshot that is NOT
 * a run — its cap refusals resolve `{ workflowId: 'failed', status: 'failed',
 * cost, error }`, the same shape the training submit uses. Compared with `===`:
 * a real orchestrator id is a workflow that may exist.
 */
const HOST_REFUSAL_WORKFLOW_ID = 'failed';

/** The viewer's own daily-limit refusal, as a host code and as a snapshot `errorCode`. */
const DAILY_LIMIT_CODE = 'daily-limit-exceeded';

/** `true` when `error` is one of the host's closed refusal codes rather than a server message. */
export function isRunConfirmedStepErrorCode(
  error: string,
): error is BlockRunConfirmedStepHostError {
  return CODE_SET.has(error);
}

/**
 * A confirmed step that did not come back with a snapshot.
 *
 * 🔴 READ THE FLAGS BEFORE SAYING ANYTHING ABOUT MONEY — they are the only part of
 * this error with a money meaning, and they point in opposite directions:
 *
 *  - `.declined` — the viewer dismissed the confirm. NO JOB WAS SUBMITTED,
 *    guaranteed by the host's consent latch, and the quote is still runnable
 *    until it expires. Render nothing.
 *  - `.dailyLimitExceeded` — the job would exceed what remains today of the
 *    daily Buzz limit the VIEWER set for this app. NO JOB, nothing charged. The
 *    host has already explained it to the viewer and pointed at where the limit
 *    is raised; a confirm cannot override it. Do not retry, and do not offer a
 *    Buzz purchase — more Buzz does not lift a limit.
 *  - `.unconfirmed` — the job MAY BE RUNNING AND CHARGED: the host sent the
 *    submit and could not learn its outcome (`submission-unconfirmed`), or no
 *    reply arrived at all (`.timedOut` — the viewer may have confirmed a dialog
 *    this block had stopped waiting for). 🔴 NEVER RETRY AUTOMATICALLY and do not
 *    tell the viewer it failed. Every confirmation is its own job, so a retry —
 *    which needs a new estimate and a new confirmation — is a SECOND, separately
 *    charged job if the first one did start. Check the viewer's generations
 *    first (`useAppWorkflows()` lists this app's runs).
 *  - `.refused` (`code: 'refused'`) — the server REFUSED the submit at a spend
 *    cap after the viewer confirmed (the viewer's daily or private-run Buzz cap,
 *    the app's daily spend or rate limit). Its reservation was refunded: NO JOB,
 *    nothing charged. `.message` is the server's reason and `.snapshot` the
 *    refusal it arrived in. Retrying needs a new estimate and usually a later
 *    time.
 *  - `.signInRequired` — no session. Route into `useRequestSignIn()`.
 *  - anything else — a refusal before any submit (an expired or used quote, a
 *    body that no longer matches its quote, a price that changed, or the
 *    client-side {@link CONFIRMED_STEP_QUOTE_ID_REFUSAL}). Estimate again before
 *    retrying; `.message` is the host's or server's text.
 */
export class RunConfirmedStepError extends Error {
  /**
   * The closed host refusal code, `'refused'` for a cap refusal, or `undefined`
   * for a server/transport error.
   */
  readonly code?: RunConfirmedStepErrorCode;
  /**
   * The server refused the submit (a spend cap, or a temporary-availability deny)
   * and refunded it — no job exists. The quote is used up: estimate again.
   * See the class docs; `.message` is the server's reason.
   */
  readonly refused: boolean;
  /** The refusal snapshot the host replied with, when {@link refused}. */
  readonly snapshot?: BlockWorkflowSnapshot;
  /** The viewer dismissed the confirm — no job was submitted. */
  readonly declined: boolean;
  /**
   * The job would exceed the viewer's own daily Buzz limit for this app — no job
   * was submitted and nothing was charged. Set for the host code
   * `daily-limit-exceeded` and for a refusal snapshot whose `errorCode` is that
   * value.
   */
  readonly dailyLimitExceeded: boolean;
  /**
   * The job may exist and may have been charged — `submission-unconfirmed`, or a
   * transport timeout. Check the viewer's generations before retrying.
   */
  readonly unconfirmed: boolean;
  /** No reply arrived within the 10-minute consent bound. Implies {@link unconfirmed}. */
  readonly timedOut: boolean;
  /** There is no session (`sign in to run`, or a bare `UNAUTHORIZED`). */
  readonly signInRequired: boolean;

  constructor(
    error: string,
    opts?: {
      timedOut?: boolean;
      refusedSnapshot?: BlockWorkflowSnapshot;
      code?: BlockRunConfirmedStepHostError;
    },
  ) {
    super(error);
    this.name = 'RunConfirmedStepError';
    this.timedOut = opts?.timedOut === true;
    this.refused = opts?.refusedSnapshot !== undefined;
    if (opts?.refusedSnapshot !== undefined) {
      this.code = 'refused';
      this.snapshot = opts.refusedSnapshot;
    } else if (opts?.code !== undefined) {
      this.code = opts.code;
    } else if (isRunConfirmedStepErrorCode(error)) {
      this.code = error;
    }
    this.declined = error === 'declined';
    this.dailyLimitExceeded =
      error === DAILY_LIMIT_CODE || opts?.refusedSnapshot?.errorCode === DAILY_LIMIT_CODE;
    this.unconfirmed = this.timedOut || error === 'submission-unconfirmed';
    this.signInRequired = error === 'sign in to run' || error === 'UNAUTHORIZED';
  }
}

/** What {@link useRunConfirmedStep} returns. */
export interface UseRunConfirmedStep {
  /**
   * Ask the host to run a quoted pass-through step. Civitai shows the viewer a
   * confirm with the server's price; on their click it submits, and this
   * resolves with the submitted workflow's snapshot — poll it with
   * `useBuzzWorkflow().watch(snapshot.workflowId)`.
   *
   * REJECTS with a {@link RunConfirmedStepError} — including `declined` and
   * `dailyLimitExceeded` (no job), `refused` (a spend-cap refusal; no job) and
   * `unconfirmed` (a job may exist). Read the flags before rendering anything. A
   * resolved snapshot is always a submitted job with a pollable `workflowId`.
   *
   * A body whose `quoteId` is missing or not `sq_`-shaped is refused HERE,
   * before anything is sent — see {@link CONFIRMED_STEP_QUOTE_ID_REFUSAL}.
   */
  runConfirmedStep: (body: QuotedStepBody) => Promise<BlockWorkflowSnapshot>;
  /** `true` while a request is in flight (including the viewer's dialog). */
  pending: boolean;
  /** The last request's failure, or `null`. Cleared at the start of the next call. */
  error: RunConfirmedStepError | null;
}

/**
 * Run ONE pass-through `kind: 'step'` job whose price is above what the app may
 * spend without asking — through the host-mediated `RUN_CONFIRMED_STEP` →
 * `CONFIRMED_STEP_RESULT` bridge, after the viewer confirms the exact price in
 * Civitai's own dialog.
 *
 * 🔴 AVAILABILITY: page apps only, behind the host flag
 * `app-blocks-confirmed-step` (ships off), with `ai:write:budgeted` declared and
 * granted by a signed-in viewer, on a host carrying civitai/civitai#5786. Refused
 * from `dev:live` and from review sessions — build the flow against the mock
 * host. Where it is unavailable the estimate simply carries no `stepQuote`.
 *
 * The flow: `useBuzzWorkflow().estimate(body)` (its `stepQuote.quoteId`) →
 * `runConfirmedStep({ ...body, quoteId })` → `useBuzzWorkflow().watch(workflowId)`.
 * Change nothing in the body between the estimate and the run: the server checks
 * it against the quoted one.
 *
 * 🔴 ONLY A FIXED PRICE IS CONFIRMABLE. `stepQuote` is present when the
 * orchestrator quoted a fixed price above the token's per-call budget and at
 * most `BLOCK_CONFIRMED_STEP_MAX_BUZZ_PER_JOB` (5,000 Buzz). A variable or
 * metered price, or no price at all, gets no quote and cannot be run this way.
 *
 * 🔴 THE CONFIRM IS CIVITAI'S, AND IT IS THE CHARGE. The price on it is read back
 * from the server's stored quote — never from your body. A quote is single-use
 * and expires 15 minutes after the estimate; the server prices the job again at
 * submit and refuses a higher price.
 *
 * 🔴 NO AUTOMATIC RETRY OF ANY KIND, on purpose. Every confirmation is its own
 * job — there is no idempotency key, the orchestrator id comes from the confirmed
 * quote — and one outcome (`submission-unconfirmed`) means a job may already be
 * running. So this hook never re-sends, and neither should you: a retry is a
 * NEW, separately charged job.
 *
 * Sent under the 10-minute human-interaction bound: the host replies only when
 * the viewer clicks or dismisses its dialog.
 *
 * @example
 * const { estimate, watch } = useBuzzWorkflow();
 * const { runConfirmedStep } = useRunConfirmedStep();
 * const quote = (await estimate(body)).stepQuote;
 * if (!quote) return submit(body); // within budget — the ordinary path
 * try {
 *   const started = await runConfirmedStep({ ...body, quoteId: quote.quoteId });
 *   await watch(started.workflowId, { onUpdate: render });
 * } catch (e) {
 *   if (!(e instanceof RunConfirmedStepError)) throw e;
 *   if (e.declined) return;                            // no job — say nothing
 *   if (e.dailyLimitExceeded) return;                  // no job — Civitai already told the viewer
 *   if (e.signInRequired) return requestSignIn();
 *   if (e.unconfirmed) return showCheckYourGenerations(); // may be running — never auto-retry
 *   if (e.refused) return showError(e.message);        // a cap refusal; no job, nothing charged
 *   showError('Could not start this job. Get a new price and try again.');
 * }
 */
export function useRunConfirmedStep(): UseRunConfirmedStep {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RunConfirmedStepError | null>(null);

  // This request can outlive the component by up to ten minutes (the dialog may
  // stay open), so a `pending` toggled on an unmounted control is state nobody
  // can clear.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runConfirmedStep = useCallback(
    async (body: QuotedStepBody): Promise<BlockWorkflowSnapshot> => {
      // See `CONFIRMED_STEP_QUOTE_ID_REFUSAL`. Before the `pending` flip and the
      // send: nothing about this call may reach the wire. `body` is read through
      // `unknown` because a JavaScript caller, or one that cast its way past the
      // type, is exactly who this is for.
      if (!isStepQuoteId((body as { quoteId?: unknown } | null | undefined)?.quoteId)) {
        const refused = new RunConfirmedStepError(CONFIRMED_STEP_QUOTE_ID_REFUSAL, {
          code: 'invalid confirmed step request',
        });
        if (mountedRef.current) setError(refused);
        throw refused;
      }
      if (mountedRef.current) {
        setPending(true);
        setError(null);
      }
      try {
        const reply = await sendTypedRequest(
          getTransport(),
          { type: 'RUN_CONFIRMED_STEP', payload: { body } },
          'CONFIRMED_STEP_RESULT',
          { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
        ).catch((err: unknown): never => {
          if (err instanceof RequestTimeoutError) {
            throw new RunConfirmedStepError(err.message, { timedOut: true });
          }
          throw err instanceof Error ? err : new Error(String(err));
        });
        if (reply.error || !reply.snapshot) {
          // `||`, not `??`: `error: ''` is a shape-valid reply. Its fallback is the
          // CAUTIOUS code — with neither a snapshot nor a reason, nothing says a
          // job was not started, so the block must not be told it was safe to
          // retry.
          throw new RunConfirmedStepError(reply.error || 'submission-unconfirmed');
        }
        // 🔴 A RESOLVED SNAPSHOT IS NOT ALWAYS A RUN. The host's confirmed submit
        // answers its spend-cap refusals (refunded, nothing started) with a
        // resolved `{ workflowId: 'failed', status: 'failed', cost, error }`.
        // Resolving that would hand the caller a workflow id to `watch()` that
        // names nothing, and drop the reason. Exact match on the host's
        // sentinel: a failed snapshot with a REAL id is a workflow that may
        // exist, and keeps resolving so it can be watched.
        if (
          reply.snapshot.workflowId === HOST_REFUSAL_WORKFLOW_ID &&
          reply.snapshot.status === 'failed'
        ) {
          throw new RunConfirmedStepError(reply.snapshot.error || 'confirmed step refused', {
            refusedSnapshot: reply.snapshot,
          });
        }
        return reply.snapshot;
      } catch (err: unknown) {
        const wrapped =
          err instanceof RunConfirmedStepError
            ? err
            : new RunConfirmedStepError(err instanceof Error ? err.message : String(err));
        if (mountedRef.current) setError(wrapped);
        // Thrown even when unmounted: the caller's `await` must still learn the
        // outcome of a possibly-charged job.
        throw wrapped;
      } finally {
        if (mountedRef.current) setPending(false);
      }
    },
    [],
  );

  return { runConfirmedStep, pending, error };
}
