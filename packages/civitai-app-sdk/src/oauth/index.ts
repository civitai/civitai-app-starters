/**
 * `@civitai/app-sdk/oauth` — the Civitai OAuth flow (Authorization Code +
 * PKCE S256) as stateless functions you call from your own server handlers.
 *
 * 🔴 `../types.js` IS RE-EXPORTED HERE ON PURPOSE (#377). `OAuthTokens`,
 * `OAuthTokenResponse` and `OAuthClientConfig` used to be reachable from the
 * ROOT barrel only, because `src/index.ts` re-exported `types.ts` directly and
 * no subpath did. Three consequences, all bad and none obvious:
 *
 *  - `exchangeCode` and `refreshToken` live on THIS subpath and RETURN
 *    `OAuthTokens`, so a consumer who imported them from `@civitai/app-sdk/oauth`
 *    could not name their own return type without reaching back to the root;
 *  - they were the only 3 of the root's 68 symbols not mirrored by a subpath,
 *    which made the root/subpath relationship unstateable, and so unguarded;
 *  - the fix has to be ADDITIVE. Removing a published export costs a major
 *    under semver, and this package is pre-1.0 where a minor breaks too. So the
 *    root keeps every symbol it had — it now reaches these three THROUGH this
 *    barrel instead of directly, which is the same root surface, byte for byte.
 *
 * `test/export-surface.test.ts` pins the result: the root is EXACTLY the union
 * of the four aggregated subpaths, asserted in both directions.
 */
export type * from '../types.js';

export * from './pkce.js';
export * from './authorize.js';
export * from './token.js';
