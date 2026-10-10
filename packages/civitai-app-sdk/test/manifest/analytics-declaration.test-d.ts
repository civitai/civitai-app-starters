/**
 * Compile-time coverage for the manifest's `analytics` (custom events)
 * declaration on `BlockManifestV1`.
 *
 * Written against `defineBlock`'s INLINE-LITERAL form on purpose: that is where
 * an untyped canonical property surfaces as TS2353 ("Object literal may only
 * specify known properties") while Ajv accepts the same manifest from a JSON
 * file — the gap the canonical-derivation ledger exists to close.
 *
 * Compiled by `tsc -p tsconfig.typecheck.json` (the `test:types` script, run by
 * `pnpm test`). Every `@ts-expect-error` below is a gate: if the case STOPS
 * being a type error, the directive is unused and tsc fails. Nothing runs.
 */
import { expectTypeOf } from 'vitest';

import { defineBlock } from '../../src/manifest/index.js';
import type {
  BlockAnalyticsDeclaration,
  BlockAnalyticsEventDeclaration,
  BlockAnalyticsPropertyDeclaration,
  BlockManifestV1,
} from '../../src/manifest/index.js';

const base: Pick<BlockManifestV1, 'blockId' | 'version' | 'name' | 'scopes' | 'contentRating'> = {
  blockId: 'my-block',
  version: '0.1.0',
  name: 'My Block',
  scopes: [],
  contentRating: 'pg',
};

// --- the field is OPTIONAL and typed by the named declaration -----------------
expectTypeOf<BlockManifestV1['analytics']>().toEqualTypeOf<
  BlockAnalyticsDeclaration | undefined
>();
expectTypeOf<BlockAnalyticsDeclaration['events']>().toEqualTypeOf<
  Record<string, BlockAnalyticsEventDeclaration> | undefined
>();
expectTypeOf<BlockAnalyticsPropertyDeclaration['type']>().toEqualTypeOf<
  'enum' | 'number' | 'boolean'
>();

// --- a manifest with no analytics still type-checks (backward compatible) -----
defineBlock({ manifest: { ...base } });

// --- a valid declaration type-checks inline: all three property types ---------
defineBlock({
  manifest: {
    ...base,
    analytics: {
      events: {
        render_started: { description: 'The user pressed Generate.' },
        render_finished: {
          properties: {
            style: { type: 'enum', values: ['anime', 'photo'] },
            seconds: { type: 'number' },
            upscaled: { type: 'boolean' },
          },
        },
      },
    },
  },
});

// --- an empty analytics object and an empty events map are both valid --------
defineBlock({ manifest: { ...base, analytics: {} } });
defineBlock({ manifest: { ...base, analytics: { events: {} } } });

// --- NO free-text string type (gate: this MUST be a type error) ---------------
defineBlock({
  manifest: {
    ...base,
    analytics: {
      events: {
        // @ts-expect-error — `string` is deliberately not a property type
        searched: { properties: { query: { type: 'string' } } },
      },
    },
  },
});

// --- an enum must carry `values` (gate) ---------------------------------------
defineBlock({
  manifest: {
    ...base,
    analytics: {
      // @ts-expect-error — `{ type: 'enum' }` without `values`
      events: { picked: { properties: { style: { type: 'enum' } } } },
    },
  },
});

// --- `values` belongs to an enum only (gate) ----------------------------------
defineBlock({
  manifest: {
    ...base,
    analytics: {
      events: {
        // @ts-expect-error — `values` on a `number` property
        timed: { properties: { seconds: { type: 'number', values: ['1'] } } },
      },
    },
  },
});

// --- unknown keys are rejected at every level (gates) -------------------------
defineBlock({
  manifest: {
    ...base,
    analytics: {
      events: {},
      // @ts-expect-error — unknown key on `analytics`
      sampleRate: 0.5,
    },
  },
});

defineBlock({
  manifest: {
    ...base,
    analytics: {
      events: {
        // @ts-expect-error — unknown key on an event declaration
        clicked: { description: 'd', category: 'ui' },
      },
    },
  },
});

defineBlock({
  manifest: {
    ...base,
    analytics: {
      events: {
        clicked: {
          // @ts-expect-error — unknown key on a property declaration
          properties: { button: { type: 'boolean', label: 'Button' } },
        },
      },
    },
  },
});
