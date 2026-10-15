/**
 * Compile-time coverage for the manifest's `storage` (document-store
 * collections) declaration on `BlockManifestV1`.
 *
 * Written against `defineBlock`'s INLINE-LITERAL form on purpose, as
 * `analytics-declaration.test-d.ts` is: that is where an untyped canonical
 * property surfaces as TS2353 while Ajv accepts the same manifest from a JSON
 * file.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (the `test:types` script, run by
 * `pnpm test`). Every `@ts-expect-error` below is a gate: if the case STOPS
 * being a type error, the directive is unused and tsc fails. Nothing runs.
 */
import { expectTypeOf } from 'vitest';

import { defineBlock } from '../../src/manifest/index.js';
import type {
  BlockManifestV1,
  BlockStorageCollectionDeclaration,
  BlockStorageDeclaration,
  BlockStorageIndexType,
  BlockStorageSharedCollectionDeclaration,
} from '../../src/manifest/index.js';
import { BLOCK_SCOPES } from '../../src/blocks/index.js';

const base: Pick<BlockManifestV1, 'blockId' | 'version' | 'name' | 'scopes' | 'contentRating'> = {
  blockId: 'my-block',
  version: '0.1.0',
  name: 'My Block',
  scopes: [],
  contentRating: 'pg',
};

// --- the field is OPTIONAL and typed by the named declaration -----------------
expectTypeOf<BlockManifestV1['storage']>().toEqualTypeOf<BlockStorageDeclaration | undefined>();
expectTypeOf<BlockStorageDeclaration['collections']>().toEqualTypeOf<
  Record<string, BlockStorageCollectionDeclaration>
>();
expectTypeOf<BlockStorageCollectionDeclaration['visibility']>().toEqualTypeOf<'private' | 'shared'>();
expectTypeOf<BlockStorageSharedCollectionDeclaration['write']>().toEqualTypeOf<
  'own' | 'anyone' | 'owner' | 'none'
>();
expectTypeOf<BlockStorageIndexType>().toEqualTypeOf<'string' | 'number' | 'boolean' | 'time'>();

// --- the document-store scopes are named constants -----------------------------
expectTypeOf(BLOCK_SCOPES.APPS_STORAGE).toEqualTypeOf<'apps:storage'>();
expectTypeOf(BLOCK_SCOPES.APPS_STORAGE_PUBLISH).toEqualTypeOf<'apps:storage:publish'>();

// --- a manifest with no storage still type-checks (backward compatible) -------
defineBlock({ manifest: { ...base } });

// --- valid declarations type-check inline: private, shared own, shared none ---
defineBlock({
  manifest: {
    ...base,
    scopes: [BLOCK_SCOPES.APPS_STORAGE, BLOCK_SCOPES.APPS_STORAGE_PUBLISH],
    scopeJustifications: { [BLOCK_SCOPES.APPS_STORAGE_PUBLISH]: 'Viewers post entries to a shared board.' },
    storage: {
      collections: {
        notes: { visibility: 'private', indexes: { status: 'string', 'meta.round': 'number' } },
        posts: {
          kind: 'docs',
          visibility: 'shared',
          write: 'own',
          counters: ['plays'],
          marks: ['vote'],
          showAuthor: true,
          indexes: { createdBy: 'string', score: 'number', pinned: 'boolean', due: 'time' },
        },
        tally: { visibility: 'shared', write: 'none', counters: ['views'] },
      },
    },
  },
});

// --- `collections` is REQUIRED on storage (gate) ------------------------------
// @ts-expect-error — `storage` without `collections`
defineBlock({ manifest: { ...base, storage: {} } });

// --- a shared collection must declare `write` (gate) --------------------------
defineBlock({
  manifest: {
    ...base,
    storage: {
      // @ts-expect-error — `visibility: 'shared'` without `write`
      collections: { posts: { visibility: 'shared' } },
    },
  },
});

// --- a private collection carries no shared-only field (gates) ----------------
defineBlock({
  manifest: {
    ...base,
    storage: {
      collections: {
        // @ts-expect-error — `write` on a private collection
        notes: { visibility: 'private', write: 'own' },
      },
    },
  },
});

defineBlock({
  manifest: {
    ...base,
    storage: {
      collections: {
        // @ts-expect-error — `marks` on a private collection
        notes: { visibility: 'private', marks: ['vote'] },
      },
    },
  },
});

// --- closed enums (gates) -----------------------------------------------------
defineBlock({
  manifest: {
    ...base,
    storage: {
      collections: {
        // @ts-expect-error — `public` is not a visibility
        notes: { visibility: 'public' },
      },
    },
  },
});

defineBlock({
  manifest: {
    ...base,
    storage: {
      collections: {
        // @ts-expect-error — `everyone` is not a write policy
        posts: { visibility: 'shared', write: 'everyone' },
      },
    },
  },
});

defineBlock({
  manifest: {
    ...base,
    storage: {
      collections: {
        notes: {
          visibility: 'private',
          // @ts-expect-error — `text` is not an index type
          indexes: { status: 'text' },
        },
      },
    },
  },
});

// --- the built-in sort keys cannot be index names (gate) ----------------------
defineBlock({
  manifest: {
    ...base,
    storage: {
      collections: {
        notes: {
          visibility: 'private',
          // @ts-expect-error — `createdAt` is a built-in sort key
          indexes: { createdAt: 'time' },
        },
      },
    },
  },
});

// --- unknown keys are rejected at every level (gates) -------------------------
defineBlock({
  manifest: {
    ...base,
    storage: {
      collections: { notes: { visibility: 'private' } },
      // @ts-expect-error — unknown key on `storage`
      quota: 1,
    },
  },
});

defineBlock({
  manifest: {
    ...base,
    storage: {
      collections: {
        // @ts-expect-error — unknown key on a collection
        notes: { visibility: 'private', retention: 30 },
      },
    },
  },
});
