/**
 * Block-scope strings.
 *
 * Distinct from the OAuth `TokenScope` bitmask in `../scopes/`: block scopes
 * are colon-separated lowercase identifiers that appear verbatim in the
 * manifest and in block-scoped JWTs. The civitai/civitai server owns the
 * mapping from these strings to OAuth bits.
 *
 * Format: `domain:verb:target`, all lowercase. `defineBlock` rejects any
 * scope that does not match this pattern, including the PascalCase form
 * used elsewhere in the SDK for OAuth bits.
 */
export const BLOCK_SCOPES = {
  MODELS_READ_SELF: 'models:read:self',
  USER_READ_SELF: 'user:read:self',
  AI_WRITE_BUDGETED: 'ai:write:budgeted',
  BUZZ_READ_SELF: 'buzz:read:self',
  SOCIAL_TIP_SELF: 'social:tip:self',
  // apps:storage:* — the per-app KV datastore (W4). These have no OAuth bit
  // (storage never touches the user's civitai resources); the server gates them
  // by presence in the block's approved scope set, not a bitmask.
  APPS_STORAGE_READ: 'apps:storage:read',
  APPS_STORAGE_WRITE: 'apps:storage:write',
  // apps:storage:shared:* — the SHARED (app-global / cross-user) datastore. Same
  // no-OAuth-bit posture as apps:storage:*; the server gates them by presence in
  // the block's approved scope set (plus a min-trust gate + fail-closed flag).
  // These are the SDK's only 4-segment scopes — see BLOCK_SCOPE_PATTERN below.
  APPS_STORAGE_SHARED_READ: 'apps:storage:shared:read',
  APPS_STORAGE_SHARED_WRITE: 'apps:storage:shared:write',
  // collections:* — the App Blocks Collections surface. These have no OAuth bit
  // (they never touch the user's civitai resources via the OAuth surface); the
  // server gates them per-op server-side (collection visibility/ownership +
  // maturity clamp on read; self-bound actor on follow/write). All 3-segment.
  // `collections:read:self`  — own-PUBLIC + any PUBLIC collection (consent-exempt).
  // `collections:write:self` — follow/bookmark on the viewer's own behalf.
  // `collections:read:private` — the subject's OWN PRIVATE collections; CONSENT-GATED.
  COLLECTIONS_READ_SELF: 'collections:read:self',
  COLLECTIONS_WRITE_SELF: 'collections:write:self',
  COLLECTIONS_READ_PRIVATE: 'collections:read:private',
} as const;

export type BlockScopeKey = keyof typeof BLOCK_SCOPES;
export type BlockScope = (typeof BLOCK_SCOPES)[BlockScopeKey];

/**
 * Format helper for the block-scope shape — 3 OR 4 colon-separated lowercase
 * segments (`domain:verb:target` or `domain:area:verb:target`).
 *
 * NOTE: this regex is **not** the authoritative validity contract. The
 * canonical manifest schema (https://civitai.com/schemas/app-block/v1.json)
 * validates `scopes` by MEMBERSHIP in a fixed enum — i.e. the 12 values in
 * {@link BLOCK_SCOPES}. `defineBlock` therefore gates on membership in
 * `BLOCK_SCOPES`; this pattern is kept only as a FORMAT HEURISTIC to give a
 * pointed error message (e.g. distinguishing a malformed/PascalCase scope from
 * a well-formed but unknown one). A scope can match this pattern and still be
 * rejected for not being a known block scope.
 *
 * The 4th segment was added to mirror the server's 4-segment
 * `apps:storage:shared:read` / `apps:storage:shared:write` scopes (the SHARED
 * cross-user datastore). The SDK now tracks the server's 4-segment scopes
 * directly, so this is no longer a coordinated-major-bump situation — the
 * pattern just widened to accept the shapes the canonical enum already lists.
 */
export const BLOCK_SCOPE_PATTERN = /^[a-z]+:[a-z]+:[a-z]+(?::[a-z]+)?$/;

/**
 * Marketplace category taxonomy for the optional manifest `category` field —
 * the app's `/apps` store listing bucket. Mirrors `MARKETPLACE_CATEGORIES` in
 * civitai/civitai's `src/server/services/blocks/marketplace-categories.constants.ts`
 * (the single source of truth) and the `category` enum in the canonical schema
 * (https://civitai.com/schemas/app-block/v1.json). Keep all three in lockstep.
 *
 * `category` is OPTIONAL: omit it to let a moderator categorise the app; when
 * present it flows to the listing automatically on moderator-approve (only when
 * a mod has not already curated one).
 */
export const BLOCK_CATEGORIES = [
  'generation',
  'games',
  'utility',
  'discovery',
  'moderation',
  'analytics',
  'other',
] as const;

export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

/**
 * Max length of the optional manifest `tagline` — the one-line store pitch shown
 * under the app's name on its `/apps` card + detail page. Mirrors
 * `MANIFEST_TAGLINE_MAX_LENGTH` in civitai/civitai's
 * `src/server/services/block-manifest-validator.service.ts` (the authoritative
 * gate) and the `tagline.maxLength` in the canonical schema
 * (https://civitai.com/schemas/app-block/v1.json). Keep all three in lockstep —
 * the schema-parity test asserts this const equals the vendored schema's bound.
 *
 * NOTE: the SERVER measures the TRIMMED length; JSON Schema's `maxLength` counts
 * the raw string. `defineBlock` mirrors the server (trimmed) so an author is
 * never rejected locally for padding the server would ignore.
 */
export const BLOCK_TAGLINE_MAX_LENGTH = 140;
