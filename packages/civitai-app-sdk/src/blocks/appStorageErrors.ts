/**
 * The App Storage rejection MESSAGES the host puts on the wire — the only site
 * in this repository that spells them **in executable code**, sibling of
 * `appStorageLimits.ts`, which owns the numbers.
 *
 * 🔴 **"IN EXECUTABLE CODE" IS THE WHOLE CLAIM — do not read it wider.** What
 * `tests/guards/app-storage-error-strings.test.mjs` actually enforces is
 * narrower still: every `error:` value inside an `APP_STORAGE_*_RESULT` payload
 * in the scanned mocks must NAME a constant from this module. It sees nothing
 * else. Hand-typed copies of these six strings live today in
 * `mockHost.ts`'s option docblocks (which ship in the published `.d.ts`),
 * in `blocks-react/test/validate.test.ts`'s fixture, in this guard's own
 * control assertions, and in both READMEs — and every one of them is invisible
 * to the guard. If the host rewords a message they go stale silently. Grep the
 * literal, not just the identifier, when a message moves.
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
 * ## 🔴 There is NO list here of "every string a block can receive" — on purpose
 *
 * **This is the THIRD attempt at this section, and the absence of that list is
 * what the first two attempts cost. It is not an omission to be helpfully
 * filled in.** Both earlier drafts shipped, and each was wrong by more than its
 * author had checked:
 *
 *   1. **Draft 1 (RETRACTED)** presented six strings as "every storage-rejection
 *      string the host can put on the wire". It had read only the
 *      `PAYLOAD_TOO_LARGE` sites, so it missed the entire authorization family.
 *   2. **Draft 2 (RETRACTED)** kept the six, added a table of eight
 *      authorization messages "measured in the same read", and presented THAT
 *      as the surface. Also wrong. It missed, in the same file: `Apps are not
 *      enabled` (`apps.router.ts:153`, `:255`, `:257` — thrown by the
 *      `enforceAppBlocksFlag` middleware, which is `.use()`d on all five
 *      storage procedures at `:470`, `:509`, `:938`, `:1022`, `:1106`, so it
 *      fires before anything else on every call), `block token subject could
 *      not be resolved` (`:148`, called unconditionally from
 *      `resolveStorageContext`), `review token subject could not be resolved`
 *      (`:82`) and `Apps authoring is not enabled for this account` (`:89`).
 *      `Apps are not enabled` is a feature-flag kill switch — neither a ceiling
 *      nor an authorization failure, so it fit neither published table.
 *
 * Each enumeration was wider than the last and each was still short; the
 * router carries **21** `throw new TRPCError` sites and **17** distinct
 * messages, against draft 2's 14. A third list would be the same defect a third
 * time.
 *
 * 🔴 **The completeness claim is the wrong SHAPE, not merely a stale list.** The
 * failure is not "this might go out of date" — it is that "the set of strings a
 * block can receive" is the host's whole error surface, which this repository
 * does not own, cannot observe from here, and has now mis-measured twice while
 * believing otherwise. Do not soften this into "the list below may be
 * incomplete" and restore one. What replaces it needs no completeness at all:
 *
 * - **This module classifies the CEILING family, and that set IS closed and IS
 *   measured** — because it is defined by a `code`, not by a reading of prose.
 *   It is every `PAYLOAD_TOO_LARGE` throw in `apps.router.ts` (`:568`, `:783`,
 *   `:791`, `:845`, `:853`) plus the bridge's fallback. A new ceiling can only
 *   arrive as a new `PAYLOAD_TOO_LARGE` throw, and the recipe below finds it.
 * - **Every OTHER host rejection reaches a block on the same `error` field and
 *   classifies `null`.** This is the whole of what a block author needs, it
 *   requires no enumeration, and it stays true when the host adds, rewords or
 *   deletes a message. It holds STRUCTURALLY, from two facts rather than from a
 *   survey: the bridge's catch arms are **blanket** `catch (err)` with no code
 *   filter (`IframeHost.tsx:2395` GET, `:2427` SET, `:2458` DELETE, `:2508`
 *   LIST, `:2535` QUOTA), each forwarding `err.message` verbatim via
 *   `storageErrorMessage()`; and {@link classifyAppStorageError} answers `null`
 *   for everything outside the ceiling patterns, which is checkable in this
 *   file without consulting the host at all.
 * - **The RECIPE is the authority — not any prose in this repository.** It is
 *   strictly wider than every list anyone has written: it found all 21 sites,
 *   including the four draft 2 missed.
 *
 * 🔴 **So: wherever a list of host strings still appears — in this repo's
 * READMEs, in the changeset, in `messages.ts`, or in
 * `test/blocks/appStorageErrors.test.ts` — it is ILLUSTRATIVE, NOT EXHAUSTIVE,
 * and must be labelled as such.** Its job is to show a reader what the `null`
 * bucket typically contains, never to bound it.
 *
 * ## Re-deriving it
 *
 * 🔴 **Not a `PAYLOAD_TOO_LARGE`-only grep** — that is structurally incapable of
 * seeing anything but the ceiling family, and is how draft 1 came to claim a
 * completeness it had not measured.
 *
 * ```sh
 * # EVERY throw, not one code. Read the whole output; do not count from memory.
 * gh api repos/civitai/civitai/contents/src/server/routers/apps.router.ts \
 *   --jq '.content' | base64 -d | grep -n "new TRPCError" -A4
 * # …and confirm the catch arms are still blanket (no code filter), which is
 * # what makes "everything else classifies null" true:
 * gh api repos/civitai/civitai/contents/src/components/AppBlocks/IframeHost.tsx \
 *   --jq '.content' | base64 -d | grep -n "storageErrorMessage" -B12
 * ```
 *
 * 🔴 **DO NOT re-derive the ceiling strings from this comment** — re-read the
 * host. These are prose a server engineer wrote, not a published contract: they
 * can be reworded in any deploy, and nothing will tell you. Which is also why
 * {@link classifyAppStorageError} answers `null` rather than guessing, and why
 * a block must branch on the CLASSIFICATION and render its OWN copy — see the
 * warning on that function.
 *
 * One consequence worth stating plainly: `null` is a **BUSY** bucket, and its
 * dominant real-world occupant is an expired or revoked token, not a rare
 * unknown. Do not write a `default:` arm that assumes `null` means "transient,
 * retry" — see the warning on {@link classifyAppStorageError}.
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
 * The only one of the six ceiling messages that is not a fixed string on the
 * host — see {@link appStorageValueTooLargeMessage}.
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
 * Every **ceiling** rejection string the host can put on the wire — one per
 * `PAYLOAD_TOO_LARGE` site in `apps.router.ts`, plus the bridge's fallback, as
 * of the measurement in this file's header.
 *
 * 🔴 **NOT "every string a block can receive".** The bridge's catch arms are
 * blanket, so every other rejection the host raises arrives on the SAME field
 * and is absent here on purpose. `invalid block token`, `block instance
 * revoked`, `Apps are not enabled` and the `storage … scope` template are
 * examples of what that covers — **illustrations, not a bound.** See this
 * file's header for why no list of them lives in this repository.
 *
 * This is the set `createMockHost` and the starter harnesses must draw from —
 * enforced by `tests/guards/app-storage-error-strings.test.mjs`, so a
 * hand-typed string cannot reappear at a mock rejection site.
 *
 * 🔴 **NOT RE-EXPORTED FROM `@civitai/app-sdk/blocks`, ON PURPOSE.** Publishing
 * this array invites `APP_STORAGE_HOST_ERROR_MESSAGES.includes(err.message)`,
 * which is EQUALITY against a frozen snapshot — narrower than
 * {@link isAppStorageHostErrorMessage}, and narrower than
 * {@link classifyAppStorageError}, by exactly the per-value message, whose cap
 * the host is free to move. That is the matcher shape #343 exists to
 * eliminate, so it must not become public API. Reach it by file path from a
 * test or a guard; a block branches on the classifier's reason.
 *
 * 🔴 **A CLOSED SET IS A CLAIM ABOUT A MEASUREMENT, NOT A CONTRACT — and this
 * measurement is narrow by construction, not merely stale.** Two separate
 * gaps, and only the first is about the future:
 *
 *   1. The host can add a `PAYLOAD_TOO_LARGE` site or reword an existing one
 *      in any deploy, and nothing here will notice.
 *   2. **Today, already**, every non-ceiling rejection the host raises reaches
 *      the block on the same field and is not in this array. 🔴 This is not a
 *      hole to be filled — two drafts tried and both came up short (see this
 *      file's header). Those strings are the host's session, approval and
 *      feature-flag prose, not ceiling vocabulary, and enumerating them here
 *      would invite exactly the equality matching the rest of this comment
 *      argues against.
 *
 * So an unrecognised string is "some storage failure, unknown which" — NOT
 * "some ceiling", and never "impossible".
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
 * 🔴 **`null` IS A REAL OUTCOME, NOT AN ERROR IN YOUR CODE — AND IT DOES NOT
 * MEAN "TRANSIENT".** Two different things land here, and only one is a retry:
 *
 *   - a ceiling message this SDK version has not seen (the host reworded one,
 *     or added a site, and your block compiled against an older SDK);
 *   - 🔴 **and, far more often in production, an authorization or kill-switch
 *     failure.** The bridge's catch arms are blanket, so every other rejection
 *     the host raises arrives on the same field and classifies `null` — for
 *     example `invalid block token` (an expired token mid-session), `block
 *     instance revoked`, `storage set requires the apps:storage:write scope`,
 *     or `Apps are not enabled` (the feature flag, which fires before anything
 *     else on every storage call). 🔴 **Those are ILLUSTRATIONS, not the set**:
 *     see this module's header for why no list of them lives here.
 *
 * So **"Please try again" is the wrong copy for the `null` arm.** Retrying an
 * expired token forever is the failure this warning exists to prevent. Write a
 * generic arm that offers a RELOAD (which re-mints the token, and also covers
 * a genuine transport blip) and concedes that saving may be unavailable — and
 * keep `'request-failed'` separate if you want honest retry copy, since that
 * reason really is the transport one.
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
 *     case 'request-failed':
 *       // The bridge's fallback: genuinely a transport fault. Retry is honest.
 *       return 'Could not save that note. Please try again.';
 *     default:
 *       // `null`: an unknown ceiling OR — usually — an expired/revoked token.
 *       return 'Could not save that note. Try reloading the page; if it keeps ' +
 *         'happening, saving may be unavailable for this app right now.';
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
 * Is `message` one of the CEILING rejection strings above?
 *
 * 🔴 Not "a string the host can produce" — it answers `false` for every
 * non-ceiling rejection the host raises, all of which the host produces and the
 * bridge forwards on the same field. It is a membership test over
 * {@link APP_STORAGE_HOST_ERROR_MESSAGES}, nothing wider.
 *
 * Wider than `APP_STORAGE_HOST_ERROR_MESSAGES.includes(…)` by exactly one
 * case: the per-value message is a template on the host, so any cap spelling
 * is admitted — see {@link classifyAppStorageError}.
 *
 * Module-internal, like the array: it is a `classifyAppStorageError(…) !== null`
 * convenience for `tests/guards/app-storage-error-strings.test.mjs`, which
 * imports this file by PATH. A block wants the classifier's reason, not a
 * yes/no on host prose.
 */
export function isAppStorageHostErrorMessage(message: unknown): message is string {
  return typeof message === 'string' && classifyAppStorageError(message) !== null;
}
