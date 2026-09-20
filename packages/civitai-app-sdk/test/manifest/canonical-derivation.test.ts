/**
 * `defineBlock` is DERIVED from the canonical schema. This suite is the part of
 * that claim a reader can check.
 *
 * WHAT EACH BLOCK BELOW IS WORTH, stated so nobody reads more into it:
 *   - HARNESS CONTROLS. Until both have been watched to work, every result here
 *     is a fact about the harness. The negative control shows `defineBlock` CAN
 *     say no; the positive control shows the Ajv oracle CAN say yes. A suite
 *     whose oracle rejects everything would pass the divergence ledger vacuously.
 *   - THE #330 CLOSING CONDITION. Every shipped `block.manifest.json` is
 *     accepted. This is the assertion the issue names; it fails on all seven at
 *     `9a060f3`.
 *   - NOT-ABOVE-THE-CANONICAL. The regression body. Each fixture is one rule the
 *     PREVIOUS implementation hand-wrote above the canonical; the canonical
 *     accepts it, so `defineBlock` must. These are the cases that go red on the
 *     previous commit.
 *   - DERIVED-NOT-MIRRORED. Rules nobody wrote down here at all, enforced only
 *     because Ajv reads them out of the vendored schema. If the implementation
 *     ever stops compiling the schema, these die.
 *   - INVARIANT GUARDS, labelled. Green before the change as well as after — NOT
 *     regression coverage, and not counted as any.
 */
import { describe, expect, it } from 'vitest';

import { defineBlock, loadCanonicalSchema } from '../../src/manifest/defineBlock.js';
import { BlockManifestError } from '../../src/blocks/manifestError.js';
import { BLOCK_TAGLINE_MAX_LENGTH } from '../../src/blocks/scopes.js';
import type { BlockManifest } from '../../src/blocks/types.js';
import { canonicalAccepts, shippedManifests, valid, without } from './fixtures.js';

const accept = (manifest: Record<string, unknown>) =>
  defineBlock({ manifest: manifest as unknown as BlockManifest });

function rejection(manifest: Record<string, unknown>): BlockManifestError {
  try {
    accept(manifest);
  } catch (err) {
    if (err instanceof BlockManifestError) return err;
    throw err;
  }
  throw new Error('expected defineBlock to throw, it did not');
}

describe('harness controls', () => {
  it('NEGATIVE CONTROL: defineBlock can say no (a canonical rule, not a divergence)', () => {
    // `blockId` pattern lives ONLY in the schema — nothing below hand-writes it.
    const err = rejection(valid({ blockId: 'X' }));
    expect(err.field).toBe('blockId');
  });

  it('POSITIVE CONTROL: the Ajv oracle can say yes (a zero here makes the ledger vacuous)', () => {
    expect(canonicalAccepts(valid())).toBe(true);
  });

  it('POSITIVE CONTROL: the Ajv oracle can say no', () => {
    expect(canonicalAccepts(valid({ contentRating: 'nc17' }))).not.toBe(true);
  });
});

describe('#330 closing condition: every shipped block.manifest.json is accepted', () => {
  const shipped = shippedManifests();

  it('found the shipped manifests at all (INVARIANT GUARD — green before this change too)', () => {
    expect(shipped.length).toBeGreaterThanOrEqual(7);
  });

  it.each(shipped.map((m) => [m.label, m] as const))('%s', (_label, { manifest }) => {
    expect(() => defineBlock({ manifest })).not.toThrow();
  });

  it.each(shipped.map((m) => [m.label, m] as const))(
    '%s is accepted by the canonical schema itself',
    (_label, { manifest }) => {
      expect(canonicalAccepts(manifest)).toBe(true);
    },
  );
});

/**
 * Each case: the canonical ACCEPTS it, therefore `defineBlock` must. Every one
 * of them is a rule the previous implementation hand-wrote above the canonical,
 * and every one is red at `9a060f3`.
 */
describe('NOT ABOVE THE CANONICAL: rules the previous implementation invented', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    // -- deleted in this change -------------------------------------------
    [
      '$schema pointing at a vendored copy (canonical: "ignored by the platform validator")',
      valid({ $schema: './node_modules/@civitai/app-sdk/schemas/app-block/v1.json' }),
    ],
    ['$schema pointing at a v2 preview', valid({ $schema: 'https://civitai.com/schemas/app-block/v2.json' })],
    ['appId absent', without(['appId'])],
    ['appId as a number (not a canonical property at all)', valid({ appId: 137 })],
    ['assets present (not a canonical property; the server ignores it)', valid({ assets: [{ url: 'x' }] })],
    ['targets[].priority non-integer (not a canonical property)', valid({ targets: [{ slotId: 's', priority: 1.5 }] })],
    // -- already relaxed by the previous commit; pinned so they stay relaxed
    ["type: 'embed' is still refused, but type may be omitted", without(['type'])],
    ['targets omitted (canonical: "Optional for page-only apps")', without(['targets'])],
    ['iframe omitted (canonical declares no required sub-fields on it)', without(['iframe'])],
    ['iframe with only sandbox', valid({ iframe: { sandbox: 'allow-scripts' } })],
    ['iframe.maxHeight null', valid({ iframe: { minHeight: 137, maxHeight: null } })],
    ['minApiVersion omitted', without(['minApiVersion'])],
    ['a 137-character name (the canonical caps nothing)', valid({ name: 'x'.repeat(137) })],
    ['an empty scopes array (the canonical sets no minItems)', valid({ scopes: [] })],
  ];

  it.each(cases)('%s', (_label, manifest) => {
    // If this line fails, the fixture is wrong, not the implementation.
    expect(canonicalAccepts(manifest), 'fixture must be canonical-VALID').toBe(true);
    expect(() => accept(manifest)).not.toThrow();
  });
});

/**
 * Rules that exist here ONLY because Ajv reads them out of the vendored schema.
 * Nothing in `src/manifest/defineBlock.ts` names any of these fields. Delete the
 * Ajv compile and every case below goes green-when-it-should-be-red.
 */
describe('DERIVED, NOT MIRRORED: canonical rules no line of this package writes down', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['blockId pattern', valid({ blockId: 'Not-A-DNS-Label' }), 'blockId'],
    ['blockId minLength', valid({ blockId: 'ab' }), 'blockId'],
    ['version pattern', valid({ version: 'v1' }), 'version'],
    ['contentRating enum', valid({ contentRating: 'nc17' }), 'contentRating'],
    ["type enum is ['block'] — 'embed' is NOT a member", valid({ type: 'embed' }), 'type'],
    ['scopes enum', valid({ scopes: ['not:a:scope'] }), 'scopes[0]'],
    ['targets maxItems', valid({ targets: Array.from({ length: 17 }, () => ({ slotId: 's' })) }), 'targets'],
    ['targets[].slotId required', valid({ targets: [{ priority: 1 }] }), 'targets[0].slotId'],
    ['iframe.minHeight floor', valid({ iframe: { minHeight: 39 } }), 'iframe.minHeight'],
    ['iframe.maxHeight ceiling', valid({ iframe: { maxHeight: 4137 } }), 'iframe.maxHeight'],
    ['iframe additionalProperties:false', valid({ iframe: { minHeight: 137, bogus: 1 } }), 'iframe.bogus'],
    ['minApiVersion pattern', valid({ minApiVersion: '1.0-beta' }), 'minApiVersion'],
    ['renderMode enum', valid({ renderMode: 'canvas' }), 'renderMode'],
    ['bootSkeleton type', valid({ bootSkeleton: 'yes' }), 'bootSkeleton'],
    ['category enum', valid({ category: 'miscellaneous' }), 'category'],
    ['tagline maxLength (RAW, per the canonical)', valid({ tagline: 'x'.repeat(141) }), 'tagline'],
    ['repository pattern', valid({ repository: 'git@github.com:owner/repo.git' }), 'repository'],
    ['buildCommand allowlist', valid({ buildCommand: 'rm -rf /', outputDir: 'dist' }), 'buildCommand'],
    ['allOf: outputDir required with buildCommand', valid({ buildCommand: 'vite build' }), 'outputDir'],
    ['outputDir traversal', valid({ buildCommand: 'vite build', outputDir: '../../etc' }), 'outputDir'],
    ['publicSettingsKeys maxItems', valid({ publicSettingsKeys: Array.from({ length: 33 }, (_, i) => `k${i}`) }), 'publicSettingsKeys'],
    ['assetBundleUrl pattern', valid({ assetBundleUrl: 'http://cdn.example.com/b.zip' }), 'assetBundleUrl'],
    ['page.path required', valid({ page: { title: 'T' } }), 'page.path'],
    ['page additionalProperties:false', valid({ page: { path: '/x', title: 'T', bogus: 1 } }), 'page.bogus'],
    ['scopeJustifications value maxLength', valid({ scopeJustifications: { 'models:read:self': 'x'.repeat(501) } }), 'scopeJustifications.models:read:self'],
  ];

  it.each(cases)('%s', (_label, manifest, field) => {
    expect(canonicalAccepts(manifest), 'fixture must be canonical-INVALID').not.toBe(true);
    expect(rejection(manifest).field).toBe(field);
  });

  it('the PascalCase scope hint fires on the scope case, not a neighbour', () => {
    const err = rejection(valid({ scopes: ['ModelsReadSelf'] }));
    expect(err.field).toBe('scopes[0]');
    expect(err.message).toContain('colon-separated lowercase');
  });
});

describe('lockstep with the vendored schema (INVARIANT GUARDS — green before this change too)', () => {
  const schema = loadCanonicalSchema() as {
    required: string[];
    properties: Record<string, { maxLength?: number }>;
  };

  it('BLOCK_TAGLINE_MAX_LENGTH equals the canonical tagline bound', () => {
    expect(BLOCK_TAGLINE_MAX_LENGTH).toBe(schema.properties.tagline?.maxLength);
  });

  it('the canonical requires exactly five fields', () => {
    expect([...schema.required].sort()).toEqual(
      ['blockId', 'contentRating', 'name', 'scopes', 'version'].sort(),
    );
  });
});
