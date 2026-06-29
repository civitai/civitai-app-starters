/**
 * Documents the invariants the canonical JSON schema and `defineBlock` agree on.
 *
 * The vendored schema (`schemas/app-block/v1.json`) is a byte-identical copy of
 * the server-published canonical at https://civitai.com/schemas/app-block/v1.json
 * (enforced by the drift-check CI job / scripts/check-canonical-schema.sh). For
 * each shared rule we read the value out of that schema and assert `defineBlock`
 * agrees — so the runtime client check can't silently diverge from the canonical
 * contract a block author will be validated against at submit time.
 *
 * NOTE: this is not a true bidirectional parity check (we don't run an
 * AJV validator against the manifests). Adding ajv is a follow-up if we want
 * full structural coverage.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defineBlock } from '../../src/blocks/defineBlock.js';
import { BLOCK_SCOPES } from '../../src/blocks/scopes.js';
import type { BlockManifest } from '../../src/blocks/types.js';

const SCHEMA_PATH = join(__dirname, '../../schemas/app-block/v1.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>;

function valid(overrides: Partial<BlockManifest> = {}): BlockManifest {
  return {
    $schema: 'https://civitai.com/schemas/app-block/v1.json',
    appId: 'app_test',
    blockId: 'my-block',
    version: '0.1.0',
    name: 'My Block',
    type: 'block',
    targets: [{ slotId: 'model.sidebar_top', priority: 100 }],
    scopes: ['models:read:self'],
    iframe: {
      src: 'https://blocks.example.com/my-block',
      minHeight: 200,
      maxHeight: 600,
      resizable: true,
      sandbox: 'allow-scripts allow-forms',
    },
    contentRating: 'pg',
    minApiVersion: '1.0',
    ...overrides,
  };
}

describe('canonical JSON schema ↔ defineBlock parity', () => {
  it('shares the canonical blockId pattern + length bounds (3-40, DNS-safe)', () => {
    const blockId = (schema.properties as Record<string, {
      pattern?: string;
      minLength?: number;
      maxLength?: number;
    }>).blockId;
    expect(blockId?.pattern).toBe('^[a-z][a-z0-9-]*[a-z0-9]$');
    expect(blockId?.minLength).toBe(3);
    expect(blockId?.maxLength).toBe(40);
    // Uppercase rejected by the pattern.
    expect(() => defineBlock({ manifest: valid({ blockId: 'BadId' }) })).toThrow();
    // Must start with a letter (canonical pattern), not a digit/hyphen.
    expect(() => defineBlock({ manifest: valid({ blockId: '1block' }) })).toThrow();
    expect(() => defineBlock({ manifest: valid({ blockId: '-block' }) })).toThrow();
    // Length bounds: 2 chars too short, 41 too long.
    expect(() => defineBlock({ manifest: valid({ blockId: 'ab' }) })).toThrow();
    expect(() => defineBlock({ manifest: valid({ blockId: 'a' + 'b'.repeat(40) }) })).toThrow();
    // 64-char id was legal under the old SDK rule; canonical caps at 40.
    expect(() => defineBlock({ manifest: valid({ blockId: 'a' + 'b'.repeat(63) }) })).toThrow();
    // A 40-char DNS-safe id is accepted.
    expect(() => defineBlock({ manifest: valid({ blockId: 'a' + 'b'.repeat(39) }) })).not.toThrow();
  });

  it('scopes is validated by enum membership (not just a pattern)', () => {
    const scopeItems = (schema.properties as Record<string, { items?: {
      pattern?: string;
      enum?: string[];
    } }>).scopes?.items;
    // Canonical validates by an enum, not a regex pattern.
    expect(scopeItems?.pattern).toBeUndefined();
    expect(Array.isArray(scopeItems?.enum)).toBe(true);
    // The enum contains the 10 known block scopes, exactly.
    expect(new Set(scopeItems?.enum)).toEqual(new Set(Object.values(BLOCK_SCOPES)));
    // Every known scope is accepted by defineBlock...
    for (const scope of Object.values(BLOCK_SCOPES)) {
      expect(() => defineBlock({ manifest: valid({ scopes: [scope] }) }), scope).not.toThrow();
    }
    // ...but a well-formed yet UNKNOWN scope (not in the enum) is rejected by
    // membership, even though it matches the colon-segment shape.
    expect(() => defineBlock({ manifest: valid({ scopes: ['models:read:all'] }) })).toThrow();
    // Malformed scopes are still rejected.
    expect(() => defineBlock({ manifest: valid({ scopes: ['ModelsReadSelf'] }) })).toThrow();
    expect(() => defineBlock({ manifest: valid({ scopes: ['models:read'] }) })).toThrow();
  });

  it('shares the contentRating enum', () => {
    const enumVals = (schema.properties as Record<string, { enum?: string[] }>).contentRating?.enum;
    expect(enumVals).toEqual(['g', 'pg', 'pg13', 'r', 'x']);
    expect(() =>
      defineBlock({
        manifest: valid({
          contentRating: 'mature' as unknown as BlockManifest['contentRating'],
        }),
      }),
    ).toThrow();
  });

  it('shares the canonical manifest.type enum (block only)', () => {
    const enumVals = (schema.properties as Record<string, { enum?: string[] }>).type?.enum;
    expect(enumVals).toEqual(['block']);
    expect(() =>
      defineBlock({
        manifest: valid({ type: 'widget' as unknown as BlockManifest['type'] }),
      }),
    ).toThrow();
  });

  it.each([
    'allow-same-origin',
    'allow-top-navigation',
    'allow-top-navigation-by-user-activation',
    'allow-top-navigation-to-custom-protocols',
  ])('defineBlock rejects sandbox token %s', (token) => {
    expect(() =>
      defineBlock({
        manifest: valid({
          iframe: { ...valid().iframe, sandbox: `allow-scripts ${token}` },
        }),
      }),
    ).toThrow();
  });

  it('shares the iframe.minHeight integer constraint (canonical bounds 40-4000)', () => {
    const minHeightSchema = (
      ((schema.properties as Record<string, { properties?: Record<string, {
        type?: string;
        minimum?: number;
        maximum?: number;
      }> }>)
        .iframe?.properties) ?? {}
    ).minHeight;
    expect(minHeightSchema?.type).toBe('integer');
    expect(minHeightSchema?.minimum).toBe(40);
    expect(minHeightSchema?.maximum).toBe(4000);
    expect(() =>
      defineBlock({
        manifest: valid({ iframe: { ...valid().iframe, minHeight: 200.5 } }),
      }),
    ).toThrow(/integer/);
  });

  it('shares the iframe.maxHeight integer-or-null constraint (canonical bounds 40-4000)', () => {
    const maxHeightSchema = (
      ((schema.properties as Record<string, { properties?: Record<string, {
        type?: string[];
        minimum?: number;
        maximum?: number;
      }> }>)
        .iframe?.properties) ?? {}
    ).maxHeight;
    expect(maxHeightSchema?.type).toEqual(['integer', 'null']);
    expect(maxHeightSchema?.minimum).toBe(40);
    expect(maxHeightSchema?.maximum).toBe(4000);
    expect(() =>
      defineBlock({
        manifest: valid({ iframe: { ...valid().iframe, maxHeight: 600.5 } }),
      }),
    ).toThrow(/integer/);
  });

  it('iframe disallows additional properties in the canonical schema', () => {
    const iframeSchema = (schema.properties as Record<string, { additionalProperties?: boolean }>)
      .iframe;
    expect(iframeSchema?.additionalProperties).toBe(false);
  });

  it('reflects the canonical required set, and defineBlock rejects each missing field', () => {
    const schemaRequired = new Set((schema.required as string[]) ?? []);
    // The canonical only requires this minimal set (NOT appId/type/targets/iframe/...).
    expect(schemaRequired).toEqual(
      new Set(['blockId', 'version', 'name', 'contentRating', 'scopes']),
    );
    // defineBlock is a strict client-side superset gate: every canonical-required
    // field is also required by defineBlock, so deleting any must throw.
    for (const field of schemaRequired) {
      const manifest = valid();
      delete (manifest as unknown as Record<string, unknown>)[field];
      expect(
        () => defineBlock({ manifest }),
        `defineBlock should reject when canonical-required field "${field}" is missing`,
      ).toThrow();
    }
  });

  it('canonical top-level does not forbid additional properties (additionalProperties absent)', () => {
    // The canonical omits additionalProperties at the top level (defaults to
    // permissive); the old vendored schema set it to `true`. Either way it must
    // not be `false` — defineBlock tolerates extra manifest fields.
    expect(schema.additionalProperties).not.toBe(false);
  });
});
