/**
 * The App Storage ceilings the host enforces — **the only RUNTIME or
 * DOCUMENTATION site in this repository that spells these numbers**.
 *
 * Every doc site, the mock host, the live dev host and the starter harnesses
 * reference these constants. That is the point of the module: seven
 * hand-copied literals is how the old figures came to agree with each other
 * and disagree with the host by 25x on bytes and 1000x on rows, with nothing
 * in any build, test or type-check able to notice.
 *
 * 🔴 **"Only site" is a claim about what is ENFORCED, and the enforcement is
 * much narrower than the repo.** `tests/guards/app-storage-quota-literals.test.mjs`
 * bans the OLD figures, and pins the derivation at each runtime site, over
 * exactly this surface:
 *
 *   - this file and `messages.ts`, here in `src/blocks/`;
 *   - `useAppStorage.ts`, `internal/mockHost.ts` and `internal/liveHost.ts` in
 *     `packages/civitai-blocks-react` — NAMED FILES, not the package: the
 *     banned numbers are the TRUE ceilings of neighbouring features there
 *     (the shared-storage app-wide quota, the iframe frame cap, Buzz figures),
 *     and a value ban over the package failed the build for saying so;
 *   - all of `starters/examples/kv-storage`;
 *   - and, in `packages/civitai-blocks-react/README.md`,
 *     `packages/civitai-app-sdk/README.md` and `starters/examples/README.md`,
 *     ONLY the App-Storage REGION — sections whose heading names App Storage,
 *     plus lines that name it themselves. `### useSharedStorage()` in the same
 *     file is not read.
 *
 * It does NOT scan, and the rule does not apply to: the guard itself (it spells
 * every figure, as test data), `CHANGELOG.md` and `.changeset/*.md` (history,
 * which must not be rewritten to satisfy a guard), `scripts/`, `tests/`,
 * `claudedocs/`, the root README, other sections of the READMEs above, or any
 * other file in any package. If you are re-deriving after a host move, do not
 * assume those paths are empty — grep them.
 *
 * ## Provenance — measured, not assumed
 *
 * Read from `civitai/civitai` `main` on **2026-09-19** via `gh api` (not a
 * local checkout, which can lag), file
 * `src/server/routers/apps.router.ts`, blob `654f2d6`:
 *
 * ```ts
 * const PER_VALUE_BYTE_CAP = 64 * 1024;          // :172
 * const USER_QUOTA_BYTES   = 2 * 1024 * 1024;    // :204
 * const USER_ROW_LIMIT     = 1_000;              // :205
 * ```
 *
 * and the `getQuota` procedure returns `limitBytes: USER_QUOTA_BYTES,
 * limitRows: USER_ROW_LIMIT` — so these are exactly the numbers a block reads
 * back from {@link https://github.com/civitai/civitai-app-starters | `useAppStorage().getQuota()`}.
 *
 * Re-derive with:
 *
 * ```sh
 * gh api repos/civitai/civitai/contents/src/server/routers/apps.router.ts \
 *   --jq '.content' | base64 -d | grep -n 'USER_QUOTA_BYTES\|USER_ROW_LIMIT\|PER_VALUE_BYTE_CAP'
 * ```
 *
 * 🔴 **DO NOT re-derive the numbers from this comment** — re-read the host.
 * The per-user clamp was sized against a measured distribution (the host's own
 * comment records: 2026-09-09, largest observed per-user footprint 0.65 MiB
 * across 49 rows, `2 MiB` chosen for ~3.1x headroom) and is expected to move
 * again when that distribution does.
 *
 * ## Which scope each number describes
 *
 * 🔴 **THE NAMESPACE AND THE BUDGET HAVE DIFFERENT SCOPES, and the docs used
 * to quote one while naming the other.**
 *
 * - **Namespace** — rows are keyed `(block_instance_id, user_id, key)`. A key
 *   written by one block instance is invisible to another. "Per (block
 *   instance, viewer)" is correct, and unchanged.
 * - **Budget** — {@link APP_STORAGE_MAX_BYTES} and
 *   {@link APP_STORAGE_MAX_ROWS} are enforced per **(app, viewer)**: the host
 *   counter is keyed `(app_block_id, user_id)`, so every block instance of the
 *   same app draws on ONE budget for that viewer. An app with three instances
 *   on a viewer's page shares 1,000 rows between them, not 3,000.
 *
 * A far larger app-wide umbrella also exists above both. It is deliberately
 * NOT exported and its value is deliberately not written here: nothing reports
 * an app's usage against it, so no block can render a meaningful "x of y" for
 * it, and a constant nobody can act on is an invitation to build a UI that
 * lies. The per-viewer clamp below is what a block will actually hit — it is
 * orders of magnitude tighter.
 */

/**
 * Largest single value one `set()` may send, in **wire** bytes
 * (`JSON.stringify(value)` measured as UTF-8).
 *
 * 🔴 This bounds what one call SENDS, not what it STORES. The host checks it
 * in the wire unit while the byte budget below is enforced in the stored unit,
 * and they diverge: the host records that the largest value this cap admits
 * (65,535 wire bytes) stores 2,911,582 bytes — 44x, and on its own past
 * {@link APP_STORAGE_MAX_BYTES}. So passing this check is not evidence the
 * write will land.
 */
export const APP_STORAGE_MAX_VALUE_BYTES = 64 * 1024;

/**
 * Total stored bytes one viewer may hold across **all instances of one app**.
 *
 * This is the value `getQuota().limitBytes` reports.
 */
export const APP_STORAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Total rows one viewer may hold across **all instances of one app**.
 *
 * This is the value `getQuota().limitRows` reports. It is the ceiling most
 * likely to surprise: a block caching one small row per item a viewer looks at
 * reaches it after a thousand items while using ~0.3 MB — well under
 * {@link APP_STORAGE_MAX_BYTES} — so a byte-only estimate will not predict it.
 */
export const APP_STORAGE_MAX_ROWS = 1_000;
