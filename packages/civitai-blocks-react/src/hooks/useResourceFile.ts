import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BlockResourceFile,
  BlockResourceFileEntry,
  BlockResourceFileEntryFormat,
  BlockResourceFileErrorCode,
  BlockResourceFileMeta,
} from '@civitai/app-sdk/blocks';

import { RESOURCE_FILE_REQUEST_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';
import { useRequestSequencer } from './useRequestSequencer.js';
import { useTransportConnection } from './useTransportConnection.js';

export type {
  BlockResourceFile,
  BlockResourceFileEntry,
  BlockResourceFileEntryFormat,
  BlockResourceFileErrorCode,
  BlockResourceFileMeta,
};

/**
 * A resource-file read failure. The host returns one code from a CLOSED set, and
 * this error carries it on `.code` so a block can branch on the exact reason:
 * `busy` and `rate-limited` are retryable; `not-found`, `forbidden` and
 * `too-large` are terminal. `parse-failed` is a corrupt or non-JSON file, but
 * also the host's catch-all for a network error, a failed fetch, its 110 s
 * deadline or a transient storage failure, so one retry is worth it.
 * `unauthorized` (signed out) does not clear by itself: the hook does not
 * refetch when the viewer changes, so after the viewer signs in
 * (`useRequestSignIn()`) without the block reloading, call `refetch()`.
 * `.message` equals the code.
 */
export class ResourceFileError extends Error {
  readonly code: BlockResourceFileErrorCode;
  constructor(code: BlockResourceFileErrorCode) {
    super(code);
    this.name = 'ResourceFileError';
    this.code = code;
  }
}

/**
 * What {@link useResourceFile} returns.
 */
export interface UseResourceFile {
  /**
   * The parsed file for the CURRENT `modelVersionId` / `fileId`, or `null` until
   * it loads. Reset to `null` the moment either id changes, so a file is never
   * shown for an id it does not belong to. A `refetch()` of the same ids keeps it
   * while reloading.
   */
  file: BlockResourceFile | null;
  /** `true` while a fetch (initial or `refetch`) is in flight. */
  loading: boolean;
  /**
   * The last fetch's failure as a {@link ResourceFileError} (`.code` is the
   * reason), or a plain `Error` (a `RequestTimeoutError`) when the host never
   * answered. Cleared at the start of the next fetch, and when either id changes.
   */
  error: Error | null;
  /** Re-request the file. */
  refetch: () => void;
}

/**
 * Read a resource file's parsed JSON (for a workflow: its graphs) by model-version
 * id, through the host-mediated `GET_RESOURCE_FILE` → `RESOURCE_FILE_RESULT`
 * bridge. TOKEN-INDEPENDENT (no block scope): the host resolves, fetches, unzips
 * and parses the file in the viewer's own page session, enforcing the real
 * download gates, and returns only the parsed JSON. The iframe never sees the
 * session, the signed URL or the raw bytes.
 *
 * Pass `fileId` to pin one file of a multi-file version; without it the host
 * picks one. Only free, public versions are served: an unpublished draft or an
 * early-access / paid version answers `not-found`, even for a viewer who bought
 * it. What the owner can read is in the README's "Only free, public versions
 * are served". Full-page app hosts only — the model-page slot does not answer
 * it, and `dev:live` replies `parse-failed`; use `dev:mock` to develop against it.
 *
 * Fetches on mount and whenever `modelVersionId` or `fileId` changes; a change
 * clears `file` and `error` first. A non-positive or non-integer
 * `modelVersionId` (or `fileId`, when given) fetches nothing. The request waits
 * up to 120 s (`RESOURCE_FILE_REQUEST_TIMEOUT_MS`), since the host downloads and
 * unzips the file; a host that never answers surfaces as a `RequestTimeoutError`
 * after that. Only the LATEST request may write state: a superseded or
 * post-unmount reply is dropped (#392).
 *
 * @example
 * const { file, loading, error, refetch } = useResourceFile(modelVersionId);
 * // Retry a retryable code from an effect, after a delay — never during render.
 * const retryable =
 *   error instanceof ResourceFileError && (error.code === 'busy' || error.code === 'rate-limited');
 * useEffect(() => {
 *   if (!retryable) return;
 *   const t = setTimeout(refetch, 2_000);
 *   return () => clearTimeout(t);
 * }, [retryable, refetch]);
 * const graphs = file?.entries.filter((e) => e.format !== 'unknown') ?? [];
 */
export function useResourceFile(modelVersionId: number, fileId?: number): UseResourceFile {
  useTransportConnection();
  const [file, setFile] = useState<BlockResourceFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const seq = useRequestSequencer();

  // The ids the current `file` / `error` belong to. A fetch for different ids
  // clears both first, so `{ file: A, error: B }` can never be returned.
  const key = `${modelVersionId}|${fileId ?? ''}`;
  const keyRef = useRef<string | null>(null);

  const isPositiveInt = (n: number): boolean => Number.isInteger(n) && n > 0;
  const valid = isPositiveInt(modelVersionId) && (fileId === undefined || isPositiveInt(fileId));

  const refetch = useCallback(() => {
    // `begin()` runs BEFORE the validity gate, as in `useWildcardPack`: moving to
    // an invalid id must also supersede an in-flight request for the old one.
    const token = seq.begin();
    if (keyRef.current !== key) {
      keyRef.current = key;
      setFile(null);
      setError(null);
    }
    if (!valid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    sendTypedRequest(
      getTransport(),
      {
        type: 'GET_RESOURCE_FILE',
        payload: fileId === undefined ? { modelVersionId } : { modelVersionId, fileId },
      },
      'RESOURCE_FILE_RESULT',
      { timeoutMs: RESOURCE_FILE_REQUEST_TIMEOUT_MS },
    )
      .then((result) => {
        if (!seq.isCurrent(token)) return;
        if (result.error || !result.file) {
          // `??`, as in `useWildcardPack`: `isValidResourceFileResult` admits only
          // the closed code set, so `error: ''` never reaches here. The fallback
          // covers only a reply with neither field, which the validator drops too.
          setError(new ResourceFileError(result.error ?? 'parse-failed'));
          setLoading(false);
          return;
        }
        setFile(result.file);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!seq.isCurrent(token)) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [valid, key, modelVersionId, fileId, seq]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { file, loading, error, refetch };
}
