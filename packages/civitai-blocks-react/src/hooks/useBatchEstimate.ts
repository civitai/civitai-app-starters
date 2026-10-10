import { useCallback, useState } from 'react';

import type {
  BlockEstimateBatchAggregate,
  BlockWorkflowSnapshot,
  WorkflowBody,
} from '@civitai/app-sdk/blocks';

import { WORKFLOW_REQUEST_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { RequestTimeoutError, sendTypedRequest } from '../transport/transport.js';
import { WorkflowEstimateError } from './useBuzzWorkflow.js';
import { useRequestSequencer } from './useRequestSequencer.js';

export type { BlockEstimateBatchAggregate };

/**
 * The most bodies one {@link UseBatchEstimate.estimateBatch} call may carry.
 *
 * The host's own cap (`BLOCK_ESTIMATE_BATCH_MAX_CELLS` in civitai/civitai). The
 * hook refuses a longer list before sending it, with the code the host would
 * have answered with a round trip later. A larger grid is priced in several
 * calls; each call is still one request against the estimate allowance.
 */
export const BATCH_ESTIMATE_MAX_CELLS = 16;

/**
 * The host's generic reply to a request it registers no handler for. The copy is
 * the host's (`BRIDGE_NACK_NO_HANDLER` in civitai/civitai), matched here ONCE so
 * no app has to match it: branch on {@link BatchEstimateError.code} instead.
 */
const HOST_UNSUPPORTED_REPLY = 'unsupported on this host';

/**
 * Why a WHOLE batch estimate was refused. The stable branch target on
 * {@link BatchEstimateError}.
 *
 * - `'unsupported'` — the host answered `unsupported on this host`: it knows the
 *   message and has no handler for it on this surface. Nothing was priced. **Fall
 *   back to one `useBuzzWorkflow().estimate()` per cell.**
 * - `'timeout'` — no reply arrived in time. 🔴 This is ALSO what a host that
 *   predates the message looks like: the host's `unsupported on this host` reply
 *   exists only for message types it already knows, so an older host sends
 *   nothing and the call ends here, after the full wait. Falling back to per-cell
 *   estimates is the right response to this code too.
 * - `'invalid-request'` — the list is empty, is not an array, or holds more than
 *   {@link BATCH_ESTIMATE_MAX_CELLS} bodies. Refused by the hook before sending,
 *   or by the host. A per-cell fallback is pointless for an empty list and is the
 *   wrong fix for an over-long one: split it.
 * - `'failed'` — the host or the server refused the call for another reason (the
 *   scope, the rate limit, review preview, no credential) or returned something
 *   that is not a batch result. The reason is on
 *   {@link BatchEstimateError.hostError}.
 */
export type BatchEstimateErrorCode = 'unsupported' | 'timeout' | 'invalid-request' | 'failed';

/**
 * Thrown by {@link UseBatchEstimate.estimateBatch} when the WHOLE call failed.
 *
 * One cell failing is NOT this: a cell that could not be priced comes back as an
 * `ok: false` entry in {@link BatchEstimateResult.cells} and the call resolves.
 *
 * Same three-audience split as `WorkflowEstimateError`:
 * - {@link BatchEstimateError.code} is what you branch on.
 * - {@link BatchEstimateError.hostError} is the host's or server's own text. It
 *   is server-authored and unsanitised: log it, never render it.
 * - `message` is a generic developer-facing summary whose wording is not a
 *   contract.
 */
export class BatchEstimateError extends Error {
  readonly code: BatchEstimateErrorCode;
  /** The host's or server's reason, verbatim, when it gave one. */
  readonly hostError?: string;

  constructor(code: BatchEstimateErrorCode, hostError?: string) {
    super(`batch estimate failed (${code})${hostError === undefined ? '' : ' — reason on .hostError'}`);
    this.name = 'BatchEstimateError';
    this.code = code;
    if (hostError !== undefined) this.hostError = hostError;
  }
}

/**
 * One cell of a batch estimate — the answer to the body at the same index.
 *
 * - `ok: true` — the cell priced. `cost` is the cost object a single
 *   `estimate()` returns for that body, passed through untouched (`cost.total`
 *   is the price shown before `submit()`).
 * - `ok: false` — the cell did not price. `error` is the SAME
 *   `WorkflowEstimateError` a single `estimate()` of that body would have
 *   rejected with (`code: 'failed' | 'no-cost'`, the reason on
 *   `error.snapshot.error`), so one function can turn either into viewer copy.
 *   It is a value here, not a throw: the other cells are still usable.
 *
 * `snapshot` is the host's snapshot for the cell, verbatim, on both arms.
 */
export type BatchEstimateCell =
  | {
      ok: true;
      cost: NonNullable<BlockWorkflowSnapshot['cost']>;
      snapshot: BlockWorkflowSnapshot;
    }
  | { ok: false; error: WorkflowEstimateError; snapshot: BlockWorkflowSnapshot };

/** What {@link UseBatchEstimate.estimateBatch} resolves with. */
export interface BatchEstimateResult {
  /** One entry per body, in the order the bodies were given. */
  cells: BatchEstimateCell[];
  /**
   * The host's run total over the cells that priced. It covers the whole list
   * only when `aggregate.pricedCells === aggregate.cellCount`.
   */
  aggregate: BlockEstimateBatchAggregate;
}

/** Options for one {@link UseBatchEstimate.estimateBatch} call. */
export interface EstimateBatchOptions {
  /**
   * How long to wait for the host's reply, in milliseconds. Default
   * `WORKFLOW_REQUEST_TIMEOUT_MS` (120,000), the single estimate's bound.
   *
   * A host that predates the batch message never replies, so this is also how
   * long an app waits before it learns to fall back. An app that would rather
   * fall back sooner can pass less, at the cost of giving up on a slow but
   * healthy batch: 16 cost quotes run 4 at a time on the host.
   */
  timeoutMs?: number;
}

/** What {@link useBatchEstimate} returns. */
export interface UseBatchEstimate {
  /**
   * Price several workflow bodies in one request. Resolves with one cell per
   * body, in order, plus a run total; rejects with {@link BatchEstimateError}
   * only when the whole call failed.
   *
   * 🔴 ESTIMATE ONLY. Nothing is submitted and no Buzz is held or spent. Submit
   * each cell with `useBuzzWorkflow().submit()`, which asks the viewer and
   * checks the budget per cell.
   */
  estimateBatch: (
    bodies: WorkflowBody[],
    options?: EstimateBatchOptions,
  ) => Promise<BatchEstimateResult>;
  /** `true` while the most recent call is in flight. */
  pending: boolean;
  /**
   * The most recent call's result, or `null` before the first one and after a
   * call that failed — a failed call never leaves an earlier total on display.
   */
  result: BatchEstimateResult | null;
  /** The most recent call's error, or `null`. */
  error: BatchEstimateError | null;
}

function toCell(snapshot: BlockWorkflowSnapshot): BatchEstimateCell {
  // The rule `useBuzzWorkflow().estimate()` applies to one reply, per cell.
  if (snapshot.status === 'failed') {
    return { ok: false, error: new WorkflowEstimateError(snapshot, 'failed'), snapshot };
  }
  const cost = snapshot.cost;
  if (!cost || typeof cost.total !== 'number') {
    return { ok: false, error: new WorkflowEstimateError(snapshot, 'no-cost'), snapshot };
  }
  return { ok: true, cost, snapshot };
}

function toBatchEstimateError(err: unknown): BatchEstimateError {
  if (err instanceof BatchEstimateError) return err;
  // Structural, not a message match — see `RequestTimeoutError`.
  if (err instanceof RequestTimeoutError) return new BatchEstimateError('timeout', err.message);
  return new BatchEstimateError('failed', err instanceof Error ? err.message : String(err));
}

/**
 * Price a grid of generations in ONE request: a list of workflow bodies in, one
 * result per body (a cost, or that cell's error) plus a run total out. Backed by
 * the `ESTIMATE_WORKFLOW_BATCH` → `ESTIMATE_BATCH_RESULT` bridge.
 *
 * Use it where an app would otherwise call `useBuzzWorkflow().estimate()` once
 * per cell. Every rule a single estimate enforces still applies to each cell;
 * what changes is the accounting and the round trips:
 *
 * - **One request against the estimate allowance**, whatever the number of
 *   cells. On a page app that allowance is shared by every viewer of the app and
 *   by the host's other reads for it, so a 16-cell grid used to take 16 of it per
 *   pricing pass.
 * - **Cells are metered separately.** The host also counts the cells of every
 *   batch against an allowance of their own, shared like the estimate allowance
 *   (on a page app, by every viewer of the app), so a batch is not a way around
 *   it. A call over either is refused whole (`code: 'failed'`, the host's
 *   rate-limit text on `hostError`); retry in a few seconds.
 * - **At most {@link BATCH_ESTIMATE_MAX_CELLS} bodies per call.**
 * - **`kind: 'training'` bodies are refused per cell.** Estimate a training run
 *   with `useBuzzWorkflow().estimate()`.
 *
 * 🔴 ESTIMATE ONLY. There is no batch submit, watch or cancel and no id for the
 * list. The total is a quote: nothing reserves it and each cell is priced again
 * at `submit()`.
 *
 * Like `estimate()`, this does NOT prompt for consent. It needs the
 * `ai:write:budgeted` scope; without it the call rejects with `code: 'failed'`.
 *
 * @example
 * const { estimateBatch } = useBatchEstimate();
 * try {
 *   const { cells, aggregate } = await estimateBatch(bodies);
 *   // cells[i] answers bodies[i]
 * } catch (err) {
 *   if (!(err instanceof BatchEstimateError)) throw err;
 *   if (err.code === 'unsupported' || err.code === 'timeout') {
 *     // this host has no batch estimate — price each cell with estimate()
 *   }
 * }
 */
export function useBatchEstimate(): UseBatchEstimate {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<BatchEstimateResult | null>(null);
  const [error, setError] = useState<BatchEstimateError | null>(null);
  // Latest call wins: an app re-prices on a form edit, so an older reply landing
  // after a newer one must not put the older total back on display.
  const sequencer = useRequestSequencer();

  const estimateBatch = useCallback(
    async (
      bodies: WorkflowBody[],
      options?: EstimateBatchOptions,
    ): Promise<BatchEstimateResult> => {
      const call = sequencer.begin();
      if (sequencer.isCurrent(call)) {
        setPending(true);
        setError(null);
      }
      try {
        if (!Array.isArray(bodies) || bodies.length === 0) {
          throw new BatchEstimateError('invalid-request', 'invalid estimate batch');
        }
        if (bodies.length > BATCH_ESTIMATE_MAX_CELLS) {
          throw new BatchEstimateError('invalid-request', 'estimate batch too large');
        }
        const reply = await sendTypedRequest(
          getTransport(),
          { type: 'ESTIMATE_WORKFLOW_BATCH', payload: { bodies } },
          'ESTIMATE_BATCH_RESULT',
          // Server-bound like the single estimate, and slower: up to 16 cost
          // quotes behind one reply.
          { timeoutMs: options?.timeoutMs ?? WORKFLOW_REQUEST_TIMEOUT_MS },
        );
        if (reply.error !== undefined) {
          if (reply.error === HOST_UNSUPPORTED_REPLY) {
            throw new BatchEstimateError('unsupported', reply.error);
          }
          if (
            reply.error === 'invalid estimate batch' ||
            reply.error === 'estimate batch too large'
          ) {
            throw new BatchEstimateError('invalid-request', reply.error);
          }
          throw new BatchEstimateError('failed', reply.error);
        }
        const { snapshots, aggregate } = reply;
        if (!snapshots || !aggregate || snapshots.length !== bodies.length) {
          // A reply that does not answer every body cannot be lined up with the
          // grid, so it is refused rather than shown shifted by a cell.
          throw new BatchEstimateError('failed', 'the host returned a malformed batch estimate');
        }
        const next: BatchEstimateResult = { cells: snapshots.map(toCell), aggregate };
        if (sequencer.isCurrent(call)) setResult(next);
        return next;
      } catch (err: unknown) {
        const wrapped = toBatchEstimateError(err);
        if (sequencer.isCurrent(call)) {
          setError(wrapped);
          // Fail closed: a confirm gate reading `result` must not keep quoting the
          // previous list's total after this one failed.
          setResult(null);
        }
        // Thrown even when superseded or unmounted — the caller's `await` is not
        // the component.
        throw wrapped;
      } finally {
        if (sequencer.isCurrent(call)) setPending(false);
      }
    },
    [sequencer],
  );

  return { estimateBatch, pending, result, error };
}
