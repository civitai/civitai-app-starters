import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  // App Blocks → Post bridge. SENSITIVE + consent-gated.
  'posts:write:self',
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

/**
 * Pins the sentence `BLOCK_SCOPE_PATTERN`'s JSDoc makes: that the canonical
 * manifest schema validates `scopes` by MEMBERSHIP in a fixed enum which is
 * *exactly* the values in {@link BLOCK_SCOPES}.
 *
 * That JSDoc used to quantify the enum as "the 12 values" while `BLOCK_SCOPES`
 * held 13, fifty lines above it in the same file. The figure is now gone rather
 * than corrected, because a count in prose is unguarded by every check in this
 * repo and this vocabulary has both GAINED and LOST members (`catalog:read`,
 * `media:read:owned` and `block:settings:*` were each declared and then
 * removed). Deleting the number only helps if something else holds the
 * relationship — this is that something.
 *
 * 🔴 IT IS A DIFFERENT CLAIM FROM THE `describe` ABOVE, WHICH CANNOT SUBSTITUTE
 * FOR IT. That one compares `BLOCK_SCOPES` against `CANONICAL_BLOCK_SCOPES`, a
 * literal transcription of the SERVER constant maintained in this same test
 * file — so both halves move together in one edit. This one compares against
 * the VENDORED SCHEMA, a separate artifact re-vendored by
 * `scripts/revendor-canonical-schema.sh` from the deployed
 * `civitai.com/schemas/app-block/v1.json`. The schema is what actually
 * validates a manifest, so a scope present in one and absent from the other is
 * a real defect that the existing test is structurally blind to.
 */
describe('BLOCK_SCOPES ↔ vendored canonical schema enum', () => {
  const SCHEMA_PATH = fileURLToPath(new URL('../../schemas/app-block/v1.json', import.meta.url));

  // readFileSync THROWS on a missing file, deliberately: if the vendored schema
  // is moved or renamed, this must fail rather than silently assert nothing.
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const schemaEnum: string[] = schema.properties.scopes.items.enum;

  it('the schema actually yielded an enum (positive control)', () => {
    // A reassuring "the sets match" is indistinguishable from comparing two
    // empty arrays, which is exactly what a moved JSON path would produce.
    expect(Array.isArray(schemaEnum)).toBe(true);
    expect(schemaEnum.length).toBeGreaterThan(0);
    expect(Object.values(BLOCK_SCOPES).length).toBeGreaterThan(0);
  });

  it('holds exactly the same scope strings — fails if either side grows OR shrinks', () => {
    // Sorted arrays, not Sets: a Set comparison hides duplicates, and the
    // failure output names the offending strings on both sides.
    expect([...schemaEnum].sort()).toEqual([...Object.values(BLOCK_SCOPES)].sort());
  });

  it('the schema enum has no duplicates', () => {
    expect(new Set(schemaEnum).size).toBe(schemaEnum.length);
  });
});
