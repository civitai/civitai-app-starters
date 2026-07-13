import { describe, expect, it } from 'vitest';

import { BlockManifestError, defineBlock } from '../../src/blocks/defineBlock.js';
import type { BlockManifest } from '../../src/blocks/types.js';

function validManifest(overrides: Partial<BlockManifest> = {}): BlockManifest {
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

describe('defineBlock', () => {
  it('returns the manifest unchanged when valid', () => {
    const manifest = validManifest();
    expect(defineBlock({ manifest })).toBe(manifest);
  });

  it('accepts a manifest with every optional field populated', () => {
    const manifest = validManifest({
      assets: [
        { url: 'https://cdn.example.com/a.js', integrity: 'sha384-AAAAAAAAAAAAAAAAAAAA' },
      ],
      settings: {
        // W3 v0 — record keyed by snake_case field name.
        theme: {
          scope: 'publisher',
          type: 'string',
          widget: 'select',
          label: 'Theme',
          description: 'Light or dark.',
          enum: ['light', 'dark'],
          default: 'light',
        },
        count: {
          scope: 'publisher',
          type: 'number',
          widget: 'number',
          label: 'Count',
          description: 'How many items.',
          min: 0,
          max: 10,
          default: 1,
        },
      },
      preview: {
        thumbnail: 'https://cdn.example.com/thumb.png',
        description: 'desc',
        screenshots: ['https://cdn.example.com/s1.png'],
      },
      promotionEligible: true,
      renderMode: 'hybrid',
      assetBundle: { url: null, sha256: null },
      trustTier: 'verified',
    });
    expect(() => defineBlock({ manifest })).not.toThrow();
  });

  describe('iframe.src localhost escape hatch', () => {
    it.each([
      'http://localhost:5173',
      'http://localhost',
      'http://block.localhost:5173',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
    ])('accepts %s', (src) => {
      const manifest = validManifest({ iframe: { ...validManifest().iframe, src } });
      expect(() => defineBlock({ manifest })).not.toThrow();
    });

    it('still rejects 0.0.0.0 (bind-all, not a loopback name)', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, src: 'http://0.0.0.0:5173' },
      });
      expect(() => defineBlock({ manifest })).toThrow(/iframe.src must use https/);
    });

    it('rejects malformed iframe.src that cannot be parsed', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, src: 'not a url' },
      });
      expect(() => defineBlock({ manifest })).toThrow(/iframe.src must use https/);
    });
  });

  describe('rejects invalid manifests', () => {
    it('throws BlockManifestError instances', () => {
      const manifest = validManifest({ blockId: 'BadId' });
      expect(() => defineBlock({ manifest })).toThrow(BlockManifestError);
    });

    it('rejects uppercase blockId', () => {
      const manifest = validManifest({ blockId: 'BadBlock' });
      expect(() => defineBlock({ manifest })).toThrow(/blockId must match/);
    });

    it('rejects blockId shorter than 3 chars', () => {
      const manifest = validManifest({ blockId: 'ab' });
      expect(() => defineBlock({ manifest })).toThrow(/blockId must match/);
    });

    it('rejects blockId with spaces or special chars', () => {
      const manifest = validManifest({ blockId: 'my block!' });
      expect(() => defineBlock({ manifest })).toThrow(/blockId must match/);
    });

    it('rejects non-string blockId (typeof guard, not just pattern coercion)', () => {
      const manifest = validManifest({ blockId: 123 as unknown as string });
      expect(() => defineBlock({ manifest })).toThrow(/blockId must be a non-empty string/);
    });

    it('rejects PascalCase scope with the pointed message', () => {
      const manifest = validManifest({ scopes: ['ModelsReadSelf'] });
      try {
        defineBlock({ manifest });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BlockManifestError);
        expect((err as Error).message).toContain('PascalCase');
        expect((err as Error).message).toContain('ModelsReadSelf');
        expect((err as BlockManifestError).field).toBe('scopes');
      }
    });

    it('rejects non-PascalCase malformed scope with the generic pattern message (no PascalCase mislabel)', () => {
      const manifest = validManifest({ scopes: ['models:read'] });
      try {
        defineBlock({ manifest });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BlockManifestError);
        expect((err as Error).message).not.toContain('PascalCase');
        expect((err as Error).message).toContain('three colon-separated');
      }
    });

    it('rejects a well-formed but UNKNOWN scope (membership, not just format)', () => {
      const manifest = validManifest({ scopes: ['foo:bar:baz'] });
      try {
        defineBlock({ manifest });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BlockManifestError);
        expect((err as Error).message).toContain('unknown block scope');
        expect((err as BlockManifestError).field).toBe('scopes');
      }
    });

    it.each([
      'apps:storage:read',
      'apps:storage:write',
      'apps:storage:shared:read',
      'apps:storage:shared:write',
    ])('accepts the storage scope %s (incl. 4-segment shared scopes)', (scope) => {
      const manifest = validManifest({ scopes: [scope] });
      expect(() => defineBlock({ manifest })).not.toThrow();
    });

    it.each([
      'collections:read:self',
      'collections:write:self',
      'collections:read:private',
    ])('accepts the collections scope %s', (scope) => {
      const manifest = validManifest({ scopes: [scope] });
      expect(() => defineBlock({ manifest })).not.toThrow();
    });

    it('rejects empty scopes array', () => {
      const manifest = validManifest({ scopes: [] });
      expect(() => defineBlock({ manifest })).toThrow(/scopes must be a non-empty array/);
    });

    it('accepts a known optional category', () => {
      const manifest = validManifest({ category: 'utility' });
      expect(() => defineBlock({ manifest })).not.toThrow();
    });

    it('accepts a manifest with category omitted', () => {
      const manifest = validManifest();
      expect((manifest as Record<string, unknown>).category).toBeUndefined();
      expect(() => defineBlock({ manifest })).not.toThrow();
    });

    it('rejects an unknown category', () => {
      const manifest = validManifest({
        category: 'nonsense' as unknown as BlockManifest['category'],
      });
      expect(() => defineBlock({ manifest })).toThrow(/category must be one of/);
    });

    it.each([
      ['allow-scripts allow-same-origin', /allow-same-origin/],
      ['allow-scripts allow-top-navigation', /allow-top-navigation/],
      [
        'allow-scripts allow-top-navigation-by-user-activation',
        /allow-top-navigation-by-user-activation/,
      ],
      [
        'allow-scripts allow-top-navigation-to-custom-protocols',
        /allow-top-navigation-to-custom-protocols/,
      ],
    ] as const)('rejects sandbox containing %s', (sandbox, expected) => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, sandbox },
      });
      expect(() => defineBlock({ manifest })).toThrow(expected);
    });

    it('tokenizes sandbox on any whitespace (tabs, newlines) when rejecting', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, sandbox: 'allow-scripts\tallow-same-origin\nallow-forms' },
      });
      expect(() => defineBlock({ manifest })).toThrow(/allow-same-origin/);
    });

    it('rejects http:// iframe.src that is not loopback', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, src: 'http://blocks.example.com' },
      });
      expect(() => defineBlock({ manifest })).toThrow(/iframe.src must use https/);
    });

    it('rejects empty iframe.src', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, src: '' },
      });
      expect(() => defineBlock({ manifest })).toThrow(/iframe.src must be a non-empty string/);
    });

    it('rejects iframe non-object', () => {
      const manifest = validManifest({ iframe: 'oops' as unknown as BlockManifest['iframe'] });
      expect(() => defineBlock({ manifest })).toThrow(/iframe must be an object/);
    });

    it('rejects iframe.sandbox non-string', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, sandbox: ['allow-scripts'] as unknown as string },
      });
      expect(() => defineBlock({ manifest })).toThrow(/iframe.sandbox must be a string/);
    });

    it.each([0, -1, 200.5, Number.NaN, Number.POSITIVE_INFINITY, 'nope'])(
      'rejects iframe.minHeight %s',
      (minHeight) => {
        const manifest = validManifest({
          iframe: { ...validManifest().iframe, minHeight: minHeight as number },
        });
        expect(() => defineBlock({ manifest })).toThrow(/minHeight must be a positive integer/);
      },
    );

    it.each(['big', 600.5, 0, -1, Number.POSITIVE_INFINITY])(
      'rejects iframe.maxHeight %s',
      (maxHeight) => {
        const manifest = validManifest({
          iframe: { ...validManifest().iframe, maxHeight: maxHeight as number },
        });
        expect(() => defineBlock({ manifest })).toThrow(
          /maxHeight must be a positive integer, null, or omitted/,
        );
      },
    );

    it('accepts manifest with iframe.maxHeight omitted (matches JSON schema, which does not require it)', () => {
      const base = validManifest();
      const { maxHeight: _ignored, ...iframeWithoutMaxHeight } = base.iframe;
      const manifest = { ...base, iframe: iframeWithoutMaxHeight } as BlockManifest;
      expect(() => defineBlock({ manifest })).not.toThrow();
    });

    it('accepts manifest with iframe.maxHeight set to null', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, maxHeight: null },
      });
      expect(() => defineBlock({ manifest })).not.toThrow();
    });

    it('rejects iframe.resizable non-boolean', () => {
      const manifest = validManifest({
        iframe: { ...validManifest().iframe, resizable: 'yes' as unknown as boolean },
      });
      expect(() => defineBlock({ manifest })).toThrow(/resizable must be a boolean/);
    });

    it('rejects name longer than 80 chars', () => {
      const manifest = validManifest({ name: 'x'.repeat(81) });
      expect(() => defineBlock({ manifest })).toThrow(/name must be 80 characters or fewer/);
    });

    it('rejects empty name', () => {
      const manifest = validManifest({ name: '' });
      expect(() => defineBlock({ manifest })).toThrow(/name must be a non-empty string/);
    });

    it('rejects empty appId', () => {
      const manifest = validManifest({ appId: '' });
      expect(() => defineBlock({ manifest })).toThrow(/appId must be a non-empty string/);
    });

    it('rejects non-semver version', () => {
      const manifest = validManifest({ version: 'not-semver' });
      expect(() => defineBlock({ manifest })).toThrow(/version must be semver/);
    });

    it('accepts semver prerelease', () => {
      const manifest = validManifest({ version: '1.2.3-beta.1' });
      expect(() => defineBlock({ manifest })).not.toThrow();
    });

    it('rejects unknown contentRating', () => {
      const manifest = validManifest({
        contentRating: 'mature' as unknown as BlockManifest['contentRating'],
      });
      expect(() => defineBlock({ manifest })).toThrow(/contentRating must be one of/);
    });

    it('rejects unknown manifest.type', () => {
      const manifest = validManifest({
        type: 'widget' as unknown as BlockManifest['type'],
      });
      expect(() => defineBlock({ manifest })).toThrow(/type must be "block" or "embed"/);
    });

    it('rejects empty targets array', () => {
      const manifest = validManifest({ targets: [] });
      expect(() => defineBlock({ manifest })).toThrow(/targets must be a non-empty array/);
    });

    it('rejects target with empty slotId', () => {
      const manifest = validManifest({
        targets: [{ slotId: '', priority: 100 }],
      });
      expect(() => defineBlock({ manifest })).toThrow(/targets\[0\].slotId must be a non-empty string/);
    });

    it('rejects target with non-integer priority', () => {
      const manifest = validManifest({
        targets: [{ slotId: 'slot.a', priority: 1.5 }],
      });
      expect(() => defineBlock({ manifest })).toThrow(/targets\[0\].priority must be an integer/);
    });

    it('rejects asset with non-SRI integrity', () => {
      const manifest = validManifest({
        assets: [{ url: 'https://cdn.example.com/a.js', integrity: 'md5-deadbeef' }],
      });
      expect(() => defineBlock({ manifest })).toThrow(/integrity must be a SubresourceIntegrity hash/);
    });

    it('rejects setting with unknown type', () => {
      const manifest = validManifest({
        settings: {
          x: { scope: 'publisher', type: 'date', label: 'X', description: 'D' },
        } as never,
      });
      expect(() => defineBlock({ manifest })).toThrow(/type must be one of number, string, boolean/);
    });

    it('rejects settings as an array (old v0-pre shape)', () => {
      const manifest = validManifest({
        settings: [{ id: 'x', type: 'number', label: 'X' }] as never,
      });
      expect(() => defineBlock({ manifest })).toThrow(/settings must be an object/);
    });

    it('rejects setting key in non-snake_case', () => {
      const manifest = validManifest({
        settings: {
          BadKey: { scope: 'publisher', type: 'boolean', label: 'L', description: 'D' },
        } as never,
      });
      expect(() => defineBlock({ manifest })).toThrow(/snake_case/);
    });

    it('rejects setting with missing scope', () => {
      const manifest = validManifest({
        settings: {
          x: { type: 'boolean', label: 'L', description: 'D' },
        } as never,
      });
      expect(() => defineBlock({ manifest })).toThrow(/scope must be one of publisher, viewer/);
    });

    it('rejects wrong $schema URL', () => {
      const manifest = validManifest({
        $schema: 'https://example.com/wrong.json' as BlockManifest['$schema'],
      });
      expect(() => defineBlock({ manifest })).toThrow(/\$schema must be/);
    });

    it.each([
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
    ] as const)('rejects when required field %s is missing', (field) => {
      const manifest = validManifest();
      delete (manifest as unknown as Record<string, unknown>)[field];
      expect(() => defineBlock({ manifest })).toThrow(
        new RegExp(`manifest\\.${field.replace('$', '\\$')} is required`),
      );
    });
  });
});
