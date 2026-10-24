import { CivitaiError } from '../core/errors.js';
import type { Http } from '../http/index.js';
import { isTransient, sleep } from '../http/retry.js';

import type { AppWorkflow, BlockWorkflowSnapshot, WorkflowBody } from './types.generated.js';

/** Where the five routes live under the site base URL. */
const BASE = 'blocks/workflows';

/** Seconds the host is asked to hold each read while watching. It applies its own ceiling. */
const HELD_READ_SECONDS = 15;

/**
 * The least time between two reads while watching. A held read normally takes
 * far longer than this; it matters when the host answers at once instead, which
 * it does when it sheds load.
 */
const READ_INTERVAL_MS = 1_500;

/** Waits between consecutive failed reads while watching; a success resets it. */
const RETRY_BACKOFF_MS = [250, 1_000, 4_000];

const FINAL: ReadonlySet<BlockWorkflowSnapshot['status']> = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

/**
 * The host could not learn whether a submit created a run. **The run may be
 * running, and the viewer may have been charged.**
 *
 * 🔴 This is not a refusal, and it must not be handled like one: do not tell
 * the viewer nothing was spent, and do not submit again blindly — a second
 * submit may start a second run. Tell the viewer the outcome
 * is unknown, then look for the run with {@link WorkflowsClient.list} before
 * offering a retry.
 *
 * The host reports it for a run the viewer confirmed a quote for: a
 * `kind: 'training'` body, or a step body carrying a `quoteId`.
 *
 * It is an error rather than a field on the result because the snapshot the
 * host sends with it is shaped exactly like a refusal (`status: 'failed'`, the
 * placeholder id, a `cost.total`), and a caller that reads only the snapshot
 * would report "not started, nothing charged".
 */
export class SubmissionUnconfirmedError extends CivitaiError {
  /**
   * The snapshot the host sent beside the flag, when it sent a usable one. Its
   * `cost.total` is the price that was reserved; its `workflowId` is a
   * placeholder, not a workflow to poll.
   */
  readonly snapshot: BlockWorkflowSnapshot | undefined;

  constructor(snapshot: BlockWorkflowSnapshot | undefined) {
    super(
      'workflows submit: the host could not confirm whether this run was started. It may be running ' +
        'and the viewer may have been charged. Do not resubmit blindly: check `app.workflows.list()` ' +
        'for the run first.',
    );
    this.name = 'SubmissionUnconfirmedError';
    this.snapshot = snapshot;
  }
}

/**
 * The price an {@link WorkflowsClient.estimate} reply quotes, in whole Buzz, or
 * `null` when it quotes none.
 *
 * An estimate is priced when its `status` is not `'failed'` AND it carries a
 * numeric `cost.total`. That is the whole rule, and it is the one to branch on:
 * - Do not require `'succeeded'`. Nothing runs on an estimate, so a priced one
 *   comes back with a status that has not finished (`'pending'` in practice),
 *   and a check for `'succeeded'` reads every price as missing.
 * - `0` is a price.
 * - A `'failed'` snapshot is never priced, even one carrying a `cost.total`: a
 *   budget refusal carries the total it would not charge.
 * - A snapshot with no numeric `cost.total` is not priced, whatever its status.
 *
 * `null` does not predict a refused {@link WorkflowsClient.submit}: a body the
 * host cannot price can still be submitted. Read `error` / `errorCode` on the
 * snapshot for why.
 */
export function estimatedCost(snapshot: Pick<BlockWorkflowSnapshot, 'status' | 'cost'>): number | null {
  const total = snapshot.cost?.total;
  return snapshot.status !== 'failed' && typeof total === 'number' ? total : null;
}

export interface WorkflowCallOptions {
  signal?: AbortSignal;
}

export interface WorkflowSubmitOptions extends WorkflowCallOptions {
  /**
   * 🔴 REQUIRED. A submit spends the viewer's Buzz, and this key is what lets
   * the host recognise a repeat of it. Mint it ONCE per thing the viewer asked for —
   * `crypto.randomUUID()` when they press the button — and send the SAME key on
   * every retry of that submit. A key minted inside a retry loop protects
   * nothing.
   *
   * Letters, digits, `_` and `-` only, 1 to 64 characters. No colons. The host
   * owns that rule and answers `400` for anything else; this client sends the
   * key as given and does not rewrite it, because a rewritten key is a
   * different key.
   */
  idempotencyKey: string;
}

export interface WorkflowGetOptions extends WorkflowCallOptions {
  /**
   * Asks the host to hold the reply until the workflow finishes, for up to this
   * many seconds. The host applies its own ceiling. Leave it unset for a plain
   * read — and never set it on a timer-driven poll, where held reads stack up.
   */
  waitSeconds?: number;
}

export interface WorkflowWatchOptions extends WorkflowCallOptions {
  /** Seconds the host may hold each read after the first. */
  waitSeconds?: number;
  /** The least time between two reads, in milliseconds. */
  intervalMs?: number;
}

export interface WorkflowListQuery {
  /** An opaque `cursor` from a previous page. */
  cursor?: string;
  /** The host bounds this and applies its own default; this client sends none. */
  limit?: number;
}

export interface WorkflowListResult {
  workflows: AppWorkflow[];
  /** Pass it back for the next page. `null` on the last page. */
  cursor: string | null;
}

/**
 * Generation for a BLOCK, through the host's `blocks/workflows/*` routes: the
 * host prices, budgets, attributes and submits the work as the viewer, and the
 * block never talks to the orchestrator itself.
 *
 * 🔴 Requires the block token the host mints. This is the client a block uses
 * instead of {@link AppClient.orchestration}, which refuses that token.
 *
 * 🔴 A REFUSAL IS AN ANSWER, NOT A THROW. When the host declines to price or
 * run a body it replies `200` with a snapshot whose `status` is `'failed'`,
 * carrying `error`, often an `errorCode`, and — for a budget refusal — the
 * `cost.total` it would not charge. `estimate`, `submit`, `get`, `wait` and
 * `cancel` all RESOLVE with that snapshot. Branch on `snapshot.status`.
 *
 * What rejects is an `ApiError` carrying the HTTP status, a `CivitaiError` for
 * a `2xx` that carried no snapshot, or whatever `fetch` threw. A `400` is a
 * malformed body or key; a `403` on `get` or `cancel` is a workflow that is
 * not this viewer's or this app's.
 *
 * 🔴 A REJECTED `submit` IS NOT "NOT STARTED". A `5xx`, a `409` and a request
 * that got no answer all leave the outcome UNKNOWN, and
 * {@link SubmissionUnconfirmedError} says so outright. See
 * {@link WorkflowsClient.submit}.
 */
export interface WorkflowsClient {
  /**
   * Prices a body without running it. Nothing is charged or reserved.
   *
   * The price is `snapshot.cost.total`. A refused estimate resolves with
   * `status: 'failed'` and no `cost`; a body the host cannot price fails this
   * way without that predicting a refused {@link WorkflowsClient.submit}.
   *
   * 🔴 DO NOT REQUIRE `'succeeded'`. Nothing runs on an estimate, so a priced
   * one comes back with a status that has not finished (`'pending'` in
   * practice). Read the price with {@link estimatedCost}, which is `null`
   * exactly when there is none to show:
   *
   * ```ts
   * const price = estimatedCost(await app.workflows.estimate(body));
   * if (price === null) showMessage('This generation could not be priced.');
   * ```
   */
  estimate(body: WorkflowBody, opts?: WorkflowCallOptions): Promise<BlockWorkflowSnapshot>;

  /**
   * Runs a body, spending the viewer's Buzz. Resolves as soon as the host has
   * accepted or refused it — follow it with {@link WorkflowsClient.wait}.
   *
   * 🔴 A resolved `status: 'failed'` is one of TWO things, told apart by
   * `workflowId`:
   * - the placeholder id `'failed'`: the host refused THIS request before
   *   submitting it (a budget, a spending cap, a body it will not run). A
   *   budget or cap refusal carries the `cost.total` it would not charge. On a
   *   first attempt nothing was charged; it says nothing about an EARLIER
   *   attempt for the same viewer action that ended unknown (below).
   * - a real id: a run was created and came back failed. Buzz may have been
   *   spent.
   *
   * A third outcome does not resolve at all: when the host could not confirm
   * whether the run was created, this REJECTS with
   * {@link SubmissionUnconfirmedError}. That run may be live and charged.
   *
   * 🔴 WHEN THIS REJECTS, TREAT THE OUTCOME AS UNKNOWN. The host refuses a
   * bad request before submitting anything, but the reply does not say whether
   * a rejection came before or after the orchestrator was called. By name:
   * - a `5xx`: the host answers this both when nothing was started and when
   *   its orchestrator call failed after the orchestrator may have created the
   *   run. A workflow may exist.
   * - a `409`: an earlier submit with the same key is still in flight (or its
   *   record was lost). That attempt may yet succeed.
   * - no answer (a dropped connection, a timeout): unknown.
   *
   * Retry with the SAME `idempotencyKey` — except for the two kinds below, the
   * host derives the run's identity on the orchestrator from it, so that a
   * repeat can be matched to an existing run — or look for the run with
   * {@link WorkflowsClient.list}. Never mint a new key for the same viewer
   * action: to the host a new key is a new generation. That matching is the
   * host's and the orchestrator's, is not guaranteed, and is not something
   * this client can verify. Nor does `list` settle it: a listed workflow
   * carries no idempotency key, and a run missing from it is not proof that
   * nothing ran.
   *
   * 🔴 For a `kind: 'training'` body and a step body carrying a `quoteId` the
   * key is NOT the run's identity: the host does not use it there, and
   * identifies the run by the confirmed quote or the training run. After an
   * unknown outcome on one of these, check `list` before asking the viewer to
   * confirm another quote.
   *
   * This client does not retry a failed submit itself; it only re-sends once
   * after refreshing an expired token, as every call does.
   */
  submit(body: WorkflowBody, opts: WorkflowSubmitOptions): Promise<BlockWorkflowSnapshot>;

  /** One workflow's current state. Only a workflow this app submitted for this viewer. */
  get(workflowId: string, opts?: WorkflowGetOptions): Promise<BlockWorkflowSnapshot>;

  /**
   * Yields the workflow now and again each time it changes, ending at a final
   * status. Break out of the loop to stop watching.
   *
   * A yielded snapshot can be a bare progress placeholder — just `workflowId`
   * and `status: 'processing'` — which the host sends when it skips a read
   * under load. Keep what an earlier snapshot showed rather than rendering
   * that one as "no steps, no images".
   */
  watch(
    workflowId: string,
    opts?: WorkflowWatchOptions,
  ): AsyncGenerator<BlockWorkflowSnapshot, void, undefined>;

  /** Resolves once the workflow reaches a final status, whichever it is. */
  wait(workflowId: string, opts?: WorkflowWatchOptions): Promise<BlockWorkflowSnapshot>;

  /**
   * Stops a running workflow on the orchestrator. Resolves with the workflow as
   * it now stands: usually `'canceled'`, but one that had already finished
   * keeps its real final status, and a host shedding load can answer with a
   * state that is not final yet. Read `status` rather than assuming.
   */
  cancel(workflowId: string, opts?: WorkflowCallOptions): Promise<BlockWorkflowSnapshot>;

  /**
   * One page of the workflows THIS APP submitted for this viewer. The host
   * scopes it to the app from the token; there is no filter to pass, and it
   * never includes the viewer's other generations.
   */
  list(query?: WorkflowListQuery, opts?: WorkflowCallOptions): Promise<WorkflowListResult>;
}

const isSnapshot = (value: unknown): value is BlockWorkflowSnapshot =>
  value != null && typeof value === 'object' && typeof (value as { status?: unknown }).status === 'string';

/**
 * Asserted, not cast: every caller branches on `status`, and a reply without
 * one would read as "not failed" to all of them.
 */
function requireSnapshot(op: string, res: { snapshot?: unknown } | undefined): BlockWorkflowSnapshot {
  if (!isSnapshot(res?.snapshot)) throw new CivitaiError(`workflows ${op}: reply carried no snapshot`);
  return res.snapshot;
}

export function createWorkflowsClient(http: Http): WorkflowsClient {
  /** Every snapshot route answers `{ snapshot }`. A `2xx` without one is not an answer. */
  const snapshotOf = async (op: string, body: unknown, signal?: AbortSignal) =>
    requireSnapshot(op, await http<{ snapshot?: unknown }>('POST', `${BASE}/${op}`, { body, signal }));

  const get = (workflowId: string, { waitSeconds, signal }: WorkflowGetOptions = {}) =>
    // The id travels in the body on every route: it identifies the viewer, so
    // it stays out of URLs. `JSON.stringify` drops an unset `waitSeconds`.
    snapshotOf('poll', { workflowId, waitSeconds }, signal);

  async function* watch(
    workflowId: string,
    { signal, waitSeconds = HELD_READ_SECONDS, intervalMs = READ_INTERVAL_MS }: WorkflowWatchOptions = {},
  ) {
    let seen: string | undefined;
    let failures = 0;
    let held = false;
    for (;;) {
      let snapshot: BlockWorkflowSnapshot;
      try {
        snapshot = await get(workflowId, held ? { waitSeconds, signal } : { signal });
        failures = 0;
      } catch (error) {
        if (signal?.aborted || !isTransient(error) || failures >= RETRY_BACKOFF_MS.length) throw error;
        await sleep(RETRY_BACKOFF_MS[failures++]!, signal);
        continue;
      }
      held = true;
      // Compared whole, so anything the host adds to a snapshot counts as progress.
      const text = JSON.stringify(snapshot);
      if (text !== seen) {
        seen = text;
        yield snapshot;
      }
      if (FINAL.has(snapshot.status)) return;
      // 🔴 Always paced, even though the read was held. The host answers a read
      // it sheds at once, with a snapshot that is not final, precisely so the
      // watcher keeps going — without this gap that reply would be re-requested
      // in a tight loop.
      signal?.throwIfAborted();
      await sleep(intervalMs, signal);
    }
  }

  return {
    estimate: (body, { signal } = {}) => snapshotOf('estimate', { body }, signal),

    async submit(body, opts) {
      const idempotencyKey = (opts as Partial<WorkflowSubmitOptions> | undefined)?.idempotencyKey;
      // Checked before the request because the host refuses a submit without
      // one, and a caller in plain JavaScript gets no compile error. Presence
      // only: the format is the host's rule and is not re-spelled here.
      if (typeof idempotencyKey !== 'string' || idempotencyKey === '') {
        throw new CivitaiError(
          'workflows submit: `idempotencyKey` is required. Mint one per viewer action — ' +
            'e.g. crypto.randomUUID() — and reuse it on every retry of that submit. Nothing was sent.',
        );
      }
      const res = await http<{ snapshot?: unknown; submissionUnconfirmed?: unknown }>(
        'POST',
        `${BASE}/submit`,
        { body: { body, idempotencyKey }, signal: opts.signal },
      );
      // 🔴 Read BEFORE the snapshot is trusted. The snapshot beside this flag is
      // refusal-shaped; returning it would tell the caller nothing was charged
      // for a run that may be live.
      if (res?.submissionUnconfirmed === true) {
        throw new SubmissionUnconfirmedError(isSnapshot(res.snapshot) ? res.snapshot : undefined);
      }
      return requireSnapshot('submit', res);
    },

    get,

    watch,

    async wait(workflowId, opts = {}) {
      let last: BlockWorkflowSnapshot | undefined;
      for await (const snapshot of watch(workflowId, opts)) last = snapshot;
      return last!;
    },

    cancel: (workflowId, { signal } = {}) => snapshotOf('cancel', { workflowId }, signal),

    async list(query = {}, { signal } = {}) {
      const res = await http<{ workflows?: unknown; cursor?: unknown }>('POST', `${BASE}/query`, {
        // Named rather than spread: the route's body schema is closed, so any
        // other key a caller passed would turn the whole request into a 400.
        body: { cursor: query.cursor, limit: query.limit },
        signal,
      });
      // 🔴 NO `?? []`. A malformed 200 must throw, never answer "nothing
      // running": a block rebuilds its in-flight queue from this.
      if (!Array.isArray(res?.workflows)) {
        throw new CivitaiError('workflows list: reply carried no `workflows` array');
      }
      // The cursor is passed through untouched: not defaulted, not re-derived.
      return { workflows: res.workflows as AppWorkflow[], cursor: res.cursor as string | null };
    },
  };
}
