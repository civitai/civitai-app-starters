import { useCallback } from 'react';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * What {@link usePublishGenerationOutputs} returns.
 */
export interface UsePublishGenerationOutputs {
  /**
   * Ask the host to PUBLISH selected outputs of ONE of this app's OWN workflows
   * (from its generator subqueue) as bare, REAL-SCANNED public `Image` rows, and
   * resolve with the created image ids (order matches the resolved outputs).
   *
   * The block sends the `workflowId` + optional `imageIndexes` (indexes into the
   * workflow's `images` as seen via `useAppWorkflows()`) — NEVER urls. The host
   * resolves the orchestrator urls server-side from the ownership-verified
   * workflow, so the iframe can't inject an arbitrary blob. FAIL-CLOSED
   * server-side: the host re-derives (viewer, app, workflowId) ownership before
   * reading the workflow, re-uploads each selected output to civitai storage, and
   * runs the FULL image-scan pipeline (no skip) — the returned ids are bare
   * (post-less), scanned `Image` rows with no Post / gallery attach / rewards /
   * notifications. Host-chrome shows a consent confirm before publishing. Omit
   * `imageIndexes` to publish all available outputs; `title` is an optional
   * advisory label the host MAY ignore.
   *
   * Rejects with the host's free-text error on failure (anon viewer / missing
   * scope / not-owned workflow / rate-limit / upload or scan failure) or the
   * transport timeout — the hook never hangs.
   */
  publish: (args: { workflowId: string; imageIndexes?: number[]; title?: string }) => Promise<number[]>;
}

/**
 * Publish selected outputs of one of the calling app's OWN generations into bare,
 * real-scanned public `Image` rows via the host-mediated
 * `PUBLISH_GENERATION_OUTPUTS` → `PUBLISH_RESULT` bridge.
 *
 * Token-bound + fail-closed: the host self-binds the account off the block token,
 * re-derives (viewer, app, workflowId) ownership before reading the workflow, and
 * re-uploads + FULL-scans each selected output server-side (no url ever crosses
 * from the iframe). The result is a set of bare (post-less) scanned `Image` row
 * ids — no Post, no gallery attach, no rewards/notifications. Host-chrome shows a
 * consent confirm before anything is published.
 *
 * @example
 * const { publish } = usePublishGenerationOutputs();
 * const imageIds = await publish({ workflowId: w.workflowId, imageIndexes: [0, 2] });
 * // …store imageIds via useSharedStorage() so the grid can read them back gated.
 */
export function usePublishGenerationOutputs(): UsePublishGenerationOutputs {
  const publish = useCallback(
    async (args: { workflowId: string; imageIndexes?: number[]; title?: string }): Promise<number[]> => {
      const reply = await sendTypedRequest(
        getTransport(),
        {
          type: 'PUBLISH_GENERATION_OUTPUTS',
          payload: {
            workflowId: args.workflowId,
            ...(args.imageIndexes !== undefined ? { imageIndexes: args.imageIndexes } : {}),
            ...(args.title !== undefined ? { title: args.title } : {}),
          },
        },
        'PUBLISH_RESULT',
      );
      if (reply.error || !reply.result) {
        throw new Error(reply.error ?? 'failed to publish generation outputs');
      }
      return reply.result.imageIds;
    },
    [],
  );

  return { publish };
}
