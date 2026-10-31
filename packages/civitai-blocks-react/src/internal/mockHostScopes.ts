/**
 * mockHostScopes.ts — the dev host's STORAGE SCOPE GATE.
 *
 * THE MOTIVATING FAILURE (2026-10-01). An app was built from the documented
 * onboarding prompt, shipped `useAppStorage()` for every save, and declared only
 * `ai:write:budgeted` in its manifest. It passed **198 unit tests, the dev
 * harness, `civitai app validate`, and a full submit** — then every save in
 * production failed:
 *
 *     "message": "storage set requires the apps:storage:write scope",
 *     "code": -32003,
 *     "data": { "code": "FORBIDDEN", "httpStatus": 403, "path": "apps.storage.set" }
 *
 * which the viewer saw as *"Saving failed for an unknown reason… try again"*.
 *
 * 🔴 THE REASON IT GOT THAT FAR IS THIS FILE'S ABSENCE. `createMockHost` served
 * storage unconditionally — its own options doc said so in as many words
 * ("`APP_STORAGE_*` is answered either way (the mock host always serves storage
 * now)") — so the one failure mode that actually ships was the only storage
 * failure mode the mock could not produce. It modelled the per-value cap, both
 * per-viewer budgets, the row limit and an induced transport failure, and not
 * the scope.
 *
 * So this is not a new feature so much as the missing arm of an existing
 * simulation: the dev host already models `ai:write:budgeted` (it has a flag,
 * a consent round-trip and an un-grantable case). Storage had nothing.
 *
 * ---
 *
 * WHAT THE SERVER ACTUALLY DOES, and what is inferred here.
 *
 * `BLOCK_SCOPES` in `@civitai/app-sdk` states the mechanism: the storage scopes
 * "have no OAuth bit … the server gates them by presence in the block's
 * APPROVED SCOPE SET, not a bitmask". Presence is therefore the whole test, and
 * it is what {@link requiredStorageScope} models.
 *
 * 🔴 ONE ROW IS MEASURED; THE REST ARE INFERRED FROM THE SCOPE NAMES. The
 * incident above is direct evidence for exactly one pair —
 * `apps.storage.set` → `apps:storage:write` — because the server named both in
 * its own refusal. Every other row below reads a `:read` scope onto a read op
 * and a `:write` scope onto a write op, which is the only split the names admit
 * but is still an inference about another service. Nothing in this repository
 * can verify it: there is no op→scope table in `@civitai/app-sdk`, none in this
 * package, and the server's own table is not vendored.
 *
 * The consequence matters because enforcement is ON by default: a row that is
 * WRONG fails a CORRECT app's suite. If that happens, the row is the suspect —
 * not the app. Fix the row and say what the server did instead.
 *
 * `SHARED_REPORT` is the row to doubt first. It is mapped to
 * `apps:storage:shared:write` because `useSharedStorage().report()` files a row
 * in the shared store, so it is a write by construction — but a server is also
 * free to treat an abuse report as a moderation path outside the store's own
 * gate, in which case this row over-gates and should be removed rather than
 * weakened.
 */

import { BLOCK_SCOPES } from '@civitai/app-sdk/blocks';

/**
 * Block→host message type → the scope the server requires to answer it.
 *
 * Only storage surfaces appear here. The money path keeps its own flag
 * (`consentGranted`) in `mockHost.ts`, deliberately: `buzzBudget` is conditional
 * on it and `setScenario` can toggle it mid-session, so folding it in here would
 * give one scope two sources of truth.
 */
const STORAGE_SCOPE_BY_MESSAGE: Readonly<Record<string, string>> = {
  // Per-app, per-viewer KV store.
  APP_STORAGE_GET: BLOCK_SCOPES.APPS_STORAGE_READ,
  APP_STORAGE_LIST: BLOCK_SCOPES.APPS_STORAGE_READ,
  APP_STORAGE_QUOTA: BLOCK_SCOPES.APPS_STORAGE_READ,
  APP_STORAGE_SET: BLOCK_SCOPES.APPS_STORAGE_WRITE, // ← the MEASURED row
  APP_STORAGE_DELETE: BLOCK_SCOPES.APPS_STORAGE_WRITE,
  // Shared, cross-user store.
  SHARED_LIST: BLOCK_SCOPES.APPS_STORAGE_SHARED_READ,
  SHARED_GET: BLOCK_SCOPES.APPS_STORAGE_SHARED_READ,
  SHARED_GET_COUNT: BLOCK_SCOPES.APPS_STORAGE_SHARED_READ,
  SHARED_GET_COUNTS: BLOCK_SCOPES.APPS_STORAGE_SHARED_READ,
  SHARED_APPEND: BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE,
  SHARED_VOTE: BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE,
  SHARED_UNVOTE: BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE,
  SHARED_WITHDRAW: BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE,
  SHARED_UPDATE: BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE,
  SHARED_REPORT: BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE, // ← doubt this one first
};

/** Every message type this gate governs. Exported for the ledger test. */
export function gatedStorageMessages(): string[] {
  return Object.keys(STORAGE_SCOPE_BY_MESSAGE).sort();
}

/**
 * The scope `type` needs, or `null` when this gate does not govern it.
 *
 * `null` is the ordinary answer — the overwhelming majority of block→host
 * messages are not storage.
 */
export function requiredStorageScope(type: string): string | null {
  return STORAGE_SCOPE_BY_MESSAGE[type] ?? null;
}

/**
 * The refusal text. Modelled on the server's own prose for the one case it was
 * observed emitting: *"storage set requires the apps:storage:write scope"*.
 *
 * 🔴 DO NOT LET A BLOCK BRANCH ON THIS STRING, and do not render it to a viewer.
 * `@civitai/app-sdk`'s `appStorageErrors.ts` is explicit that host refusal prose
 * is "not localized, not written for an end user, and free to change", and that
 * an authorization failure deliberately classifies as `null` through
 * `classifyAppStorageError` — which is exactly what this message does, matching
 * production rather than inventing a classification the real host does not send.
 * That `null` arm is also why *"please try again"* is the wrong copy for it: a
 * missing scope is a manifest defect and no number of retries fixes it.
 */
export function storageScopeDeniedMessage(type: string, scope: string): string {
  return `${verbFor(type)} requires the ${scope} scope`;
}

/**
 * The server names the OPERATION, not the message type, in its refusal
 * (`storage set …`, on path `apps.storage.set`). Mirror that so a developer
 * grepping their logs for the production string finds the dev one too.
 */
function verbFor(type: string): string {
  const shared = type.startsWith('SHARED_');
  const op = type
    .replace(/^APP_STORAGE_/, '')
    .replace(/^SHARED_/, '')
    .toLowerCase()
    .replace(/_/g, ' ');
  return shared ? `shared storage ${op}` : `storage ${op}`;
}

/**
 * The reply payload that refuses `type`, type-correct for that reply's own
 * contract.
 *
 * 🔴 EVERY STORAGE REPLY CARRIES `error?`, AND A NON-EMPTY `error` IS THE REJECT
 * SIGNAL — `@civitai/app-sdk`'s messages module calls it "the
 * `APP_STORAGE_GET_RESULT` value-or-error convention: consumers treat a
 * non-empty `error` as the failure signal". So a refusal does not need a new
 * wire field, a new constant, or an `@civitai/app-sdk` change — which also
 * means it needs no peer-range bump, the hazard that once left 27 of 43 test
 * files collecting zero tests in this very package.
 *
 * The DATA fields are still required by each reply's type, so each arm supplies
 * an empty-but-valid one rather than omitting it: a reply that fails its own
 * contract risks being dropped by the host-message validator, which would
 * present as a HANG rather than a refusal.
 */
export function storageScopeDeniedPayload(
  type: string,
  requestId: string | undefined,
  error: string,
): Record<string, unknown> {
  switch (type) {
    // ---- reads: data field + error ----
    case 'APP_STORAGE_GET':
      return { requestId, value: null, error };
    case 'APP_STORAGE_LIST':
      return { requestId, keys: [], error };
    case 'APP_STORAGE_QUOTA':
      return { requestId, usedBytes: 0, rowCount: 0, limitBytes: 0, limitRows: 0, error };
    case 'SHARED_LIST':
      return { requestId, items: [], error };
    case 'SHARED_GET':
      return { requestId, item: null, error };
    case 'SHARED_GET_COUNT':
      return { requestId, count: 0, error };
    case 'SHARED_GET_COUNTS':
      return { requestId, counts: {}, error };
    // ---- writes: ok:false + error ----
    default:
      return { requestId, ok: false, error };
  }
}

/** The reply type for a block→host storage message. Uniform across the family. */
export function storageResultType(type: string): string {
  return `${type}_RESULT`;
}
