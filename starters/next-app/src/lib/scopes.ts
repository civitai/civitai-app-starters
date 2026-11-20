import { bitmaskFromScopes } from '@civitai/app-sdk/scopes';

/**
 * Scopes this app requests at OAuth consent. Keep narrow — users are more
 * likely to approve a small ask. Bump as you add features.
 *
 *   UserRead         — needed for /api/v1/me (username, tier, email). 🔴 NOT the
 *                      balance — that endpoint has never returned one.
 *   BuzzRead         — needed to read the Buzz balance (buzz.getUserAccount).
 *                      Optional at consent: without it the app hides the
 *                      balance row rather than failing.
 *   AIServicesRead   — needed to list past generations
 *   AIServicesWrite  — needed to submit a new generation (spends user's Buzz)
 */
export const REQUESTED_SCOPES = bitmaskFromScopes([
  'UserRead',
  'BuzzRead',
  'AIServicesRead',
  'AIServicesWrite',
]);
