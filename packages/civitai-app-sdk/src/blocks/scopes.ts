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
  MEDIA_READ_OWNED: 'media:read:owned',
  USER_READ_SELF: 'user:read:self',
  AI_WRITE_BUDGETED: 'ai:write:budgeted',
  BUZZ_READ_SELF: 'buzz:read:self',
  BLOCK_SETTINGS_READ: 'block:settings:read',
  BLOCK_SETTINGS_WRITE: 'block:settings:write',
  SOCIAL_TIP_SELF: 'social:tip:self',
  // apps:storage:* — the per-app KV datastore (W4). These have no OAuth bit
  // (storage never touches the user's civitai resources); the server gates them
  // by presence in the block's approved scope set, not a bitmask.
  APPS_STORAGE_READ: 'apps:storage:read',
  APPS_STORAGE_WRITE: 'apps:storage:write',
} as const;

export type BlockScopeKey = keyof typeof BLOCK_SCOPES;
export type BlockScope = (typeof BLOCK_SCOPES)[BlockScopeKey];

/**
 * Format helper for the `domain:verb:target` block-scope shape.
 *
 * NOTE: this regex is **not** the authoritative validity contract. The
 * canonical manifest schema (https://civitai.com/schemas/app-block/v1.json)
 * validates `scopes` by MEMBERSHIP in a fixed enum — i.e. the 10 values in
 * {@link BLOCK_SCOPES}. `defineBlock` therefore gates on membership in
 * `BLOCK_SCOPES`; this pattern is kept only to give a pointed error message
 * (e.g. distinguishing a malformed/PascalCase scope from a well-formed but
 * unknown one). A scope can match this pattern and still be rejected for not
 * being a known block scope.
 *
 * The 3-segment shape (`domain:verb:target`) is **intentional**: scope
 * comparisons in token validation rely on it. Relaxing this (e.g. to allow
 * 4+ segments like `ai:write:image:budgeted`) requires a coordinated change
 * across the SDK, the canonical JSON schema, the civitai/civitai token
 * validator, and a `@civitai/app-sdk` major bump.
 */
export const BLOCK_SCOPE_PATTERN = /^[a-z]+:[a-z]+:[a-z]+$/;
