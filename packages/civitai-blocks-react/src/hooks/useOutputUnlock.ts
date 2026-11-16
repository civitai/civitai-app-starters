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
   * Rejects only when the host could not route the request at all.
   */
  unlockOutput: (workflowId: string, position: number) => Promise<BlockOutputUnlockResult>;
}

/**
 * Unlock ONE restricted output in place, through a dialog the HOST draws.
 *
 * Offer it on an output whose entry is `{ restricted: true }`. The host reads the
 * live workflow and decides what to offer; your app supplies only the position:
 * - `reason: 'pool'` (the paying Buzz pool does not cover mature content): the
 *   viewer can unlock it with yellow Buzz at the price the host shows (no author
 *   share is added: your app was paid on the original generation, if at all; the
 *   spend counts toward the viewer's daily limit for your app). On `'unlocked'`,
 *   `result.snapshot.outputs[position]` carries the url.
 * - `'ceiling'` / `'unrated'`: never charged. The host links the viewer to
 *   civitai.red when that site could show it (`'linked-out'`), or explains why not
 *   (`'unavailable'`).
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
