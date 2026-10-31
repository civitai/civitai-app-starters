import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from './useBuzzWorkflow.js';
import type { WatchWorkflowOptions } from './useBuzzWorkflow.js';
import { useTransportConnection } from './useTransportConnection.js';

/**
 * The most workflows one {@link useWorkflowBatch} may watch.
 *
 * Derived from the host's poll allowance, not picked: one watched workflow makes
 * at most 60 / 1.5 = 40 polls a minute (one poll in flight, `intervalMs` 1,500
 * between polls), and the viewer's poll allowance is 1,200 per 60 s per block
 * instance, so 1,200 / 40 = 30 workflows is the most one viewer can watch before
 * polls start coming back as placeholders. The developer docs' limits table
 * gives the same figure. A list longer than this throws, because an app that
 * needs more cells needs a different plan than "watch them all at once".
 */
export const WORKFLOW_BATCH_MAX_CELLS = 30;

/**
 * How many `cancel()` requests {@link UseWorkflowBatch.cancelAll} keeps in flight.
 *
 * Cancels charge the ESTIMATE allowance (150 per 10 s per block instance). On a
 * page app every viewer of the app shares that allowance, along with the host's
 * other reads for the app (viewer, balance, image and model lookups). Four at a
 * time keeps a 16-cell cancel-all from landing as one burst on an allowance other
 * people are using. Not exported: it is a pacing detail, not a contract.
 */
const CANCEL_CONCURRENCY = 4;

/** Statuses after which a workflow will not change again. */
const TERMINAL: ReadonlySet<BlockWorkflowSnapshot['status']> = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

/**
 * Placeholder ids a resolved `submit()` can carry when no workflow was created
 * (see `useBuzzWorkflow().submit`). There is nothing behind them to watch.
 */
const NON_WORKFLOW_IDS: ReadonlySet<string> = new Set(['failed', 'whatif']);

/**
 * Where a cell's watch stands.
 *
 * - `'watching'` — a `watch()` loop is running for it.
 * - `'settled'` — its latest snapshot is terminal. Nothing is polling it.
 * - `'stopped'` — nothing is polling it and it is NOT known to be finished: the
 *   watch timed out (`timeoutMs`), gave up after `maxRetries` failed polls, or the
 *   host answered a poll with its failure placeholder instead of this workflow's
 *   status. The workflow may still be running. `error` says why when there was an
 *   error. Call {@link UseWorkflowBatch.rewatch} to start watching it again.
 */
export type WorkflowBatchCellPhase = 'watching' | 'settled' | 'stopped';

/**
 * Where a cell's most recent cancel request stands.
 *
 * - `'idle'` — no cancel was asked for.
 * - `'pending'` — a cancel request is in flight.
 * - `'done'` — the host answered with a terminal snapshot. Usually `canceled`,
 *   but a workflow that finished before the cancel landed reports its real
 *   status (`succeeded`, `failed`, `expired`).
 * - `'refused'` — not cancelled. The host answered with a NON-terminal snapshot
 *   (its answer when the estimate allowance is used up: the cancel was not sent),
 *   or this cell was not attempted because an earlier cancel in the same
 *   `cancelAll()` was refused. The workflow is still running. Call `cancelAll()`
 *   again after a few seconds.
 * - `'failed'` — the cancel request itself failed: it rejected, or the host
 *   answered with its failure placeholder (`workflowId: 'failed'`) rather than
 *   this workflow's snapshot. The workflow's state is unknown and it may still be
 *   running. Calling `cancelAll()` again retries it.
 */
export type WorkflowBatchCancelState = 'idle' | 'pending' | 'done' | 'refused' | 'failed';

/** One watched workflow. */
export interface WorkflowBatchCell {
  workflowId: string;
  /**
   * The latest snapshot the host returned FOR THIS WORKFLOW, or `null` before the
   * first one. A host failure placeholder (whose `workflowId` is `'failed'`) is
   * never stored here, because it is not this workflow's status.
   */
  snapshot: BlockWorkflowSnapshot | null;
  phase: WorkflowBatchCellPhase;
  /** Why the watch stopped, when it stopped on an error. `null` otherwise. */
  error: Error | null;
  cancel: WorkflowBatchCancelState;
}

/**
 * Counts over every cell, from each cell's latest snapshot.
 *
 * `succeeded + failed + canceled + expired + running === total`.
 */
export interface WorkflowBatchSummary {
  total: number;
  /** Cells whose latest snapshot is not terminal, including cells with no snapshot yet. */
  running: number;
  succeeded: number;
  failed: number;
  canceled: number;
  expired: number;
  /**
   * The part of `running` that nothing is polling (phase `'stopped'`). A batch
   * with `stopped > 0` will not settle on its own: call `rewatch()`.
   */
  stopped: number;
  /**
   * The sum of `cost.total` on the terminal snapshots that carry one: the
   * generation cost the host reported for each finished workflow (a cancelled
   * workflow reports its cost after the cancel). It is what the snapshots say,
   * not a read of the viewer's Buzz ledger. The app author's fee is charged
   * separately and is not included.
   */
  realisedCost: number;
  /** How many terminal cells contributed to `realisedCost`. */
  costedCells: number;
  /** `true` when every cell is terminal (`running === 0`). `true` for an empty list. */
  settled: boolean;
}

/**
 * What one {@link UseWorkflowBatch.cancelAll} call did. Each array holds workflow
 * ids, in list order.
 */
export interface WorkflowBatchCancelResult {
  /** The host answered `canceled`. */
  canceled: string[];
  /**
   * The workflow had already finished: either its latest snapshot was already
   * terminal (no request was sent), or the host answered the cancel with the
   * workflow's real terminal status because it finished first.
   */
  alreadySettled: string[];
  /** The host answered with a non-terminal snapshot: the cancel was not sent. */
  refused: string[];
  /**
   * Not attempted, because an earlier cancel in this call was refused. The
   * allowance is used up, so sending more would only be refused too.
   */
  notAttempted: string[];
  /** The cancel request failed. The workflow's state is unknown. */
  failed: string[];
  /** `true` when `refused`, `notAttempted` and `failed` are all empty. */
  complete: boolean;
}

/** Options for {@link useWorkflowBatch}. Passed to every cell's `watch()`. */
export type WorkflowBatchOptions = Pick<
  WatchWorkflowOptions,
  'intervalMs' | 'waitSeconds' | 'timeoutMs' | 'maxRetries'
>;

/** What {@link useWorkflowBatch} returns. */
export interface UseWorkflowBatch {
  /** One cell per id passed in, in the same order. */
  cells: readonly WorkflowBatchCell[];
  summary: WorkflowBatchSummary;
  /**
   * Cancel every cell that is not known to be finished. Resolves (never rejects)
   * with what happened to each one; see {@link WorkflowBatchCancelResult}.
   *
   * Calling it while a previous call is still running returns that call's
   * promise. Calling it again after a call that was not `complete` retries the
   * cells that are still not finished.
   */
  cancelAll: () => Promise<WorkflowBatchCancelResult>;
  /** Start watching every `'stopped'` cell again. */
  rewatch: () => void;
}

type CellState = Omit<WorkflowBatchCell, 'workflowId'>;

const FRESH: CellState = { snapshot: null, phase: 'watching', error: null, cancel: 'idle' };

function validateIds(ids: readonly string[]): void {
  if (ids.length > WORKFLOW_BATCH_MAX_CELLS) {
    throw new RangeError(
      `useWorkflowBatch: ${ids.length} workflow ids, but at most ${WORKFLOW_BATCH_MAX_CELLS} can be watched at once`,
    );
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('useWorkflowBatch: every workflow id must be a non-empty string');
    }
    if (NON_WORKFLOW_IDS.has(id)) {
      throw new TypeError(
        `useWorkflowBatch: '${id}' is not a workflow id. A submit that resolved with it created nothing to watch`,
      );
    }
    if (seen.has(id)) {
      throw new TypeError(`useWorkflowBatch: workflow id '${id}' appears more than once`);
    }
    seen.add(id);
  }
}

function summarise(cells: readonly WorkflowBatchCell[]): WorkflowBatchSummary {
  const summary: WorkflowBatchSummary = {
    total: cells.length,
    running: 0,
    succeeded: 0,
    failed: 0,
    canceled: 0,
    expired: 0,
    stopped: 0,
    realisedCost: 0,
    costedCells: 0,
    settled: true,
  };
  for (const cell of cells) {
    const status = cell.snapshot?.status;
    if (status === undefined || !TERMINAL.has(status)) {
      summary.running += 1;
      if (cell.phase === 'stopped') summary.stopped += 1;
      continue;
    }
    summary[status as 'succeeded' | 'failed' | 'canceled' | 'expired'] += 1;
    const total = cell.snapshot?.cost?.total;
    if (typeof total === 'number' && Number.isFinite(total)) {
      summary.realisedCost += total;
      summary.costedCells += 1;
    }
  }
  summary.settled = summary.running === 0;
  return summary;
}

/**
 * Watch a set of already-submitted workflows as one batch, with per-cell status,
 * a summary, and cancel-all. For grid apps that submit N workflows one by one
 * with `useBuzzWorkflow().submit()` (one submit per cell) and then
 * have to follow all N.
 *
 * 🔴 THE APP OWNS THE LIST, AND THE LIST IS THE BATCH. Pass the workflow ids as
 * an array: append each id as its `submit()` resolves, and persist the same
 * array (it is plain strings) to re-attach after a reload by passing it back.
 * There is no server-side batch id. The host knows nothing about the grouping,
 * so nothing here changes what the host allows: every cell is one ordinary
 * `watch()` and every cancel is one ordinary `cancel()`.
 *
 * What it guarantees, and the host limits behind each:
 *
 * - **One poll in flight per workflow.** Each cell is one `watch()` loop. When a
 *   loop is restarted (the list changes, `rewatch()`, a React StrictMode
 *   remount), the new loop waits for the old loop's in-flight poll to return
 *   first, so two polls for one workflow never overlap.
 * - **At most {@link WORKFLOW_BATCH_MAX_CELLS} workflows.** That is the poll
 *   allowance (1,200 per 60 s, per block instance and viewer) divided by one
 *   watch's 40 polls a minute. A longer list throws.
 * - **Cancel-all is paced and stops on refusal.** Cancels charge the estimate
 *   allowance (150 per 10 s per block instance, shared by every viewer of a page
 *   app). At most four are in flight. When the host answers one with a
 *   non-terminal snapshot (its answer when that allowance is used up), the rest
 *   of the call is not sent and comes back as `notAttempted`. Nothing is retried
 *   automatically. Call `cancelAll()` again after a few seconds.
 * - **A host failure placeholder is not a workflow outcome.** When the host
 *   fails a poll or a cancel it answers with `{ workflowId: 'failed', status:
 *   'failed' }`. `watch()` and `cancel()` resolve with that, but it says nothing
 *   about the workflow, which may still be running. This hook never counts it as
 *   a failed cell: a poll placeholder stops the cell (phase `'stopped'`, with
 *   `error` set), and a cancel placeholder is a `'failed'` cancel.
 * - **Unmounting stops every poll.** No state updates happen after unmount. A
 *   `cancelAll()` already running keeps sending, because the viewer asked for it.
 *
 * Throws (at render) when the list is longer than
 * {@link WORKFLOW_BATCH_MAX_CELLS}, has a duplicate, has an empty id, or has the
 * `'failed'` / `'whatif'` placeholder a refused `submit()` resolves with.
 *
 * Needs the same `ai:write:budgeted` scope as `submit()`. A viewer who submitted
 * already has it.
 *
 * @example
 * const { submit } = useBuzzWorkflow();
 * const [ids, setIds] = useState<string[]>(() => loadSavedIds());
 * const batch = useWorkflowBatch(ids);
 *
 * async function runCell(body: WorkflowBody, key: string) {
 *   const snap = await submit(body, { idempotencyKey: key });
 *   if (snap.workflowId !== 'failed') setIds((prev) => [...prev, snap.workflowId]);
 * }
 *
 * useEffect(() => saveIds(ids), [ids]);
 *
 * // batch.summary.running, batch.summary.realisedCost, batch.cells[i].snapshot …
 * const result = await batch.cancelAll();
 * if (!result.complete) showRetryCancel(result);
 */
export function useWorkflowBatch(
  workflowIds: readonly string[],
  options?: WorkflowBatchOptions,
): UseWorkflowBatch {
  useTransportConnection();
  validateIds(workflowIds);

  // A private `useBuzzWorkflow()` instance, so the app's own instance's
  // `result`/`status` are not overwritten by 16 cells' updates.
  const { watch, cancel } = useBuzzWorkflow();

  const [states, setStates] = useState<ReadonlyMap<string, CellState>>(() => new Map());
  // Mirror of `states` for async code, which must not read a stale closure.
  const statesRef = useRef(states);
  statesRef.current = states;

  const idsKey = workflowIds.join('\u0000');
  const idsRef = useRef(workflowIds);
  idsRef.current = workflowIds;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mountedRef = useRef(false);
  /** Per workflow: the running loop's controller and a promise that settles when it ends. */
  const loopsRef = useRef(new Map<string, { controller: AbortController; done: Promise<void> }>());
  const cancelAllRef = useRef<Promise<WorkflowBatchCancelResult> | null>(null);

  const patch = useCallback((workflowId: string, change: Partial<CellState>) => {
    if (!mountedRef.current) return;
    setStates((prev) => {
      const next = new Map(prev);
      next.set(workflowId, { ...(prev.get(workflowId) ?? FRESH), ...change });
      return next;
    });
  }, []);

  const startLoop = useCallback(
    (workflowId: string) => {
      const loops = loopsRef.current;
      const previous = loops.get(workflowId);
      previous?.controller.abort();
      const controller = new AbortController();
      // 🔴 CHAIN ON THE PREVIOUS LOOP. Aborting a `watch()` does not withdraw a
      // poll already in flight (the host can hold it up to 15 s); the loop only
      // sees the abort when that poll returns. Starting the new loop at once would
      // put two polls for one workflow in flight.
      const done = (previous?.done ?? Promise.resolve()).then(async () => {
        if (controller.signal.aborted) return;
        try {
          const final = await watch(workflowId, {
            ...optionsRef.current,
            signal: controller.signal,
            onUpdate: (snapshot) => {
              if (controller.signal.aborted || snapshot.workflowId !== workflowId) return;
              patch(workflowId, { snapshot });
            },
          });
          if (controller.signal.aborted) return;
          if (final.workflowId !== workflowId) {
            patch(workflowId, {
              phase: 'stopped',
              error: new Error(
                `useWorkflowBatch: the host answered a poll for ${workflowId} with a failure placeholder, not the workflow's status`,
              ),
            });
            return;
          }
          patch(workflowId, {
            snapshot: final,
            phase: TERMINAL.has(final.status) ? 'settled' : 'stopped',
            error: null,
          });
        } catch (err) {
          if (controller.signal.aborted) return;
          patch(workflowId, { phase: 'stopped', error: err instanceof Error ? err : new Error(String(err)) });
        }
      });
      loops.set(workflowId, { controller, done });
    },
    [watch, patch],
  );

  useEffect(() => {
    mountedRef.current = true;
    const loops = loopsRef.current;
    return () => {
      mountedRef.current = false;
      for (const loop of loops.values()) loop.controller.abort();
    };
  }, []);

  // Diff the list against the running loops: start new ids, stop removed ones.
  useEffect(() => {
    const loops = loopsRef.current;
    const wanted = new Set(idsRef.current);
    for (const [id, loop] of loops) {
      // Abort, but KEEP the entry: its `done` is what a re-added id's new loop
      // must wait on, because the aborted loop's poll may still be in flight.
      if (!wanted.has(id)) loop.controller.abort();
    }
    for (const id of idsRef.current) {
      const loop = loops.get(id);
      if (loop && !loop.controller.signal.aborted) continue;
      const state = statesRef.current.get(id);
      // A settled or stopped cell stays as it is until `rewatch()`.
      if (state && state.phase !== 'watching') continue;
      startLoop(id);
    }
    setStates((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of prev.keys()) {
        if (!wanted.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // `idsKey` stands for the list's contents; the list itself is read from the ref.
  }, [idsKey, startLoop]);

  const rewatch = useCallback(() => {
    for (const id of idsRef.current) {
      if (statesRef.current.get(id)?.phase !== 'stopped') continue;
      patch(id, { phase: 'watching', error: null });
      startLoop(id);
    }
  }, [patch, startLoop]);

  const cancelAll = useCallback((): Promise<WorkflowBatchCancelResult> => {
    if (cancelAllRef.current) return cancelAllRef.current;

    const run = async (): Promise<WorkflowBatchCancelResult> => {
      const ids = [...idsRef.current];
      const outcome = new Map<string, keyof Omit<WorkflowBatchCancelResult, 'complete'>>();
      const targets: string[] = [];
      for (const id of ids) {
        const status = statesRef.current.get(id)?.snapshot?.status;
        if (status !== undefined && TERMINAL.has(status)) outcome.set(id, 'alreadySettled');
        else targets.push(id);
      }

      let refusedSeen = false;
      let next = 0;
      const worker = async () => {
        for (let id = targets[next]; id !== undefined; id = targets[next]) {
          next += 1;
          if (refusedSeen) {
            outcome.set(id, 'notAttempted');
            patch(id, { cancel: 'refused' });
            continue;
          }
          patch(id, { cancel: 'pending' });
          let snapshot: BlockWorkflowSnapshot;
          try {
            snapshot = await cancel(id);
          } catch {
            outcome.set(id, 'failed');
            patch(id, { cancel: 'failed' });
            continue;
          }
          if (snapshot.workflowId !== id) {
            // The host's failure placeholder: the request failed, the workflow's
            // state is unknown.
            outcome.set(id, 'failed');
            patch(id, { cancel: 'failed' });
          } else if (TERMINAL.has(snapshot.status)) {
            outcome.set(id, snapshot.status === 'canceled' ? 'canceled' : 'alreadySettled');
            loopsRef.current.get(id)?.controller.abort();
            patch(id, { cancel: 'done', snapshot, phase: 'settled', error: null });
          } else {
            refusedSeen = true;
            outcome.set(id, 'refused');
            patch(id, { cancel: 'refused' });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CANCEL_CONCURRENCY, targets.length) }, () => worker()),
      );

      const result: WorkflowBatchCancelResult = {
        canceled: [],
        alreadySettled: [],
        refused: [],
        notAttempted: [],
        failed: [],
        complete: true,
      };
      for (const id of ids) {
        const bucket = outcome.get(id);
        if (bucket) result[bucket].push(id);
      }
      result.complete =
        result.refused.length === 0 && result.notAttempted.length === 0 && result.failed.length === 0;
      return result;
    };

    const promise = run().finally(() => {
      cancelAllRef.current = null;
    });
    cancelAllRef.current = promise;
    return promise;
  }, [cancel, patch]);

  const cells = useMemo<readonly WorkflowBatchCell[]>(
    () => workflowIds.map((workflowId) => ({ workflowId, ...(states.get(workflowId) ?? FRESH) })),
    // `idsKey` stands for the list's contents, so a new array with the same ids
    // does not rebuild the cells.
    [idsKey, states],
  );
  const summary = useMemo(() => summarise(cells), [cells]);

  return { cells, summary, cancelAll, rewatch };
}
