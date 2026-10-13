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

export interface WorkflowCallOptions {
  signal?: AbortSignal;
}

export interface WorkflowSubmitOptions extends WorkflowCallOptions {
  /**
   * 🔴 REQUIRED. A submit spends the viewer's Buzz, and this key is what makes
   * sending it twice charge once. Mint it ONCE per thing the viewer asked for —
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
 * What rejects is a request that was itself refused or never answered: an
 * `ApiError` carrying the HTTP status (a malformed body or key is `400`, a
 * workflow that is not this viewer's or this app's is `403`), or a
 * `CivitaiError` for a `2xx` that carried no snapshot.
 */
export interface WorkflowsClient {
  /**
   * Prices a body without running it. Nothing is charged or reserved.
   *
   * The price is `snapshot.cost.total`. A refused estimate resolves with
   * `status: 'failed'` and no `cost`; a body the host cannot price fails this
   * way without that predicting a refused {@link WorkflowsClient.submit}.
   */
  estimate(body: WorkflowBody, opts?: WorkflowCallOptions): Promise<BlockWorkflowSnapshot>;

  /**
   * Runs a body, spending the viewer's Buzz. Resolves as soon as the host has
   * accepted or refused it — follow it with {@link WorkflowsClient.wait}.
   *
   * A budget or cap refusal resolves with `status: 'failed'`, a `cost.total`
   * and no real workflow id. Nothing was charged.
   *
   * 🔴 This client does not retry a failed submit; it only re-sends once after
   * refreshing an expired token, as every call does. If the request fails
   * without an answer, the workflow may or may not exist: retry with the SAME
   * `idempotencyKey`.
   */
  submit(body: WorkflowBody, opts: WorkflowSubmitOptions): Promise<BlockWorkflowSnapshot>;

  /** One workflow's current state. Only a workflow this app submitted for this viewer. */
  get(workflowId: string, opts?: WorkflowGetOptions): Promise<BlockWorkflowSnapshot>;

  /**
   * Yields the workflow now and again each time it changes, ending at a final
   * status. Break out of the loop to stop watching.
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

export function createWorkflowsClient(http: Http): WorkflowsClient {
  /** Every snapshot route answers `{ snapshot }`. A `2xx` without one is not an answer. */
  const snapshotOf = async (op: string, body: unknown, signal?: AbortSignal) => {
    const res = await http<{ snapshot?: unknown }>('POST', `${BASE}/${op}`, { body, signal });
    const snapshot = res?.snapshot as BlockWorkflowSnapshot | null | undefined;
    // Asserted, not cast: every caller branches on `status`, and a reply
    // without one would read as "not failed" to all of them.
    if (snapshot == null || typeof snapshot !== 'object' || typeof snapshot.status !== 'string') {
      throw new CivitaiError(`workflows ${op}: reply carried no snapshot`);
    }
    return snapshot;
  };

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
      return snapshotOf('submit', { body, idempotencyKey }, opts.signal);
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
