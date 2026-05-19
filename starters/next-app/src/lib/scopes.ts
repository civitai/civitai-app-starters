import { bitmaskFromScopes } from '@civitai/app-sdk/scopes';

/**
 * Scopes this app requests at OAuth consent. Keep narrow — users are more
 * likely to approve a small ask. Bump as you add features.
 *
 *   UserRead         — needed for /me (username, balance)
 *   BuzzRead         — needed to read Buzz balance
 *   AIServicesRead   — needed to list past generations
 *   AIServicesWrite  — needed to submit a new generation (spends user's Buzz)
 */
export const REQUESTED_SCOPES = bitmaskFromScopes([
  'UserRead',
  'BuzzRead',
  'AIServicesRead',
  'AIServicesWrite',
]);
