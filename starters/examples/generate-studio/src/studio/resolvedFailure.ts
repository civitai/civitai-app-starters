/**
 * What a RESOLVED `status: 'failed'` submit means for one run card. Free of
 * React and runtime imports so the mapping can be exercised on its own.
 *
 * - The `'failed'` placeholder id: the host refused before anything ran (a
 *   budget, a daily or per-app cap, a velocity limit, a missing quote). Nothing
 *   was charged, and there is no workflow to record → `refused` ("Not started").
 * - A REAL id: a run was created and came back failed, and Buzz may already have
 *   been spent → `failed`, with the id recorded so it can be found in history.
 *
 * (The third resolved reply — a TRAINING run the server could not confirm —
 * cannot reach this app: it submits no training kind, and on the host bridge
 * that reply is indistinguishable from the placeholder anyway. See
 * `useBuzzWorkflow`'s `submit` docs for the complete list.)
 */
export interface ResolvedFailurePatch {
  status: 'refused' | 'failed';
  workflowId: string | null;
  message: string;
}

export function resolvedFailurePatch(snap: { workflowId: string }): ResolvedFailurePatch {
  if (snap.workflowId === 'failed') {
    return { status: 'refused', workflowId: null, message: 'Not started — nothing was charged.' };
  }
  return {
    status: 'failed',
    workflowId: snap.workflowId,
    message: 'This run failed and may have been charged. Check your history before trying again.',
  };
}
