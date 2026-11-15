/**
 * The last seven exports of the removed legacy key-value store.
 *
 * civitai.com refuses every legacy-store call since 2026-11-10 (HTTP 410,
 * `legacy_store_removed`), and `@civitai/blocks-react` removed `useAppStorage()`
 * and `useSharedStorage()` in the release after 0.80.x. Use the document store
 * instead: `app.storage.collection(name)` in `@civitai/sdk`.
 *
 * 🔴 **Why these seven are still exported, when nothing in this repository
 * reads them.** Published `@civitai/blocks-react` releases value-import these
 * names from `@civitai/app-sdk/blocks` at module load, in
 * `dist/internal/mockHost.js` (all seven in the `0.80.1` tarball, measured
 * 2026-11-14; `PEER_FLOOR.md` records them arriving in 0.47.0 and 0.49.0).
 * `0.80.1` declares the peer range `>=0.57.0 <1.0.0`, so it accepts this
 * release. Deleting a name would make `@civitai/blocks-react/testing`
 * fail to load with `SyntaxError: ... does not provide an export named ...` for
 * anyone who upgrades app-sdk before blocks-react. That stops every one of their
 * test files from loading (the #344 failure).
 *
 * **When to remove them:** in app-sdk `1.0.0`. Every published blocks-react
 * that imports them (0.54.0 onward) caps its app-sdk peer range below `1.0.0`
 * (read from the registry, 2026-11-14), so none of them can be installed next
 * to it.
 *
 * The values are the ones the host used; they describe a store that no longer
 * exists. Do not build anything on them.
 */

/** @deprecated The legacy store was removed. Use `app.storage.collection(name)` in `@civitai/sdk`. */
export const APP_STORAGE_MAX_VALUE_BYTES = 64 * 1024;

/** @deprecated The legacy store was removed. Use `app.storage.collection(name)` in `@civitai/sdk`. */
export const APP_STORAGE_MAX_BYTES = 2 * 1024 * 1024;

/** @deprecated The legacy store was removed. Use `app.storage.collection(name)` in `@civitai/sdk`. */
export const APP_STORAGE_MAX_ROWS = 1_000;

/** @deprecated The legacy store was removed. Use `app.storage.collection(name)` in `@civitai/sdk`. */
export const APP_STORAGE_ERROR_VALUE_TOO_LARGE = `value exceeds ${APP_STORAGE_MAX_VALUE_BYTES / 1024}KB cap`;

/** @deprecated The legacy store was removed. Use `app.storage.collection(name)` in `@civitai/sdk`. */
export const APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED = 'per-user storage quota exceeded';

/** @deprecated The legacy store was removed. Use `app.storage.collection(name)` in `@civitai/sdk`. */
export const APP_STORAGE_ERROR_USER_ROW_LIMIT = 'per-user row limit exceeded';

/** @deprecated The legacy store was removed. Use `app.storage.collection(name)` in `@civitai/sdk`. */
export const APP_STORAGE_ERROR_REQUEST_FAILED = 'storage request failed';
