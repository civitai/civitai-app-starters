/**
 * The App Storage rejection MESSAGES the host puts on the wire — **the only
 * site in this repository that spells them**, sibling of
 * `appStorageLimits.ts`, which owns the numbers.
 *
 * 🔴 **THE WIRE CARRIES A MESSAGE, NOT A CODE.** The host's router throws a
 * `TRPCError` that has BOTH: `code: 'PAYLOAD_TOO_LARGE'` and a per-site
 * `message`. The bridge that answers `APP_STORAGE_SET` forwards
 * **`err.message`** and never the code, so `PAYLOAD_TOO_LARGE` is a string a
 * block CANNOT receive. `createMockHost` emitted it anyway for three releases:
 * a block that branched on it took the actionable branch under `dev:mock` and
 * the generic one in production, and nothing local could see the difference.
 * That is civitai/civitai-app-starters#343, and this module is its fix — one
 * spelling, shared by the mock, the example harness and any block matcher.
 *
 * ## Provenance — measured, not assumed
 *
 * Read from `civitai/civitai` `main` on **2026-09-20** via `gh api` (not a
 * local checkout, which can lag).
 *
 * `src/server/routers/apps.router.ts` — five rejection sites, every one
 * `code: 'PAYLOAD_TOO_LARGE'`, each with its own message:
 *
 * ```ts
 * :568  throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE',
 *                             message: `value exceeds ${PER_VALUE_BYTE_CAP / 1024}KB cap` });
 * :783  throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'app quota exceeded' });
 * :791  throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'app row limit exceeded' });
 * :845  throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'per-user storage quota exceeded' });
 * :853  throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'per-user row limit exceeded' });
 * ```
 *
 * `src/components/AppBlocks/IframeHost.tsx:282` (and the identical pair in
 * `PageBlockHost.tsx`) — what actually reaches the block:
 *
 * ```ts
 * function storageErrorMessage(err: unknown): string {
 *   if (err && typeof err === 'object' && 'message' in err) {
 *     const message = (err as { message?: unknown }).message;
 *     if (typeof message === 'string' && message.length > 0) return message;
 *   }
 *   return 'storage request failed';
 * }
 * ```
 *
 * …called from every `APP_STORAGE_*` catch arm, so the fallback is a SIXTH
 * string a block can receive — for any failure whose error carries no message
 * (a transport fault, a non-`Error` throw), on reads and deletes as well as
 * writes.
 *
 * Re-derive with:
 *
 * ```sh
 * gh api repos/civitai/civitai/contents/src/server/routers/apps.router.ts \
 *   --jq '.content' | base64 -d | grep -n "PAYLOAD_TOO_LARGE" -A3
 * gh api repos/civitai/civitai/contents/src/components/AppBlocks/IframeHost.tsx \
 *   --jq '.content' | base64 -d | grep -n "storageErrorMessage" -A8
 * ```
 *
 * 🔴 **DO NOT re-derive the strings from this comment** — re-read the host.
 * These are prose a server engineer wrote, not a published contract: they can
 * be reworded in any deploy, and nothing will tell you. Which is also why
 * {@link classifyAppStorageError} answers `null` rather than guessing, and why
 * a block must branch on the CLASSIFICATION and render its OWN copy — see the
 * warning on that function.
 *
 * ## Which ceiling each message names
 *
 * Two scopes, and the remedies differ:
 *
 * - **per-user** (`'per-user storage quota exceeded'`, `'per-user row limit
 *   exceeded'`) — this viewer has filled their own budget for this app. The
 *   ceilings are `APP_STORAGE_MAX_BYTES` / `APP_STORAGE_MAX_ROWS`;
 *   the viewer can free space by deleting their own rows.
 * - **app-wide** (`'app quota exceeded'`, `'app row limit exceeded'`) — the
 *   app has filled a far larger umbrella shared across every viewer. One
 *   viewer's delete will not reliably clear it; this is the developer's
 *   problem, and `appStorageLimits.ts` deliberately does not export the
 *   umbrella's value because nothing reports usage against it.
 *
 * A block will normally hit the per-user pair. Both are reachable, so a
 * matcher that handles only one is a matcher with a silent hole.
 */

import { APP_STORAGE_MAX_VALUE_BYTES } from './appStorageLimits.js';

/**
 * The host's per-value-cap message, as a function of the cap — a mirror of the
 * template literal at `apps.router.ts:569`, which divides by 1024 and appends
 * `KB cap`.
 *
 * 🔴 **THIS IS A TEMPLATE ON THE HOST, SO IT IS A TEMPLATE HERE.** Writing
 * `'value exceeds 64KB cap'` as a literal would be true only while the cap is
 * 64KB, and a string that silently stops matching the host the day the cap
 * moves is the exact defect #343 is about — one spelling that drifts, with
 * nothing able to notice. Derived from {@link APP_STORAGE_MAX_VALUE_BYTES} so
 * the two move together.
 *
 * Exported from this module (not from `@civitai/app-sdk/blocks`) so a test can
 * feed it a cap the constant cannot equal and watch the output move. Blocks
 * want {@link APP_STORAGE_ERROR_VALUE_TOO_LARGE}.
 */
export function appStorageValueTooLargeMessage(
  capBytes: number = APP_STORAGE_MAX_VALUE_BYTES,
): string {
  return `value exceeds ${capBytes / 1024}KB cap`;
}

/**
 * A single value exceeded the per-value wire cap
 * ({@link APP_STORAGE_MAX_VALUE_BYTES}). `apps.router.ts:568-569`.
 *
 * The only one of the six that is not a fixed string on the host — see
 * {@link appStorageValueTooLargeMessage}.
 */
export const APP_STORAGE_ERROR_VALUE_TOO_LARGE = appStorageValueTooLargeMessage();

/** The APP-wide byte umbrella is full. `apps.router.ts:782-785`. */
export const APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED = 'app quota exceeded';

/** The APP-wide row umbrella is full. `apps.router.ts:790-793`. */
export const APP_STORAGE_ERROR_APP_ROW_LIMIT = 'app row limit exceeded';

/**
 * This viewer's byte budget for this app (`APP_STORAGE_MAX_BYTES`) is
 * full. `apps.router.ts:844-847`.
 */
export const APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED = 'per-user storage quota exceeded';

/**
 * This viewer's row budget for this app (`APP_STORAGE_MAX_ROWS`) is
 * full. `apps.router.ts:852-855`.
 *
 * The ceiling a block reaches first in practice: rows run out long before
 * bytes do.
 */
export const APP_STORAGE_ERROR_USER_ROW_LIMIT = 'per-user row limit exceeded';

/**
 * The bridge's fallback, used for any storage failure whose error carries no
 * usable message — a transport fault, a non-`Error` throw, an upstream 5xx.
 * `IframeHost.tsx:287`.
 *
 * 🔴 It is NOT specific to writes. Every `APP_STORAGE_*` catch arm goes
 * through the same helper, so a `get`, `delete`, `list` or `getQuota` can
 * reject with it too. Retryable, unlike the five ceilings.
 */
export const APP_STORAGE_ERROR_REQUEST_FAILED = 'storage request failed';

/**
 * Every storage-rejection string the host can put on the wire, as of the
 * measurement in this file's header.
 *
 * This is the set `createMockHost` and the starter harnesses must draw from —
 * enforced by `tests/guards/app-storage-error-strings.test.mjs`, so a
 * hand-typed string cannot reappear at a mock rejection site.
 *
 * 🔴 **A CLOSED SET IS A CLAIM ABOUT A MEASUREMENT, NOT A CONTRACT.** The host
 * can add a sixth site or reword an existing one in any deploy. Treat an
 * unrecognised string as "some ceiling, unknown which" — never as impossible.
 */
export const APP_STORAGE_HOST_ERROR_MESSAGES = [
  APP_STORAGE_ERROR_VALUE_TOO_LARGE,
  APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED,
  APP_STORAGE_ERROR_APP_ROW_LIMIT,
  APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED,
  APP_STORAGE_ERROR_USER_ROW_LIMIT,
  APP_STORAGE_ERROR_REQUEST_FAILED,
] as const;

/**
 * Which rejection site a storage failure came from, as a closed set. `null`
 * means the string matched nothing known — see {@link classifyAppStorageError}.
 */
export type AppStorageRejectionReason =
  | 'value-too-large'
  | 'app-quota-exceeded'
  | 'app-row-limit'
  | 'user-quota-exceeded'
  | 'user-row-limit'
  | 'request-failed';

/**
 * Turn a rejection — the `Error` `useAppStorage().set()` throws, or its raw
 * message — into the rejection site it came from, or `null` when the string
 * matches nothing this SDK version knows about.
 *
 * Branch on the RESULT; render your OWN copy.
 *
 * 🔴 **NEVER RENDER THE MESSAGE ITSELF TO A VIEWER.** It is host-authored
 * server prose in the same class as a workflow `snapshot.error`: not
 * localized, not written for an end user, and free to change. Log it for
 * yourself (`console.warn`) and show copy your app owns.
 *
 * 🔴 **`null` IS A REAL OUTCOME, NOT AN ERROR IN YOUR CODE.** The host can add
 * a rejection site or reword one at any deploy, and a block compiled against
 * an older SDK will see the new string. Give it a retry-ish generic arm; do
 * NOT assume it means "impossible".
 *
 * @example
 * try {
 *   await storage.set(key, note);
 * } catch (err) {
 *   console.warn('[my-app] save failed:', err);
 *   switch (classifyAppStorageError(err)) {
 *     case 'value-too-large':
 *       return 'That note is too long to save. Try shortening it.';
 *     case 'user-row-limit':
 *     case 'app-row-limit':
 *       return 'You have no note slots left. Delete one to make room.';
 *     default:
 *       return 'Could not save that note. Please try again.';
 *   }
 * }
 */
export function classifyAppStorageError(error: unknown): AppStorageRejectionReason | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';

  // CONTAINMENT, not equality. `useAppStorage` throws `new Error(result.error)`
  // verbatim, so equality would be enough for a rejection caught directly off
  // `set()` — but a block that re-wraps ("could not save: <cause>") or logs a
  // joined string is ordinary, and equality would silently stop classifying it.
  // Containment costs nothing here: no host message is a substring of another
  // (checked by a control in `test/blocks/appStorageErrors.test.ts`).
  if (message.includes(APP_STORAGE_ERROR_USER_ROW_LIMIT)) return 'user-row-limit';
  if (message.includes(APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED)) return 'user-quota-exceeded';
  if (message.includes(APP_STORAGE_ERROR_APP_ROW_LIMIT)) return 'app-row-limit';
  if (message.includes(APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED)) return 'app-quota-exceeded';
  if (message.includes(APP_STORAGE_ERROR_REQUEST_FAILED)) return 'request-failed';
  // LAST, and matched as a FAMILY rather than against the compiled constant.
  // The cap is the host's, this SDK carries a snapshot of it, and the two can
  // disagree across a release — so `value exceeds 32KB cap` from a host that
  // has moved the cap must still classify, which an equality test against
  // `APP_STORAGE_ERROR_VALUE_TOO_LARGE` would not do.
  if (/\bvalue exceeds \d+(?:\.\d+)?KB cap\b/.test(message)) return 'value-too-large';
  return null;
}

/**
 * Is `message` a storage-rejection string the host can produce?
 *
 * Wider than `APP_STORAGE_HOST_ERROR_MESSAGES.includes(…)` by exactly one
 * case: the per-value message is a template on the host, so any cap spelling
 * is admitted — see {@link classifyAppStorageError}.
 */
export function isAppStorageHostErrorMessage(message: unknown): message is string {
  return typeof message === 'string' && classifyAppStorageError(message) !== null;
}
