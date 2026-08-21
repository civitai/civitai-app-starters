import { useCallback } from 'react';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../internal/requestTimeouts.js';
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
   * 🔴 CONSENT-GATED, SO IT WAITS ON A PERSON. Host-chrome shows a confirm
   * before publishing and replies only on an explicit click or dismiss, so this
   * call passes {@link HUMAN_INTERACTION_TIMEOUT_MS} (10 min) instead of
   * inheriting the ~30s default. It does NOT hang: the host resolves the instant
   * the viewer acts, and the 10-minute ceiling still bounds an abandoned dialog.
   *
   * Rejects with the host's free-text error on failure (anon viewer / missing
   * scope / not-owned workflow / rate-limit / upload or scan failure), or at the
   * consent-length timeout if the viewer never answers the confirm at all.
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
 * consent confirm before anything is published, and because that confirm waits on
 * a human the request carries {@link HUMAN_INTERACTION_TIMEOUT_MS}, not the
 * default protocol timeout.
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
        // 🔴 civitai/civitai#4158 — WITHOUT THIS THE VIEWER PAYS FOR NOTHING.
        // The host opens a consent confirm and answers only when the viewer
        // clicks; at the ~30s default this rejected while the dialog was still
        // on screen. The generation was already billed and a dead publish
        // bridge has no refund path, so the charge stood and the outputs were
        // lost. Every human-gated request opts out the same way — the ledger is
        // `HUMAN_GATED_REQUEST_TYPES` in `internal/requestTimeouts.ts`.
        { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
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
