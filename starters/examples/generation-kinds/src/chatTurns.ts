/**
 * The chat transcript's turns, and what a RESOLVED `status: 'failed'` submit
 * does to them. Free of React and runtime imports so the rules can be exercised
 * on their own.
 *
 * - The `'failed'` placeholder id: the host refused before anything ran (a cap,
 *   a limit, a missing quote) and nothing was charged. Keep the draft in the box
 *   so the viewer can send it again; add no turn.
 * - A REAL id: a run was created and came back failed, and Buzz may already have
 *   been spent. Keep the message as a turn MARKED FAILED and clear the draft —
 *   leaving it primed would invite a second, separately charged send of the same
 *   text. A failed turn is never sent back to the model as context.
 *
 * (The third resolved reply — a TRAINING run the server could not confirm —
 * cannot come from a chat submit, and on the host bridge it is indistinguishable
 * from the placeholder anyway. See `useBuzzWorkflow`'s `submit` docs.)
 */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** Set on a user turn whose submit resolved `failed` with a real workflow id. */
  failed?: true;
}

export type ResolvedChatFailure =
  | { kind: 'not-started' }
  | { kind: 'ran-and-failed'; turn: Turn };

export const RAN_AND_FAILED_NOTE =
  'That message ran but failed, and may have been charged. Check your history before sending it again.';

export function resolvedChatFailure(snap: { workflowId: string }, text: string): ResolvedChatFailure {
  if (snap.workflowId === 'failed') return { kind: 'not-started' };
  return { kind: 'ran-and-failed', turn: { role: 'user', content: text, failed: true } };
}

/** The turns the model sees: a failed turn got no reply, so it is not context. */
export function turnsForModel(history: Turn[]): Turn[] {
  return history.filter((t) => !t.failed);
}
