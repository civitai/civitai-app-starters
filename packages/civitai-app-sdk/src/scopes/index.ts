// TODO(scopes-codegen): Replace this hand-copied file with a build-time
// codegen step that fetches scope metadata from
// `${CIVITAI_BASE_URL}/.well-known/openid-configuration` (and/or a
// scopes-specific endpoint). The discovery endpoint already exposes scope
// values; once Civitai publishes a stable scope-label feed we can drop the
// labels copy too. Until then this file is the source of truth for the SDK
// and must stay in sync with `src/shared/constants/token-scope.constants.ts`
// in the main `civitai/civitai` repo.

/**
 * Token Scope — Bitwise flags for API key and OAuth token permissions.
 *
 * Each scope is a power of 2 so they can be combined with bitwise OR.
 * Use `hasScope(tokenScope, TokenScope.ModelsWrite)` to check.
 *
 * Buzz spending is implicit in the scopes that require it:
 *  - AIServicesWrite (generation, training, scanning)
 *  - BountiesWrite (bounty creation)
 *  - SocialTip (tipping)
 */
export const TokenScope = {
  None: 0,

  // Account & Profile
  UserRead: 1 << 0,
  UserWrite: 1 << 1,

  // Models & Resources
  ModelsRead: 1 << 2,
  ModelsWrite: 1 << 3,
  ModelsDelete: 1 << 4,

  // Media & Posts (images, videos, posts)
  MediaRead: 1 << 5,
  MediaWrite: 1 << 6,
  MediaDelete: 1 << 7,

  // Articles
  ArticlesRead: 1 << 8,
  ArticlesWrite: 1 << 9,
  ArticlesDelete: 1 << 10,

  // Bounties (write implicitly allows buzz spend for bounty creation)
  BountiesRead: 1 << 11,
  BountiesWrite: 1 << 12,
  BountiesDelete: 1 << 13,

  // AI Services — generation, training, scanning, all orchestrator requests
  // Write implicitly allows buzz spend for orchestrator usage
  AIServicesRead: 1 << 14,
  AIServicesWrite: 1 << 15,

  // Buzz (Currency)
  BuzzRead: 1 << 16,

  // Collections & Interactions
  CollectionsRead: 1 << 17,
  CollectionsWrite: 1 << 18,
  SocialWrite: 1 << 19,
  SocialTip: 1 << 20,

  // Notifications
  NotificationsRead: 1 << 21,
  NotificationsWrite: 1 << 22,

  // Vault
  VaultRead: 1 << 23,
  VaultWrite: 1 << 24,

  // All scopes
  Full: (1 << 25) - 1,
} as const;

export type TokenScopeKey = Exclude<keyof typeof TokenScope, 'None' | 'Full'>;
export type TokenScopeValue = (typeof TokenScope)[keyof typeof TokenScope];

export const tokenScopeLabels: Record<number, string> = {
  [TokenScope.UserRead]: 'Read profile, settings & email',
  [TokenScope.UserWrite]: 'Update profile & settings',
  [TokenScope.ModelsRead]: 'Browse & download models',
  [TokenScope.ModelsWrite]: 'Upload & edit models',
  [TokenScope.ModelsDelete]: 'Delete models',
  [TokenScope.MediaRead]: 'View images, videos & posts',
  [TokenScope.MediaWrite]: 'Upload media & create posts',
  [TokenScope.MediaDelete]: 'Delete media & posts',
  [TokenScope.ArticlesRead]: 'Read articles',
  [TokenScope.ArticlesWrite]: 'Create & edit articles',
  [TokenScope.ArticlesDelete]: 'Delete articles',
  [TokenScope.BountiesRead]: 'View bounties',
  [TokenScope.BountiesWrite]: 'Create & manage bounties',
  [TokenScope.BountiesDelete]: 'Delete bounties',
  [TokenScope.AIServicesRead]: 'View generation & training history',
  [TokenScope.AIServicesWrite]: 'Generate, train & scan',
  [TokenScope.BuzzRead]: 'View buzz balance & history',
  [TokenScope.CollectionsRead]: 'View collections',
  [TokenScope.CollectionsWrite]: 'Manage collections',
  [TokenScope.SocialWrite]: 'Follow, react, comment & review',
  [TokenScope.SocialTip]: 'Tip other users',
  [TokenScope.NotificationsRead]: 'Read notifications',
  [TokenScope.NotificationsWrite]: 'Manage notification preferences',
  [TokenScope.VaultRead]: 'View vault',
  [TokenScope.VaultWrite]: 'Manage vault',
};

export const TokenScopePresets = {
  ReadOnly:
    TokenScope.UserRead |
    TokenScope.ModelsRead |
    TokenScope.MediaRead |
    TokenScope.ArticlesRead |
    TokenScope.BountiesRead |
    TokenScope.BuzzRead |
    TokenScope.CollectionsRead |
    TokenScope.AIServicesRead |
    TokenScope.NotificationsRead |
    TokenScope.VaultRead,
  Creator:
    TokenScope.UserRead |
    TokenScope.ModelsRead |
    TokenScope.MediaRead |
    TokenScope.ArticlesRead |
    TokenScope.BountiesRead |
    TokenScope.BuzzRead |
    TokenScope.CollectionsRead |
    TokenScope.AIServicesRead |
    TokenScope.NotificationsRead |
    TokenScope.VaultRead |
    TokenScope.ModelsWrite |
    TokenScope.MediaWrite |
    TokenScope.ArticlesWrite |
    TokenScope.BountiesWrite |
    TokenScope.CollectionsWrite |
    TokenScope.SocialWrite,
  AIServices:
    TokenScope.UserRead |
    TokenScope.AIServicesWrite |
    TokenScope.AIServicesRead |
    TokenScope.BuzzRead,
  Full: TokenScope.Full,
} as const;

export type TokenScopePresetKey = keyof typeof TokenScopePresets;

/**
 * True if the given bitmask grants the named scope.
 *
 * @example
 * if (hasScope(token.scope, TokenScope.AIServicesWrite)) allowGeneration();
 */
export function hasScope(bitmask: number, scope: number): boolean {
  return (bitmask & scope) === scope;
}

/**
 * Return the list of named scopes contained in a bitmask (excludes the
 * `None`/`Full` aggregates). The inverse of {@link bitmaskFromScopes}.
 *
 * @example
 * scopesFromBitmask(token.scope); // e.g. ['UserRead', 'AIServicesWrite', 'BuzzRead']
 */
export function scopesFromBitmask(bitmask: number): TokenScopeKey[] {
  const out: TokenScopeKey[] = [];
  for (const [name, bit] of Object.entries(TokenScope)) {
    if (name === 'None' || name === 'Full') continue;
    if (typeof bit === 'number' && bit !== 0 && (bitmask & bit) === bit) {
      out.push(name as TokenScopeKey);
    }
  }
  return out;
}

/**
 * Combine a list of named scopes into a single bitmask — use this to build the
 * `scope` you pass to {@link buildAuthorizeUrl} instead of a magic number.
 *
 * @example
 * const scope = bitmaskFromScopes(['AIServicesWrite', 'BuzzRead', 'UserRead']);
 */
export function bitmaskFromScopes(scopes: readonly TokenScopeKey[]): number {
  let mask = 0;
  for (const s of scopes) mask |= TokenScope[s];
  return mask;
}

/**
 * Human-readable label for a tokenScope bitmask (matches the Civitai UI).
 * Returns a preset name (`Full Access`/`Read Only`/`Creator`/`AI Services`),
 * `Legacy` for `null`/`undefined`, or `Custom` for any other combination.
 *
 * @example
 * getScopeLabel(token.scope); // 'AI Services' | 'Custom' | …
 */
export function getScopeLabel(tokenScope: number | null | undefined): string {
  if (tokenScope == null) return 'Legacy';
  if (tokenScope === TokenScope.Full) return 'Full Access';
  if (tokenScope === TokenScopePresets.ReadOnly) return 'Read Only';
  if (tokenScope === TokenScopePresets.Creator) return 'Creator';
  if (tokenScope === TokenScopePresets.AIServices) return 'AI Services';
  return 'Custom';
}
