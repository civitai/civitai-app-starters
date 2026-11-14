import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BlockPersistGenerationSourceRequest,
  BlockPersistedGenerationSource,
} from '@civitai/app-sdk/blocks';

import { WORKFLOW_REQUEST_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';
import { useTransportConnection } from './useTransportConnection.js';

/** What {@link usePersistGenerationSource} returns. */
export interface UsePersistGenerationSource {
  /**
   * Save ONE output of one of this app's OWN workflows as a PRIVATE, scanned
   * generation source, and resolve with it: `{ url, width, height, imageId,
   * ready }`. `url` / `width` / `height` go straight into a `sourceImages`
   * entry of the next generation.
   *
   * `ready: false` means the scan had not finished within the host's wait
   * (about 30 s). A generation using the source is then refused with the
   * `source-scan-pending` error code; retry it later.
   *
   * Rejects with the host's error string (a refusal, a not-owned workflow, an
   * output index that does not exist, a server failure; an iframe/slot host
   * refuses this message outright), with a generic message when the host's
   * reply is malformed, or with a `RequestTimeoutError` if the host never
   * answers.
   */
  persist: (args: BlockPersistGenerationSourceRequest) => Promise<BlockPersistedGenerationSource>;
  /** `true` while at least one `persist()` is in flight. */
  isPending: boolean;
  /** The last `persist()` failure, or `null`. Cleared when the next `persist()` starts. */
  error: Error | null;
}

/** Fallback message for a host `error: ''`. */
const PERSIST_FAILED = 'failed to persist the generation source';

/**
 * Turn one of the calling app's OWN finished generation outputs into a
 * PRIVATE, scanned generation source, through the host-mediated
 * `PERSIST_GENERATION_SOURCE` → `GENERATION_SOURCE_PERSISTED` bridge.
 *
 * Like `usePublishGenerationOutputs()`, the block names the output by
 * `workflowId` and `imageIndex` (an index into the workflow's `images` as seen
 * via `useAppWorkflows()`), never by url: the host resolves it server-side from
 * the ownership-verified workflow. Unlike publishing, the image is private to
 * the viewer, is NOT on the app's shared grid, and there is NO confirm dialog.
 *
 * The host fetches the output, stores it and waits up to about 30 s for the scan
 * before it replies, all under one server deadline, so it can answer after ~32 s
 * plus network. The request therefore carries {@link WORKFLOW_REQUEST_TIMEOUT_MS}
 * (120 s) rather than the 30 s default.
 *
 * Idempotent per (viewer, app, `workflowId`, `imageIndex`): calling again returns
 * the same image with its current `ready`, which is how to wait for a pending
 * scan. Outputs over 2048 px are downscaled; outputs under 64 px are refused.
 *
 * Full-page app hosts only: the iframe/slot host, review mode, a block that is
 * not ready yet and App Assistant dev-tunnel previews reply with an error. `dev:live`
 * refuses it too (it needs the viewer's signed-in session); test it against the
 * mock host — `createMockHost` or `Harness` from `@civitai/blocks-react/testing`,
 * with the `persistedGenerationSource` / `persistGenerationSourceError` options.
 *
 * @example
 * const { persist, isPending } = usePersistGenerationSource();
 * const src = await persist({ workflowId: w.workflowId, imageIndex: 0 });
 * // src.ready === false → the next submit may fail with `source-scan-pending`; retry later.
 * await submit({ ...body, sourceImages: [{ url: src.url, width: src.width, height: src.height }] });
 */
export function usePersistGenerationSource(): UsePersistGenerationSource {
  useTransportConnection();
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  // The request can outlive the component (up to 120 s), so state is only touched while
  // mounted. The promise still settles either way: the caller's `await` is not
  // the component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const persist = useCallback(
    async (args: BlockPersistGenerationSourceRequest): Promise<BlockPersistedGenerationSource> => {
      if (mountedRef.current) {
        setInFlight((n) => n + 1);
        setError(null);
      }
      try {
        const reply = await sendTypedRequest(
          getTransport(),
          {
            type: 'PERSIST_GENERATION_SOURCE',
            payload: { workflowId: args.workflowId, imageIndex: args.imageIndex },
          },
          'GENERATION_SOURCE_PERSISTED',
          { timeoutMs: WORKFLOW_REQUEST_TIMEOUT_MS },
        );
        // PRESENCE, not truthiness, and `||` for the message: a host `error: ''`
        // must still reject, with readable copy. A malformed `result` never gets
        // here — the transport answers it as an `error` (see
        // `isValidGenerationSourcePersistedResult`).
        if (reply.error !== undefined || !reply.result) {
          throw new Error(reply.error || PERSIST_FAILED);
        }
        const { url, width, height, imageId, ready } = reply.result;
        return { url, width, height, imageId, ready };
      } catch (err: unknown) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current) setError(wrapped);
        throw wrapped;
      } finally {
        if (mountedRef.current) setInFlight((n) => n - 1);
      }
    },
    [],
  );

  return { persist, isPending: inFlight > 0, error };
}
