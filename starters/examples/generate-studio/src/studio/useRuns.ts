import { useCallback, useEffect, useRef, useState } from 'react';

import { useBuzzWorkflow } from '@civitai/blocks-react';
import type { BlockWorkflowSnapshot, WorkflowBody } from '@civitai/app-sdk/blocks';

import { logServerReason, submitRejection, WATCH_FAILED_MESSAGE } from './copy.js';
import { resolvedFailurePatch } from './resolvedFailure.js';

export type RunStatus = 'submitting' | 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'expired' | 'refused';

export interface Run {
  localId: string;
  workflowId: string | null;
  status: RunStatus;
  images: string[];
  cost: number | null;
  /** App-owned copy — see `copy.ts`. */
  message?: string;
  autoClaim?: number;
}

export const LIVE: ReadonlySet<RunStatus> = new Set(['submitting', 'queued', 'running']);

/**
 * The run queue: submit → watch → (cancel), several runs at once.
 *
 * `watch()` owns the polling loop (sequential, one request in flight per
 * workflow) and resolves on the terminal snapshot; `onUpdate` streams the
 * intermediate ones. This replaces the hand-written `poll()` + backoff loop the
 * `buzz-workflow` example still shows.
 *
 * 🔴 ABORTING A WATCH IS NOT A CANCEL. The signal stops this block watching; the
 * orchestrator keeps running and Buzz stays spent. `cancelRun` calls `cancel()`,
 * a real server-side stop scoped by the host to workflows the viewer owns.
 */
export function useRuns(onSettled: () => void) {
  const { submit, watch, cancel } = useBuzzWorkflow();
  const [runs, setRuns] = useState<Run[]>([]);
  const watchers = useRef(new Map<string, AbortController>());

  // Unmount: stop WATCHING everything (the workflows themselves carry on).
  useEffect(() => {
    const map = watchers.current;
    return () => map.forEach((ac) => ac.abort());
  }, []);

  const patch = useCallback((localId: string, next: Partial<Run>) => {
    setRuns((rs) => rs.map((r) => (r.localId === localId ? { ...r, ...next } : r)));
  }, []);

  const follow = useCallback(
    (localId: string, workflowId: string, message?: string) => {
      const ac = new AbortController();
      watchers.current.set(localId, ac);
      watch(workflowId, { signal: ac.signal, onUpdate: (snap) => patch(localId, fromSnapshot(snap)) })
        .then((snap) => {
          if (ac.signal.aborted) return;
          if (snap.status === 'failed') logServerReason('watch', snap);
          patch(localId, {
            ...fromSnapshot(snap),
            ...(snap.status === 'failed' ? { message: message ?? WATCH_FAILED_MESSAGE } : {}),
          });
        })
        .catch((err: unknown) => {
          // `watch` rejects only after `maxRetries` consecutive transport failures.
          logServerReason('watch', null, err);
          patch(localId, { message: 'Lost track of this run. Your history has its result.' });
        })
        .finally(() => {
          watchers.current.delete(localId);
          onSettled();
        });
    },
    [watch, patch, onSettled],
  );

  /**
   * Submit `body`. Resolves with the snapshot when `submit` RESOLVED as `failed`
   * (a cap refusal, or a run that came back failed — see resolvedFailure.ts),
   * otherwise `null`.
   */
  const start = useCallback(
    async (body: WorkflowBody): Promise<BlockWorkflowSnapshot | null> => {
      const localId = crypto.randomUUID();
      setRuns((rs) => [{ localId, workflowId: null, status: 'submitting', images: [], cost: null }, ...rs]);
      try {
        // No idempotencyKey: each click is a NEW logical submit, and the hook mints
        // a fresh valid key. The SDK's one automatic consent retry reuses it.
        const snap = await submit(body);
        if (snap.status === 'failed') {
          // RESOLVED: a cap refusal ("Not started") or a run that came back failed
          // and may have spent ("Failed", id recorded) — resolvedFailure.ts. Never
          // "out of Buzz", which REJECTS (the catch below).
          logServerReason('submit', snap);
          patch(localId, { ...resolvedFailurePatch(snap), cost: snap.cost?.total ?? null });
          onSettled();
          return snap;
        }
        patch(localId, { workflowId: snap.workflowId, ...fromSnapshot(snap) });
        follow(localId, snap.workflowId);
        return null;
      } catch (err) {
        logServerReason('submit', null, err);
        const outcome = submitRejection(err);
        if (outcome.watchId) {
          // A workflow probably exists: report its REAL fate instead of guessing.
          patch(localId, { workflowId: outcome.watchId, status: 'running', message: outcome.message });
          follow(localId, outcome.watchId, outcome.message);
        } else {
          patch(localId, { status: 'failed', message: outcome.message });
          onSettled(); // re-read the wallet: in production a short wallet lands here
        }
        return null;
      }
    },
    [submit, patch, follow, onSettled],
  );

  const cancelRun = useCallback(
    (localId: string) => {
      const run = runs.find((r) => r.localId === localId);
      if (!run?.workflowId) return;
      cancel(run.workflowId)
        .then((snap) => patch(localId, fromSnapshot(snap)))
        .catch((err: unknown) => {
          // Already finished, or transient. The watcher still reports the real end.
          logServerReason('cancel', null, err);
        });
    },
    [runs, cancel, patch],
  );

  const dismiss = useCallback((localId: string) => {
    watchers.current.get(localId)?.abort(); // stop watching; does NOT cancel
    setRuns((rs) => rs.filter((r) => r.localId !== localId));
  }, []);

  return { runs, start, cancelRun, dismiss };
}

function fromSnapshot(snap: BlockWorkflowSnapshot): Partial<Run> {
  return {
    status: snap.status === 'pending' ? 'queued' : snap.status === 'processing' ? 'running' : snap.status,
    ...(snap.imageUrls ? { images: snap.imageUrls } : {}),
    ...(typeof snap.cost?.total === 'number' ? { cost: snap.cost.total } : {}),
    ...(snap.autoClaim ? { autoClaim: snap.autoClaim.amount } : {}),
  };
}
