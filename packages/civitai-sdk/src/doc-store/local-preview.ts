import type { ViewerInfo } from '../core/handshake.js';
import { StorageError, type DocumentStorage, type StorageCollection } from './index.js';

/**
 * The document store for a DEV-TUNNEL PREVIEW: the host marked the frame
 * `storageMode: 'local-preview'` (a preview has no server-side storage namespace,
 * by design), so `app.storage.collection(name)` is served by an in-memory store
 * in this tab instead of `/api/v1/blocks/storage/…`.
 *
 * That store is `createFakeStorage` — the real client over a seam that enforces
 * the server's rules — loaded with a dynamic `import()`, so it is a separate
 * chunk that an app outside a preview never downloads. It never receives the
 * site HTTP client, so no request can reach a real route by construction.
 *
 * The collections come from the app's LOCAL manifest, the one being previewed,
 * never from the server. With none available, every call fails with a local
 * error instead of falling through to the real routes or to a permissive store.
 */

/**
 * Where `@civitai/app-sdk/vite` puts the local manifest's `scopes` and `storage`
 * in a DEV SERVER page (never in a build). Spelled again, on purpose, in
 * `packages/civitai-app-sdk/src/vite/index.ts`; the two copies are pinned equal by
 * `tests/guards/local-preview-manifest-global.test.mjs`.
 */
export const LOCAL_PREVIEW_MANIFEST_GLOBAL = '__CIVITAI_LOCAL_PREVIEW_MANIFEST__';

/** What a local preview reads from the manifest: the scopes it declares and its `storage` block. */
export interface LocalPreviewManifest {
  scopes?: readonly string[];
  storage?: unknown;
}

/** The manifest the dev server injected, if any. */
export function readInjectedManifest(): LocalPreviewManifest | undefined {
  const value = (globalThis as Record<string, unknown>)[LOCAL_PREVIEW_MANIFEST_GLOBAL];
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as LocalPreviewManifest)
    : undefined;
}

const NO_MANIFEST =
  "local preview storage: the host marked this frame `storageMode: 'local-preview'` (a dev-tunnel preview, " +
  'which has no server-side storage), and no block.manifest.json reached @civitai/sdk to say which ' +
  'collections exist. Add `blockManifestPlugin()` from `@civitai/app-sdk/vite` to vite.config and run the ' +
  'Vite dev server. Nothing was sent to the server.';

/**
 * The status of both local errors. A missing or unservable manifest is a SETUP
 * mistake that no wait fixes, so it must not be a status `isTransient`
 * (`src/http/retry.ts`) reads as retryable — that is every 5xx and 429. 404 is
 * the status the server gives the nearest case it has, `collection_not_declared`:
 * with no usable manifest, no collection is declared. `get` still rejects (it
 * reads only the code `not_found` as "no document"), and the `code` tells the
 * two apart.
 */
export const LOCAL_PREVIEW_ERROR_STATUS = 404;

/**
 * Builds the preview's document store. Never throws: a missing or unusable
 * manifest yields a store whose every call rejects, so one bad declaration
 * cannot stop the rest of the app from starting.
 */
export async function createLocalPreviewStorage(
  manifest: LocalPreviewManifest | undefined,
  viewer: ViewerInfo | null,
): Promise<DocumentStorage> {
  if (manifest === undefined) return refusingStorage('local_preview_no_manifest', NO_MANIFEST);
  const { createFakeStorage } = await import('./fake.js');
  try {
    return createFakeStorage({
      manifest: { scopes: manifest.scopes, storage: manifest.storage },
      // Latched at init, like the mode: a sign-in remounts the frame.
      viewer: viewer === null ? null : { username: viewer.username ?? `user-${viewer.id}` },
    }).storage;
  } catch (error) {
    return refusingStorage(
      'local_preview_invalid_manifest',
      `local preview storage: block.manifest.json declares storage the local preview store cannot serve — ` +
        `${(error as Error).message}. Nothing was sent to the server.`,
    );
  }
}

/** A store that refuses every call with one LOCAL, non-retryable error. */
function refusingStorage(code: string, message: string): DocumentStorage {
  const refuse = (): Promise<never> =>
    Promise.reject(
      new StorageError(LOCAL_PREVIEW_ERROR_STATUS, code, message, { code, message, error: message }),
    );
  // Every method of `StorageCollection`, so `satisfies` fails the build if one is added.
  const collection = {
    get: refuse,
    getMany: refuse,
    put: refuse,
    create: refuse,
    delete: refuse,
    list: refuse,
    increment: refuse,
    mark: refuse,
    unmark: refuse,
  } satisfies Record<keyof StorageCollection, () => Promise<never>>;
  return {
    collection: <T extends object>() => collection as StorageCollection<T>,
    info: refuse,
  };
}
