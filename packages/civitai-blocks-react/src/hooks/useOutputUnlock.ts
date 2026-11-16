import { useCallback } from 'react';
import type { BlockOutputUnlockResult } from '@civitai/app-sdk/blocks';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';
import { useTransportConnection } from './useTransportConnection.js';

/** What {@link useOutputUnlock} returns. */
export interface UseOutputUnlock {
  /**
   * Ask the host to unlock the output at `position` (its index in
   * `snapshot.outputs`) of a workflow your app ran. Resolves when the viewer is done
   * with the host's dialog; see {@link BlockOutputUnlockResult} for each outcome.
   * Rejects when the host answers with an `error` (it could not route the request),
   * and when no reply arrives within the human-interaction timeout (10 minutes) —
   * which is also what happens on an older host with no unlock handler, since it
   * never replies.
   */
  unlockOutput: (workflowId: string, position: number) => Promise<BlockOutputUnlockResult>;
}

/**
 * Unlock ONE restricted output in place, through a dialog the HOST draws.
 *
 * Offer it on an output whose entry is `{ restricted: true }`. The host reads the
 * live workflow and decides what to offer; your app supplies only the position:
 * - `reason: 'pool'` (the paying Buzz pool does not cover mature content): the
 *   viewer can unlock it with yellow Buzz at the price the host shows. It adds no
 *   author share and counts against no spend limit (the original generation already
 *   did); `'refused'` means the viewer's yellow Buzz is short. On `'unlocked'`,
 *   `result.snapshot.outputs[position]` carries the url.
 * - `'ceiling'` / `'unrated'`: never charged. The host links the viewer to your app
 *   on civitai.red, at the same page, when that site could show it (`'linked-out'`),
 *   or explains why not (`'unavailable'`).
 *
 * 🔴 HUMAN-GATED: the reply waits for the viewer, so this uses
 * {@link HUMAN_INTERACTION_TIMEOUT_MS}, not the 30s default.
 *
 * @example
 * const { unlockOutput } = useOutputUnlock();
 * const result = await unlockOutput(snapshot.workflowId, 1);
 * if (result.outcome === 'unlocked') setSnapshot(result.snapshot!);
 */
export function useOutputUnlock(): UseOutputUnlock {
  useTransportConnection();
  const unlockOutput = useCallback(async (workflowId: string, position: number) => {
    const payload = await sendTypedRequest(
      getTransport(),
      { type: 'REQUEST_OUTPUT_UNLOCK', payload: { workflowId, position } },
      'OUTPUT_UNLOCK_RESULT',
      { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
    );
    if (typeof payload.error === 'string' || !payload.result) {
      throw new Error(payload.error ?? 'output unlock failed');
    }
    return payload.result;
  }, []);
  return { unlockOutput };
}
