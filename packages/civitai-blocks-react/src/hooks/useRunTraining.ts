import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BlockRunTrainingHostError,
  BlockTrainingQuote,
  BlockWorkflowSnapshot,
  WorkflowBodyTraining,
} from '@civitai/app-sdk/blocks';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { RequestTimeoutError, sendTypedRequest } from '../transport/transport.js';

export type { BlockRunTrainingHostError, BlockTrainingQuote, WorkflowBodyTraining };

/**
 * A training body ready to RUN: {@link WorkflowBodyTraining} with the `quoteId`
 * its estimate returned. Required here so a body without one is a compile error
 * rather than a host refusal.
 */
export type QuotedTrainingBody = WorkflowBodyTraining & { quoteId: string };

/**
 * The host's CLOSED refusal codes for `RUN_TRAINING`, as a runtime list. Mirrors
 * civitai/civitai's `RUN_TRAINING_HOST_ERRORS`.
 *
 * 🔴 THE ERROR CHANNEL IS NOT AN ENUM: server messages (an expired or used quote,
 * a body that differs from the quoted one) arrive in the same field — see
 * {@link isRunTrainingErrorCode}.
 */
export const RUN_TRAINING_ERROR_CODES = [
  'review-mode',
  'block is not ready',
  'sign in to train',
  'invalid training request',
  'no block token',
  'declined',
  'submission-unconfirmed',
] as const satisfies readonly BlockRunTrainingHostError[];

const CODE_SET: ReadonlySet<string> = new Set(RUN_TRAINING_ERROR_CODES);

/**
 * The `code` a {@link RunTrainingError} can carry: one of the host's closed
 * refusal codes, or `'refused'` — assigned by THIS SDK, never sent by the host,
 * for a submit the server refused at a spend cap (see {@link RunTrainingError.refused}).
 */
export type RunTrainingErrorCode = BlockRunTrainingHostError | 'refused';

/**
 * The `workflowId` the host's training submit stamps on a snapshot that is NOT a
 * run — its cap refusals resolve `{ workflowId: 'failed', status: 'failed', cost,
 * error }` (`submitTrainingWorkflow` in civitai/civitai `blocks.router.ts`).
 * Compared with `===`: a real orchestrator id is a workflow that may exist.
 */
const HOST_REFUSAL_WORKFLOW_ID = 'failed';

/** `true` when `error` is one of the host's closed refusal codes rather than a server message. */
export function isRunTrainingErrorCode(error: string): error is BlockRunTrainingHostError {
  return CODE_SET.has(error);
}

/**
 * A training run that did not come back with a snapshot.
 *
 * 🔴 READ THE FLAGS BEFORE SAYING ANYTHING ABOUT MONEY — they are the only part of
 * this error with a money meaning, and they point in opposite directions:
 *
 *  - `.declined` — the viewer dismissed the consent dialog. NO RUN WAS
 *    SUBMITTED, guaranteed by the host's consent latch. Render nothing.
 *  - `.unconfirmed` — the run MAY BE RUNNING AND CHARGED: the host sent the
 *    submit and could not learn its outcome (`submission-unconfirmed`), or no
 *    reply arrived at all (`.timedOut` — the viewer may have clicked Train on a
 *    dialog this block had stopped waiting for). Do NOT retry automatically and
 *    do NOT tell the viewer it failed: check their trainings first
 *    (`useAppWorkflows()` lists this app's runs), because re-running the same
 *    body after the server did start it is a SECOND, separately charged run.
 *  - `.refused` (`code: 'refused'`) — the server REFUSED the submit at a spend
 *    cap after the viewer confirmed (the viewer's daily or private-run Buzz cap,
 *    the per-app consent budget, the app's daily spend or rate limit, a dev
 *    session cap). Its reservation was refunded: NO RUN, nothing charged.
 *    `.message` is the server's reason (e.g. `daily Buzz cap reached: …`) and
 *    `.snapshot` the refusal it arrived in. Retrying needs a new estimate and
 *    usually a later time; buying Buzz does not lift these caps.
 *  - `.signInRequired` — no session. Route into `useRequestSignIn()`.
 *  - anything else — a refusal before any submit (an expired or used quote, a
 *    body that no longer matches its quote, an ineligible image). Estimate again
 *    before retrying; `.message` is the host's or server's text.
 */
export class RunTrainingError extends Error {
  /**
   * The closed host refusal code, `'refused'` for a cap refusal, or `undefined`
   * for a server/transport error.
   */
  readonly code?: RunTrainingErrorCode;
  /**
   * The server refused the submit at a spend cap and refunded it — no run exists.
   * See the class docs; `.message` is the server's reason.
   */
  readonly refused: boolean;
  /** The refusal snapshot the host replied with, when {@link refused}. */
  readonly snapshot?: BlockWorkflowSnapshot;
  /** The viewer dismissed the consent dialog — no run was submitted. */
  readonly declined: boolean;
  /**
   * The run may exist and may have been charged — `submission-unconfirmed`, or a
   * transport timeout. Check the viewer's trainings before retrying.
   */
  readonly unconfirmed: boolean;
  /** No reply arrived within the 10-minute consent bound. Implies {@link unconfirmed}. */
  readonly timedOut: boolean;
  /** There is no session (`sign in to train`, or a bare `UNAUTHORIZED`). */
  readonly signInRequired: boolean;

  constructor(
    error: string,
    opts?: { timedOut?: boolean; refusedSnapshot?: BlockWorkflowSnapshot },
  ) {
    super(error);
    this.name = 'RunTrainingError';
    this.timedOut = opts?.timedOut === true;
    this.refused = opts?.refusedSnapshot !== undefined;
    if (opts?.refusedSnapshot !== undefined) {
      this.code = 'refused';
      this.snapshot = opts.refusedSnapshot;
    } else if (isRunTrainingErrorCode(error)) {
      this.code = error;
    }
    this.declined = error === 'declined';
    this.unconfirmed = this.timedOut || error === 'submission-unconfirmed';
    this.signInRequired = error === 'sign in to train' || error === 'UNAUTHORIZED';
  }
}

/** What {@link useRunTraining} returns. */
export interface UseRunTraining {
  /**
   * Ask the host to run a quoted training body. Civitai shows the viewer a
   * consent dialog with the server's price and details; on their click it
   * submits, and this resolves with the submitted workflow's snapshot — poll it
   * with `useBuzzWorkflow().watch(snapshot.workflowId)`.
   *
   * REJECTS with a {@link RunTrainingError} — including `declined` (no run),
   * `refused` (a spend cap stopped it; no run) and `unconfirmed` (a run may
   * exist). Read the flags before rendering anything. A resolved snapshot is
   * always a submitted run with a pollable `workflowId`.
   */
  runTraining: (body: QuotedTrainingBody) => Promise<BlockWorkflowSnapshot>;
  /** `true` while a request is in flight (including the viewer's dialog). */
  pending: boolean;
  /** The last request's failure, or `null`. Cleared at the start of the next call. */
  error: RunTrainingError | null;
}

/**
 * Run an App Blocks `kind: 'training'` LoRA training — the only way one starts —
 * through the host-mediated `RUN_TRAINING` → `TRAINING_RESULT` bridge.
 *
 * 🔴 AVAILABILITY: page apps only, behind the host flag `app-blocks-training-kind`
 * (ships off), with `ai:write:budgeted` declared and granted by a signed-in
 * viewer. Refused from `dev:live` and from review sessions — build the flow
 * against the mock host. See `WorkflowBodyTraining` in `@civitai/app-sdk`.
 *
 * The flow: `usePrepareTrainingDataset()` → `useBuzzWorkflow().estimate(body)`
 * (its `trainingQuote.quoteId`) → `runTraining({ ...body, quoteId })` →
 * `useBuzzWorkflow().watch(workflowId)`. Change nothing in the body between the
 * estimate and the run: the server checks it against the quoted one.
 *
 * 🔴 THE CONSENT DIALOG IS CIVITAI'S, AND IT IS THE CHARGE. Every number on it is
 * read back from the server's stored quote — never from your body. A run may cost
 * more than the token's per-call budget (the viewer confirms the exact price), up
 * to `BLOCK_TRAINING_MAX_BUZZ_PER_RUN` (5,000 Buzz). Images are the viewer's own.
 *
 * 🔴 NO AUTOMATIC CONSENT RETRY, unlike the other consent-gated hooks — on
 * purpose. `RUN_TRAINING` carries no idempotency key and has an outcome
 * (`submission-unconfirmed`) where a run may exist, so this hook never re-sends.
 * It is also unreachable in practice: a block holding a `quoteId` got it from an
 * estimate that already required `ai:write:budgeted`.
 *
 * Sent under the 10-minute human-interaction bound: the host replies only when
 * the viewer clicks or dismisses its dialog.
 *
 * @example
 * const { estimate, watch } = useBuzzWorkflow();
 * const { runTraining } = useRunTraining();
 * const quote = (await estimate(body)).trainingQuote!;
 * try {
 *   const started = await runTraining({ ...body, quoteId: quote.quoteId });
 *   await watch(started.workflowId, { onUpdate: render });
 * } catch (e) {
 *   if (!(e instanceof RunTrainingError)) throw e;
 *   if (e.declined) return;                          // no run — say nothing
 *   if (e.signInRequired) return requestSignIn();
 *   if (e.unconfirmed) return showCheckYourTrainings(); // may be running — never auto-retry
 *   if (e.refused) return showError(e.message); // a spend cap; no run, nothing charged
 *   showError('Could not start training. Get a new price and try again.');
 * }
 */
export function useRunTraining(): UseRunTraining {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RunTrainingError | null>(null);

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

  const runTraining = useCallback(
    async (body: QuotedTrainingBody): Promise<BlockWorkflowSnapshot> => {
      if (mountedRef.current) {
        setPending(true);
        setError(null);
      }
      try {
        const reply = await sendTypedRequest(
          getTransport(),
          { type: 'RUN_TRAINING', payload: { body } },
          'TRAINING_RESULT',
          { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
        ).catch((err: unknown): never => {
          if (err instanceof RequestTimeoutError) {
            throw new RunTrainingError(err.message, { timedOut: true });
          }
          throw err instanceof Error ? err : new Error(String(err));
        });
        if (reply.error || !reply.snapshot) {
          // `||`, not `??`: `error: ''` is a shape-valid reply. Its fallback is the
          // CAUTIOUS code — with neither a snapshot nor a reason, nothing says a
          // run was not started, so the block must not be told it was safe to
          // retry.
          throw new RunTrainingError(reply.error || 'submission-unconfirmed');
        }
        // 🔴 A RESOLVED SNAPSHOT IS NOT ALWAYS A RUN. The host's training submit
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
          throw new RunTrainingError(reply.snapshot.error || 'training run refused', {
            refusedSnapshot: reply.snapshot,
          });
        }
        return reply.snapshot;
      } catch (err: unknown) {
        const wrapped =
          err instanceof RunTrainingError
            ? err
            : new RunTrainingError(err instanceof Error ? err.message : String(err));
        if (mountedRef.current) setError(wrapped);
        // Thrown even when unmounted: the caller's `await` must still learn the
        // outcome of a possibly-charged run.
        throw wrapped;
      } finally {
        if (mountedRef.current) setPending(false);
      }
    },
    [],
  );

  return { runTraining, pending, error };
}
