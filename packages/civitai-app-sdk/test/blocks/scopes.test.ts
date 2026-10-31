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
  // Document store (manifest `storage`). `apps:storage` is the one 2-segment
  // scope; `apps:storage:publish` is SENSITIVE + consent-gated.
  'apps:storage',
  'apps:storage:publish',
  // App Blocks Collections surface scopes.
  'collections:read:self',
  'collections:write:self',
  'collections:read:private',
  // App Blocks → Post bridge. SENSITIVE + consent-gated.
  'posts:write:self',
  // Digital goods. `goods:read:self` is consent-EXEMPT (server-scoped to the
  // calling app's own sales); `goods:purchase:self` is consent-GATED.
  'goods:read:self',
  'goods:purchase:self',
  // App Store sub-listings (civitai/civitai#5511). SENSITIVE + consent-EXEMPT
  // server-side (gated per call); 4-segment.
  'apps:store:items:write',
  // App reactions (civitai/civitai#6144). SENSITIVE + consent-GATED.
  'social:react:self',
] as const;

describe('BLOCK_SCOPES', () => {
  it('exposes exactly the canonical server block-scope set', () => {
    expect(new Set(Object.values(BLOCK_SCOPES))).toEqual(new Set(CANONICAL_BLOCK_SCOPES));
  });

  it('includes the digital-goods scopes, which the canonical schema has carried since #5171', () => {
    // These were live on the server and in the canonical schema while ABSENT
    // here, so `defineBlock` rejected both and no app scaffolded from this repo
    // could declare them — the blocks-react hooks that call the goods endpoints
    // were unreachable. Named rather than left to the set-equality above so the
    // reason survives.
    expect(BLOCK_SCOPES.GOODS_READ_SELF).toBe('goods:read:self');
    expect(BLOCK_SCOPES.GOODS_PURCHASE_SELF).toBe('goods:purchase:self');
  });

  it('includes the W4 apps:storage:* datastore scopes', () => {
    expect(BLOCK_SCOPES.APPS_STORAGE_READ).toBe('apps:storage:read');
    expect(BLOCK_SCOPES.APPS_STORAGE_WRITE).toBe('apps:storage:write');
  });

  it('includes the 4-segment SHARED apps:storage:shared:* datastore scopes', () => {
    expect(BLOCK_SCOPES.APPS_STORAGE_SHARED_READ).toBe('apps:storage:shared:read');
    expect(BLOCK_SCOPES.APPS_STORAGE_SHARED_WRITE).toBe('apps:storage:shared:write');
  });

  it('includes the 4-segment App Store sub-listing scope apps:store:items:write', () => {
    expect(BLOCK_SCOPES.APPS_STORE_ITEMS_WRITE).toBe('apps:store:items:write');
  });

  it('includes the document-store scopes apps:storage and apps:storage:publish', () => {
    expect(BLOCK_SCOPES.APPS_STORAGE).toBe('apps:storage');
    expect(BLOCK_SCOPES.APPS_STORAGE_PUBLISH).toBe('apps:storage:publish');
  });

  it('BLOCK_SCOPE_PATTERN accepts 2 to 4 segments and nothing outside that', () => {
    expect('apps:storage').toMatch(BLOCK_SCOPE_PATTERN);
    expect('apps:storage:shared:write').toMatch(BLOCK_SCOPE_PATTERN);
    expect('apps').not.toMatch(BLOCK_SCOPE_PATTERN);
    expect('a:b:c:d:e').not.toMatch(BLOCK_SCOPE_PATTERN);
    expect('ModelsReadSelf').not.toMatch(BLOCK_SCOPE_PATTERN);
  });

  it('every value matches BLOCK_SCOPE_PATTERN (2, 3 or 4 colon segments)', () => {
    for (const scope of Object.values(BLOCK_SCOPES)) {
      expect(scope, scope).toMatch(BLOCK_SCOPE_PATTERN);
    }
  });
});
