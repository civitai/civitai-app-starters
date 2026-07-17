import { describe, expect, it } from 'vitest';

import { BLOCK_SCOPES, BLOCK_SCOPE_PATTERN } from '../../src/blocks/scopes.js';

/**
 * Guards the BLOCK_SCOPES convenience map against drift from the server's
 * authoritative block-scope set (civitai/civitai →
 * src/shared/constants/block-scope.constants.ts, `BLOCK_SCOPE_TO_OAUTH_BIT`).
 *
 * This list is intentionally duplicated here: the SDK can't import the server
 * constant, so if a scope is added/removed server-side, update both this test
 * and BLOCK_SCOPES. (`catalog:read` is intentionally NOT a scope — see the
 * server constant's note.)
 */
const CANONICAL_BLOCK_SCOPES = [
  'models:read:self',
  'user:read:self',
  'ai:write:budgeted',
  'buzz:read:self',
  'social:tip:self',
  'apps:storage:read',
  'apps:storage:write',
  // 4-segment SHARED (cross-user) datastore scopes.
  'apps:storage:shared:read',
  'apps:storage:shared:write',
  // App Blocks Collections surface scopes.
  'collections:read:self',
  'collections:write:self',
  'collections:read:private',
] as const;

describe('BLOCK_SCOPES', () => {
  it('exposes exactly the canonical server block-scope set', () => {
    expect(new Set(Object.values(BLOCK_SCOPES))).toEqual(new Set(CANONICAL_BLOCK_SCOPES));
  });

  it('includes the W4 apps:storage:* datastore scopes', () => {
    expect(BLOCK_SCOPES.APPS_STORAGE_READ).toBe('apps:storage:read');
    expect(BLOCK_SCOPES.APPS_STORAGE_WRITE).toBe('apps:storage:write');
  });

  it('includes the 4-segment SHARED apps:storage:shared:* datastore scopes', () => {
    expect(BLOCK_SCOPES.APPS_STORAGE_SHARED_READ).toBe('apps:storage:shared:read');
    expect(BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE).toBe('apps:storage:shared:write');
  });

  it('every value matches BLOCK_SCOPE_PATTERN (3 or 4 colon segments)', () => {
    for (const scope of Object.values(BLOCK_SCOPES)) {
      expect(scope, scope).toMatch(BLOCK_SCOPE_PATTERN);
    }
  });
});
