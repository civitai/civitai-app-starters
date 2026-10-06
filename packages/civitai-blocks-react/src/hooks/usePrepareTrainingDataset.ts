import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BlockPrepareTrainingDatasetHostError,
  BlockTrainingDatasetItem,
  BlockTrainingDatasetResult,
  BlockTrainingRejectionReason,
} from '@civitai/app-sdk/blocks';
import { BLOCK_SCOPES } from '@civitai/app-sdk/blocks';

import { withConsentRetry } from '../internal/withConsentRetry.js';
import { WORKFLOW_REQUEST_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { RequestTimeoutError, sendTypedRequest } from '../transport/transport.js';
import type { ConsentRetryOptions } from './consentRetryOptions.js';

/**
 * The consent-gated scope the training flow requires — `ai:write:budgeted`. The
 * server refuses a dataset request from a token without it (it is the spend
 * scope, and preparing is gated exactly like the run it prepares for). From
 * {@link BLOCK_SCOPES}, never a literal: a typo would make the automatic consent
 * prompt silently do nothing.
 */
const TRAINING_SCOPES = [BLOCK_SCOPES.AI_WRITE_BUDGETED] as const;

export type {
  BlockPrepareTrainingDatasetHostError,
  BlockTrainingDatasetItem,
  BlockTrainingDatasetResult,
  BlockTrainingRejectionReason,
};

/**
 * The host's CLOSED refusal codes for `PREPARE_TRAINING_DATASET`, as a runtime
 * list. Mirrors civitai/civitai's `PREPARE_TRAINING_DATASET_HOST_ERRORS`.
 *
 * 🔴 THE ERROR CHANNEL IS NOT AN ENUM: it also carries free-text server
 * messages, so "is this a code?" is a membership question at runtime — see
 * {@link isPrepareTrainingDatasetErrorCode}.
 */
export const PREPARE_TRAINING_DATASET_ERROR_CODES = [
  'review-mode',
  'block is not ready',
  'sign in to train',
  'invalid training dataset',
  'no block token',
] as const satisfies readonly BlockPrepareTrainingDatasetHostError[];

const CODE_SET: ReadonlySet<string> = new Set(PREPARE_TRAINING_DATASET_ERROR_CODES);

/** `true` when `error` is one of the host's closed refusal codes rather than a server message. */
export function isPrepareTrainingDatasetErrorCode(
  error: string,
): error is BlockPrepareTrainingDatasetHostError {
  return CODE_SET.has(error);
}

/**
 * A dataset-preparation failure.
 *
 * `.code` is the host's refusal code when the HOST refused, `undefined` for a
 * server message or a transport timeout. Check `.timedOut` before rendering
 * `.message` — a timeout's message is an SDK-internal string.
 *
 * Preparing charges nothing, so no failure here costs the viewer Buzz.
 */
export class PrepareTrainingDatasetError extends Error {
  /** The closed host refusal code, or `undefined` for a server/transport error. */
  readonly code?: BlockPrepareTrainingDatasetHostError;
  /**
   * No reply arrived within the bound. The server may still have prepared a
   * dataset; nothing was charged either way, and preparing again simply makes a
   * new handle.
   */
  readonly timedOut: boolean;
  /**
   * There is no session — the viewer is signed out (`sign in to train`), or their
   * session ended (a bare `UNAUTHORIZED`). Route into `useRequestSignIn()`.
   */
  readonly signInRequired: boolean;

  constructor(error: string, opts?: { timedOut?: boolean }) {
    super(error);
    this.name = 'PrepareTrainingDatasetError';
    this.timedOut = opts?.timedOut === true;
    if (isPrepareTrainingDatasetErrorCode(error)) this.code = error;
    this.signInRequired = error === 'sign in to train' || error === 'UNAUTHORIZED';
  }
}

/** What {@link usePrepareTrainingDataset} returns. */
export interface UsePrepareTrainingDataset {
  /**
   * Ask the host to prepare a training dataset from the viewer's OWN images.
   * Resolves with the opaque `datasetId`, the admitted `count` and the
   * `rejected` images. REJECTS with a {@link PrepareTrainingDatasetError}.
   *
   * A resolved result admitted AT LEAST ONE image (`count >= 1`) — when nothing
   * is admitted the server refuses instead, and this rejects with its message
   * (`none of the requested images can be used for training` / `… could be
   * prepared for training`, no `.code`). Read `rejected` for what was left out:
   * `pending-scan` and `import-unavailable` are retryable; the rest are not.
   * The per-image reasons are not available when everything was rejected.
   */
  prepareDataset: (
    items: BlockTrainingDatasetItem[],
    options?: ConsentRetryOptions,
  ) => Promise<BlockTrainingDatasetResult>;
  /** `true` while a request is in flight. */
  pending: boolean;
  /** The last request's failure, or `null`. Cleared at the start of the next call. */
  error: PrepareTrainingDatasetError | null;
}

/**
 * Step 1 of the App Blocks `kind: 'training'` flow: turn the viewer's own images
 * and your captions into a dataset handle for `WorkflowBodyTraining.datasetId`,
 * through the host-mediated `PREPARE_TRAINING_DATASET` → `TRAINING_DATASET_RESULT`
 * bridge.
 *
 * 🔴 AVAILABILITY: page apps only, behind the host flag `app-blocks-training-kind`
 * (ships off), with `ai:write:budgeted` declared in the manifest and granted by a
 * signed-in viewer. Refused from `dev:live` and from review sessions — build the
 * flow against the mock host. See `WorkflowBodyTraining` in `@civitai/app-sdk`.
 *
 * Only the viewer's OWN scanned, unflagged images within the page's maturity
 * ceiling are admitted; captions are moderated. Bounds: 1–50 items, captions up
 * to 1,000 characters (`BLOCK_TRAINING_DATASET_MAX_ITEMS`,
 * `BLOCK_TRAINING_CAPTION_MAX_CHARS`); the host refuses anything else with
 * `invalid training dataset` before calling the server.
 *
 * No dialog and no charge. When the token lacks `ai:write:budgeted`, the call
 * opens the host's consent prompt and retries once on a grant (opt out with
 * `{ autoRequestConsent: false }`).
 *
 * Sent under the 120s server-work bound, not the 30s protocol default: the server
 * imports up to 50 images into the orchestrator within its own 60s budget.
 *
 * @example
 * const { prepareDataset } = usePrepareTrainingDataset();
 * try {
 *   const dataset = await prepareDataset(
 *     picked.map((img) => ({ imageId: img.id, caption: img.caption })),
 *   );
 *   if (dataset.rejected.length > 0) showNotice(`${dataset.rejected.length} image(s) left out`);
 * } catch (e) {
 *   // Includes "none of the requested images can be used for training".
 *   if (e instanceof PrepareTrainingDatasetError) showError(e.message);
 * }
 */
export function usePrepareTrainingDataset(): UsePrepareTrainingDataset {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PrepareTrainingDatasetError | null>(null);

  // The consent wait can outlive the component; see `useCreatePostFromApp`.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** ONE round-trip + its result contract. Re-invoked verbatim on a consent retry. */
  const prepareOnce = useCallback(
    async (items: BlockTrainingDatasetItem[]): Promise<BlockTrainingDatasetResult> => {
      const reply = await sendTypedRequest(
        getTransport(),
        { type: 'PREPARE_TRAINING_DATASET', payload: { items } },
        'TRAINING_DATASET_RESULT',
        { timeoutMs: WORKFLOW_REQUEST_TIMEOUT_MS },
      ).catch((err: unknown): never => {
        // Stamped INSIDE the closure `withConsentRetry` re-invokes, so its rule 4
        // sees it: a 120s wait is not repeated behind a consent prompt.
        if (err instanceof RequestTimeoutError) {
          throw new PrepareTrainingDatasetError(err.message, { timedOut: true });
        }
        throw err instanceof Error ? err : new Error(String(err));
      });
      if (reply.error || !reply.result) {
        // `||`, not `??`: the validator shape-checks `error`, so `''` is a valid
        // reply that must not become an Error with an empty message. The
        // fallback is deliberately NOT a host code — `invalid training dataset`
        // would claim "nothing reached the server", which an empty error does
        // not tell us.
        throw new PrepareTrainingDatasetError(reply.error || 'training dataset could not be prepared');
      }
      return reply.result;
    },
    [],
  );

  const prepareDataset = useCallback(
    async (
      items: BlockTrainingDatasetItem[],
      options?: ConsentRetryOptions,
    ): Promise<BlockTrainingDatasetResult> => {
      if (mountedRef.current) {
        setPending(true);
        setError(null);
      }
      try {
        return await withConsentRetry(
          getTransport(),
          TRAINING_SCOPES,
          () => prepareOnce(items),
          options,
          () => mountedRef.current,
        );
      } catch (err: unknown) {
        const wrapped =
          err instanceof PrepareTrainingDatasetError
            ? err
            : new PrepareTrainingDatasetError(err instanceof Error ? err.message : String(err));
        if (mountedRef.current) setError(wrapped);
        throw wrapped;
      } finally {
        if (mountedRef.current) setPending(false);
      }
    },
    [prepareOnce],
  );

  return { prepareDataset, pending, error };
}
