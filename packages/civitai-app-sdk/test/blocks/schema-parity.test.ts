/**
 * Documents the invariants the JSON schema and `defineBlock` agree on.
 *
 * For each shared rule we build a manifest that violates the rule and assert
 * `defineBlock` rejects it. If a rule lives only in the JSON schema and not in
 * `defineBlock`, a block author won't see the failure until `civitai deploy`
 * — that's the gap class this test guards against.
 *
 * NOTE: this is not a true bidirectional parity check (we don't run an
 * AJV validator against the manifests). Adding ajv is a follow-up if the
 * server starts using the schema as its source of truth.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defineBlock } from '../../src/blocks/defineBlock.js';
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

describe('JSON schema ↔ defineBlock parity', () => {
  it('shares the same blockId pattern', () => {
    const pattern = (schema.properties as Record<string, { pattern?: string }>).blockId?.pattern;
    expect(pattern).toBe('^[a-z0-9-]{3,64}$');
    expect(() => defineBlock({ manifest: valid({ blockId: 'BadId' }) })).toThrow();
  });

  it('shares the same scope pattern (3 colon-segments, lowercase)', () => {
    const pattern = (
      (schema.properties as Record<string, { items?: { pattern?: string } }>).scopes?.items
    )?.pattern;
    expect(pattern).toBe('^[a-z]+:[a-z]+:[a-z]+$');
    expect(() => defineBlock({ manifest: valid({ scopes: ['ModelsReadSelf'] }) })).toThrow();
    expect(() => defineBlock({ manifest: valid({ scopes: ['models:read'] }) })).toThrow();
  });

  it('shares the name maxLength of 80', () => {
    const maxLen = (schema.properties as Record<string, { maxLength?: number }>).name?.maxLength;
    expect(maxLen).toBe(80);
    expect(() => defineBlock({ manifest: valid({ name: 'x'.repeat(81) }) })).toThrow();
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

  it('shares the manifest.type enum', () => {
    const enumVals = (schema.properties as Record<string, { enum?: string[] }>).type?.enum;
    expect(enumVals).toEqual(['block', 'embed']);
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
  ])('both reject sandbox token %s', (token) => {
    expect(() =>
      defineBlock({
        manifest: valid({
          iframe: { ...valid().iframe, sandbox: `allow-scripts ${token}` },
        }),
      }),
    ).toThrow();
  });

  it('shares the iframe.minHeight integer constraint', () => {
    const minHeightSchema = (
      ((schema.properties as Record<string, { properties?: Record<string, { type?: string }> }>)
        .iframe?.properties) ?? {}
    ).minHeight;
    expect(minHeightSchema?.type).toBe('integer');
    expect(() =>
      defineBlock({
        manifest: valid({ iframe: { ...valid().iframe, minHeight: 200.5 } }),
      }),
    ).toThrow(/integer/);
  });

  it('shares the iframe.maxHeight integer constraint', () => {
    const maxHeightSchema = (
      ((schema.properties as Record<string, { properties?: Record<string, { type?: string[] }> }>)
        .iframe?.properties) ?? {}
    ).maxHeight;
    expect(maxHeightSchema?.type).toEqual(['integer', 'null']);
    expect(() =>
      defineBlock({
        manifest: valid({ iframe: { ...valid().iframe, maxHeight: 600.5 } }),
      }),
    ).toThrow(/integer/);
  });

  it('shares the same required-field set', () => {
    const schemaRequired = new Set((schema.required as string[]) ?? []);
    const expected = new Set([
      '$schema',
      'appId',
      'blockId',
      'version',
      'name',
      'type',
      'targets',
      'scopes',
      'iframe',
      'contentRating',
      'minApiVersion',
    ]);
    expect(schemaRequired).toEqual(expected);
    for (const field of schemaRequired) {
      const manifest = valid();
      delete (manifest as unknown as Record<string, unknown>)[field];
      expect(
        () => defineBlock({ manifest }),
        `defineBlock should reject when required field "${field}" is missing`,
      ).toThrow();
    }
  });
});
