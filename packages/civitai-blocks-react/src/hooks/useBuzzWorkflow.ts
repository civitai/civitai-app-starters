import { useCallback, useState } from 'react';

import type { BlockWorkflowSnapshot, WorkflowBody, WorkflowStatus } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { generateIdempotencyKey, sendTypedRequest } from '../internal/transport.js';

/**
 * Snapshot statuses that mean "no further polling is needed."
 * Used by both `submit` (a host can return an instant-fail / cached result)
 * and `poll` so the hook can't get stuck in 'polling' after a terminal reply.
 */
const TERMINAL_STATUSES: ReadonlySet<BlockWorkflowSnapshot['status']> = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

/**
 * The workflow requests (estimate / submit / poll) are orchestrator-bound:
 * the host forwards them to the generation orchestrator and only replies
 * once it answers. `submit` is the slowest — server-side it does a whatif
 * cost-preflight AND the real submit (two orchestrator round-trips) plus a
 * prompt audit before responding, which legitimately exceeds the
 * transport's 30s `DEFAULT_REQUEST_TIMEOUT_MS` (tuned for fast bridge
 * messages) when the orchestrator queue is busy. Give these calls a
 * generous ceiling so a busy-but-healthy orchestrator doesn't surface as
 * a spurious `request "SUBMIT_WORKFLOW" timed out` rejection.
 */
const WORKFLOW_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Default orchestrator-side hold per {@link UseBuzzWorkflowReturn.watch} poll,
 * in SECONDS.
 *
 * 🔴 THE UNIT IS SECONDS, matching the orchestrator's `?wait=` parameter — not
 * the milliseconds every other timing option in this file uses. Named
 * `waitSeconds` everywhere for exactly that reason.
 *
 * 15 rather than something larger for two reasons, both of them ceilings this
 * value must stay UNDER, not preferences:
 *   - civitai's shared `getWorkflow` helper aborts a single orchestrator read at
 *     20s. A hold at or above that is cancelled by our own backstop before the
 *     orchestrator can answer.
 *   - the host's poll additionally runs an inline output-moderation scan with
 *     its own ~12s ceiling, and the two are SEQUENTIAL — so the round trip's
 *     worst case is 15 + 12 = 27s, which must stay inside the host's own
 *     end-to-end response budget.
 */
export const DEFAULT_WATCH_WAIT_SECONDS = 15;

/** Gap between `watch` polls, in ms. See {@link WatchWorkflowOptions.intervalMs}. */
const DEFAULT_WATCH_INTERVAL_MS = 1_500;

/** Total `watch` budget, in ms. Generation can legitimately take minutes. */
const DEFAULT_WATCH_TIMEOUT_MS = 10 * 60_000;

/** How many CONSECUTIVE transport failures `watch` absorbs before rejecting. */
const DEFAULT_WATCH_MAX_RETRIES = 3;

/** Optional controls for {@link UseBuzzWorkflowReturn.watch}. */
export interface WatchWorkflowOptions {
  /**
   * Called with EVERY snapshot the host returns, intermediate ones included, in
   * order. This is the push side of the API: render from here instead of
   * re-reading `result` on a timer.
   *
   * A throw from this callback is not caught — it rejects the `watch` promise.
   */
  onUpdate?: (snapshot: BlockWorkflowSnapshot) => void;
  /**
   * Stop watching. The promise RESOLVES with the last snapshot seen rather than
   * rejecting: an abort is the caller's own decision, not a failure, and the
   * common case (a component unmounting) has nobody left to catch a rejection.
   *
   * 🔴 This does NOT cancel the workflow — it stops watching it. Buzz is already
   * spent and the orchestrator keeps running. To actually stop the work, call
   * {@link UseBuzzWorkflowReturn.cancel}.
   */
  signal?: AbortSignal;
  /**
   * Orchestrator-side hold per poll, in **seconds**. Default
   * {@link DEFAULT_WATCH_WAIT_SECONDS}. `0` disables long polling and falls back
   * to a plain read per `intervalMs`.
   *
   * 🔴 CURRENTLY ADVISORY. It travels on the `POLL_WORKFLOW` message and a host
   * that does not yet read the field simply answers immediately, exactly as
   * today — so `watch` is correct either way, it just polls more often. See the
   * field's note on `BlockToParentMessage`.
   */
  waitSeconds?: number;
  /**
   * Delay between polls, in ms. Default 1500.
   *
   * 🔴 NOT REDUNDANT WITH `waitSeconds`. When the host long-polls, the hold
   * dominates and this is a few percent of overhead. When it does NOT — an
   * older host, or `waitSeconds: 0` — this is the only thing standing between
   * this loop and a request storm.
   */
  intervalMs?: number;
  /** Give up and resolve with the last snapshot after this long. Default 10min. */
  timeoutMs?: number;
  /**
   * Consecutive transport failures to absorb before rejecting. Default 3.
   *
   * A poll can fail for reasons that have nothing to do with the workflow (a
   * pod rolling, a network blip). Because `watch` OWNS the loop, a single blip
   * would otherwise end a generation the caller's own retry loop used to
   * survive. The counter RESETS on any successful poll, so this bounds a burst,
   * not a lifetime.
   */
  maxRetries?: number;
}

/**
 * Sleep, waking EARLY if `signal` aborts.
 *
 * 🔴 A PLAIN `setTimeout` WOULD MAKE ABORT LATENCY EQUAL THE POLL INTERVAL. A
 * component unmounting mid-gap would keep a pending timer alive for up to
 * `intervalMs` and only then notice, which is exactly the "unmounted component
 * kept working" shape an abort signal exists to prevent. The listener is always
 * removed, so an abort long after the sleep resolved cannot fire into a
 * finished loop.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

/**
 * Thrown by {@link UseBuzzWorkflowReturn.estimate} when the host's reply does not
 * carry a usable price — either because the estimate ERRORED, or because it came
 * back without a numeric `cost.total`.
 *
 * 🔴 WHY THIS EXISTS — civitai/civitai#4159. A host-side `blocks.estimateWorkflow`
 * throw is not propagated to the block as a rejection; it CANNOT be, because the
 * reply crosses `postMessage`. The host instead posts a well-formed
 * `ESTIMATE_RESULT` carrying its `failureSnapshot(err)` —
 * `{ workflowId: 'failed', status: 'failed', error: '<server message>' }`, with
 * **no `cost`** (see the host's `failureSnapshot.ts`, whose own comment states
 * the block is expected to read `status`/`error`).
 *
 * Until this guard, `estimate()` resolved that snapshot as a SUCCESS and moved
 * the hook to `'confirming'`. A correctly fail-closed block — one that gates
 * Confirm on `typeof snapshot.cost?.total === 'number'` — then rendered a
 * confirm dialog reading "Cost unavailable" with Confirm permanently disabled,
 * and the server's own explanation (already present on `snapshot.error`) was
 * discarded on the floor. The control was dead AND undiagnosable: a caller
 * could not tell "priced at 0" from "the estimate errored".
 *
 * 🔴 TWO PRODUCERS, ONE OBSERVABLE — which is why {@link WorkflowEstimateError.code}
 * exists and why the guard is not keyed on `status` alone. The server's
 * `snapshotFromWorkflow` omits `cost` from an otherwise-SUCCESSFUL snapshot
 * whenever the whatIf reply has no numeric total, so a `{status:'pending'}` reply
 * with no `error` at all produces the identical dead control. A `status`-only
 * guard would be INERT for that half. The two are distinguishable only by
 * `snapshot.error` / `workflowId === 'failed'` — exactly the fields the original
 * incident discarded, which is why it is still unknown which producer caused it.
 *
 * So an unusable estimate now REJECTS, which is what every caller's existing
 * `try/catch` around `estimate()` is already shaped for. The snapshot is carried
 * on the error rather than dropped, so nothing that was reachable before is lost
 * — a caller that wants the raw reply reads `err.snapshot`.
 *
 * 🔴 WHERE THE REASON IS — READ `.snapshot.error`, NOT `message`. Recovering that
 * string is the entire point of this class, so getting this the wrong way round
 * reproduces the bug one layer down: a caller who logs `message` expecting the
 * server's words gets a constant and is exactly as stuck as before.
 *
 * 🔴 THREE FIELDS, THREE AUDIENCES — AND **NONE OF THEM IS VIEWER-FACING COPY**.
 * The viewer-facing string is one the APP owns; this error carries nothing you
 * may render as-is. Two apps migrating to `0.43.0` each had a `catch` that piped
 * `err.message` straight into rendered UI, and each would have shipped
 * `estimate did not return a usable price (failed) — reason on .snapshot.error`
 * to end users; both were caught only by a test asserting that exact string.
 *
 *   - {@link WorkflowEstimateError.snapshot}`.error` — **the DIAGNOSTIC read.**
 *     The server's own words, verbatim. **Server-authored and UNSANITISED**:
 *     civitai's `errorHandling.ts` documents that raw upstream text —
 *     Prisma/`pg` column and constraint names among it — can reach this field.
 *     Log it, or show it in a developer-facing error surface. **NEVER render it
 *     verbatim into markup**, and think before shipping it to a third-party
 *     error tracker.
 *   - {@link WorkflowEstimateError.message} — **DEVELOPER-FACING.** A CONSTANT
 *     template with only `code` interpolated. It contains no server text and
 *     nothing to sanitise, so it is safe to LOG and safe to let a stack trace
 *     print — that is deliberate, because `message` is what an uncaught
 *     rejection prints and what a third-party block's error reporter ships
 *     upstream by default, and this is a package consumed by third-party code.
 *     **It is NOT intended for display to viewers**: it names an internal field
 *     path, it is not localised, and **its exact wording is NOT a contract** —
 *     it can change in any release, so a UI built on it silently rots.
 *   - {@link WorkflowEstimateError.code} — **the BRANCH TARGET**, and the only
 *     stable one. Switch on it to pick a viewer-facing string YOUR APP owns
 *     (see the mapper in the `@example` on {@link useBuzzWorkflow}).
 *
 * 🔴 DO NOT "SIMPLIFY" THIS BY PUTTING `snapshot.error` BACK ON `message`. The
 * two fields are split on purpose and the split is what keeps database internals
 * off a third party's default-printed surface. `test/useBuzzWorkflow.test.tsx`
 * pins it with a realistic `Unique constraint failed: Key (email)=(…)` fixture.
 *
 * 🔴 NOT APPLIED TO `submit`, and the reason is narrower than it looks. On
 * `WORKFLOW_SUBMITTED` there are likewise TWO producers, indistinguishable by
 * `status`: budget/cap REJECTIONS, which are a documented outcome the block
 * recovers from (open a top-up flow) and which carry a `cost`; and caught server
 * exceptions posted via the SAME `failureSnapshot(err)` used above, which do not.
 * The `#4159` defect is therefore live on `submit` too, discriminated by `cost`
 * presence rather than by `status`. Fixing it there is a separate change with its
 * own blast radius on the recovery path (a fix MUST keep the budget-rejection arm
 * RESOLVING, or the top-up flow breaks) and is deliberately NOT attempted here —
 * so `submit` is left resolving BOTH, and the accompanying test pins only the
 * budget-rejection producer, not a claim that submit is correct.
 *
 * 🔴 TRACKED, NOT FORGOTTEN: civitai/civitai-app-starters#251. Read it before
 * touching `submit`'s failure handling.
 */
export class WorkflowEstimateError extends Error {
  /**
   * WHICH PRODUCER this was, structurally — so a caller branches on an enum
   * rather than on prose. It is the ONLY stable branch target here:
   * `snapshot.error` is server-authored and can change without notice, and
   * {@link WorkflowEstimateError.message} is a generic developer-facing summary
   * whose exact wording is not a contract either.
   *
   * 🔴 THIS IS WHAT A VIEWER-FACING MESSAGE MUST BE DERIVED FROM. Branch on
   * `code` and return a string your app owns and localises; never render
   * `message` or `snapshot.error` to a viewer.
   *
   * - `'failed'`  — the reply's `status` is `'failed'`. USUALLY that means
   *   `blocks.estimateWorkflow` threw server-side and the host posted its
   *   `failureSnapshot(err)` (so `snapshot.error` carries the server's reason and
   *   there is no `cost`) — but it is NOT only that: a whatIf the orchestrator
   *   itself reports as failed maps to `'failed'` through the server's own
   *   `ORCH_STATUS_MAP`, and such a reply CAN carry a numeric `cost`. Both are
   *   rejected: a failed estimate is not a quote you may spend against, whether
   *   or not a number came back with it. Do not read this code as "the host
   *   threw" — read it as "the estimate did not succeed".
   * - `'no-cost'` — a NON-failed reply with no numeric `cost.total`. There is
   *   usually no `snapshot.error` to explain it, which makes it the harder of the
   *   two to diagnose from the block side.
   */
  readonly code: 'failed' | 'no-cost';

  /**
   * The snapshot the host replied with, VERBATIM — including `snapshot.error`,
   * the server's own words, when there are any.
   *
   * 🔴 `snapshot.error` IS SERVER-AUTHORED AND UNSANITISED. It is where the
   * reason lives (reading it is the documented way to diagnose an estimate that
   * will not price — the whole point of civitai/civitai#4159), but civitai's
   * `errorHandling.ts` documents that raw upstream text — Prisma/`pg` column and
   * constraint names among it — can reach that field. Log it, show it in a
   * developer-facing error surface, **NEVER render it verbatim into markup**,
   * and do not ship it to a third-party error tracker without thinking about it.
   */
  readonly snapshot: BlockWorkflowSnapshot;

  constructor(snapshot: BlockWorkflowSnapshot, code: 'failed' | 'no-cost') {
    // 🔴 GENERIC, AND DELIBERATELY NOT `snapshot.error`. `message` is the field an
    // uncaught rejection PRINTS and the field a third-party block's error
    // reporter ships upstream by default — so putting the raw server string here
    // would put database internals (constraint names, `Key (email)=(…) already
    // exists.`) on the default-printed surface of somebody else's code. Exposure
    // to the block is identical either way (`snapshot.error` was always on the
    // wire), so routing the raw text to `.snapshot.error` alone costs a
    // deliberate debugger nothing and changes only the DISPOSITION. `code` is
    // carried IN the message so an uncaught rejection is still self-describing.
    //
    // 🔴 IT IS DEVELOPER-FACING, NOT VIEWER-FACING — it names an internal field
    // path and is not localised, so it must not reach rendered UI. Its exact
    // wording is NOT a contract: it may change in any release. A viewer-facing
    // string is derived from `code` by the app (see the class docs).
    super(`estimate did not return a usable price (${code}) — reason on .snapshot.error`);
    this.name = 'WorkflowEstimateError';
    this.code = code;
    this.snapshot = snapshot;
  }
}

/** Optional per-submit controls. */
export interface SubmitWorkflowOptions {
  /**
   * A STABLE idempotency key for this logical submit. Reuse the SAME value when
   * RETRYING a submit whose response was lost (timeout / network drop) so the
   * host+orchestrator collapse it to ONE Buzz charge instead of double-charging.
   * Omit → the hook generates a fresh key per `submit()` call (each call is a new
   * logical submit); pass a stable id (e.g. a grid-cell id) to make a retry safe.
   */
  idempotencyKey?: string;
}

interface UseBuzzWorkflowReturn {
  /**
   * Price a workflow without queueing it. Resolves ONLY with a snapshot that
   * carries a numeric `cost.total`.
   *
   * 🔴 REJECTS with {@link WorkflowEstimateError} when the reply is unusable —
   * the estimate errored server-side, or it came back with no numeric cost.
   * Wrap every call in `try/catch`; see that class for why resolving such a
   * reply was civitai/civitai#4159.
   *
   * 🔴 THIS INCLUDES MODERATOR REVIEW PREVIEW, a behaviour change worth knowing
   * before you ship. While an app is under review the host short-circuits every
   * workflow request with `failureSnapshot('not available in review preview')`,
   * so `estimate()` now rejects there where it used to resolve. That is the
   * correct reading — no estimate happened — and it is why the catch is not
   * optional: a block without one turns the reviewer's first click into an
   * unhandled rejection, at exactly the moment it is meant to look healthy. A
   * block that catches shows the reviewer the reason instead.
   *
   * `result` is updated to the returned snapshot BEFORE any rejection, so a
   * failed estimate can never leave a previous, differently-configured
   * estimate's price sitting in `result` for a Confirm gate to read.
   */
  estimate: (body: WorkflowBody) => Promise<BlockWorkflowSnapshot>;
  submit: (
    body: WorkflowBody,
    options?: SubmitWorkflowOptions,
  ) => Promise<BlockWorkflowSnapshot>;
  /**
   * ONE host round-trip. The low-level pull primitive — you almost certainly
   * want {@link UseBuzzWorkflowReturn.watch} instead, which owns the loop.
   */
  poll: (workflowId: string) => Promise<BlockWorkflowSnapshot>;
  /**
   * Watch a workflow to completion. Resolves with the TERMINAL snapshot; calls
   * `onUpdate` with every intermediate snapshot along the way.
   *
   * This is the replacement for the `useEffect` + `setTimeout` backoff every
   * block used to hand-write around {@link UseBuzzWorkflowReturn.poll}. The app
   * consumes a promise and/or a callback; the loop lives here.
   *
   * 🔴 THE LOOP IS SEQUENTIAL AND NON-OVERLAPPING BY CONSTRUCTION — each poll is
   * awaited before the next is scheduled, so exactly one request per watched
   * workflow is ever in flight. That is not tidiness: it is the property that
   * makes a long hold SAFE. A caller-written `setInterval(poll, 2000)` against
   * a host holding 15s would stack ~7 concurrent requests per workflow, and
   * that is precisely why long polling is opt-in on the wire rather than
   * switched on for every deployed block.
   *
   * @example
   * const { submit, watch, cancel } = useBuzzWorkflow();
   * const submitted = await submit(body);
   * const done = await watch(submitted.workflowId, {
   *   onUpdate: (snap) => setProgress(snap.status),
   *   signal: abortRef.current.signal,
   * });
   * if (done.status === 'succeeded') setImages(done.imageUrls ?? []);
   */
  watch: (
    workflowId: string,
    options?: WatchWorkflowOptions,
  ) => Promise<BlockWorkflowSnapshot>;
  /**
   * Cancel a running workflow on the orchestrator (a real server-side stop,
   * not just client-side untracking). The host re-derives ownership from the
   * viewer's orchestrator token, so this can only cancel workflows the viewer
   * owns; the orchestrator rejects others. Resolves with the workflow's
   * (now-canceled) snapshot.
   */
  cancel: (workflowId: string) => Promise<BlockWorkflowSnapshot>;
  status: WorkflowStatus;
  result: BlockWorkflowSnapshot | null;
  error: Error | null;
}

/**
 * Orchestrates the estimate → confirm → submit → poll dance through the
 * host-mediated `postMessage` path.
 *
 * The host enforces budget rules (`cost_estimate <= token.buzzBudget`)
 * before forwarding to the orchestrator; submit() will reject if the host
 * refuses. Block apps should call `useBuzzPurchase().openPurchaseModal()`
 * when that happens.
 *
 * AFTER `submit` FLIPS `status` TO `'polling'`, USE `watch(workflowId)`. It owns
 * the loop, resolves on the terminal snapshot, and pushes every intermediate
 * one to an `onUpdate` callback — so a block consumes a promise/callback rather
 * than running its own timer. `poll(workflowId)` remains the single-round-trip
 * primitive for callers that genuinely want to drive their own cadence; the
 * hand-written `useEffect` + backoff around it that this docstring used to
 * prescribe is no longer the recommended shape. `status === 'confirming'` is
 * IDLE (estimate landed, user reviewing cost) — keep the Generate button
 * enabled.
 *
 * `estimate`/`submit` take a full {@link WorkflowBody} — the discriminated
 * union keyed by `kind`, with THREE members as of `@civitai/app-sdk@0.30.0`:
 * a `textToImage` body (`{ kind, modelId, modelVersionId, params }`), a
 * `customComfy` body (`kind: 'customComfy'`), or a `step` body
 * (`{ kind: 'step', step, params }` — a server-registered orchestrator step
 * such as `'chat-completion'`), never a bare `{ prompt }`. The hook forwards
 * the body to the host verbatim and never reads variant-specific fields, so
 * every member flows through unchanged, including any member added later.
 *
 * 🔴 `customComfy` IS ITSELF A UNION, on `mode` — an app CAN ship its own
 * ComfyUI graph. `WorkflowBodyCustomComfyRecipe` (`mode` omitted or `'recipe'`)
 * names a server-registered recipe; `WorkflowBodyCustomComfyInline`
 * (`mode: 'inline'`) carries the graph itself, plus its declared AIR
 * `resources` and a `maxBuzz` bound. The inline arm is LIVE in production
 * (developer-only) and this comment used to describe `customComfy` as a
 * recipe-only `{ kind, recipe, params }` shape — written when that was true and
 * never revisited once the arm shipped. A developer working against the live
 * feature read the equivalent claim on the type, believed it over their own
 * instinct, and concluded the capability did not exist. `@civitai/app-sdk`
 * 0.30.0 predates the inline arm; the union above is otherwise unchanged.
 *
 * @returns `{ estimate, submit, poll, watch, cancel, status, result, error }`.
 *
 * @example
 * const { estimate, submit, watch, status, result } = useBuzzWorkflow();
 * const body = {
 *   kind: 'textToImage' as const,
 *   modelId,
 *   modelVersionId,
 *   params: { prompt: 'a cat' },
 * };
 * // A viewer-facing string YOUR APP owns, chosen by `code`. Neither
 * // `err.message` (developer-facing, wording not a contract) nor
 * // `err.snapshot.error` (server-authored, unsanitised) may be rendered.
 * const estimateFailureMessage = (err: WorkflowEstimateError) =>
 *   err.code === 'no-cost'
 *     ? 'We could not get a price for this configuration. Try adjusting it.'
 *     : 'Pricing is unavailable right now. Please try again shortly.';
 *
 * // 🔴 estimate() REJECTS when the reply carries no usable price — an errored
 * // estimate, or one that came back with no numeric cost. ALWAYS catch it.
 * try {
 *   await estimate(body);          // status 'estimating' → 'confirming' (cost in result.cost.total)
 * } catch (err) {
 *   // status is now 'error'; `result` holds the unusable snapshot, never a
 *   // STALE priced one. See WorkflowEstimateError for the three-audience split.
 *   if (!(err instanceof WorkflowEstimateError)) throw err;
 *   logForDebugging(err.message, err.snapshot.error); // developer-facing: LOG only
 *   showError(estimateFailureMessage(err));           // viewer-facing: app-owned
 * }
 * const snap = await submit(body); // status 'submitting' → 'polling'; returns a workflowId
 * const done = await watch(snap.workflowId, { onUpdate: render }); // → terminal
 */
export function useBuzzWorkflow(): UseBuzzWorkflowReturn {
  const [status, setStatus] = useState<WorkflowStatus>('idle');
  const [result, setResult] = useState<BlockWorkflowSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const estimate = useCallback(async (body: WorkflowBody) => {
    setError(null);
    setStatus('estimating');
    try {
      const { snapshot } = await sendTypedRequest(
        getTransport(),
        { type: 'ESTIMATE_WORKFLOW', payload: { body } },
        'ESTIMATE_RESULT',
        { timeoutMs: WORKFLOW_REQUEST_TIMEOUT_MS },
      );
      // 🔴 PUBLISH THE SNAPSHOT BEFORE ANY REJECTION BELOW. `result` is what the
      // README documents as where the cost lives, so a block may gate its Confirm
      // on `typeof result.cost?.total === 'number'` rather than on the returned
      // value. If the throw jumped over this line, a FAILED estimate would leave
      // the PREVIOUS estimate's snapshot in place and that gate would read the
      // OLD config's price — a live control quoting the wrong number on a money
      // path, which is strictly worse than the dead control this PR exists to
      // fix. Assigning first preserves the pre-fix fail-CLOSED property (the
      // cost-less snapshot overwrites the priced one) and merely adds the
      // rejection on top.
      setResult(snapshot);
      // 🔴 AN UNUSABLE ESTIMATE MUST REJECT — and there are TWO producers of the
      // identical observable "resolved, but no `cost.total`", distinguishable
      // only by fields the incident in civitai/civitai#4159 discarded:
      //
      //   (a) status:'failed'  — `blocks.estimateWorkflow` threw server-side. The
      //       host cannot reject across postMessage, so it posts
      //       `failureSnapshot(err)`: a VALID snapshot with `status:'failed'`,
      //       an `error` string, and no `cost`.
      //   (b) no numeric cost on an otherwise-successful snapshot — the server's
      //       `snapshotFromWorkflow` OMITS `cost` entirely when the whatIf reply
      //       has no numeric total (`...(typeof total === 'number' ? … : {})`),
      //       which yields e.g. `{status:'pending'}` with no `error` at all.
      //
      // Keying on `status` ALONE would leave (b) resolving — the same dead
      // "Cost unavailable" control, still undiagnosable. So the rule is the one
      // the caller actually needs: an estimate that did not yield a usable price
      // does not resolve. `canceled`/`expired` are covered by the same clause
      // (they carry no cost), which is why they need no arm of their own.
      const usableCost = typeof snapshot.cost?.total === 'number';
      if (snapshot.status === 'failed') {
        throw new WorkflowEstimateError(snapshot, 'failed');
      }
      if (!usableCost) {
        throw new WorkflowEstimateError(snapshot, 'no-cost');
      }
      setStatus('confirming');
      return snapshot;
    } catch (err) {
      setError(err as Error);
      setStatus('error');
      throw err;
    }
  }, []);

  const submit = useCallback(async (body: WorkflowBody, options?: SubmitWorkflowOptions) => {
    setError(null);
    setStatus('submitting');
    // Idempotency: reuse a caller-supplied stable key across a retry (→ one Buzz
    // charge), or mint a fresh one per call (each call is a new logical submit).
    const idempotencyKey = options?.idempotencyKey ?? generateIdempotencyKey();
    try {
      const { snapshot } = await sendTypedRequest(
        getTransport(),
        { type: 'SUBMIT_WORKFLOW', payload: { body, idempotencyKey } },
        'WORKFLOW_SUBMITTED',
        { timeoutMs: WORKFLOW_REQUEST_TIMEOUT_MS },
      );
      setResult(snapshot);
      setStatus(TERMINAL_STATUSES.has(snapshot.status) ? 'done' : 'polling');
      return snapshot;
    } catch (err) {
      setError(err as Error);
      setStatus('error');
      throw err;
    }
  }, []);

  /**
   * ONE poll round-trip, with an optional long-poll hint. The single place that
   * builds a `POLL_WORKFLOW` message, so `poll` and `watch` cannot drift on the
   * message shape or the request timeout.
   */
  const pollOnce = useCallback(
    async (workflowId: string, waitSeconds?: number): Promise<BlockWorkflowSnapshot> => {
      const { snapshot } = await sendTypedRequest(
        getTransport(),
        {
          type: 'POLL_WORKFLOW',
          payload: {
            workflowId,
            // Omitted rather than sent as 0 when long polling is off, so the
            // message stays byte-identical to what pre-`watch` blocks send.
            ...(waitSeconds !== undefined && waitSeconds > 0 ? { waitSeconds } : {}),
          },
        },
        'WORKFLOW_STATUS',
        { timeoutMs: WORKFLOW_REQUEST_TIMEOUT_MS },
      );
      // A reply without a usable snapshot is a failure, not a result: returning
      // `undefined` would make `poll` resolve with a non-snapshot, and would
      // make `watch` — whose stop condition is
      // `TERMINAL_STATUSES.has(snapshot.status)` — loop to its timeout against a
      // host that is answering with nothing. Throwing routes it into `watch`'s
      // bounded retry instead.
      //
      // 🔴 NOT CLAIMED TO BE REACHABLE THROUGH `IframeTransport`, WHICH ALREADY
      // FAIL-CLOSES THIS. Its `payloadValidatorFor('WORKFLOW_STATUS')`
      // (internal/validate.ts) drops a reply whose `snapshot.status` is absent
      // or outside the known set, so the request never resolves at all and
      // times out instead. This guard covers the OTHER transports
      // `sendTypedRequest` accepts (mock/test hosts, `dev:live`), and is kept as
      // cheap defence — do not cite it as validated input handling on the
      // iframe path.
      if (!snapshot || typeof snapshot.status !== 'string') {
        throw new Error(`POLL_WORKFLOW: malformed response (no snapshot) for ${workflowId}`);
      }
      return snapshot;
    },
    [],
  );

  const poll = useCallback(
    async (workflowId: string) => {
      setStatus('polling');
      try {
        const snapshot = await pollOnce(workflowId);
        setResult(snapshot);
        if (TERMINAL_STATUSES.has(snapshot.status)) {
          setStatus('done');
        }
        return snapshot;
      } catch (err) {
        setError(err as Error);
        setStatus('error');
        throw err;
      }
    },
    [pollOnce],
  );

  const watch = useCallback(
    async (workflowId: string, options?: WatchWorkflowOptions) => {
      const interval = options?.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
      const waitSeconds = options?.waitSeconds ?? DEFAULT_WATCH_WAIT_SECONDS;
      const maxRetries = options?.maxRetries ?? DEFAULT_WATCH_MAX_RETRIES;
      const deadline = Date.now() + (options?.timeoutMs ?? DEFAULT_WATCH_TIMEOUT_MS);

      setError(null);
      setStatus('polling');

      let last: BlockWorkflowSnapshot | null = null;
      let consecutiveFailures = 0;

      // 🔴 SEQUENTIAL BY CONSTRUCTION. Every iteration AWAITS its poll before
      // scheduling the next, so at most one request per watched workflow is
      // ever in flight no matter how long the host holds it. A timer-driven
      // caller cannot make that guarantee, which is why long polling is
      // requested here and not enabled globally.
      for (;;) {
        if (options?.signal?.aborted) break;

        let snapshot: BlockWorkflowSnapshot;
        try {
          snapshot = await pollOnce(workflowId, waitSeconds);
          consecutiveFailures = 0;
        } catch (err) {
          // A blip is not the end of a generation. `watch` owns the loop, so a
          // single transport failure would otherwise kill a run that a
          // caller-written retry loop used to survive.
          consecutiveFailures += 1;
          if (consecutiveFailures > maxRetries || Date.now() >= deadline) {
            setError(err as Error);
            setStatus('error');
            throw err;
          }
          await sleep(interval, options?.signal);
          continue;
        }

        last = snapshot;
        setResult(snapshot);
        // 🔴 `onUpdate` RECEIVES THE SNAPSHOT AS AN ARGUMENT AND MUST USE IT.
        // `setResult` above is a React state update, so it is NOT visible to a
        // callback reading the hook's `result` in this same tick — that reads
        // the PREVIOUS render's value. The argument is the current one; the
        // hook state catches up on the next render.
        //
        // A throw here propagates deliberately — swallowing a consumer's error
        // would leave the loop spinning against a broken consumer.
        options?.onUpdate?.(snapshot);

        if (TERMINAL_STATUSES.has(snapshot.status)) {
          setStatus('done');
          return snapshot;
        }
        // Budget exhausted: resolve with what we have rather than throwing. A
        // non-terminal result is a legitimate answer ("still running"), and the
        // caller can tell the difference by reading `.status`.
        if (Date.now() + interval >= deadline) break;
        await sleep(interval, options?.signal);
      }

      // Aborted or timed out with a snapshot in hand — resolve with it.
      if (last) return last;
      // 🔴 NO SNAPSHOT AT ALL. Only reachable when the signal was ALREADY
      // aborted on entry. Rejecting is the only honest option: there is nothing
      // to resolve with, and issuing a poll here would make a request the
      // caller explicitly asked us not to make.
      const aborted = new Error(`watch(${workflowId}) aborted before any snapshot`);
      aborted.name = 'AbortError';
      throw aborted;
    },
    [pollOnce],
  );

  const cancel = useCallback(async (workflowId: string) => {
    try {
      const { snapshot } = await sendTypedRequest(
        getTransport(),
        { type: 'CANCEL_WORKFLOW', payload: { workflowId } },
        'WORKFLOW_CANCELED',
        { timeoutMs: WORKFLOW_REQUEST_TIMEOUT_MS },
      );
      setResult(snapshot);
      setStatus('done');
      return snapshot;
    } catch (err) {
      // A cancel that fails (e.g. the workflow already finished, or a transient
      // host error) is surfaced but must not wedge the hook — callers treat
      // cancel as best-effort and still clear their own UI.
      setError(err as Error);
      throw err;
    }
  }, []);

  return { estimate, submit, poll, watch, cancel, status, result, error };
}
